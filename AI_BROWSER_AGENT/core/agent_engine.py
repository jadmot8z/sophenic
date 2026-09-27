import asyncio
import logging
from urllib.parse import urlsplit

from browser.errors import BrowserActionInterrupted, BrowserUnavailable
from core.action_policy import needs_human_credentials
from core.authentication import browser_login_refused
from core.decision_system import DecisionSystem, LoopDetected, LoopGuard
from core.models import Action
from core.planner import Planner
from core.progress import progress_signature
from core.reasoning_loop import ReasoningLoop
from core.task_context import YEAR, search_mismatch, travel_question
from memory.short_term_memory import ShortTermMemory
from tools.utility_tools import public_action, safe_url

logger = logging.getLogger(__name__)


class AgentEngine:
    def __init__(self, settings, llm, browser, tools, storage, memory, task_id):
        self.settings, self.llm, self.browser, self.tools = settings, llm, browser, tools
        self.storage, self.memory, self.task_id = storage, memory, task_id
        self.decision = DecisionSystem(self.emit, settings.human_timeout)
        self.deadline = None
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
            async with asyncio.timeout(self.settings.task_timeout) as deadline:
                self.deadline = deadline
                await self._run(goal)
        except asyncio.CancelledError:
            self.storage.update_task(self.task_id, "cancelled", "Arrêt demandé par l'utilisateur")
            self.emit("cancelled", {})
            raise
        except Exception as exc:
            # Avoid leaking form values/URLs from Playwright exception call logs.
            message = (
                str(exc)[:1000]
                if isinstance(exc, (ValueError, RuntimeError))
                else "Opération interrompue. Vérifiez Ollama, Chromium ou le délai maximal."
            )
            self.storage.update_task(self.task_id, "failed", message)
            self.emit("error", {"message": message})
        finally:
            self.phase = "idle"

    async def _human_pause(self, action, observation):
        """No model/browser work during login. Human wait has its own bounded timeout."""
        self.stage("WAITING_USER")
        clock = asyncio.get_running_loop()
        started = clock.time()
        previous_deadline = self.deadline.when()
        self.deadline.reschedule(None)
        try:
            return await self.decision.request_help(action, observation)
        finally:
            self.deadline.reschedule(previous_deadline + clock.time() - started)

    async def _clarify_travel(self, goal):
        question = travel_question(goal)
        if not question:
            return goal
        for _ in range(3):
            if not await self._human_pause(Action(action="ask_user", value=question), {"url": ""}):
                self.storage.update_task(self.task_id, "cancelled", "Précision annulée")
                self.emit("cancelled", {"reason": "Précision annulée"})
                return None
            response = self.decision.response.strip()
            if YEAR.search(response):
                # This is actual user input, not text from a webpage or a guessed year.
                return goal + "\nPrécisions données par l'utilisateur : " + response
            question = "L’année n’a pas été précisée. Indiquez-la en quatre chiffres (exemple : 2027)."
        self.storage.update_task(
            self.task_id, "needs_attention", "Année manquante ; aucune recherche exécutée"
        )
        self.emit(
            "attention", {"message": "Précisez l’année dans une nouvelle demande pour lancer la recherche."}
        )
        return None

    async def _run(self, goal):
        goal = await self._clarify_travel(goal)
        if goal is None:
            return
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
        recoveries = 0
        browser_recovery = 0
        for step in range(self.settings.max_steps):
            self.stage("OBSERVE")
            try:
                async with self.browser.lock:
                    observation = await self.browser.observe()
                    observed_page = self.browser.current()
            except BrowserUnavailable as exc:
                request = Action(
                    action="ask_user", value=str(exc) + " Corrigez le problème puis reprenez, ou annulez."
                )
                if not await self._human_pause(request, {"url": ""}):
                    self.storage.update_task(self.task_id, "cancelled", "Récupération navigateur annulée")
                    self.emit("cancelled", {"reason": "Récupération navigateur annulée"})
                    return
                continue
            if observation.get("recovery_count", 0) > browser_recovery:
                browser_recovery = observation["recovery_count"]
                self.emit("recovery", {"message": observation.get("recovery_message", "Navigateur récupéré")})
                recent.add(
                    {"action": "browser_recovery"},
                    {"message": "Nouvel état navigateur ; aucune commande rejouée."},
                )
            observation["upload_files"] = self.tools.files.list_files()
            if browser_login_refused(observation):
                message = (
                    "Google affiche un refus de connexion lié à ce navigateur. Une nouvelle tentative "
                    "identique ne le résoudra pas. La tâche est arrêtée comme incomplète. "
                    "Vous pouvez configurer Chrome ou Edge installé pour une nouvelle tentative, sans "
                    "garantie d’acceptation. Si le refus persiste, utilisez votre navigateur normal ou "
                    "une intégration officielle du service. Aucune protection n’a été désactivée."
                )
                self.storage.update_task(self.task_id, "needs_attention", message)
                self.emit("attention", {"message": message})
                return
            # Passwords and Google authentication never go through the model or chat.
            host = (urlsplit(observation["url"]).hostname or "").lower()
            login_page = host == "accounts.google.com" or any(
                e.get("type") == "password" for e in observation.get("elements", [])
            )
            if login_page:
                action = Action(
                    action="ask_user",
                    value=(
                        "Une authentification ou un champ secret est affiché. Connectez-vous ou complétez "
                        "cette étape vous-même dans la fenêtre du navigateur piloté, puis cliquez sur J’ai terminé. "
                        "Ne saisissez pas de mot de passe dans ce chat. Si le site refuse ce navigateur, "
                        "arrêtez la tâche et indiquez le message de blocage."
                    ),
                )
            else:
                self.stage("THINK")
                action = await reasoning.next_action(
                    goal, plan, observation, recent, self.memory.preferences(), self.memory.lessons()
                )
                if needs_human_credentials(action, observation):
                    action = Action(
                        action="ask_user",
                        value=(
                            "Complétez le mot de passe ou le code de vérification directement dans le navigateur piloté, "
                            "puis cliquez sur J’ai terminé. Ne partagez pas ce secret dans le chat."
                        ),
                    )
            mismatch = search_mismatch(goal, action)
            if mismatch:
                self.emit("recovery", {"message": mismatch})
                recent.add({"action": "search_validation"}, {"error": mismatch, "executed": False})
                self.stage("REPLAN")
                plan = await Planner(self.llm).create(goal + "\nCorrection obligatoire : " + mismatch)
                self.emit("plan", {"steps": plan})
                continue
            try:
                guard.check(action, observation)
            except LoopDetected as exc:
                recoveries += 1
                self.emit("recovery", {"message": str(exc), "attempt": recoveries})
                recent.add(
                    {"action": "recovery"},
                    {
                        "error": str(exc),
                        "blocked_action": public_action(action),
                        "instruction": "Ne répète pas cette action. Change de stratégie ou demande une intervention.",
                    },
                )
                guard = LoopGuard()
                if recoveries <= 2:
                    self.stage("REPLAN")
                    plan = await Planner(self.llm).create(
                        goal
                        + "\nBlocage observé : "
                        + str(exc)
                        + "\nDernière action sans effet : "
                        + action.action
                        + "\nChange de stratégie ou de source ; ne répète pas l’action sans effet."
                    )
                    self.emit("plan", {"steps": plan})
                    continue
                action = Action(
                    action="ask_user",
                    value=(
                        "La page reste bloquée malgré deux changements de stratégie. Vérifiez le navigateur piloté : "
                        "une connexion, un CAPTCHA ou une fenêtre du site peut nécessiter votre intervention. "
                        "Vous pouvez débloquer la page puis reprendre, donner une autre source, ou annuler."
                    ),
                )
            self.emit("action", {"step": step + 1, **public_action(action)})
            if action.action == "ask_user":
                resumed = await self._human_pause(action, observation)
                if not resumed:
                    self.storage.update_task(
                        self.task_id, "cancelled", "Intervention annulée par l’utilisateur"
                    )
                    self.emit("cancelled", {"reason": "Intervention annulée"})
                    return
                recent.add(
                    {"action": "ask_user", "question": action.value},
                    {
                        "resumed": True,
                        "user_response": self.decision.response,
                        "instruction": "L’utilisateur a terminé son intervention ; vérifier le nouvel état réel.",
                    },
                )
                self.emit("resumed", {"message": "Reprise après intervention ; nouvelle observation"})
                errors = 0
                guard = LoopGuard()
                # Do not reuse pre-login handles or execute a previously prepared command.
                continue
            if action.action == "finish":
                self.storage.update_task(self.task_id, "completed", action.answer)
                self.emit("answer", {"text": action.answer})
                return
            try:
                approved_page = self.browser.current()
                if approved_page is not observed_page or approved_page.url != observation["url"]:
                    raise BrowserUnavailable("L’onglet a changé pendant la décision ; nouvelle observation.")
            except BrowserUnavailable as exc:
                self.emit("recovery", {"message": str(exc)})
                recent.add({"action": "browser_recovery"}, {"executed": False, "error": str(exc)})
                continue
            self.stage("AUTHORIZE")
            approved = await self.decision.authorize(action, observation)
            if not approved:
                # Refusal stops the task, so the model cannot rephrase to bypass consent.
                self.storage.update_task(self.task_id, "cancelled", "Action refusée ; tâche arrêtée")
                self.emit("cancelled", {"reason": "Action refusée"})
                return
            self.stage("ACT")
            action_started = False
            try:
                async with self.browser.lock:
                    if self.browser.current() is not approved_page or approved_page.url != observation["url"]:
                        raise ValueError(
                            "La page a changé depuis la demande de confirmation ; action annulée"
                        )
                    action_started = True
                    result = await self.tools.execute(action)
                    # Verify only in the same live page. A blank recovered page is not evidence of success.
                    if action.action != "close_tab" and (
                        not self.browser.is_running()
                        or approved_page.is_closed()
                        or self.browser.current().is_closed()
                    ):
                        raise BrowserActionInterrupted(
                            "Le navigateur a disparu après l’action ; vérifiez son résultat avant de continuer."
                        )
                    self.stage("VERIFY")
                    generation = observation.get("browser_generation")
                    verified = await self.browser.observe()
                    if (
                        action.action != "close_tab"
                        and generation is not None
                        and generation != verified.get("browser_generation")
                    ):
                        raise BrowserActionInterrupted(
                            "Le navigateur a été relancé pendant la vérification ; résultat de l’action inconnu."
                        )
                result.update(
                    {
                        "url": safe_url(verified["url"]),
                        "page_errors": verified["errors"],
                        "changed": progress_signature(observation) != progress_signature(verified),
                    }
                )
                errors = 0
            except Exception as exc:
                errors += 1
                # Include useful validation errors, but not potentially sensitive browser call logs.
                error = str(exc)[:500] if isinstance(exc, ValueError) else type(exc).__name__
                result = {
                    "ok": False,
                    "error": error,
                    "uncertain": isinstance(exc, BrowserActionInterrupted)
                    or (action_started and isinstance(exc, BrowserUnavailable)),
                }
                self.memory.learn_error(action.action, error)
            self.stage("MEMORY")
            recent.add(public_action(action), result)
            self.emit("result", result)
            if result.get("uncertain"):
                request = Action(
                    action="ask_user",
                    value=(
                        "Le navigateur a disparu pendant ou juste après une action. Celle-ci a peut-être déjà "
                        "été effectuée sur le site. Vérifiez notamment tout envoi ou paiement avant de reprendre. "
                        "Aucune commande n’est rejouée automatiquement. Indiquez ce que vous avez constaté, ou annulez."
                    ),
                )
                # Restore infrastructure for manual inspection, never the interrupted command/URL.
                async with self.browser.lock:
                    await self.browser.ensure_page()
                if not await self._human_pause(request, observation):
                    self.storage.update_task(self.task_id, "cancelled", "Résultat incertain ; arrêt demandé")
                    self.emit("cancelled", {"reason": "Résultat incertain ; aucune action rejouée"})
                    return
                recent.add(
                    {"action": "manual_verification"},
                    {
                        "user_response": self.decision.response,
                        "instruction": "Vérifie le résultat réel ; ne renvoie jamais une transaction par défaut.",
                    },
                )
                errors = 0
                guard = LoopGuard()
                continue
            if not result["ok"] and errors >= 3:
                request = Action(
                    action="ask_user",
                    value=(
                        "Le navigateur rencontre plusieurs erreurs. Vérifiez l’onglet du navigateur piloté ; "
                        "corrigez le blocage puis reprenez, ou annulez la tâche."
                    ),
                )
                if not await self._human_pause(request, observation):
                    self.storage.update_task(self.task_id, "cancelled", "Intervention annulée")
                    self.emit("cancelled", {"reason": "Intervention annulée"})
                    return
                recent.add({"action": "ask_user"}, {"user_response": self.decision.response, "resumed": True})
                errors = 0
                guard = LoopGuard()
            if not result["ok"]:
                self.stage("REPLAN")
                plan = await Planner(self.llm).create(
                    goal
                    + "\nLe plan précédent a rencontré cette erreur ; adapte la stratégie : "
                    + result["error"]
                )
                self.emit("plan", {"steps": plan})
        message = (
            "La limite d’étapes a été atteinte sans résultat vérifié. La tâche est incomplète ; "
            "précisez la demande ou une autre source avant de relancer."
        )
        self.storage.update_task(self.task_id, "needs_attention", message)
        self.emit("attention", {"message": message})
