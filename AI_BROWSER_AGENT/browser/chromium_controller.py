import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

from playwright.async_api import async_playwright

from browser.element_detector import ElementDetector
from browser.page_analyzer import PageAnalyzer
from tools.utility_tools import validate_url


class ChromiumController:
    def __init__(self, settings):
        self.settings = settings
        self.playwright = self.browser = self.context = self.page = None
        self.tabs = {}
        self.next_tab = 0
        self.detector = ElementDetector()
        self.analyzer = PageAnalyzer(self.detector)
        self.lock = asyncio.Lock()

    async def _route(self, route):
        """Filter intercepted requests and subresources against private network access.

        This is defense in depth, not an OS network sandbox. Browser redirects and
        independent DNS resolution require an external filtering proxy for isolation.
        """
        try:
            url = validate_url(route.request.url)
            host = urlsplit(url).hostname
            addresses = await asyncio.wait_for(
                asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM), timeout=5
            )
            if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
                raise ValueError("Résolution réseau privée interdite")
        except (ValueError, OSError):
            await route.abort("blockedbyclient")
        else:
            await route.continue_()

    def _register(self, page):
        self.next_tab += 1
        self.tabs[f"t{self.next_tab}"] = page
        self.page = page
        page.on("dialog", lambda dialog: dialog.dismiss())
        page.on("download", lambda download: download.cancel())

    async def start(self):
        if self.context:
            return
        self.playwright = await async_playwright().start()
        try:
            self.browser = await self.playwright.chromium.launch(headless=self.settings.headless)
            self.context = await self.browser.new_context(
                viewport={"width": 1360, "height": 900}, accept_downloads=False, service_workers="block"
            )
            self.context.set_default_timeout(self.settings.action_timeout)
            await self.context.route("**/*", self._route)
            await self.context.route_web_socket("**/*", lambda ws: ws.close())
            self.context.on("page", self._register)
            await self.context.new_page()
        except BaseException:
            await self.close()
            raise

    def current(self):
        self.tabs = {key: page for key, page in self.tabs.items() if not page.is_closed()}
        if self.page is None or self.page.is_closed():
            self.page = next(iter(self.tabs.values()), None)
        if self.page is None:
            raise ValueError("Aucun onglet ouvert")
        return self.page

    async def observe(self):
        page = self.current()
        return {**await self.analyzer.observe(page), "tabs": self.tab_state()}

    def tab_state(self):
        return [
            {"id": key, "url": p.url, "active": p is self.page}
            for key, p in self.tabs.items()
            if not p.is_closed()
        ]

    async def close(self):
        try:
            await self.detector.clear()
            if self.browser:
                await self.browser.close()
        finally:
            if self.playwright:
                await self.playwright.stop()
            self.playwright = self.browser = self.context = self.page = None
            self.tabs = {}
