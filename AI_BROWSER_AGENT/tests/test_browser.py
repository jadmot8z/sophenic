"""Real Chromium integration test. No Ollama and no external network required."""

import pytest

from browser.chromium_controller import ChromiumController
from core.config import Settings
from core.models import Action
from tools.browser_tools import BrowserTools
from tools.file_tools import FileTools


async def test_real_chromium(tmp_path):
    browser = ChromiumController(Settings(data_dir=tmp_path, headless=True))
    try:
        await browser.start()
        await browser.current().set_content("""<label for="q">Recherche</label><input id="q">
          <button onclick="document.querySelector('output').textContent=document.querySelector('input').value">Valider</button>
          <select aria-label="Choix"><option value="a">Alpha</option><option value="b">Beta</option></select>
          <input type="file" aria-label="Document"><output></output>""")
        tools = BrowserTools(browser, FileTools(tmp_path))
        observation = await browser.observe()
        assert any(e["label"] == "Recherche" for e in observation["elements"])
        await tools.execute(Action(action="type", target="Recherche", value="RTX 4070"))
        typed = await browser.observe()
        assert typed["form_fingerprint"] != observation["form_fingerprint"]
        assert "RTX 4070" not in typed["text"]  # input values are not exposed as visible text
        await tools.execute(Action(action="click", target="Valider"))
        assert await browser.current().locator("output").inner_text() == "RTX 4070"
        await tools.execute(Action(action="select", target="Choix", value="b"))
        assert await browser.current().locator("select").input_value() == "b"
        (tools.files.root / "test.txt").write_text("upload")
        await tools.execute(Action(action="upload", target="Document", value="test.txt"))
        assert (
            await browser.current().locator("input[type=file]").evaluate("e => e.files[0].name") == "test.txt"
        )
        old_id = observation["elements"][0]["id"]
        await browser.observe()
        with pytest.raises(ValueError):
            browser.detector.resolve(old_id, browser.current())
        await tools.execute(Action(action="new_tab"))
        assert len(browser.tab_state()) == 2
        await tools.execute(Action(action="switch_tab", target="t1"))
        assert "RTX 4070" in (await browser.observe())["text"]
        await tools.execute(Action(action="close_tab", target="t2"))
        assert len(browser.tab_state()) == 1
        with pytest.raises(ValueError):
            await tools.execute(Action(action="open_url", url="http://127.0.0.1:8765/api/session"))
    finally:
        await browser.close()
