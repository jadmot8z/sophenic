import json

import httpx
from pydantic import BaseModel

from core.config import Settings
from llm.model_config import OPTIONS


class OllamaClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.http = httpx.AsyncClient(
            base_url=settings.ollama_url, timeout=settings.llm_timeout, trust_env=False
        )

    async def health(self):
        response = await self.http.get("/api/tags", timeout=5)
        response.raise_for_status()
        names = [m["name"] for m in response.json().get("models", [])]
        return {"available": self.settings.model in names, "model": self.settings.model, "models": names}

    async def structured(self, messages: list[dict], schema: type[BaseModel]):
        """One repair attempt, no unbounded retries and no executable model code."""
        messages = list(messages)
        for attempt in range(2):
            response = await self.http.post(
                "/api/chat",
                json={
                    "model": self.settings.model,
                    "messages": messages,
                    "stream": False,
                    "think": False,
                    "format": schema.model_json_schema(),
                    "options": {**OPTIONS, "num_ctx": self.settings.context_size},
                    "keep_alive": "10m",
                },
            )
            response.raise_for_status()
            content = response.json()["message"]["content"]
            try:
                return schema.model_validate(json.loads(content))
            except (ValueError, TypeError) as exc:
                if attempt:
                    raise ValueError("Ollama n'a pas produit une commande JSON valide") from exc
                messages += [
                    {"role": "assistant", "content": content[:10000]},
                    {"role": "user", "content": "JSON invalide. Respecte strictement le schéma fourni."},
                ]

    async def close(self):
        await self.http.aclose()
