ALLOWED_KEYS = {"Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"}


async def type_text(node, value):
    await node.fill(value)


async def press_key(page, value):
    if value not in ALLOWED_KEYS:
        raise ValueError("Touche non autorisée")
    await page.keyboard.press(value)
