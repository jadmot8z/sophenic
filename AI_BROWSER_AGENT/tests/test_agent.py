"""Orchestration unit tests use doubles; production never falls back to them."""

import asyncio
from unittest.mock import AsyncMock, Mock

from core.agent_engine import AgentEngine
from core.config import Settings
from core.models import Action, Plan
from core.task_manager import TaskManager
from memory.long_term_memory import LongTermMemory
from memory.sqlite_storage import SQLiteStorage


def components(tmp_path, actions):
    storage = SQLiteStorage(tmp_path / "test.db")
    memory = LongTermMemory(storage)
    llm = Mock()
    llm.health = AsyncMock(return_value={"available": True})
    llm.structured = AsyncMock(side_effect=[Plan(steps=["Observer puis répondre"]), *actions])
    page = Mock(url="https://example.com")
    browser = Mock()
    browser.current.return_value = page
    browser.lock = asyncio.Lock()
    browser.start = AsyncMock()
    browser.close = AsyncMock()
    browser.observe = AsyncMock(
        return_value={"url": page.url, "text": "Example", "elements": [], "errors": []}
    )
    tools = Mock()
    tools.files.list_files.return_value = []
    tools.execute = AsyncMock(return_value={"ok": True})
    return Settings(data_dir=tmp_path), llm, browser, tools, storage, memory


async def test_finish_stores_answer(tmp_path):
    args = components(tmp_path, [Action(action="finish", answer="Source : https://example.com")])
    args[4].create_task("t", "recherche")
    try:
        await AgentEngine(*args, "t").run("recherche")
        assert args[4].tasks()[0]["status"] == "completed"
        args[3].execute.assert_not_awaited()
    finally:
        args[4].close()


async def test_refusal_stops_without_side_effect(tmp_path):
    args = components(tmp_path, [Action(action="click", target="e1")])
    args[4].create_task("t", "recherche")
    engine = AgentEngine(*args, "t")
    engine.decision.authorize = AsyncMock(return_value=False)
    try:
        await engine.run("recherche")
        assert args[4].tasks()[0]["status"] == "cancelled"
        args[3].execute.assert_not_awaited()
    finally:
        args[4].close()


async def test_stop_and_single_task(tmp_path):
    import pytest

    args = components(tmp_path, [])
    started = asyncio.Event()

    async def slow_health():
        started.set()
        await asyncio.Event().wait()

    args[1].health = slow_health
    manager = TaskManager(*args)
    try:
        manager.start("recherche")
        await started.wait()
        with pytest.raises(ValueError):
            manager.start("autre recherche")
        await manager.stop()
        assert not manager.busy()
        assert args[4].tasks()[0]["status"] == "cancelled"
        args[2].close.assert_awaited_once()
    finally:
        args[4].close()


async def test_crash_recovery(tmp_path):
    args = components(tmp_path, [])
    try:
        args[4].create_task("old", "ancienne tâche")
        args[4].update_task("old", "running")
        manager = TaskManager(*args)
        assert not manager.busy()
        assert args[4].tasks()[0]["status"] == "interrupted"
    finally:
        args[4].close()


async def test_stop_before_job_started(tmp_path):
    args = components(tmp_path, [])
    manager = TaskManager(*args)
    try:
        manager.start("recherche")
        await manager.stop()
        assert args[4].tasks()[0]["status"] == "cancelled"
        assert manager.state()["phase"] == "idle"
    finally:
        args[4].close()
