"""Risk-based consent. Model classification can escalate, never override local checks.

Heuristics are deliberately conservative on ambiguous submit controls. They are not a
proof that an arbitrary site's JavaScript is harmless (see SECURITY.md).
"""

import re
import unicodedata
from urllib.parse import unquote, urlsplit


def normalize(text):
    return "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c))


SENSITIVE = re.compile(
    r"\b(send|envoyer|envoi|publish|publier|poster|post|delete|supprimer|effacer|remove|"
    r"buy|acheter|purchase|payer|pay|paiement|payment|commander|checkout|place order|"
    r"transfer|transferer|virer|resilier|unsubscribe|subscribe|abonner|donate|donner|"
    r"partager|share|grant|autoriser|allow|accept all|tout accepter)\b"
)
AMBIGUOUS = re.compile(r"\b(submit|soumettre|confirm|confirmer|validate|valider|ok|oui|yes)\b")
SEARCH = re.compile(r"\b(search|recherche|rechercher|chercher|filtrer|filter)\b")
SECRET = re.compile(r"\b(password|mot de passe|verification code|code de verification|one.time|otp|2fa)\b")


def target_element(action, observation):
    matches = [
        e
        for e in observation.get("elements", [])
        if e.get("id") == action.target or e.get("label") == action.target
    ]
    return matches[0] if len(matches) == 1 else None


def needs_human_credentials(action, observation):
    element = target_element(action, observation) or {}
    return action.action == "type" and (
        element.get("type") == "password"
        or element.get("autocomplete") in {"current-password", "new-password", "one-time-code"}
        or bool(SECRET.search(normalize(element.get("label", ""))))
    )


def consent_reason(action, observation):
    if action.action in {"ask_user", "finish", "observe", "switch_tab", "close_tab", "scroll"}:
        return None
    # A search command only navigates to the fixed search provider. Misclassifying
    # a ticket search as a purchase must not force sensitive consent.
    if action.action == "search":
        return None
    if action.impact != "routine":
        return "Action sensible signalée par le modèle : " + action.impact
    if action.action == "upload":
        return "Transmission d’un fichier à un site externe"
    if action.action in {"open_url", "new_tab"} and action.url:
        parts = urlsplit(action.url)
        if SENSITIVE.search(normalize(unquote(parts.path + " " + parts.query))):
            return "URL pouvant déclencher une opération sensible"
    if action.action in {"click", "double_click"}:
        element = target_element(action, observation)
        if not element:
            return "Cible non identifiée : vérification humaine requise"
        label = normalize(" ".join(str(element.get(k, "")) for k in ("label", "title", "href")))
        if SENSITIVE.search(label):
            return "Envoi, publication ou autre opération sensible détectée sur la cible"
        if AMBIGUOUS.search(label) or element.get("type") == "submit":
            if not SEARCH.search(label) and element.get("form_role") != "search":
                return "Validation de formulaire potentiellement engageante"
        if not element.get("label"):
            return "Commande sans libellé : effet final inconnu"
    if action.action == "press" and action.value == "Enter":
        focused = observation.get("focused") or {}
        label = normalize(focused.get("label", ""))
        if focused.get("tag") == "input" and (focused.get("type") == "search" or SEARCH.search(label)):
            return None
        return "Entrée peut envoyer un message ou soumettre un formulaire"
    return None
