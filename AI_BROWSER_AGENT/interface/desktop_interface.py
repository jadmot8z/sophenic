"""Loopback-only desktop web interface with origin and per-session CSRF protection."""

import asyncio
import logging
import secrets
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from browser.chromium_controller import ChromiumController
from core.config import Settings
from core.task_manager import TaskManager
from interface.chat_interface import create_router
from llm.ollama_client import OllamaClient
from memory.long_term_memory import LongTermMemory
from memory.sqlite_storage import SQLiteStorage
from tools.browser_tools import BrowserTools
from tools.file_tools import FileTools

STATIC = Path(__file__).parent / "static"


def create_app(settings=None):
    settings = settings or Settings.from_env()
    token = secrets.token_urlsafe(32)

    @asynccontextmanager
    async def lifespan(app):
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        log_dir = settings.data_dir / "logs"
        log_dir.mkdir(exist_ok=True)
        handler = RotatingFileHandler(
            log_dir / "agent.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8"
        )
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        log = logging.getLogger("core")
        log.setLevel(logging.INFO)
        log.addHandler(handler)
        storage = SQLiteStorage(settings.data_dir / "memory.sqlite3")
        llm = OllamaClient(settings)
        browser = ChromiumController(settings)
        files = FileTools(settings.data_dir)
        memory = LongTermMemory(storage)
        manager = TaskManager(settings, llm, browser, BrowserTools(browser, files), storage, memory)
        app.state.manager = manager
        app.state.storage = storage
        app.include_router(create_router(manager, storage, memory, browser, llm, files))
        try:
            yield
        finally:
            await manager.stop()
            await browser.close()
            await llm.close()
            storage.close()
            log.removeHandler(handler)
            handler.close()

    app = FastAPI(
        title="AI Browser Agent", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]"])

    @app.middleware("http")
    async def security(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and urlsplit(origin).netloc != request.headers.get("host"):
            return JSONResponse({"detail": "Origine interdite"}, status_code=403)
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"detail": "Requête cross-site interdite"}, status_code=403)
        if request.url.path.startswith("/api/") and request.method != "GET":
            if not secrets.compare_digest(request.headers.get("x-agent-token", ""), token):
                return JSONResponse({"detail": "Jeton local requis"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        )
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/session")
    async def session():
        return {"token": token}

    @app.get("/")
    async def index():
        return FileResponse(STATIC / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app


if __name__ == "__main__":
    import sys

    import uvicorn

    # Playwright launches subprocesses. Windows must use Proactor, not reload/workers loops.
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    config = uvicorn.Config(create_app(), host="127.0.0.1", port=8765, loop="asyncio", access_log=False)
    asyncio.run(uvicorn.Server(config).serve())
