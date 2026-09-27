import asyncio

import pytest
from pydantic import ValidationError

from core.action_policy import consent_reason, needs_human_credentials
from core.decision_system import DecisionSystem
from core.models import Action


def page(label="", **extra):
    return {"url": "https://example.com", "elements": [{"id": "e1", "label": label, **extra}]}


@pytest.mark.parametrize(
    "action,observation",
    [
        (Action(action="open_url", url="https://mail.google.com"), {}),
        (Action(action="search", value="vol Paris Marrakech"), {}),
        (Action(action="click", target="e1"), page("Nouveau message", tag="button", type="button")),
        (Action(action="type", target="e1", value="Salut"), page("Corps du message")),
        (Action(action="click", target="e1"), page("Rechercher", type="submit")),
        (Action(action="back"), {}),
        (Action(action="press", value="Enter"), {"focused": {"tag": "input", "type": "search"}}),
    ],
)
async def test_routine_actions_are_automatic(action, observation):
    decision = DecisionSystem(lambda *args: None)
    assert consent_reason(action, observation) is None
    assert await decision.authorize(action, observation)
    assert decision.pending is None


@pytest.mark.parametrize(
    "label",
    [
        "Envoyer",
        "Send",
        "Publier",
        "Supprimer",
        "Payer 45 €",
        "Acheter",
        "Confirmer",
        "Place order",
        "Tout accepter",
    ],
)
def test_final_buttons_cannot_be_downgraded_by_model(label):
    assert consent_reason(Action(action="click", target="e1", impact="routine"), page(label))


def test_extra_sensitive_paths():
    assert consent_reason(Action(action="upload", target="e1", value="doc.pdf"), {})
    assert consent_reason(Action(action="click", target="e1", impact="send"), page("Go"))
    assert consent_reason(Action(action="press", value="Enter"), {"focused": {"tag": "textarea"}})
    assert consent_reason(Action(action="press", value="Enter"), {})
    assert consent_reason(Action(action="open_url", url="https://example.com/delete?id=1"), {})
    assert consent_reason(Action(action="click", target="e1"), page("Continue", type="submit"))


@pytest.mark.parametrize(
    "metadata",
    [
        {"type": "password"},
        {"autocomplete": "one-time-code"},
        {"label": "Code de vérification"},
    ],
)
def test_credentials_are_manual(metadata):
    element = {"id": "e1", "label": "secret", **metadata}
    assert needs_human_credentials(
        Action(action="type", target="e1", value="secret"), {"elements": [element]}
    )


def test_help_contract():
    with pytest.raises(ValidationError):
        Action(action="ask_user")
    assert Action(action="ask_user", value="Quelle adresse email exacte ?").value
    with pytest.raises(ValidationError):
        Action(action="click", target="e1", impact="ignore_safety")


async def test_human_intervention_resume_and_expired_id():
    decision = DecisionSystem(lambda *args: None)
    job = asyncio.create_task(decision.request_help(Action(action="ask_user", value="Connectez-vous"), {}))
    await asyncio.sleep(0)
    identifier = decision.pending["id"]
    assert decision.pending["kind"] == "intervention"
    decision.resolve(identifier, True, "Compte connecté ; destinataire : ami@example.com")
    assert await job
    assert decision.response.startswith("Compte connecté")
    assert decision.pending is None
    with pytest.raises(ValueError):
        decision.resolve(identifier, True)


async def test_human_intervention_timeout():
    decision = DecisionSystem(lambda *args: None, human_timeout=0.01)
    with pytest.raises(RuntimeError, match="Délai de réponse"):
        await decision.request_help(Action(action="ask_user", value="Connectez-vous"), {})
    assert decision.pending is None


async def test_human_intervention_cancel_cleanup():
    decision = DecisionSystem(lambda *args: None)
    job = asyncio.create_task(decision.request_help(Action(action="ask_user", value="Connectez-vous"), {}))
    await asyncio.sleep(0)
    job.cancel()
    with pytest.raises(asyncio.CancelledError):
        await job
    assert decision.pending is None
