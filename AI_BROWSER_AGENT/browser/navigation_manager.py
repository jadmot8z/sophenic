from tools.utility_tools import validate_url


async def navigate(page, url):
    response = await page.goto(validate_url(url), wait_until="domcontentloaded")
    if response and response.status >= 400:
        raise ValueError(f"Erreur HTTP {response.status} pour la navigation")
