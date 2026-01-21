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


def upgrade():
    with op.batch_alter_table('sample_data', schema=None) as batch_op:
        batch_op.alter_column('_rule_matched', new_column_name='status', existing_type=sa.String(length=255))

def downgrade():
    with op.batch_alter_table('sample_data', schema=None) as batch_op:
        batch_op.alter_column('status', new_column_name='_rule_matched', existing_type=sa.String(length=255))
