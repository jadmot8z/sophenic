"""HTTP routes consumed by the local chat UI."""

from fastapi import APIRouter, HTTPException, Query, Response

from core.models import Approval, PermissionSettings, Preference, TaskRequest
from vision.screenshot_processor import capture


def create_router(manager, storage, memory, browser, llm, files):
    api = APIRouter(prefix="/api")

    @api.get("/health")
    async def health():
        try:
            ollama = await llm.health()
            return {"ollama": ollama, "browser": browser.context is not None}
        except Exception:
            return {"ollama": {"available": False, "error": "Ollama inaccessible"}, "browser": False}

    @api.get("/state")
    async def state():
        return {**manager.state(), "tabs": browser.tab_state()}

    @api.get("/settings/permissions")
    async def permissions():
        return {"mode": manager.permission_mode}

    @api.put("/settings/permissions")
    async def set_permissions(body: PermissionSettings):
        if body.mode == "always_accept" and not body.accept_sensitive_risk:
            raise HTTPException(422, "Confirmez le risque des actions sensibles sans validation")
        manager.set_permission_mode(body.mode)
        return {"mode": manager.permission_mode}

    @api.get("/tasks")
    async def tasks():
        return storage.tasks()

    @api.post("/tasks", status_code=202)
    async def start(body: TaskRequest):
        try:
            return {"id": manager.start(body.goal)}
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @api.post("/stop")
    async def stop():
        await manager.stop()
        return {"stopped": True}

    @api.get("/tasks/{task_id}/events")
    async def events(task_id: str, after: int = Query(default=0, ge=0)):
        return storage.events(task_id, after)

    @api.post("/confirm/{identifier}")
    async def confirm(identifier: str, body: Approval):
        try:
            if not manager.engine:
                raise ValueError("Aucune tâche")
            manager.engine.decision.resolve(identifier, body.approved, body.response)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        return {"accepted": True}

    @api.get("/screenshot")
    async def screenshot():
        if not browser.context:
            raise HTTPException(404, "Navigateur non démarré")
        try:
            async with browser.lock:
                image = await capture(browser.current())
            return Response(image, media_type="image/jpeg", headers={"Cache-Control": "no-store"})
        except Exception as exc:
            raise HTTPException(503, "Capture indisponible") from exc

    @api.get("/preferences")
    async def preferences():
        return memory.preferences()

    @api.put("/preferences/{key}")
    async def preference(key: str, body: Preference):
        if key == "permission_mode":
            raise HTTPException(422, "Utilisez le réglage de permissions dédié")
        if len(key) > 100:
            raise HTTPException(422, "Clé trop longue")
        memory.set_preference(key, body.value)
        return {"saved": True}

    @api.get("/files")
    async def upload_files():
        return files.list_files()

    return api
