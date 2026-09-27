import asyncio
import hashlib
import json
import uuid
from collections import Counter

from core.action_policy import consent_reason, target_element
from core.progress import progress_signature


class LoopDetected(RuntimeError):
    """Recoverable lack of progress, never a raw terminal error for the user."""


class LoopGuard:
    def __init__(self):
        self.seen = Counter()
        self.unchanged = 0
        self.previous = None

    def check(self, action, observation):
        # Element IDs change with each observation; normalize to element descriptions.
        if action.action in {"finish", "ask_user"}:
            return
        data = action.model_dump(include={"action", "target", "value", "url"})
        element = next((e for e in observation.get("elements", []) if e["id"] == action.target), None)
        if element:
            data["target"] = {k: v for k, v in element.items() if k != "id"}
        state = progress_signature(observation)
        fingerprint = hashlib.sha256(json.dumps([data, state], sort_keys=True).encode()).hexdigest()
        self.seen[fingerprint] += 1
        if self.seen[fingerprint] >= 3:
            raise LoopDetected("La même action revient sans effet observable sur la page.")
        self.unchanged = self.unchanged + 1 if state == self.previous else 0
        self.previous = state
        if self.unchanged >= 8:
            raise LoopDetected("La page et les champs ne progressent plus depuis plusieurs étapes.")


class DecisionSystem:
    def __init__(self, emit, human_timeout=900, permission_mode="sensitive"):
        self.emit = emit
        self.permission_mode = permission_mode
        self.human_timeout = human_timeout
        self.response = ""
        self.pending = None
        self.future = None

    async def authorize(self, action, observation):
        if action.action in {"finish", "ask_user", "observe"}:
            return True
        if self.permission_mode == "always_accept":
            return True
        if self.permission_mode == "always_ask":
            reason = "Le mode Toujours demander exige votre accord pour cette action."
        else:
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
            "permission_mode": self.permission_mode,
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
