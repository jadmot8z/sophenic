"""Lifecycle unit tests: doubles isolate closure races; real-browser tests are separate."""

import asyncio
from unittest.mock import AsyncMock, Mock, patch

import pytest
from playwright.async_api import Error as PlaywrightError

from browser.chromium_controller import ChromiumController
from browser.errors import BrowserActionInterrupted, BrowserUnavailable
from core.config import Settings
from core.models import Action
from tools.browser_tools import BrowserTools


class Page:
    def __init__(self):
        self.closed = False
        self.url = "about:blank"
        self.handlers = {}

    def is_closed(self):
        return self.closed

    def on(self, event, handler):
        self.handlers[event] = handler

    async def close(self):
        self.closed = True


class Context:
    def __init__(self):
        self.pages = []
        self.handlers = {}
        self.created = 0
        self.browser = Mock()
        self.browser.is_connected.return_value = True
        self.browser.close = AsyncMock()
        self.route = AsyncMock()
        self.route_web_socket = AsyncMock()

    async def new_page(self):
        await asyncio.sleep(0)  # Exercise concurrent ensure_page calls.
        self.created += 1
        page = Page()
        self.pages.append(page)
        if "page" in self.handlers:
            self.handlers["page"](page)
        return page

    def on(self, name, handler):
        self.handlers[name] = handler

    def set_default_timeout(self, value):
        self.timeout = value

    async def close(self):
        for page in self.pages:
            page.closed = True
        if "close" in self.handlers:
            self.handlers["close"](self)


def controller(tmp_path):
    browser = ChromiumController(Settings(data_dir=tmp_path, headless=True))
    context = Context()
    browser.context, browser.browser, browser.context_closed = context, context.browser, False
    context.on("page", browser._register)
    context.on("close", lambda c: browser._context_did_close(c))
    browser.generation = 1
    return browser, context


async def test_missing_last_tab_recreated_without_duplicate_registration(tmp_path):
    browser, context = controller(tmp_path)
    first = await browser.ensure_page()
    await first.close()
    second = await browser.ensure_page()
    assert first is not second
    assert len(browser.tab_state()) == 1
    assert browser.current() is second
    assert browser.recovery_count == 1
    assert context.created == 2


async def test_existing_tab_selected_when_active_closed(tmp_path):
    browser, context = controller(tmp_path)
    first = await browser.ensure_page()
    second = await context.new_page()
    await second.close()
    assert await browser.ensure_page() is first
    assert context.created == 2


async def test_concurrent_recovery_creates_only_one_page(tmp_path):
    browser, context = controller(tmp_path)
    pages = await asyncio.gather(*(browser.ensure_page() for _ in range(8)))
    assert all(page is pages[0] for page in pages)
    assert context.created == 1
    assert len(browser.tab_state()) == 1


async def test_closed_context_restarts_with_no_navigation_replay(tmp_path):
    browser, context = controller(tmp_path)
    old = await browser.ensure_page()
    old.url = "https://example.com/payment"
    await context.close()
    replacement = Context()

    async def launch():
        browser.context, browser.browser = replacement, replacement.browser
        browser.context_closed = False
        browser.generation += 1
        replacement.on("page", browser._register)

    browser._launch = AsyncMock(side_effect=launch)
    page = await browser.ensure_page()
    assert page.url == "about:blank"
    assert page is not old
    browser._launch.assert_awaited_once()
    assert browser.generation == 2


async def test_closed_page_during_observation_is_read_again(tmp_path):
    browser, _ = controller(tmp_path)
    first = await browser.ensure_page()

    async def observe(page):
        if page is first:
            await first.close()
            raise PlaywrightError("Target closed")
        return {"url": page.url, "text": "new page", "elements": []}

    browser.analyzer.observe = AsyncMock(side_effect=observe)
    observation = await browser.observe()
    assert observation["text"] == "new page"
    assert browser.analyzer.observe.await_count == 2


async def test_crashed_page_is_not_reused(tmp_path):
    browser, _ = controller(tmp_path)
    first = await browser.ensure_page()
    first.handlers["crash"](first)
    assert await browser.ensure_page() is not first


async def test_restart_is_bounded_and_reports_installation_hint(tmp_path):
    browser = ChromiumController(Settings(data_dir=tmp_path, browser_channel="chrome"))
    browser._launch = AsyncMock(side_effect=PlaywrightError("missing executable"))
    with pytest.raises(BrowserUnavailable, match="Google Chrome"):
        await browser.ensure_page()
    assert browser._launch.await_count == 2


async def test_interrupted_action_not_retried(tmp_path):
    browser, _ = controller(tmp_path)
    page = await browser.ensure_page()
    tools = BrowserTools(browser, Mock())

    async def interrupted(action):
        await page.close()
        raise PlaywrightError("Target closed")

    tools._execute = AsyncMock(side_effect=interrupted)
    with pytest.raises(BrowserActionInterrupted):
        await tools.execute(Action(action="click", target="e1", impact="send"))
    tools._execute.assert_awaited_once()


@pytest.mark.parametrize("channel", ["chrome", "msedge", "chromium"])
async def test_dedicated_persistent_profile_launch_options(tmp_path, channel):
    browser = ChromiumController(Settings(data_dir=tmp_path, browser_channel=channel, remember_session=True))
    context = Context()
    driver = Mock()
    driver.chromium.launch_persistent_context = AsyncMock(return_value=context)
    driver.stop = AsyncMock()
    runner = Mock(start=AsyncMock(return_value=driver))
    with patch("browser.chromium_controller.async_playwright", return_value=runner):
        await browser.start()
    kwargs = driver.chromium.launch_persistent_context.call_args.kwargs
    assert kwargs["user_data_dir"] == str((tmp_path / "browser_profiles" / channel).resolve())
    assert kwargs.get("channel") == (channel if channel != "chromium" else None)
    assert "args" not in kwargs  # No stealth, TLS-disable or authentication-bypass flags.
    await browser.close()
