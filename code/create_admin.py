#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""快速创建管理员账号 - 直接连接数据库"""

import pymysql
from werkzeug.security import generate_password_hash

# 数据库配置 - 直接写死
DB_CONFIG = {
    'host': 'localhost',
    'port': 3306,
    'user': 'root',
    'password': '',
    'database': 'labeling_platform',
    'charset': 'utf8mb4'
}

def create_admin_user(username='admin', password='admin123', real_name='系统管理员'):
    """创建管理员账号"""
    try:
        # 连接数据库
        conn = pymysql.connect(**DB_CONFIG)
        cursor = conn.cursor()

        # 检查用户是否已存在
        cursor.execute("SELECT id FROM user WHERE username = %s", (username,))
        if cursor.fetchone():
            print(f'❌ 用户 {username} 已存在')
            cursor.close()
            conn.close()
            return False

        # 生成密码哈希
        password_hash = generate_password_hash(password)

        # 插入管理员账号
        sql = """
        INSERT INTO user (username, password, real_name, role, category_arr, brand_arr, is_active)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """
        cursor.execute(sql, (username, password_hash, real_name, 'Data_admin', None, None, 1))
        conn.commit()

        print(f'✅ 管理员账号创建成功！')
        print(f'   用户名: {username}')
        print(f'   密码: {password}')
        print(f'   角色: Data_admin (全部权限)')

        cursor.close()
        conn.close()
        return True

    except Exception as e:
        print(f'❌ 创建失败: {str(e)}')
        return False

if __name__ == '__main__':
    # 默认管理员账号
    create_admin_user(
        username='admin',
        password='admin123',
        real_name='系统管理员'
    )
