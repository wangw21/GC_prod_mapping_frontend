from flask import Flask
from flask_login import LoginManager
from flask_migrate import Migrate
from config import config
import os

def create_app(config_name='default'):
    """应用工厂函数"""
    app = Flask(__name__)
    app.config.from_object(config[config_name])

    # 初始化扩展
    from app.models import db
    db.init_app(app)
    migrate = Migrate(app, db)

    # 初始化Flask-Login
    login_manager = LoginManager()
    login_manager.init_app(app)
    login_manager.login_view = 'auth.login'
    login_manager.login_message = '请先登录'
    @login_manager.user_loader
    def load_user(user_id):
        from app.models import User
        return User.query.get(int(user_id))

    # 注册蓝图
    from app.routes import main, auth, admin, labeling
    app.register_blueprint(main.bp)
    app.register_blueprint(auth.bp)
    app.register_blueprint(admin.bp)
    app.register_blueprint(labeling.bp)

    # 确保必要的目录存在
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

    # 上下文处理器
    @app.context_processor
    def inject_user():
        from flask_login import current_user
        return dict(current_user=current_user)

    # 中英双语：注入翻译函数与当前语言
    from app.i18n import t, get_lang
    @app.context_processor
    def inject_i18n():
        return dict(t=t, current_lang=get_lang())

    # 语言切换
    from flask import session, redirect, request, url_for
    from app.i18n import SUPPORTED_LANGS
    @app.route('/set-language/<lang>')
    def set_language(lang):
        if lang in SUPPORTED_LANGS:
            session['lang'] = lang
        return redirect(request.referrer or url_for('main.index'))

    return app
