async def click(node, double=False):
    if double:
        await node.dblclick()
    else:
        await node.click()
