"""add business identity columns to audit_log

为 audit_log 增加业务身份四列（product_description, sku, url, sku_url），
用于下游联动与跨月回滚（自增 id 跨月不稳定，故以业务键作稳定标识）。

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2025-10-24

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('audit_log', schema=None) as batch_op:
        batch_op.add_column(sa.Column('product_description', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('sku', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('url', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('sku_url', sa.Text(), nullable=True))


def downgrade():
    with op.batch_alter_table('audit_log', schema=None) as batch_op:
        batch_op.drop_column('sku_url')
        batch_op.drop_column('url')
        batch_op.drop_column('sku')
        batch_op.drop_column('product_description')
