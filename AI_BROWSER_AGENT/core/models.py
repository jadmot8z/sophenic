"""The model's only executable language: a bounded, validated JSON contract."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ActionName = Literal[
    "open_url",
    "back",
    "forward",
    "refresh",
    "new_tab",
    "switch_tab",
    "close_tab",
    "click",
    "double_click",
    "type",
    "press",
    "scroll",
    "select",
    "upload",
    "observe",
    "search",
    "finish",
]


class Action(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: ActionName
    target: str = Field(default="", max_length=180)
    value: str = Field(default="", max_length=8000)
    url: str = Field(default="", max_length=4000)
    reason: str = Field(default="", max_length=1000)
    answer: str = Field(default="", max_length=16000)

    @model_validator(mode="after")
    def check_arguments(self):
        if self.action in {"click", "double_click", "type", "select", "upload", "switch_tab", "close_tab"}:
            if not self.target:
                raise ValueError("target requis")
        if self.action == "open_url" and not self.url:
            raise ValueError("url requise")
        if self.action in {"search", "select", "upload", "press"} and not self.value:
            raise ValueError("value requis")
        if self.action == "finish" and not self.answer:
            raise ValueError("answer requis")
        return self


class Plan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    steps: list[str] = Field(min_length=1, max_length=12)


class TaskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    goal: str = Field(min_length=3, max_length=12000)


class Approval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approved: bool


class Preference(BaseModel):
    value: str = Field(max_length=2000)
