from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import json

db = SQLAlchemy()

class User(UserMixin, db.Model):
    """用户模型"""
    __tablename__ = 'user'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    real_name = db.Column(db.String(50))
    role = db.Column(db.Enum('Data_admin', 'BU_admin', 'Labeller'), nullable=False)
    category_arr = db.Column(db.JSON)  # NULL表示全部权限
    brand_arr = db.Column(db.JSON)     # NULL表示全部权限
    is_active = db.Column(db.Boolean, default=True)

    def set_password(self, password):
        """设置密码(加密存储)"""
        self.password = generate_password_hash(password)

    def check_password(self, password):
        """验证密码"""
        return check_password_hash(self.password, password)

    def has_category_permission(self, category):
        """检查是否有category权限"""
        if self.category_arr is None:
            return True  # NULL表示全部权限
        return category in self.category_arr

    def has_brand_permission(self, brand):
        """检查是否有brand权限"""
        if self.brand_arr is None:
            return True  # NULL表示全部权限
        return brand in self.brand_arr

    def has_permission(self, category, brand):
        """检查是否有权限访问指定category和brand的数据"""
        return self.has_category_permission(category) and self.has_brand_permission(brand)

    def get_id(self):
        """Flask-Login需要的方法"""
        return str(self.id)

    @property
    def is_data_admin(self):
        return self.role == 'Data_admin'

    @property
    def is_bu_admin(self):
        return self.role == 'BU_admin'

    @property
    def is_labeller(self):
        return self.role == 'Labeller'

    def __repr__(self):
        return f'<User {self.username}>'


class SampleData(db.Model):
    """样本数据模型 - 严格按照CSV表头"""
    __tablename__ = 'sample_data'

    id = db.Column(db.Integer, primary_key=True)
    eRetailer = db.Column(db.String(255))
    online_store = db.Column(db.String(255))
    category = db.Column(db.String(255), index=True)
    brand = db.Column(db.String(255), index=True)
    is_competitor = db.Column(db.String(255))
    product_description = db.Column(db.Text)
    url = db.Column(db.Text)
    sku_url = db.Column(db.Text)
    sku = db.Column(db.Text)
    sku_id = db.Column(db.String(255))
    retailer_product_code = db.Column(db.String(255))
    latest_review_date = db.Column(db.Date)
    image_url = db.Column(db.Text)
    total = db.Column(db.String(255))
    total_comments = db.Column(db.String(255))
    last_month_total = db.Column(db.String(255))
    last_total_comments = db.Column(db.String(255))
    note = db.Column(db.Text)

    # 打标字段
    prod_attributes1 = db.Column(db.String(255))
    prod_attributes2 = db.Column(db.String(255))
    prod_attributes3 = db.Column(db.String(255))
    prod_attributes4 = db.Column(db.String(255))
    prod_attributes5 = db.Column(db.String(255))

    # 打标状态: Labeled/Unlabeled/Prelabeled/Historical/Incomplete/Uncertain
    status = db.Column(db.String(255), index=True)

    def to_dict(self):
        """转换为字典"""
        return {
            'id': self.id,
            'eRetailer': self.eRetailer,
            'online_store': self.online_store,
            'category': self.category,
            'brand': self.brand,
            'is_competitor': self.is_competitor,
            'product_description': self.product_description,
            'url': self.url,
            'sku_url': self.sku_url,
            'sku': self.sku,
            'sku_id': self.sku_id,
            'retailer_product_code': self.retailer_product_code,
            'latest_review_date': self.latest_review_date,
            'image_url': self.image_url,
            'total': self.total,
            'total_comments': self.total_comments,
            'last_month_total': self.last_month_total,
            'last_total_comments': self.last_total_comments,
            'note': self.note,
            'prod_attributes1': self.prod_attributes1,
            'prod_attributes2': self.prod_attributes2,
            'prod_attributes3': self.prod_attributes3,
            'prod_attributes4': self.prod_attributes4,
            'prod_attributes5': self.prod_attributes5,
            'status': self.status
        }

    @property
    def is_labeled(self):
        """是否已打标"""
        return self.status in ('Labeled', 'Historical', 'Incomplete')

    @property
    def preferred_link(self):
        """Return the business-preferred link for the labeling table."""
        eretailer = (self.eRetailer or '').strip().upper()
        url = (self.url or '').strip()
        sku_url = (self.sku_url or '').strip()
        if eretailer == 'DOUYIN':
            return url or None
        return sku_url or url or None

    def __repr__(self):
        return f'<SampleData {self.id}>'


class AuditLog(db.Model):
    """操作审计日志：记录用户对数据的更改，支持溯源与找回。

    changes 字段存储字段级 {old, new} 快照，仅当 entity_type='sample' 时用于一键回滚。
    product_description/sku/url/sku_url 为业务身份四列：数据每月清空重传后自增 id 会变，
    这四列是与下游数据表联动、跨月定位同一条数据的稳定业务键。
    """
    __tablename__ = 'audit_log'

    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    user_id = db.Column(db.Integer, index=True)
    username = db.Column(db.String(50))            # 冗余存储，避免用户删除后无法溯源
    action = db.Column(db.String(50), index=True)  # label_edit/batch_label/batch_save/upload/clear_data/user_*
    entity_type = db.Column(db.String(30), index=True)  # sample/user/data
    entity_id = db.Column(db.Integer, index=True)  # 当月自增 id（仅供快速查看，跨月不稳定）
    # 业务身份四列（稳定键，用于下游联动与跨月回滚）
    product_description = db.Column(db.Text)
    sku = db.Column(db.Text)
    url = db.Column(db.Text)
    sku_url = db.Column(db.Text)
    changes = db.Column(db.JSON)                    # {field: {old, new}}，用于回滚
    detail = db.Column(db.Text)                     # 人类可读摘要
    ip = db.Column(db.String(45))
    reverted = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {
            'id': self.id,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else '',
            'user_id': self.user_id,
            'username': self.username,
            'action': self.action,
            'entity_type': self.entity_type,
            'entity_id': self.entity_id,
            'product_description': self.product_description,
            'sku': self.sku,
            'url': self.url,
            'sku_url': self.sku_url,
            'changes': self.changes,
            'detail': self.detail,
            'ip': self.ip,
            'reverted': self.reverted,
        }

    def __repr__(self):
        return f'<AuditLog {self.id} {self.action} {self.entity_type}:{self.entity_id}>'
