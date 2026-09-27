"""Fresh local clock and deterministic clarification of common ambiguous travel dates."""

import re
from datetime import datetime

from core.action_policy import normalize

MONTH = re.compile(
    r"\b(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|"
    r"january|february|march|april|may|june|july|august|september|october|november|december)\b"
)
YEAR = re.compile(r"\b(?:19|20|21)\d{2}\b")
TRAVEL = re.compile(r"\b(billets?|vols?|avion|flights?|aller[ -]retour|trajet|voyage|train)\b")
TRANSPORT = re.compile(r"\b(avion|vols?|flights?|train|bus|ferry|bateau)\b")


def local_clock():
    current = datetime.now().astimezone()
    return {
        "local_date": current.date().isoformat(),
        "local_time": current.isoformat(timespec="seconds"),
        "timezone": current.tzname(),
    }


def travel_question(goal):
    text = normalize(goal)
    numeric_date = re.search(r"\b\d{1,2}[/.-]\d{1,2}\b", text)
    if TRAVEL.search(text) and (MONTH.search(text) or numeric_date) and not YEAR.search(text):
        question = (
            "Pour quelle année souhaitez-vous ces billets ? Indiquez une année à quatre chiffres. "
            f"La date actuelle de votre ordinateur est {local_clock()['local_date']}."
        )
        if not TRANSPORT.search(text):
            question += " Précisez aussi le moyen de transport souhaité (par exemple : 2027, avion)."
        return question
    return None


def search_mismatch(goal, action):
    """Reject invented years/explicitly conflicting transport before sending a travel search."""
    if action.action != "search" or not TRAVEL.search(normalize(goal)):
        return None
    expected_years = set(YEAR.findall(goal))
    query_years = set(YEAR.findall(action.value))
    if expected_years and query_years - expected_years:
        return "La recherche invente une année non demandée. Respecte les années confirmées : " + ", ".join(
            sorted(expected_years)
        )
    text, query = normalize(goal), normalize(action.value)
    if re.search(r"\b(avion|vols?|flights?)\b", text) and re.search(r"\b(trains?|ferroviaire)\b", query):
        return "La demande porte sur un billet d’avion, pas un billet de train. Corrige la recherche."
    if re.search(r"\btrains?\b", text) and re.search(r"\b(avion|vols?|flights?)\b", query):
        return (
            "La demande porte explicitement sur un train. Ne la remplace pas par un vol sans clarification."
        )
    return None
