from browser.dom_parser import VIEWPORT_TEXT_JS, parse_dom


class PageAnalyzer:
    def __init__(self, detector):
        self.detector = detector
        self.generation = 0

    async def observe(self, page):
        await self.detector.clear()
        self.generation += 1
        handles, elements = await parse_dom(page, self.generation)
        self.detector.handles, self.detector.elements = handles, elements
        self.detector.page, self.detector.url = page, page.url
        text = await page.evaluate(VIEWPORT_TEXT_JS)
        errors = await page.locator('[role="alert"], [aria-invalid="true"]').evaluate_all(
            "els => els.slice(0,15).map(e => (e.innerText || e.getAttribute('aria-label') || 'Champ invalide').slice(0,300))"
        )
        return {
            "url": page.url,
            "title": await page.title(),
            "text": text,
            "elements": elements,
            "errors": errors,
            "limitations": "DOM principal uniquement ; iframe/shadow DOM fermé/canvas non analysés",
        }
