import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import User


def get_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def get_by_id(db: Session, user_id: uuid.UUID) -> User | None:
    return db.get(User, user_id)


def get_owner(db: Session) -> User | None:
    """The single owner row, if any (the schema allows at most one)."""
    return db.scalar(select(User).limit(1))


def count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User)) or 0


def create(db: Session, *, email: str, password_hash: str, now: datetime) -> User:
    user = User(email=email, password_hash=password_hash, created_at=now, updated_at=now)
    db.add(user)
    db.flush()
    return user


def update_password_hash(db: Session, user: User, password_hash: str, now: datetime) -> None:
    user.password_hash = password_hash
    user.updated_at = now
    db.flush()
