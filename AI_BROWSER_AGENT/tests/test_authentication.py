import pytest

from core.authentication import browser_login_refused


@pytest.mark.parametrize(
    "text",
    [
        "This browser or app may not be secure. Try using a different browser.",
        "Ce navigateur ou cette application ne sont peut-être pas sécurisés.",
    ],
)
def test_google_insecure_browser_refusal(text):
    assert browser_login_refused({"url": "https://accounts.google.com/signin", "text": text})


def test_search_snippet_is_not_a_login_refusal():
    assert not browser_login_refused(
        {"url": "https://www.google.com/search", "text": "This browser or app may not be secure"}
    )


def test_password_required_is_not_a_browser_refusal():
    assert not browser_login_refused(
        {"url": "https://accounts.google.com/signin", "text": "Entrez votre mot de passe"}
    )
