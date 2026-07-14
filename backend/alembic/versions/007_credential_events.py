"""Add credential_events audit table."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "007_credential_events"
down_revision = "006_drop_funpay_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "credential_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("credential_kind", sa.String(32), nullable=False),
        sa.Column("credential_id", sa.String(64), nullable=True),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("label", sa.String(255), nullable=True),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("flow_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_credential_events_user_id", "credential_events", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_credential_events_user_id", table_name="credential_events")
    op.drop_table("credential_events")
