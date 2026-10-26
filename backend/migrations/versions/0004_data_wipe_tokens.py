"""data wipe verification tokens

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-21
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "data_wipe_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("source_ip", sa.String(64), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("token_hash", name="uq_data_wipe_tokens_token_hash"),
    )
    op.create_index(
        "ix_data_wipe_tokens_user_created",
        "data_wipe_tokens",
        ["user_id", "created_at"],
    )
    op.create_index(
        "ix_data_wipe_tokens_source_created",
        "data_wipe_tokens",
        ["source_ip", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("data_wipe_tokens")
