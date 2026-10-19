import uuid

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import _alembic_config

DEFAULT_CATEGORY_COUNT = 13


def _user(conn, email="owner@example.com"):
    uid = uuid.uuid4()
    conn.execute(
        text("INSERT INTO users (id, email, password_hash) VALUES (:id, :email, 'h')"),
        {"id": uid, "email": email},
    )
    return uid


def _account(conn, user_id, name="Bank", kind="bank", opening="0.00", opening_date="2026-10-01"):
    aid = uuid.uuid4()
    conn.execute(
        text(
            "INSERT INTO accounts (id, user_id, name, account_type, opening_balance, opening_date)"
            " VALUES (:id, :u, :n, CAST(:t AS account_type), :ob, :od)"
        ),
        {"id": aid, "u": user_id, "n": name, "t": kind, "ob": opening, "od": opening_date},
    )
    return aid


def _category(conn, user_id, name="Food", kind="expense"):
    cid = uuid.uuid4()
    conn.execute(
        text(
            "INSERT INTO categories (id, user_id, name, category_type)"
            " VALUES (:id, :u, :n, CAST(:t AS category_type))"
        ),
        {"id": cid, "u": user_id, "n": name, "t": kind},
    )
    return cid


def _tx(conn, user_id, kind, account_id, **kw):
    tid = kw.pop("id", uuid.uuid4())
    params = {
        "id": tid,
        "u": user_id,
        "t": kind,
        "n": kw.pop("name", "x"),
        "amount": kw.pop("amount", "10.00"),
        "d": kw.pop("date", "2026-10-05"),
        "a": account_id,
        "dest": kw.pop("destination", None),
        "c": kw.pop("category", None),
        "fee": kw.pop("fee_amount", "0.00"),
        "rel": kw.pop("related", None),
    }
    assert not kw, kw
    conn.execute(
        text(
            "INSERT INTO transactions (id, user_id, type, name, amount, transaction_date,"
            " account_id, destination_account_id, category_id, fee_amount, related_transaction_id)"
            " VALUES (:id, :u, CAST(:t AS transaction_type), :n, :amount, :d, :a, :dest, :c,"
            " :fee, :rel)"
        ),
        params,
    )
    return tid


@pytest.fixture
def base(engine, clean_db):
    with engine.begin() as conn:
        user_id = _user(conn)
        a1 = _account(conn, user_id, "Bank")
        a2 = _account(conn, user_id, "MoMo", "mobile_money")
        cat = _category(conn, user_id, "Food", "expense")
        fees = _category(conn, user_id, "Fees", "expense")
    return {"user": user_id, "a1": a1, "a2": a2, "cat": cat, "fees": fees}


def test_tables_and_enums_exist(engine, clean_db):
    names = set(inspect(engine).get_table_names())
    assert {"accounts", "categories", "transactions", "monthly_budgets"} <= names
    with engine.connect() as conn:
        enums = {r[0] for r in conn.execute(text("SELECT typname FROM pg_type WHERE typtype='e'"))}
    assert {"account_type", "category_type", "transaction_type"} <= enums


@pytest.mark.parametrize("amount", ["0.00", "-1.00"])
def test_amount_must_be_positive(engine, base, amount):
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _tx(conn, base["user"], "expense", base["a1"], amount=amount)


def test_fee_amount_must_not_be_negative(engine, base):
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _tx(conn, base["user"], "expense", base["a1"], fee_amount="-0.01")


@pytest.mark.parametrize("kind", ["income", "expense"])
def test_income_and_expense_cannot_have_a_destination(engine, base, kind):
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _tx(conn, base["user"], kind, base["a1"], destination=base["a2"])


def test_transfer_needs_a_destination(engine, base):
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _tx(conn, base["user"], "transfer", base["a1"])


def test_transfer_needs_different_accounts(engine, base):
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _tx(conn, base["user"], "transfer", base["a1"], destination=base["a1"])


def test_valid_rows_are_accepted(engine, base):
    with engine.begin() as conn:
        _tx(conn, base["user"], "income", base["a1"])
        _tx(conn, base["user"], "expense", base["a1"], category=base["cat"])
        _tx(conn, base["user"], "transfer", base["a1"], destination=base["a2"])
        assert conn.execute(text("SELECT count(*) FROM transactions")).scalar_one() == 3


