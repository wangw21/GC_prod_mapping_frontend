"""add audit_log table

Revision ID: a1b2c3d4e5f6
Revises: 5026cbb5ff52
Create Date: 2026-06-29 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = '5026cbb5ff52'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'audit_log',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('username', sa.String(length=50), nullable=True),
        sa.Column('action', sa.String(length=50), nullable=True),
        sa.Column('entity_type', sa.String(length=30), nullable=True),
        sa.Column('entity_id', sa.Integer(), nullable=True),
        sa.Column('changes', sa.JSON(), nullable=True),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('ip', sa.String(length=45), nullable=True),
        sa.Column('reverted', sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('audit_log', schema=None) as batch_op:
        batch_op.create_index('ix_audit_log_created_at', ['created_at'])
        batch_op.create_index('ix_audit_log_user_id', ['user_id'])
        batch_op.create_index('ix_audit_log_action', ['action'])
        batch_op.create_index('ix_audit_log_entity_type', ['entity_type'])
        batch_op.create_index('ix_audit_log_entity_id', ['entity_id'])


def downgrade():
    with op.batch_alter_table('audit_log', schema=None) as batch_op:
        batch_op.drop_index('ix_audit_log_entity_id')
        batch_op.drop_index('ix_audit_log_entity_type')
        batch_op.drop_index('ix_audit_log_action')
        batch_op.drop_index('ix_audit_log_user_id')
        batch_op.drop_index('ix_audit_log_created_at')
    op.drop_table('audit_log')
