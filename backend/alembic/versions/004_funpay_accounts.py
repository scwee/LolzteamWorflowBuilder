"""Add funpay_accounts table."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "004_funpay_accounts"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "funpay_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nickname", sa.String(128), nullable=False, server_default=""),
        sa.Column("golden_key_encrypted", sa.Text(), nullable=False),
        sa.Column("golden_key_preview", sa.String(32), nullable=False, server_default=""),
        sa.Column("proxy", sa.Text(), nullable=True),
        sa.Column("balance", sa.Float(), nullable=True),
        sa.Column("orders_count", sa.Integer(), nullable=True),
        sa.Column("last_refreshed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_funpay_accounts_user_id", "funpay_accounts", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_funpay_accounts_user_id", table_name="funpay_accounts")
    op.drop_table("funpay_accounts")
