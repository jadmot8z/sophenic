"""Shared progress comparison: form edits and scrolling count, not only body text."""

import hashlib
import json


def progress_signature(observation):
    elements = [{k: v for k, v in e.items() if k != "id"} for e in observation.get("elements", [])]
    state = {
        key: observation.get(key) for key in ("url", "text", "form_fingerprint", "scroll", "tabs", "focused")
    }
    state["elements"] = elements
    return hashlib.sha256(json.dumps(state, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
