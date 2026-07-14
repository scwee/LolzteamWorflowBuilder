"""Add lzt_accounts and flow_files tables."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "005_lzt_accounts_and_files"
down_revision = "004_funpay_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lzt_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nickname", sa.String(128), nullable=False, server_default=""),
        sa.Column("token_encrypted", sa.Text(), nullable=False),
        sa.Column("token_preview", sa.String(32), nullable=False, server_default=""),
        sa.Column("balance", sa.Float(), nullable=True),
        sa.Column("last_refreshed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_lzt_accounts_user_id", "lzt_accounts", ["user_id"])

    op.create_table(
        "flow_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("flow_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("flows.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("node_id", sa.String(64), nullable=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(128), nullable=False, server_default="text/plain"),
        sa.Column("encoding", sa.String(16), nullable=False, server_default="text"),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("content_text", sa.Text(), nullable=True),
        sa.Column("content_binary", sa.LargeBinary(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_flow_files_flow_id", "flow_files", ["flow_id"])
    op.create_index("ix_flow_files_user_id", "flow_files", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_flow_files_user_id", table_name="flow_files")
    op.drop_index("ix_flow_files_flow_id", table_name="flow_files")
    op.drop_table("flow_files")
    op.drop_index("ix_lzt_accounts_user_id", table_name="lzt_accounts")
    op.drop_table("lzt_accounts")
