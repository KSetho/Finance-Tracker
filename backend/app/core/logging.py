import logging

_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


def configure_logging() -> None:
    """Route application logs to stderr at INFO.

    Security events are logged by event name and source address only. Passwords, session
    tokens, CSRF tokens and the secret key must never be passed to a logger.
    """
    app_logger = logging.getLogger("app")
    if not app_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(_FORMAT))
        app_logger.addHandler(handler)
    app_logger.setLevel(logging.INFO)
