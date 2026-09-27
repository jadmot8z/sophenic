class BrowserUnavailable(RuntimeError):
    """A browser/page disappeared. Only read operations may be retried automatically."""


class BrowserActionInterrupted(RuntimeError):
    """An action may already have reached the site; never replay it automatically."""
