from flask import Blueprint, render_template, redirect, url_for
from flask_login import current_user

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
        return redirect(url_for('labeling.samples'))

@bp.route('/dashboard')
def dashboard():
    """仪表盘"""
    if not current_user.is_authenticated:
        return redirect(url_for('auth.login'))

    return render_template('dashboard.html')
