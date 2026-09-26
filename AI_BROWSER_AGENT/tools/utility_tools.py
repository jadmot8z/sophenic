import ipaddress
from urllib.parse import urlsplit, urlunsplit


def validate_url(value: str) -> str:
    """Only public HTTP(S). DNS and redirects are also checked at the browser boundary."""
    try:
        parts = urlsplit(value)
        host = parts.hostname
        port = parts.port
    except ValueError as exc:
        raise ValueError("URL invalide") from exc
    if parts.scheme not in {"https", "http"} or not host or parts.username or parts.password:
        raise ValueError("Seules les URL HTTP(S) sans identifiants sont autorisées")
    if port not in {None, 80, 443}:
        raise ValueError("Port réseau non autorisé")
    normalized = host.lower().rstrip(".")
    if normalized == "localhost" or normalized.endswith((".localhost", ".local", ".internal")):
        raise ValueError("Accès réseau local interdit")
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        if "." not in normalized:
            raise ValueError("Nom d'hôte local interdit")
    else:
        if not address.is_global:
            raise ValueError("Adresse privée ou réservée interdite")
    return value


def safe_url(value):
    """URLs in persistent logs omit query/fragment which may contain tokens."""
    p = urlsplit(value)
    return urlunsplit((p.scheme, p.netloc, p.path, "", ""))


def public_action(action):
    result = action.model_dump()
    if result["value"]:
        result["value"] = "[valeur masquée]"
    if result["url"]:
        result["url"] = safe_url(result["url"])
    return result
