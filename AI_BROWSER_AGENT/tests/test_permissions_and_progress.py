import asyncio
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from core.decision_system import DecisionSystem, LoopDetected, LoopGuard
from core.models import Action
from core.progress import progress_signature
from core.task_context import search_mismatch, travel_question
from llm.prompt_manager import messages


async def test_always_ask_requires_ordinary_search_consent():
    decision = DecisionSystem(lambda *args: None, permission_mode="always_ask")
    job = asyncio.create_task(decision.authorize(Action(action="search", value="vols"), {}))
    await asyncio.sleep(0)
    assert decision.pending["permission_mode"] == "always_ask"
    decision.resolve(decision.pending["id"], True)
    assert await job


@pytest.mark.parametrize(
    "action",
    [
        Action(action="click", target="e1", impact="send"),
        Action(action="upload", target="e1", value="document.pdf"),
        Action(action="click", target="e1", impact="purchase"),
    ],
)
async def test_always_accept_includes_sensitive_actions(action):
    decision = DecisionSystem(lambda *args: None, permission_mode="always_accept")
    assert await decision.authorize(action, {})
    assert decision.pending is None


async def test_always_accept_still_waits_for_user_information():
    decision = DecisionSystem(lambda *args: None, permission_mode="always_accept")
    job = asyncio.create_task(decision.request_help(Action(action="ask_user", value="Quelle année ?"), {}))
    await asyncio.sleep(0)
    assert not job.done()
    decision.resolve(decision.pending["id"], True, "2027")
    assert await job
    assert decision.response == "2027"


async def test_mode_change_does_not_resolve_existing_confirmation():
    decision = DecisionSystem(lambda *args: None, permission_mode="always_ask")
    job = asyncio.create_task(decision.authorize(Action(action="search", value="vols"), {}))
    await asyncio.sleep(0)
    decision.permission_mode = "always_accept"
    assert not job.done()
    decision.resolve(decision.pending["id"], False)
    assert not await job


async def test_search_not_sensitive_even_if_model_misclassifies():
    decision = DecisionSystem(lambda *args: None)
    assert await decision.authorize(
        Action(action="search", value="vols Paris Marrakech", impact="other_sensitive"), {}
    )
    assert decision.pending is None


def test_form_filling_counts_as_progress():
    guard = LoopGuard()
    for index in range(20):
        guard.check(
            Action(action="type", target="e1", value="date"),
            {
                "url": "https://example.com",
                "text": "Formulaire inchangé",
                "form_fingerprint": f"changed-{index}",
            },
        )


def test_scrolling_counts_as_progress():
    guard = LoopGuard()
    for index in range(20):
        guard.check(
            Action(action="scroll", value="bas"),
            {
                "url": "https://example.com",
                "text": "Texte inchangé",
                "scroll": {"y": index * 600},
            },
        )


def test_changed_reason_does_not_hide_repeated_action():
    guard = LoopGuard()
    for index in range(2):
        guard.check(Action(action="search", value="same", reason=str(index)), {"text": "same"})
    with pytest.raises(LoopDetected):
        guard.check(Action(action="search", value="same", reason="a new explanation"), {"text": "same"})


def test_finish_never_rejected_for_lack_of_page_change():
    guard = LoopGuard()
    for _ in range(15):
        guard.check(Action(action="finish", answer="Résultat"), {"text": "same"})


def test_signature_ignores_generation_ids():
    assert progress_signature({"elements": [{"id": "e1", "label": "Search"}]}) == progress_signature(
        {"elements": [{"id": "e2", "label": "Search"}]}
    )


def test_travel_missing_year_is_clarified():
    assert travel_question("billet du 20 au 30 août paris marrakech aller retour")
    assert travel_question("vol 20/08 - 30/08 Paris Marrakech")
    assert travel_question("vol Paris Marrakech 20 au 30 août 2027") is None
    assert travel_question("Ouvre Gmail") is None


def test_reject_stale_year_and_wrong_transport_in_search():
    goal = "vol Paris Marrakech 20 au 30 août 2027"
    assert search_mismatch(goal, Action(action="search", value="vol Paris Marrakech août 2023"))
    assert search_mismatch(goal, Action(action="search", value="billets de train Paris Marrakech août 2027"))
    assert search_mismatch(goal, Action(action="search", value="vol Paris Marrakech août 2027")) is None
    assert (
        search_mismatch("historique billets avion 2023", Action(action="search", value="billets avion 2023"))
        is None
    )


def test_current_date_is_injected_on_every_decision():
    with patch("core.task_context.datetime") as clock:
        clock.now.return_value = datetime(2028, 1, 5, 12, tzinfo=timezone.utc)
        prompt = messages("recherche", [], {}, [], {}, [])[0]["content"]
    assert "2028-01-05" in prompt
    assert "HORLOGE LOCALE ACTUELLE" in prompt


def test_focus_changes_count_as_progress():
    guard = LoopGuard()
    for i in range(20):
        guard.check(Action(action="press", value="Tab"), {"text": "same", "focused": {"label": f"field {i}"}})
