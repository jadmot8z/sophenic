import pytest
from pydantic import ValidationError

from core.decision_system import DecisionSystem, LoopGuard
from core.models import Action
from tools.file_tools import FileTools
from tools.utility_tools import public_action, validate_url


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "http://localhost/",
        "http://127.0.0.1",
        "http://[::1]",
        "http://192.168.1.1",
        "https://user:pass@example.com",
        "http://example.com:11434",
        "http://169.254.169.254",
        "http://localhost.",
        "http://printer",
    ],
)
def test_unsafe_urls(url):
    with pytest.raises(ValueError):
        validate_url(url)


def test_public_url():
    assert validate_url("https://example.com/path?q=1").startswith("https://")


@pytest.mark.parametrize(
    "data",
    [
        {"action": "shell"},
        {"action": "click"},
        {"action": "open_url"},
        {"action": "finish"},
        {"action": "observe", "script": "bad"},
    ],
)
def test_contract(data):
    with pytest.raises(ValidationError):
        Action.model_validate(data)


def test_file_boundary(tmp_path):
    files = FileTools(tmp_path)
    (files.root / "ok.txt").write_text("hi")
    assert files.resolve_upload("ok.txt").endswith("ok.txt")
    for name in ["../secret", "..\\secret", "/etc/passwd", "absent"]:
        with pytest.raises(ValueError):
            files.resolve_upload(name)


def test_loop_guard_normalizes_ids():
    guard = LoopGuard()
    for i in range(3):
        action = Action(action="click", target=f"e{i}")
        obs = {"url": "https://example.com", "text": "same", "elements": [{"id": f"e{i}", "label": "Buy"}]}
        if i == 2:
            with pytest.raises(RuntimeError):
                guard.check(action, obs)
        else:
            guard.check(action, obs)


def test_no_form_values_in_action_log():
    assert "secret" not in str(public_action(Action(action="type", target="e1", value="secret")))


async def test_confirmation_and_stale_id():
    import asyncio

    decision = DecisionSystem(lambda *args: None)
    task = asyncio.create_task(decision.authorize(Action(action="click", target="e1"), {}))
    await asyncio.sleep(0)
    with pytest.raises(ValueError):
        decision.resolve("bad", True)
    decision.resolve(decision.pending["id"], False)
    assert await task is False
    assert decision.pending is None


async def test_observe_does_not_need_approval():
    decision = DecisionSystem(lambda *args: None)
    assert await decision.authorize(Action(action="observe"), {})
