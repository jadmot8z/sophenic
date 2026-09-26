import asyncio
import uuid

from core.agent_engine import AgentEngine


class TaskManager:
    def __init__(self, settings, llm, browser, tools, storage, memory):
        self.args = settings, llm, browser, tools, storage, memory
        self.storage = storage
        self.engine = self.job = None
        # Crash recovery never resumes side effects without user consent.
        storage.recover_tasks()

    def busy(self):
        return self.job is not None and not self.job.done()

    def start(self, goal):
        if self.busy():
            raise ValueError("Une tâche est déjà en cours")
        identifier = uuid.uuid4().hex
        self.storage.create_task(identifier, goal)
        self.engine = AgentEngine(*self.args, identifier)
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
            "task_id": self.engine.task_id if self.engine else None,
            "phase": self.engine.phase if self.engine else "idle",
            "confirmation": self.engine.decision.pending if self.engine and self.busy() else None,
        }
