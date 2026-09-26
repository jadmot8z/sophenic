from vision.screenshot_processor import capture
from vision.visual_element_detector import bounding_boxes


async def inspect_screen(browser):
    """Provide screenshot + DOM geometry. Qwen3 14B does NOT receive image input."""
    async with browser.lock:
        return {
            "image": await capture(browser.current()),
            "elements": await bounding_boxes(browser.detector.handles),
            "mode": "dom_geometry",
            "multimodal": False,
        }
