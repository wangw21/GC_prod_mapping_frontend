from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
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

    # 打标状态
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

    def __repr__(self):
        return f'<SampleData {self.id}>'
