import json

import httpx
import pytest

from core.config import Settings
from core.models import Action
from llm.ollama_client import OllamaClient


async def test_ollama_json_repair_and_model():
    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        assert body["model"] == "qwen3:14b"
        assert body["think"] is False
        assert body["format"]["additionalProperties"] is False
        content = "not JSON" if len(requests) == 1 else '{"action":"observe"}'
        return httpx.Response(200, json={"message": {"content": content}})

    client = OllamaClient(Settings())
    await client.http.aclose()
    client.http = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://ollama.test")
    try:
        result = await client.structured([{"role": "user", "content": "Observe"}], Action)
        assert result.action == "observe"
        assert len(requests) == 2
    finally:
        await client.close()


async def test_invalid_command_never_executed():
    client = OllamaClient(Settings())
    await client.http.aclose()
    client.http = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(200, json={"message": {"content": '{"action":"shell"}'}})
        ),
        base_url="http://ollama.test",
    )
    try:
        with pytest.raises(ValueError, match="JSON valide"):
            await client.structured([], Action)
    finally:
        await client.close()
