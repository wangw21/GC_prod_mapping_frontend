from functools import wraps
from flask import redirect, url_for, flash, abort
from flask_login import current_user

def login_required(f):
    """登录验证装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            flash('请先登录', 'warning')
            return redirect(url_for('auth.login'))
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    """Data_admin权限验证装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            flash('请先登录', 'warning')
            return redirect(url_for('auth.login'))
        if not current_user.is_data_admin:
            flash('需要Data_admin权限', 'danger')
            abort(403)
        return f(*args, **kwargs)
    return decorated_function

def role_required(*roles):
    """指定角色权限验证装饰器"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not current_user.is_authenticated:
                flash('请先登录', 'warning')
                return redirect(url_for('auth.login'))
            if current_user.role not in roles:
                flash(f'需要以下角色之一: {", ".join(roles)}', 'danger')
                abort(403)
            return f(*args, **kwargs)
        return decorated_function
    return decorator
