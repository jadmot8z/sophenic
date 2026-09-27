"""Local configuration. Defaults never expose the control API on the network."""

import os
from pathlib import Path

from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseModel):
    data_dir: Path = ROOT / "data"
    ollama_url: str = "http://127.0.0.1:11434"
    model: str = "qwen3:14b"
    max_steps: int = Field(default=40, ge=1, le=200)
    task_timeout: int = Field(default=900, ge=30)
    llm_timeout: int = Field(default=180, ge=10)
    action_timeout: int = Field(default=15000, ge=1000)
    context_size: int = Field(default=16384, ge=4096)
    human_timeout: int = Field(default=900, ge=30, le=3600)
    headless: bool = False

    @classmethod
    def from_env(cls):
        return cls(
            data_dir=Path(os.environ.get("AIBA_DATA_DIR", str(ROOT / "data"))),
            ollama_url=os.environ.get("AIBA_OLLAMA_URL", "http://127.0.0.1:11434"),
            headless=os.environ.get("AIBA_HEADLESS") == "1",
        )
