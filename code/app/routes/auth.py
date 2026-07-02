from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_user, logout_user, current_user
from app.models import User, db
from app.i18n import t

bp = Blueprint('auth', __name__, url_prefix='/auth')

@bp.route('/login', methods=['GET', 'POST'])
def login():
    """登录"""
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))

    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        remember = request.form.get('remember', False)

        user = User.query.filter_by(username=username).first()

        if user and user.check_password(password):
            if not user.is_active:
                flash(t('Account is disabled'), 'danger')
                return render_template('auth/login.html')

            login_user(user, remember=remember)
            flash(t('Welcome back') + ', ' + (user.real_name or user.username) + '!', 'success')

            # 重定向到之前访问的页面
            next_page = request.args.get('next')
            if next_page:
                return redirect(next_page)
            return redirect(url_for('main.index'))
        else:
            flash(t('Incorrect username or password'), 'danger')

    return render_template('auth/login.html')

@bp.route('/logout')
def logout():
    """登出"""
    logout_user()
    flash(t('Logged out'), 'info')
    return redirect(url_for('auth.login'))
