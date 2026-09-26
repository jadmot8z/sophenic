async def capture(page):
    # Captures are returned in memory, never saved automatically.
    return await page.screenshot(type="jpeg", quality=65, full_page=False, timeout=10000)
