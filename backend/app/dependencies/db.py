from collections.abc import Iterator

from fastapi import Request
from sqlalchemy.orm import Session


def get_db(request: Request) -> Iterator[Session]:
    """Request-scoped session. Services own commit boundaries; anything uncommitted is rolled
    back when the session closes."""
    db = request.app.state.session_factory()
    try:
        yield db
    finally:
        db.close()
