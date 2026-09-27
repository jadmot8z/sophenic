import asyncio
import hashlib
import json
import uuid
from collections import Counter

from core.action_policy import consent_reason, target_element


class LoopGuard:
    def __init__(self):
        self.seen = Counter()
        self.unchanged = 0
        self.previous = None

    def check(self, action, observation):
        # Element IDs change with each observation; normalize to element descriptions.
        data = action.model_dump()
        element = next((e for e in observation.get("elements", []) if e["id"] == action.target), None)
        if element:
            data["target"] = {k: v for k, v in element.items() if k != "id"}
        fingerprint = hashlib.sha256(
            json.dumps([data, observation.get("url"), observation.get("text")], sort_keys=True).encode()
        ).hexdigest()
        self.seen[fingerprint] += 1
        if self.seen[fingerprint] >= 3:
            raise RuntimeError("Anti-boucle : même action répétée trois fois sur une page inchangée")
        state = (observation.get("url"), observation.get("text"))
        self.unchanged = self.unchanged + 1 if state == self.previous else 0
        self.previous = state
        if self.unchanged >= 8:
            raise RuntimeError("Anti-boucle : huit étapes sans changement observable")


class DecisionSystem:
    def __init__(self, emit, human_timeout=900):
        self.emit = emit
        self.human_timeout = human_timeout
        self.response = ""
        self.pending = None
        self.future = None

    async def authorize(self, action, observation):
        reason = consent_reason(action, observation)
        if reason is None:
            return True
        return await self._wait(action, observation, "confirmation", reason, 180)

    async def request_help(self, action, observation):
        return await self._wait(action, observation, "intervention", action.value, self.human_timeout)

    async def _wait(self, action, observation, kind, message, timeout):
        identifier = uuid.uuid4().hex
        self.response = ""
        self.pending = {
            "id": identifier,
            "kind": kind,
            "action": action.model_dump(),
            "page_url": observation.get("url"),
            "element": target_element(action, observation),
            "message": message,
            "summary": action.summary,
            "warning": "Ne saisissez aucun mot de passe ou code secret ici. Utilisez la fenêtre Chromium.",
        }
        self.future = asyncio.get_running_loop().create_future()
        self.emit(kind, {"id": identifier, "action": action.action})
        try:
            return await asyncio.wait_for(self.future, timeout=timeout)
        except TimeoutError as exc:
            raise RuntimeError("Délai de réponse utilisateur dépassé ; tâche arrêtée") from exc
        finally:
            self.pending = self.future = None

    def resolve(self, identifier, approved, response=""):
        if not self.pending or self.pending["id"] != identifier or self.future.done():
            raise ValueError("Confirmation expirée ou inconnue")
        if self.pending["kind"] == "intervention" and approved:
            self.response = response
        self.future.set_result(approved)
