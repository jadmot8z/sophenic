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
    page.is_closed.return_value = False
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


async def test_travel_year_clarified_before_planning_or_search(tmp_path):
    args = components(tmp_path, [Action(action="finish", answer="Pas de tarif vérifié")])
    args[4].create_task("t", "billet Paris Marrakech du 20 au 30 août")
    engine = AgentEngine(*args, "t")
    pending = asyncio.Event()
    engine.decision.emit = lambda kind, data: pending.set() if kind == "intervention" else None
    job = asyncio.create_task(engine.run("billet Paris Marrakech du 20 au 30 août"))
    try:
        await asyncio.wait_for(pending.wait(), 2)
        args[1].structured.assert_not_awaited()
        args[3].execute.assert_not_awaited()
        assert "année" in engine.decision.pending["message"]
        engine.decision.resolve(engine.decision.pending["id"], True, "2027, avion")
        await job
        first_prompt = args[1].structured.call_args_list[0].args[0]
        assert "2027, avion" in first_prompt[1]["content"]
        assert args[4].tasks()[0]["status"] == "completed"
    finally:
        if not job.done():
            job.cancel()
            try:
                await job
            except asyncio.CancelledError:
                pass
        args[4].close()


async def test_loop_recovers_and_can_finish_instead_of_crashing(tmp_path):
    repeated = Action(action="observe")
    args = components(
        tmp_path,
        [
            repeated,
            repeated,
            repeated,
            Plan(steps=["Changer de source"]),
            Action(action="finish", answer="Blocage expliqué"),
        ],
    )
    args[4].create_task("t", "recherche")
    try:
        await AgentEngine(*args, "t").run("recherche")
        assert args[4].tasks()[0]["status"] == "completed"
        assert any(e["kind"] == "recovery" for e in args[4].events("t"))
        assert not any(e["kind"] == "error" for e in args[4].events("t"))
    finally:
        args[4].close()


async def test_persistent_loop_requests_human_instead_of_crashing(tmp_path):
    a = Action(action="observe")
    args = components(
        tmp_path,
        [a, a, a, Plan(steps=["Changer la source"]), a, a, a, Plan(steps=["Autre approche"]), a, a, a],
    )
    args[4].create_task("t", "recherche")
    engine = AgentEngine(*args, "t")
    pending = asyncio.Event()
    engine.decision.emit = lambda kind, data: pending.set() if kind == "intervention" else None
    job = asyncio.create_task(engine.run("recherche"))
    try:
        await asyncio.wait_for(pending.wait(), 2)
        assert engine.phase == "WAITING_USER"
        assert "deux changements" in engine.decision.pending["message"]
        engine.decision.resolve(engine.decision.pending["id"], False)
        await job
        assert args[4].tasks()[0]["status"] == "cancelled"
        assert not any(e["kind"] == "error" for e in args[4].events("t"))
    finally:
        if not job.done():
            job.cancel()
            try:
                await job
            except asyncio.CancelledError:
                pass
        args[4].close()


async def test_wrong_year_search_is_not_executed(tmp_path):
    bad = Action(action="search", value="billets de train Paris Marrakech août 2023")
    good = Action(action="search", value="vol Paris Marrakech 20 au 30 août 2027")
    args = components(
        tmp_path,
        [
            bad,
            Plan(steps=["Respecter le vol et les dates"]),
            good,
            Action(action="finish", answer="Aucun tarif vérifié"),
        ],
    )
    args[4].create_task("t", "vol Paris Marrakech 20 au 30 août 2027")
    try:
        await AgentEngine(*args, "t").run("vol Paris Marrakech 20 au 30 août 2027")
        args[3].execute.assert_awaited_once_with(good)
        assert args[4].tasks()[0]["status"] == "completed"
    finally:
        args[4].close()


async def test_closed_page_during_thinking_does_not_execute_stale_action(tmp_path):
    from browser.errors import BrowserUnavailable

    args = components(
        tmp_path, [Action(action="click", target="e1"), Action(action="finish", answer="Page relue")]
    )
    args[4].create_task("t", "recherche")
    page = args[2].current.return_value
    args[2].current.side_effect = [page, BrowserUnavailable("Onglet fermé"), page]
    try:
        await AgentEngine(*args, "t").run("recherche")
        args[3].execute.assert_not_awaited()
        assert args[4].tasks()[0]["status"] == "completed"
        assert any(e["kind"] == "recovery" for e in args[4].events("t"))
    finally:
        args[4].close()


async def test_interrupted_send_requests_verification_even_in_always_accept(tmp_path):
    from browser.errors import BrowserActionInterrupted

    args = components(tmp_path, [Action(action="click", target="e1", impact="send")])
    args[4].create_task("t", "Envoyer")
    args[3].execute.side_effect = BrowserActionInterrupted("Résultat incertain")
    args[2].ensure_page = AsyncMock()
    engine = AgentEngine(*args, "t")
    engine.decision.permission_mode = "always_accept"
    pending = asyncio.Event()
    engine.decision.emit = lambda kind, data: pending.set() if kind == "intervention" else None
    job = asyncio.create_task(engine.run("Envoyer"))
    try:
        await asyncio.wait_for(pending.wait(), 2)
        assert "peut-être déjà" in engine.decision.pending["message"]
        engine.decision.resolve(engine.decision.pending["id"], False)
        await job
        args[3].execute.assert_awaited_once()
        assert args[4].tasks()[0]["status"] == "cancelled"
    finally:
        if not job.done():
            job.cancel()
            try:
                await job
            except asyncio.CancelledError:
                pass
        args[4].close()


async def test_explicit_google_refusal_is_not_a_login_retry_loop(tmp_path):
    args = components(tmp_path, [])
    args[4].create_task("t", "Ouvrir Gmail")
    args[2].observe.return_value = {
        "url": "https://accounts.google.com/signin",
        "text": "This browser or app may not be secure.",
        "elements": [],
        "errors": [],
    }
    try:
        await AgentEngine(*args, "t").run("Ouvrir Gmail")
        assert args[4].tasks()[0]["status"] == "needs_attention"
        assert args[1].structured.await_count == 1  # Plan only, no repeated login decisions.
        args[3].execute.assert_not_awaited()
    finally:
        args[4].close()
