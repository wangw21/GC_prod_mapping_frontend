from app import create_app
from app.models import db, User
from dotenv import load_dotenv
import os

# 加载环境变量
load_dotenv()

# 创建应用
app = create_app(os.getenv('FLASK_ENV', 'development'))

@app.cli.command()
def init_db():
    """初始化数据库"""
    db.create_all()
    print('数据库初始化完成')

@app.cli.command()
def create_admin():
    """创建管理员账号"""
    username = input('管理员用户名: ')
    password = input('管理员密码: ')
    real_name = input('真实姓名(可选): ')

    if User.query.filter_by(username=username).first():
        print('用户名已存在')
        return

    admin = User(
        username=username,
        real_name=real_name if real_name else None,
        role='Data_admin',
        category_arr=None,  # NULL表示全部权限
        brand_arr=None
    )
    admin.set_password(password)

    db.session.add(admin)
    db.session.commit()

    print(f'管理员 {username} 创建成功')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
