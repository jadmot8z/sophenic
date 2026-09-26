from urllib.parse import quote_plus


def search_url(query):
    return "https://www.google.com/search?q=" + quote_plus(query)
