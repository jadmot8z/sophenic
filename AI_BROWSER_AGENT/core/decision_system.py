import asyncio
import hashlib
import json
import uuid
from collections import Counter


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
    # Even a GET link may delete or publish. Strict mode approves navigation too.
    SAFE = {"observe", "scroll", "switch_tab", "finish"}

    def __init__(self, emit):
        self.emit = emit
        self.pending = None
        self.future = None

    async def authorize(self, action, observation):
        if action.action in self.SAFE:
            return True
        identifier = uuid.uuid4().hex
        self.pending = {
            "id": identifier,
            "action": action.model_dump(),
            "page_url": observation.get("url"),
            "element": next(
                (
                    e
                    for e in observation.get("elements", [])
                    if e["id"] == action.target or e["label"] == action.target
                ),
                None,
            ),
            "warning": "Cette action peut transmettre des données ou modifier un site. Vérifiez la cible et la valeur.",
        }
        self.future = asyncio.get_running_loop().create_future()
        # Persist only an ID, never the unredacted approval payload.
        self.emit("confirmation", {"id": identifier, "action": action.action})
        try:
            return await asyncio.wait_for(self.future, timeout=180)
        finally:
            self.pending = self.future = None

    def resolve(self, identifier, approved):
        if not self.pending or self.pending["id"] != identifier or self.future.done():
            raise ValueError("Confirmation expirée ou inconnue")
        self.future.set_result(approved)
