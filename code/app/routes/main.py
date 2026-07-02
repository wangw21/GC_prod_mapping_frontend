from flask import Blueprint, render_template, redirect, url_for
from flask_login import current_user
from app.bu_landing_config import get_landing_filters

bp = Blueprint('main', __name__)

@bp.route('/')
def index():
    """首页"""
    if not current_user.is_authenticated:
        return redirect(url_for('auth.login'))

    # 根据角色跳转到不同页面
    if current_user.is_data_admin:
        return redirect(url_for('labeling.stats'))
    else:
        # 非 Data_admin：按所属 BU 落地到带默认筛选的 Sample List
        landing = get_landing_filters(current_user)
        return redirect(url_for('labeling.samples', **landing))

@bp.route('/dashboard')
def dashboard():
    """仪表盘"""
    if not current_user.is_authenticated:
        return redirect(url_for('auth.login'))

    return render_template('dashboard.html')
