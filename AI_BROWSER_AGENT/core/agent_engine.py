import asyncio
import logging

from core.decision_system import DecisionSystem, LoopGuard
from core.planner import Planner
from core.reasoning_loop import ReasoningLoop
from memory.short_term_memory import ShortTermMemory
from tools.utility_tools import public_action, safe_url

logger = logging.getLogger(__name__)


class AgentEngine:
    def __init__(self, settings, llm, browser, tools, storage, memory, task_id):
        self.settings, self.llm, self.browser, self.tools = settings, llm, browser, tools
        self.storage, self.memory, self.task_id = storage, memory, task_id
        self.decision = DecisionSystem(self.emit)
        self.phase = "queued"

    def emit(self, kind, payload):
        self.storage.event(self.task_id, kind, payload)
        logger.info("task=%s event=%s", self.task_id, kind)

    def stage(self, phase):
        self.phase = phase
        self.emit("phase", {"phase": phase})

    async def run(self, goal):
        self.storage.update_task(self.task_id, "running")
        try:
            async with asyncio.timeout(self.settings.task_timeout):
                await self._run(goal)
        except asyncio.CancelledError:
            self.storage.update_task(self.task_id, "cancelled", "Arrêt demandé par l'utilisateur")
            self.emit("cancelled", {})
            raise
        except Exception as exc:
            # Avoid leaking form values/URLs from Playwright exception call logs.
            message = f"{type(exc).__name__}: " + (
                str(exc)[:1000]
                if isinstance(exc, (ValueError, RuntimeError))
                else "Opération interrompue. Vérifiez Ollama, Chromium ou le délai maximal."
            )
            self.storage.update_task(self.task_id, "failed", message)
            self.emit("error", {"message": message})
        finally:
            self.phase = "idle"

    async def _run(self, goal):
        health = await self.llm.health()
        if not health["available"]:
            raise RuntimeError("Modèle absent : exécutez ollama pull qwen3:14b")
        await self.browser.start()
        self.stage("PLAN")
        plan = await Planner(self.llm).create(goal)
        self.emit("plan", {"steps": plan})
        recent, guard = ShortTermMemory(), LoopGuard()
        reasoning = ReasoningLoop(self.llm)
        errors = 0
        for step in range(self.settings.max_steps):
            self.stage("OBSERVE")
            async with self.browser.lock:
                observation = await self.browser.observe()
            observation["upload_files"] = self.tools.files.list_files()
            self.stage("THINK")
            action = await reasoning.next_action(
                goal, plan, observation, recent, self.memory.preferences(), self.memory.lessons()
            )
            guard.check(action, observation)
            self.emit("action", {"step": step + 1, **public_action(action)})
            if action.action == "finish":
                self.storage.update_task(self.task_id, "completed", action.answer)
                self.emit("answer", {"text": action.answer})
                return
            approved_page = self.browser.current()
            self.stage("AUTHORIZE")
            approved = await self.decision.authorize(action, observation)
            if not approved:
                # Refusal stops the task, so the model cannot rephrase to bypass consent.
                self.storage.update_task(self.task_id, "cancelled", "Action refusée ; tâche arrêtée")
                self.emit("cancelled", {"reason": "Action refusée"})
                return
            self.stage("ACT")
            try:
                async with self.browser.lock:
                    if self.browser.current() is not approved_page or approved_page.url != observation["url"]:
                        raise ValueError(
                            "La page a changé depuis la demande de confirmation ; action annulée"
                        )
                    result = await self.tools.execute(action)
                    self.stage("VERIFY")
                    verified = await self.browser.observe()
                result.update(
                    {
                        "url": safe_url(verified["url"]),
                        "page_errors": verified["errors"],
                        "changed": observation["text"] != verified["text"]
                        or observation["url"] != verified["url"],
                    }
                )
                errors = 0
            except Exception as exc:
                errors += 1
                # Include useful validation errors, but not potentially sensitive browser call logs.
                error = str(exc)[:500] if isinstance(exc, ValueError) else type(exc).__name__
                result = {"ok": False, "error": error}
                self.memory.learn_error(action.action, error)
                if errors >= 3:
                    raise RuntimeError("Trois erreurs consécutives ; intervention nécessaire") from exc
            self.stage("MEMORY")
            recent.add(public_action(action), result)
            self.emit("result", result)
            if not result["ok"]:
                self.stage("REPLAN")
                plan = await Planner(self.llm).create(
                    goal
                    + "\nLe plan précédent a rencontré cette erreur ; adapte la stratégie : "
                    + result["error"]
                )
                self.emit("plan", {"steps": plan})
        raise RuntimeError("Limite d'étapes atteinte sans résultat final vérifié")
