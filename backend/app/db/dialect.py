from sqlalchemy import Date, func, type_coerce
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session
from sqlalchemy.sql.expression import ColumnElement


def dialect_insert(db: Session, model):
    """Return an INSERT supporting the active database's ON CONFLICT API."""
    if db.get_bind().dialect.name == "sqlite":
        return sqlite_insert(model)
    return postgresql_insert(model)


def month_bucket(db: Session, column) -> ColumnElement:
    """First day of a date's month, with a Python ``date`` result on both databases."""
    if db.get_bind().dialect.name == "sqlite":
        return type_coerce(func.date(column, "start of month"), Date)
    return type_coerce(func.date_trunc("month", column), Date)
