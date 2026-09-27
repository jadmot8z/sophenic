import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright

from browser.element_detector import ElementDetector
from browser.errors import BrowserUnavailable
from browser.page_analyzer import PageAnalyzer
from tools.utility_tools import validate_url


class ChromiumController:
    def __init__(self, settings):
        self.settings = settings
        self.playwright = self.browser = self.context = self.page = None
        self.tabs = {}
        self.crashed = set()
        self.next_tab = 0
        self.detector = ElementDetector()
        self.analyzer = PageAnalyzer(self.detector)
        self.lock = asyncio.Lock()
        self.lifecycle_lock = asyncio.Lock()
        self.context_closed = True
        self.generation = 0
        self.recovery_count = 0
        self.last_recovery = ""

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
        if page in self.tabs.values() or page.is_closed() or page in self.crashed:
            return
        self.next_tab += 1
        self.tabs[f"t{self.next_tab}"] = page
        self.page = page
        page.on("crash", lambda _: self.crashed.add(page))
        page.on("dialog", lambda dialog: dialog.dismiss())
        page.on("download", lambda download: download.cancel())

    def is_running(self):
        return (
            self.context is not None
            and not self.context_closed
            and (self.browser is None or self.browser.is_connected())
        )

    def configuration(self):
        return {
            "channel": self.settings.browser_channel,
            "remember_session": self.settings.remember_session,
            "running": self.is_running(),
            "generation": self.generation,
            "recovery_count": self.recovery_count,
            "last_recovery": self.last_recovery,
        }

    async def start(self):
        await self.ensure_page()

    def _context_did_close(self, context):
        # Ignore a delayed close event from a previous generation.
        if self.context is context:
            self.context_closed = True

    async def _launch(self):
        self.playwright = await async_playwright().start()
        options = {
            "viewport": {"width": 1360, "height": 900},
            "accept_downloads": False,
            "service_workers": "block",
        }
        launch = {"headless": self.settings.headless}
        if self.settings.browser_channel != "chromium":
            launch["channel"] = self.settings.browser_channel
        try:
            if self.settings.remember_session:
                # Never touch the user's normal Chrome/Edge profile or import their cookies.
                profile = self.settings.data_dir / "browser_profiles" / self.settings.browser_channel
                profile.mkdir(parents=True, exist_ok=True)
                self.context = await self.playwright.chromium.launch_persistent_context(
                    user_data_dir=str(profile.resolve()), **launch, **options
                )
                self.browser = self.context.browser
            else:
                self.browser = await self.playwright.chromium.launch(**launch)
                self.context = await self.browser.new_context(**options)
            self.context_closed = False
            context = self.context
            context.on("close", lambda _: self._context_did_close(context))
            context.set_default_timeout(self.settings.action_timeout)
            await context.route("**/*", self._route)
            await context.route_web_socket("**/*", lambda ws: ws.close())
            context.on("page", self._register)
            for page in context.pages:
                self._register(page)
            self.generation += 1
        except BaseException:
            await self._close_resources()
            raise

    def _prune(self):
        self.tabs = {
            key: page for key, page in self.tabs.items() if not page.is_closed() and page not in self.crashed
        }
        if self.page is None or self.page.is_closed() or self.page not in self.tabs.values():
            self.page = next(iter(self.tabs.values()), None)

    async def ensure_page(self):
        """Bounded recovery of infrastructure only. Never reload a URL or replay an action."""
        async with self.lifecycle_lock:
            for attempt in range(2):
                try:
                    if not self.is_running():
                        restarting = self.generation > 0
                        await self._close_resources()
                        await self._launch()
                        if restarting:
                            self.recovery_count += 1
                            self.last_recovery = (
                                "Navigateur relancé ; nouvelle observation, aucune action rejouée."
                            )
                    self._prune()
                    for page in self.context.pages:
                        self._register(page)
                    if self.page is None:
                        page = await self.context.new_page()
                        self._register(page)  # Idempotent if the page event already registered it.
                        if self.next_tab > 1:
                            self.recovery_count += 1
                            self.last_recovery = "Onglet fermé : un nouvel onglet vierge a été créé."
                    return self.current()
                except (PlaywrightError, BrowserUnavailable):
                    await self._close_resources()
                    if attempt:
                        label = {
                            "chromium": "Chromium Playwright",
                            "chrome": "Google Chrome",
                            "msedge": "Microsoft Edge",
                        }[self.settings.browser_channel]
                        raise BrowserUnavailable(
                            f"Impossible d’ouvrir {label}. Vérifiez son installation et fermez toute autre "
                            "instance de l’agent utilisant ce profil, puis réessayez."
                        ) from None

    def current(self):
        """Strict snapshot accessor: callers must not recover underneath a pending action."""
        self._prune()
        if not self.is_running() or self.page is None:
            raise BrowserUnavailable("L’onglet a été fermé ; une nouvelle observation est nécessaire.")
        return self.page

    async def observe(self):
        # Observation is read-only and may safely restart after a concurrent manual close.
        for attempt in range(2):
            page = await self.ensure_page()
            try:
                return {
                    **await self.analyzer.observe(page),
                    "tabs": self.tab_state(),
                    "browser_generation": self.generation,
                    "recovery_count": self.recovery_count,
                    "recovery_message": self.last_recovery,
                }
            except PlaywrightError:
                if attempt:
                    raise BrowserUnavailable(
                        "La page change ou se ferme pendant sa lecture. Vérifiez le navigateur."
                    ) from None

    def tab_state(self):
        self._prune()
        return [{"id": key, "url": page.url, "active": page is self.page} for key, page in self.tabs.items()]

    async def _close_resources(self):
        # This function is called under lifecycle_lock; it must not acquire it again.
        context, browser, playwright = self.context, self.browser, self.playwright
        self.playwright = self.browser = self.context = self.page = None
        self.context_closed = True
        self.tabs = {}
        self.crashed.clear()
        await self.detector.clear()
        try:
            if context:
                await context.close()
        except PlaywrightError:
            pass  # A manual window close may already have disposed the context.
        try:
            if browser:
                await browser.close()
        except PlaywrightError:
            pass
        finally:
            if playwright:
                await playwright.stop()

    async def close(self):
        async with self.lifecycle_lock:
            await self._close_resources()
