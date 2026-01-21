# 产品数据标注平台 - 部署文档

## 目录
- [系统要求](#系统要求)
- [环境准备](#环境准备)
- [数据库配置](#数据库配置)
- [应用部署](#应用部署)
- [生产环境配置](#生产环境配置)
- [常见问题](#常见问题)

---

## 系统要求

### 硬件要求
- **CPU**: 2核及以上
- **内存**: 4GB及以上 (建议8GB,用于处理大文件导入)
- **磁盘**: 20GB及以上可用空间

### 软件要求
- **操作系统**: Windows 10/11, Linux, macOS
- **Python**: 3.8 或以上版本
- **MySQL**: 5.7 或以上版本 (推荐8.0)
- **浏览器**: Chrome, Firefox, Edge 最新版本

---

## 环境准备

### 1. 安装Python

**Windows:**
```bash
# 从 python.org 下载Python 3.8+安装包
# 安装时勾选"Add Python to PATH"
python --version  # 验证安装
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install python3 python3-pip
python3 --version
```

**macOS:**
```bash
brew install python@3.11
python3 --version
```

### 2. 安装MySQL

**Windows:**
- 下载MySQL安装包: https://dev.mysql.com/downloads/mysql/
- 安装时记住root密码
- 启动MySQL服务

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql
sudo mysql_secure_installation  # 配置安全选项
```

**macOS:**
```bash
brew install mysql
brew services start mysql
mysql_secure_installation
```

---

## 数据库配置

### 1. 创建数据库

登录MySQL:
```bash
# Windows
mysql -u root -p

# Linux/macOS
sudo mysql -u root -p
```

创建数据库和用户:
```sql
-- 创建数据库
CREATE DATABASE labeling_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建用户 (生产环境请使用强密码)
CREATE USER 'labeling_user'@'localhost' IDENTIFIED BY 'your_secure_password';

-- 授权
GRANT ALL PRIVILEGES ON labeling_platform.* TO 'labeling_user'@'localhost';
FLUSH PRIVILEGES;

-- 退出
EXIT;
```

### 2. 导入数据库结构

```bash
# 进入项目目录
cd D:\01workplace\打标平台\code

# 导入表结构
mysql -u root -p labeling_platform < schema.sql
```

### 3. MySQL性能优化 (可选,针对大数据量)

编辑MySQL配置文件:
- **Windows**: `C:\ProgramData\MySQL\MySQL Server 8.0\my.ini`
- **Linux**: `/etc/mysql/my.cnf` 或 `/etc/my.cnf`
- **macOS**: `/usr/local/etc/my.cnf`

添加以下配置:
```ini
[mysqld]
# 基础优化
max_allowed_packet = 256M
innodb_buffer_pool_size = 2G
innodb_log_file_size = 512M

# 批量导入优化
bulk_insert_buffer_size = 64M
local_infile = 1
```

重启MySQL服务:
```bash
# Windows
net stop mysql
net start mysql

# Linux
sudo systemctl restart mysql

# macOS
brew services restart mysql
```

---

## 应用部署

### 1. 获取代码

```bash
# 克隆仓库或解压代码包
cd D:\01workplace\打标平台\code
```

### 2. 创建虚拟环境 (推荐)

```bash
# 创建虚拟环境
python3 -m venv venv

# 激活虚拟环境
# Windows
venv\Scripts\activate

# Linux/macOS
source venv/bin/activate
```

### 3. 安装依赖

```bash
pip3 install -r requirements.txt
```

### 4. 配置环境变量

创建 `.env` 文件 (可选):
```bash
# 数据库配置
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=labeling_user
MYSQL_PASSWORD=your_secure_password
MYSQL_DB=labeling_platform

# Flask配置
SECRET_KEY=your-secret-key-change-in-production
FLASK_ENV=production
```

**注意**: 如果不使用`.env`文件,需要在 `config.py` 中直接修改配置。

### 5. 创建管理员账号

```bash
# 方法1: 使用脚本创建 (需要先修改create_admin.py中的数据库密码)
python3 create_admin.py

# 方法2: 手动SQL插入
mysql -u root -p labeling_platform
```

默认管理员账号:
- **用户名**: admin
- **密码**: admin123
- **角色**: Data_admin

**生产环境请立即修改默认密码!**

### 6. 测试运行

```bash
python3 run.py
```

访问: http://localhost:5000

看到登录页面说明部署成功!

---

## 生产环境配置

### 1. 使用Gunicorn部署 (Linux/macOS)

安装Gunicorn:
```bash
pip3 install gunicorn
```

创建启动脚本 `start.sh`:
```bash
#!/bin/bash
cd /path/to/code
source venv/bin/activate
gunicorn -w 4 -b 0.0.0.0:5000 run:app
```

运行:
```bash
chmod +x start.sh
./start.sh
```

### 2. 使用Nginx反向代理 (推荐)

安装Nginx:
```bash
# Ubuntu/Debian
sudo apt install nginx

# CentOS/RHEL
sudo yum install nginx
```

配置Nginx (`/etc/nginx/sites-available/labeling`):
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 大文件上传配置
        client_max_body_size 500M;
        proxy_read_timeout 600s;
    }

    location /static {
        alias /path/to/code/app/static;
        expires 30d;
    }
}
```

启用配置:
```bash
sudo ln -s /etc/nginx/sites-available/labeling /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 3. 配置Systemd服务 (Linux)

创建服务文件 `/etc/systemd/system/labeling.service`:
```ini
[Unit]
Description=Labeling Platform
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/path/to/code
Environment="PATH=/path/to/code/venv/bin"
ExecStart=/path/to/code/venv/bin/gunicorn -w 4 -b 127.0.0.1:5000 run:app

[Install]
WantedBy=multi-user.target
```

启动服务:
```bash
sudo systemctl daemon-reload
sudo systemctl start labeling
sudo systemctl enable labeling
sudo systemctl status labeling
```

### 4. Windows服务部署

使用NSSM (Non-Sucking Service Manager):

1. 下载NSSM: https://nssm.cc/download
2. 安装服务:
```cmd
nssm install LabelingPlatform "D:\01workplace\打标平台\code\venv\Scripts\python.exe" "D:\01workplace\打标平台\code\run.py"
nssm start LabelingPlatform
```

---

## 安全配置

### 1. 修改默认密码

登录后台,立即修改管理员密码。

### 2. 修改SECRET_KEY

在 `config.py` 或 `.env` 中设置强随机密钥:
```python
import secrets
print(secrets.token_hex(32))
```

### 3. 配置防火墙

```bash
# Linux (UFW)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# 限制MySQL只允许本地访问
sudo ufw deny 3306/tcp
```

### 4. 数据库备份

创建备份脚本 `backup.sh`:
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
mysqldump -u root -p labeling_platform > backup_${DATE}.sql
# 保留最近7天的备份
find . -name "backup_*.sql" -mtime +7 -delete
```

设置定时任务:
```bash
crontab -e
# 每天凌晨2点备份
0 2 * * * /path/to/backup.sh
```

---

## 常见问题

### 1. 数据库连接失败

**错误**: `Can't connect to MySQL server`

**解决**:
- 检查MySQL服务是否启动
- 验证用户名和密码是否正确
- 确认 `config.py` 中的数据库配置

### 2. 导入数据时内存不足

**错误**: `MemoryError`

**解决**:
- 减小 `chunk_size` 参数 (在 `csv_handler.py` 中)
- 增加系统内存
- 分批导入大文件

### 3. 上传文件大小限制

**错误**: `413 Request Entity Too Large`

**解决**:
- 修改 `config.py` 中的 `MAX_CONTENT_LENGTH`
- 配置Nginx的 `client_max_body_size`

### 4. 端口被占用

**错误**: `Address already in use`

**解决**:
```bash
# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Linux/macOS
lsof -i :5000
kill -9 <PID>
```

### 5. 权限问题

**错误**: `Permission denied`

**解决**:
```bash
# 设置正确的文件权限
chmod -R 755 /path/to/code
chown -R www-data:www-data /path/to/code
```

---

## 维护建议

### 日志管理

查看应用日志:
```bash
# 开发环境
python3 run.py  # 直接在终端查看

# 生产环境 (systemd)
sudo journalctl -u labeling -f

# Gunicorn日志
tail -f /var/log/gunicorn/access.log
tail -f /var/log/gunicorn/error.log
```

### 数据库维护

```sql
-- 查看表大小
SELECT
    table_name AS `Table`,
    ROUND(((data_length + index_length) / 1024 / 1024), 2) AS `Size (MB)`
FROM information_schema.TABLES
WHERE table_schema = 'labeling_platform';

-- 优化表
OPTIMIZE TABLE sample_data;

-- 查看慢查询
SHOW VARIABLES LIKE 'slow_query_log';
```

### 性能监控

```bash
# 查看系统资源
htop  # Linux
top   # 通用

# 查看MySQL连接数
mysql -u root -p -e "SHOW PROCESSLIST;"

# 查看Python进程
ps aux | grep python
```

---

## 升级指南

### 1. 备份数据

```bash
mysqldump -u root -p labeling_platform > backup_before_upgrade.sql
```

### 2. 拉取新代码

```bash
cd /path/to/code
git pull  # 或替换代码文件
```

### 3. 更新依赖

```bash
pip3 install -r requirements.txt --upgrade
```

### 4. 执行数据库迁移 (如有)

```bash
mysql -u root -p labeling_platform < migration.sql
```

### 5. 重启服务

```bash
# Systemd
sudo systemctl restart labeling

# 手动
pkill -f gunicorn
./start.sh
```

---

## 联系支持

如遇到部署问题,请检查:
1. Python和MySQL版本是否符合要求
2. 防火墙和端口配置
3. 日志文件中的错误信息
4. 数据库连接和权限

**部署成功后,请立即:**
✅ 修改默认管理员密码
✅ 修改SECRET_KEY
✅ 配置数据库备份
✅ 设置防火墙规则
✅ 测试文件上传和导入功能
