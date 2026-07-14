"""cascade deletes for runs and schedules

Revision ID: 003
Revises: 002
Create Date: 2026-07-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("flow_runs_flow_id_fkey", "flow_runs", type_="foreignkey")
    op.create_foreign_key(
        "flow_runs_flow_id_fkey",
        "flow_runs",
        "flows",
        ["flow_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("webhook_tokens_flow_id_fkey", "webhook_tokens", type_="foreignkey")
    op.create_foreign_key(
        "webhook_tokens_flow_id_fkey",
        "webhook_tokens",
        "flows",
        ["flow_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("node_runs_flow_run_id_fkey", "node_runs", type_="foreignkey")
    op.create_foreign_key(
        "node_runs_flow_run_id_fkey",
        "node_runs",
        "flow_runs",
        ["flow_run_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("flow_schedules_flow_id_fkey", "flow_schedules", type_="foreignkey")
    op.create_foreign_key(
        "flow_schedules_flow_id_fkey",
        "flow_schedules",
        "flows",
        ["flow_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("flow_schedules_flow_id_fkey", "flow_schedules", type_="foreignkey")
    op.create_foreign_key("flow_schedules_flow_id_fkey", "flow_schedules", "flows", ["flow_id"], ["id"])

    op.drop_constraint("node_runs_flow_run_id_fkey", "node_runs", type_="foreignkey")
    op.create_foreign_key("node_runs_flow_run_id_fkey", "node_runs", "flow_runs", ["flow_run_id"], ["id"])

    op.drop_constraint("webhook_tokens_flow_id_fkey", "webhook_tokens", type_="foreignkey")
    op.create_foreign_key("webhook_tokens_flow_id_fkey", "webhook_tokens", "flows", ["flow_id"], ["id"])

    op.drop_constraint("flow_runs_flow_id_fkey", "flow_runs", type_="foreignkey")
    op.create_foreign_key("flow_runs_flow_id_fkey", "flow_runs", "flows", ["flow_id"], ["id"])
