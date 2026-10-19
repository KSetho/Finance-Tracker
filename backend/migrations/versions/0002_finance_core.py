"""finance core: accounts, categories, transactions, monthly_budgets

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-17
"""
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

ACCOUNT_TYPE = postgresql.ENUM("bank", "mobile_money", "cash", name="account_type", create_type=False)
CATEGORY_TYPE = postgresql.ENUM("income", "expense", name="category_type", create_type=False)
TRANSACTION_TYPE = postgresql.ENUM(
    "income", "expense", "transfer", name="transaction_type", create_type=False
)

DEFAULT_CATEGORIES = [
    ("Salary", "income"),
    ("Freelance", "income"),
    ("Business", "income"),
    ("Gift", "income"),
    ("Other income", "income"),
    ("Food", "expense"),
    ("Transport", "expense"),
    ("Bills", "expense"),
    ("Shopping", "expense"),
    ("Health", "expense"),
    ("Family", "expense"),
    ("Fees", "expense"),
    ("Other expense", "expense"),
]


def upgrade() -> None:
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"
    if is_postgresql:
        for enum in (ACCOUNT_TYPE, CATEGORY_TYPE, TRANSACTION_TYPE):
            enum.create(bind, checkfirst=True)
        account_type = ACCOUNT_TYPE
        category_type = CATEGORY_TYPE
        transaction_type = TRANSACTION_TYPE
    else:
        account_type = sa.Enum(
            "bank", "mobile_money", "cash", name="account_type", native_enum=False
        )
        category_type = sa.Enum("income", "expense", name="category_type", native_enum=False)
        transaction_type = sa.Enum(
            "income", "expense", "transfer", name="transaction_type", native_enum=False
        )

    ts = lambda name: sa.Column(  # noqa: E731
        name, sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )

    op.create_table(
        "accounts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("account_type", account_type, nullable=False),
        sa.Column("opening_balance", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("opening_date", sa.Date(), nullable=False),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        ts("created_at"),
        ts("updated_at"),
        sa.CheckConstraint("opening_balance >= 0", name="ck_accounts_opening_balance_nonneg"),
    )
    op.create_index("uq_accounts_id_user", "accounts", ["id", "user_id"], unique=True)
    op.execute("CREATE UNIQUE INDEX uq_accounts_user_lower_name ON accounts (user_id, lower(name))")

    op.create_table(
        "categories",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("category_type", category_type, nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        ts("created_at"),
    )
    op.create_index("uq_categories_id_user", "categories", ["id", "user_id"], unique=True)
    op.create_index(
        "uq_categories_user_type_name",
        "categories",
        ["user_id", "category_type", "name"],
        unique=True,
    )

    op.create_table(
        "transactions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("type", transaction_type, nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("destination_account_id", sa.Uuid(), nullable=True),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("fee_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column(
            "related_transaction_id",
            sa.Uuid(),
            sa.ForeignKey("transactions.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        ts("created_at"),
        ts("updated_at"),
        sa.CheckConstraint("amount > 0", name="ck_transactions_amount_positive"),
        sa.CheckConstraint("fee_amount >= 0", name="ck_transactions_fee_nonneg"),
        sa.CheckConstraint(
            "(type IN ('income', 'expense') AND account_id IS NOT NULL"
            " AND destination_account_id IS NULL)"
            " OR (type = 'transfer' AND account_id IS NOT NULL"
            " AND destination_account_id IS NOT NULL AND account_id <> destination_account_id)",
            name="ck_transactions_shape",
        ),
        sa.CheckConstraint(
            "related_transaction_id IS NULL OR (type = 'expense' AND fee_amount = 0)",
            name="ck_transactions_fee_row",
        ),
        sa.ForeignKeyConstraint(
            ["account_id", "user_id"], ["accounts.id", "accounts.user_id"], name="fk_tx_account_owner"
        ),
        sa.ForeignKeyConstraint(
            ["destination_account_id", "user_id"],
            ["accounts.id", "accounts.user_id"],
            name="fk_tx_destination_owner",
        ),
        sa.ForeignKeyConstraint(
            ["category_id", "user_id"],
            ["categories.id", "categories.user_id"],
            name="fk_tx_category_owner",
        ),
    )
    op.create_index(
        "uq_transactions_related",
        "transactions",
        ["related_transaction_id"],
        unique=True,
        postgresql_where=sa.text("related_transaction_id IS NOT NULL"),
        sqlite_where=sa.text("related_transaction_id IS NOT NULL"),
    )
    op.execute(
        "CREATE INDEX ix_transactions_user_date ON transactions "
        "(user_id, transaction_date DESC, created_at DESC)"
    )
    op.create_index(
        "ix_transactions_user_type_date", "transactions", ["user_id", "type", "transaction_date"]
    )
    op.create_index("ix_transactions_account", "transactions", ["account_id"])
    op.create_index("ix_transactions_destination", "transactions", ["destination_account_id"])
    op.create_index("ix_transactions_category", "transactions", ["category_id"])

    op.create_table(
        "monthly_budgets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("month_start", sa.Date(), nullable=False),
        sa.Column("allowance", sa.Numeric(14, 2), nullable=False),
        ts("created_at"),
        ts("updated_at"),
        sa.CheckConstraint("allowance >= 0", name="ck_budgets_allowance_nonneg"),
        sa.CheckConstraint(
            "EXTRACT(day FROM month_start) = 1"
            if is_postgresql
            else "strftime('%d', month_start) = '01'",
            name="ck_budgets_month_start",
        ),
    )
    op.create_index(
        "uq_budgets_user_month", "monthly_budgets", ["user_id", "month_start"], unique=True
    )

    # An owner who was provisioned before this revision still needs the built-in categories.
    if is_postgresql:
        values = ", ".join(f"('{name}', '{kind}')" for name, kind in DEFAULT_CATEGORIES)
        op.execute(
            "INSERT INTO categories (id, user_id, name, category_type, is_system) "
            "SELECT gen_random_uuid(), u.id, c.name, CAST(c.kind AS category_type), true "
            f"FROM users u CROSS JOIN (VALUES {values}) AS c(name, kind) "
            "ON CONFLICT (user_id, category_type, name) DO NOTHING"
        )
    else:
        users = sa.table("users", sa.column("id", sa.Uuid()))
        categories = sa.table(
            "categories",
            sa.column("id", sa.Uuid()),
            sa.column("user_id", sa.Uuid()),
            sa.column("name", sa.String()),
            sa.column("category_type", sa.String()),
            sa.column("is_system", sa.Boolean()),
        )
        rows = [
            {
                "id": uuid.uuid4(),
                "user_id": user_id,
                "name": name,
                "category_type": kind,
                "is_system": True,
            }
            for user_id in bind.scalars(sa.select(users.c.id))
            for name, kind in DEFAULT_CATEGORIES
        ]
        if rows:
            bind.execute(categories.insert(), rows)


def downgrade() -> None:
    op.drop_table("monthly_budgets")
    op.drop_table("transactions")
    op.drop_table("categories")
    op.drop_table("accounts")
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for enum in (TRANSACTION_TYPE, CATEGORY_TYPE, ACCOUNT_TYPE):
            enum.drop(bind, checkfirst=True)
