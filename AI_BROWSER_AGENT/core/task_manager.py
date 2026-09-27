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
        self.browser_configuring = False
        self.stop_lock = asyncio.Lock()
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

    async def configure_browser(self, config):
        if self.busy() or self.browser_configuring:
            raise ValueError("Arrêtez la tâche avant de changer de navigateur")
        self.browser_configuring = True
        try:
            browser = self.args[2]
            async with browser.lock:
                await browser.close()
                browser.settings.browser_channel = config.channel
                browser.settings.remember_session = config.remember_session
                self.memory.set_preference("browser_channel", config.channel)
                self.memory.set_preference("remember_session", "1" if config.remember_session else "0")
            return browser.configuration()
        finally:
            self.browser_configuring = False

    async def open_browser(self):
        if self.busy() or self.browser_configuring:
            raise ValueError("Le navigateur est déjà contrôlé par une tâche ; utilisez sa fenêtre existante")
        self.browser_configuring = True
        try:
            browser = self.args[2]
            async with browser.lock:
                await browser.ensure_page()
                await browser.current().bring_to_front()
            return browser.configuration()
        finally:
            self.browser_configuring = False

    def busy(self):
        return self.job is not None and not self.job.done()

    def start(self, goal):
        if self.busy() or self.browser_configuring:
            raise ValueError("Une tâche est déjà en cours")
        identifier = uuid.uuid4().hex
        self.storage.create_task(identifier, goal)
        self.engine = AgentEngine(*self.args, identifier)
        self.engine.decision.permission_mode = self.permission_mode
        self.engine.emit("permission_mode", {"mode": self.permission_mode})
        self.job = asyncio.create_task(self.engine.run(goal), name=f"agent-{identifier}")
        return identifier

    async def stop(self):
        async with self.stop_lock:
            if self.busy():
                self.browser_configuring = True
                job, engine = self.job, self.engine
                job.cancel()
                try:
                    await job
                except asyncio.CancelledError:
                    pass
                finally:
                    try:
                        if engine.phase == "queued":
                            self.storage.update_task(engine.task_id, "cancelled", "Arrêt avant démarrage")
                            engine.phase = "idle"
                        # No new task may start while the previous browser is closing.
                        await self.args[2].close()
                    finally:
                        self.browser_configuring = False

    def state(self):
        return {
            "busy": self.busy(),
            "permission_mode": self.permission_mode,
            "task_id": self.engine.task_id if self.engine else None,
            "phase": self.engine.phase if self.engine else "idle",
            "confirmation": self.engine.decision.pending if self.engine and self.busy() else None,
        }
