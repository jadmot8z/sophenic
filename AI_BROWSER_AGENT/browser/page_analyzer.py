import hashlib
import hmac
import json
import secrets

from browser.dom_parser import DESCRIBE_JS, FORM_STATE_JS, VIEWPORT_TEXT_JS, parse_dom


class PageAnalyzer:
    def __init__(self, detector):
        self.detector = detector
        self.generation = 0
        self.progress_key = secrets.token_bytes(32)

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
        focused_handle = await page.evaluate_handle("document.activeElement || document.body")
        try:
            focused = await focused_handle.evaluate(DESCRIBE_JS)
        finally:
            await focused_handle.dispose()
        # Only a session-keyed fingerprint leaves this local analyzer, not field contents.
        form_state = await page.evaluate(FORM_STATE_JS)
        form_fingerprint = hmac.new(
            self.progress_key, json.dumps(form_state).encode(), hashlib.sha256
        ).hexdigest()
        scroll = await page.evaluate("() => ({x: Math.round(scrollX), y: Math.round(scrollY)})")
        return {
            "url": page.url,
            "title": await page.title(),
            "text": text,
            "elements": elements,
            "focused": focused,
            "form_fingerprint": form_fingerprint,
            "scroll": scroll,
            "errors": errors,
            "limitations": "DOM principal uniquement ; iframe/shadow DOM fermé/canvas non analysés",
        }
