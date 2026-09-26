class ElementDetector:
    def __init__(self):
        self.handles = {}
        self.elements = []
        self.page = None
        self.url = ""

    async def clear(self):
        for handle in self.handles.values():
            try:
                await handle.dispose()
            except Exception:
                pass  # The page may already have been closed.
        self.handles = {}
        self.elements = []

    def resolve(self, target, page):
        if page is not self.page or page.url != self.url:
            raise ValueError("Observation périmée : observer à nouveau")
        if target not in self.handles:
            matches = [e["id"] for e in self.elements if e["label"] == target]
            if len(matches) != 1:
                raise ValueError("Cible introuvable ou ambiguë ; utiliser l'id d'observation")
            target = matches[0]
        return self.handles[target]
