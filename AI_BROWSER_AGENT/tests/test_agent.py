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


async def test_login_pause_and_fresh_observation(tmp_path):
    args = components(tmp_path, [Action(action="finish", answer="Session disponible")])
    args[4].create_task("t", "Ouvrir Gmail")
    args[2].observe.side_effect = [
        {"url": "https://accounts.google.com/signin", "text": "Connexion", "elements": [], "errors": []},
        {"url": "https://mail.google.com", "text": "Boîte de réception", "elements": [], "errors": []},
    ]
    engine = AgentEngine(*args, "t")
    pending = asyncio.Event()
    engine.decision.emit = lambda kind, data: pending.set() if kind == "intervention" else None
    job = asyncio.create_task(engine.run("Ouvrir Gmail"))
    try:
        await asyncio.wait_for(pending.wait(), 2)
        assert engine.phase == "WAITING_USER"
        assert engine.deadline.when() is None
        args[3].execute.assert_not_awaited()
        # Only the plan has used Ollama; the login observation was not sent to it.
        assert args[1].structured.await_count == 1
        engine.decision.resolve(engine.decision.pending["id"], True)
        await job
        assert args[2].observe.await_count == 2
        assert args[4].tasks()[0]["status"] == "completed"
        assert engine.deadline.when() is not None
    finally:
        if not job.done():
            job.cancel()
        args[4].close()


async def test_requested_information_reaches_next_decision(tmp_path):
    args = components(
        tmp_path,
        [
            Action(action="ask_user", value="Quelle adresse exacte ?"),
            Action(action="finish", answer="Précision reçue"),
        ],
    )
    args[4].create_task("t", "Préparer un mail")
    engine = AgentEngine(*args, "t")
    pending = asyncio.Event()
    engine.decision.emit = lambda kind, data: pending.set() if kind == "intervention" else None
    job = asyncio.create_task(engine.run("Préparer un mail"))
    try:
        await asyncio.wait_for(pending.wait(), 2)
        engine.decision.resolve(engine.decision.pending["id"], True, "ami@example.com")
        await job
        messages = args[1].structured.call_args.args[0]
        assert "ami@example.com" in messages[1]["content"]
        assert not any("ami@example.com" in str(e) for e in args[4].events("t"))
    finally:
        if not job.done():
            job.cancel()
        args[4].close()