def test_fee_row_must_be_an_expense_with_zero_fee_amount(engine, base):
    with engine.begin() as conn:
        parent = _tx(conn, base["user"], "transfer", base["a1"], destination=base["a2"])
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _tx(conn, base["user"], "income", base["a1"], related=parent)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _tx(
            conn,
            base["user"],
            "expense",
            base["a1"],
            related=parent,
            fee_amount="1.00",
            category=base["fees"],
        )


def test_a_parent_can_have_only_one_fee(engine, base):
    with engine.begin() as conn:
        parent = _tx(conn, base["user"], "transfer", base["a1"], destination=base["a2"])
        _tx(conn, base["user"], "expense", base["a1"], related=parent, category=base["fees"])
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _tx(conn, base["user"], "expense", base["a2"], related=parent, category=base["fees"])


def test_deleting_a_parent_cascades_to_its_fee(engine, base):
    with engine.begin() as conn:
        parent = _tx(conn, base["user"], "transfer", base["a1"], destination=base["a2"])
        _tx(conn, base["user"], "expense", base["a1"], related=parent, category=base["fees"])
        conn.execute(text("DELETE FROM transactions WHERE id = :id"), {"id": parent})
        assert conn.execute(text("SELECT count(*) FROM transactions")).scalar_one() == 0


def test_composite_foreign_keys_reject_another_owners_rows(engine, allow_second_user, base):
    with engine.begin() as conn:
        other = _user(conn, "other@example.com")
        foreign_account = _account(conn, other, "Theirs")
        foreign_category = _category(conn, other, "Theirs", "expense")
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _tx(conn, base["user"], "expense", foreign_account)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _tx(conn, base["user"], "expense", base["a1"], category=foreign_category)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _tx(conn, base["user"], "transfer", base["a1"], destination=foreign_account)


def test_account_names_are_unique_per_user_ignoring_case(engine, base):
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _account(conn, base["user"], "bank")  # same name as "Bank", different case


def test_account_opening_balance_cannot_be_negative(engine, base):
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _account(conn, base["user"], "Neg", opening="-1.00")


def test_category_names_are_unique_per_user_and_type(engine, base):
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _category(conn, base["user"], "Food", "expense")
    with engine.begin() as conn:
        _category(conn, base["user"], "Food", "income")  # same name, other type is fine


def test_budget_constraints(engine, base):
    insert = text(
        "INSERT INTO monthly_budgets (id, user_id, month_start, allowance) VALUES (:id, :u, :m, :a)"
    )
    with engine.begin() as conn:
        conn.execute(
            insert, {"id": uuid.uuid4(), "u": base["user"], "m": "2026-10-01", "a": "3000"}
        )
    with pytest.raises(IntegrityError), engine.begin() as conn:  # one allowance per month
        conn.execute(insert, {"id": uuid.uuid4(), "u": base["user"], "m": "2026-10-01", "a": "1"})
    with pytest.raises(IntegrityError), engine.begin() as conn:  # must be the 1st
        conn.execute(insert, {"id": uuid.uuid4(), "u": base["user"], "m": "2026-11-15", "a": "1"})
    with pytest.raises(IntegrityError), engine.begin() as conn:  # not negative
        conn.execute(insert, {"id": uuid.uuid4(), "u": base["user"], "m": "2026-12-01", "a": "-1"})


def test_upgrade_seeds_default_categories_for_an_existing_owner(
    test_database_url, engine, clean_db
):
    cfg = _alembic_config(test_database_url)
    command.downgrade(cfg, "0001")
    try:
        eng = create_engine(test_database_url)
        with eng.begin() as conn:
            conn.execute(text("DELETE FROM users"))
            _user(conn)
        command.upgrade(cfg, "head")
        with eng.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM categories")).scalar_one() == (
                DEFAULT_CATEGORY_COUNT
            )
            names = {r[0] for r in conn.execute(text("SELECT name FROM categories"))}
        assert {"Salary", "Fees", "Other expense", "Other income"} <= names
        eng.dispose()
    finally:
        command.upgrade(cfg, "head")


def test_downgrade_then_upgrade_round_trips(test_database_url, clean_db):
    cfg = _alembic_config(test_database_url)
    command.downgrade(cfg, "0001")
    eng = create_engine(test_database_url)
    try:
        names = set(inspect(eng).get_table_names())
        assert "transactions" not in names and "users" in names
    finally:
        eng.dispose()
        command.upgrade(cfg, "head")
    eng = create_engine(test_database_url)
    try:
        assert {"accounts", "transactions"} <= set(inspect(eng).get_table_names())
    finally:
        eng.dispose()
