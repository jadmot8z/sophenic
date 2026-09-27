from core.models import Plan
from llm.prompt_manager import system_prompt


class Planner:
    def __init__(self, llm):
        self.llm = llm

    async def create(self, goal):
        return (
            await self.llm.structured(
                [
                    {
                        "role": "system",
                        "content": system_prompt()
                        + "\nProduis un plan concret, court et vérifiable utilisant tes outils navigateur. Prévois ask_user pour connexion ou information manquante, puis reprise. Ne transforme pas une connexion absente en refus de capacité.",
                    },
                    {"role": "user", "content": goal},
                ],
                Plan,
            )
        ).steps
