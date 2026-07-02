"""Rename _rule_matched to status

Revision ID: 5026cbb5ff52
Revises: ba90b0a2e4b6
Create Date: 2026-01-12 15:54:31.379363

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '5026cbb5ff52'
down_revision = 'ba90b0a2e4b6'
branch_labels = None
depends_on = None


def _get_column_names(table_name):
    inspector = sa.inspect(op.get_bind())
    return {column['name'] for column in inspector.get_columns(table_name)}


def upgrade():
    sample_columns = _get_column_names('sample_data')
    if 'status' in sample_columns or '_rule_matched' not in sample_columns:
        return

    with op.batch_alter_table('sample_data', schema=None) as batch_op:
        batch_op.alter_column('_rule_matched', new_column_name='status', existing_type=sa.String(length=255))

def downgrade():
    with op.batch_alter_table('sample_data', schema=None) as batch_op:
        batch_op.alter_column('status', new_column_name='_rule_matched', existing_type=sa.String(length=255))
