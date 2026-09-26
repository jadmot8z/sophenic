"""Geometry from the real DOM; not a vision model or OCR replacement."""


async def bounding_boxes(elements):
    result = []
    for identifier, handle in elements.items():
        box = await handle.bounding_box()
        if box:
            result.append({"id": identifier, "box": box})
    return result
