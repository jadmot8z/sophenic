import asyncio
import uuid

from core.agent_engine import AgentEngine


class TaskManager:
    def __init__(self, settings, llm, browser, tools, storage, memory):
        self.args = settings, llm, browser, tools, storage, memory
        self.storage = storage
        self.memory = memory
        saved_mode = memory.preferences().get("permission_mode", "sensitive")
        self.permission_mode = (
            saved_mode if saved_mode in {"always_ask", "sensitive", "always_accept"} else "sensitive"
        )
        self.engine = self.job = None
        # Crash recovery never resumes side effects without user consent.
        storage.recover_tasks()

    def set_permission_mode(self, mode):
        if mode not in {"always_ask", "sensitive", "always_accept"}:
            raise ValueError("Mode de permission inconnu")
        self.permission_mode = mode
        self.memory.set_preference("permission_mode", mode)
        if self.engine:
            # An already pending question remains pending: a mode change does not answer it.
            self.engine.decision.permission_mode = mode
            if self.busy():
                self.engine.emit("permission_mode", {"mode": mode})

    def busy(self):
        return self.job is not None and not self.job.done()

    def start(self, goal):
        if self.busy():
            raise ValueError("Une tâche est déjà en cours")
        identifier = uuid.uuid4().hex
        self.storage.create_task(identifier, goal)
        self.engine = AgentEngine(*self.args, identifier)
        self.engine.decision.permission_mode = self.permission_mode
        self.engine.emit("permission_mode", {"mode": self.permission_mode})
        self.job = asyncio.create_task(self.engine.run(goal), name=f"agent-{identifier}")
        return identifier

    async def stop(self):
        if self.busy():
            self.job.cancel()
            try:
                await self.job
            except asyncio.CancelledError:
                pass
            finally:
                if self.engine.phase == "queued":
                    self.storage.update_task(self.engine.task_id, "cancelled", "Arrêt avant démarrage")
                    self.engine.phase = "idle"
                # Closing Chromium prevents further page-side work after cancellation.
                await self.args[2].close()

    def state(self):
        return {
            "busy": self.busy(),
            "permission_mode": self.permission_mode,
            "task_id": self.engine.task_id if self.engine else None,
            "phase": self.engine.phase if self.engine else "idle",
            "confirmation": self.engine.decision.pending if self.engine and self.busy() else None,
        }
