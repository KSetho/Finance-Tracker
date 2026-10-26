"""report request throttle log

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-21
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_ip", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_report_requests_user_created",
        "report_requests",
        ["user_id", "created_at"],
    )
    op.create_index(
        "ix_report_requests_source_created",
        "report_requests",
        ["source_ip", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("report_requests")
