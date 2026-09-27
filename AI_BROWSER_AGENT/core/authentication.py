"""Explicit provider refusal is not a missing password and must not cause retry loops."""

from urllib.parse import urlsplit

from core.action_policy import normalize


def browser_login_refused(observation):
    if (urlsplit(observation.get("url", "")).hostname or "").lower() != "accounts.google.com":
        return False
    text = normalize(observation.get("text", ""))
    return "browser or app may not be secure" in text or (
        "navigateur" in text and ("pas securise" in text or "pas securisee" in text)
    )
