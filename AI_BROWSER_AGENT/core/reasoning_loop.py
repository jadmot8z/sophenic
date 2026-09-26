from core.models import Action
from llm.prompt_manager import messages


class ReasoningLoop:
    def __init__(self, llm):
        self.llm = llm

    async def next_action(self, goal, plan, observation, memory, preferences, lessons):
        return await self.llm.structured(
            messages(goal, plan, observation, memory.snapshot(), preferences, lessons), Action
        )
