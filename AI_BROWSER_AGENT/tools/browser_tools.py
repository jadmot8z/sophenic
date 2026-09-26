from browser.click_engine import click
from browser.dom_parser import DESCRIBE_JS
from browser.navigation_manager import navigate
from browser.typing_engine import press_key, type_text
from tools.web_search import search_url


class BrowserTools:
    def __init__(self, browser, files):
        self.browser, self.files = browser, files

    async def execute(self, action):
        b, kind = self.browser, action.action
        page = b.current()
        if kind in {"open_url", "search"}:
            await navigate(page, action.url if kind == "open_url" else search_url(action.value))
        elif kind == "new_tab":
            page = await b.context.new_page()
            if action.url:
                await navigate(page, action.url)
        elif kind in {"switch_tab", "close_tab"}:
            if action.target not in b.tabs or b.tabs[action.target].is_closed():
                raise ValueError("Onglet inconnu")
            if kind == "switch_tab":
                b.page = b.tabs[action.target]
                await b.page.bring_to_front()
            else:
                await b.tabs[action.target].close()
                if not any(not p.is_closed() for p in b.tabs.values()):
                    await b.context.new_page()
                b.current()
        elif kind in {"back", "forward", "refresh"}:
            method = {"back": page.go_back, "forward": page.go_forward, "refresh": page.reload}[kind]
            await method(wait_until="domcontentloaded")
        elif kind == "press":
            await press_key(page, action.value)
        elif kind == "scroll":
            await page.mouse.wheel(0, -650 if action.value in {"haut", "up"} else 650)
        elif kind in {"click", "double_click", "type", "select", "upload"}:
            node = b.detector.resolve(action.target, page)
            expected = next(e for e in b.detector.elements if b.detector.handles[e["id"]] is node)
            actual = await node.evaluate(DESCRIBE_JS)
            if actual != {k: v for k, v in expected.items() if k != "id"}:
                raise ValueError("Élément modifié depuis l’observation ; nouvelle confirmation requise")
            if kind in {"click", "double_click"}:
                await click(node, kind == "double_click")
            elif kind == "type":
                await type_text(node, action.value)
            elif kind == "select":
                try:
                    await node.select_option(value=action.value)
                except Exception:
                    await node.select_option(label=action.value)
            else:
                await node.set_input_files(self.files.resolve_upload(action.value))
        elif kind != "observe":
            raise ValueError(f"Action non exécutable : {kind}")
        return {"ok": True, "action": kind}
