from core.models import Plan
from llm.prompt_manager import SYSTEM


class Planner:
    def __init__(self, llm):
        self.llm = llm

    async def create(self, goal):
        return (
            await self.llm.structured(
                [
                    {"role": "system", "content": SYSTEM + "\nProduis un plan concret, court et vérifiable."},
                    {"role": "user", "content": goal},
                ],
                Plan,
            )
        ).steps
