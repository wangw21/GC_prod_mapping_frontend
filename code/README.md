# 产品数据标注平台

一个基于Flask的电商产品数据人工标注系统,支持CSV/Excel批量导入、多用户权限管理、批量打标等功能。

## 功能特性

### 核心功能
- ✅ **数据导入**: 支持CSV/Excel文件批量导入,最大500MB,优化支持百万级数据
- ✅ **权限管理**: 三级权限体系(Data_admin/BU_admin/Labeller),基于category和brand的细粒度控制
- ✅ **人工打标**: 单个打标 + 批量打标,支持5个自定义属性字段
- ✅ **高级筛选**: 10+个筛选条件,快速定位目标数据
- ✅ **数据导出**: 支持全部/已打标/未打标数据导出
- ✅ **统计看板**: 实时显示打标进度和分类统计

### 技术亮点
- 🚀 **高性能导入**: 批量插入 + 分块读取,100万数据约10-20分钟
- 🎯 **智能下拉**: 属性字段支持历史值选择 + 自由输入,按字母排序
- 🔐 **安全认证**: Flask-Login + Werkzeug密码哈希
- 📊 **数据权限**: 精细化权限过滤,确保数据安全
- 💾 **批量操作**: 支持跨页勾选批量打标

## 快速开始

### 安装依赖
```bash
pip install -r requirements.txt
```

### 配置数据库
```bash
mysql -u root -p
CREATE DATABASE labeling_platform CHARACTER SET utf8mb4;
EXIT;
mysql -u root -p labeling_platform < schema.sql
```

### 创建管理员
```bash
# 修改 create_admin.py 中的数据库密码
python create_admin.py
```

### 启动应用
```bash
python run.py
```

访问: http://localhost:5000

默认账号: `admin` / `admin123`

## 文档

- 📘 [快速开始指南](QUICKSTART.md) - 5分钟快速部署
- 📗 [部署文档](DEPLOYMENT.md) - 生产环境完整部署指南
- 📙 [MySQL优化](mysql_optimization.md) - 百万级数据导入优化

## 系统架构

```
labeling-platform/
├── app/
│   ├── __init__.py          # Flask应用初始化
│   ├── models.py            # 数据模型(User, SampleData)
│   ├── routes/              # 路由模块
│   │   ├── auth.py          # 登录/登出
│   │   ├── admin.py         # 上传/下载/用户管理
│   │   ├── labeling.py      # 样本列表/打标/统计
│   │   └── main.py          # 首页重定向
│   ├── templates/           # Jinja2模板
│   ├── static/              # 静态资源
│   └── utils/               # 工具模块
│       ├── csv_handler.py   # CSV导入导出(优化版)
│       ├── decorators.py    # 权限装饰器
│       └── progress_tracker.py # 进度跟踪(备用)
├── config.py                # 配置文件
├── run.py                   # 启动入口
├── schema.sql               # 数据库结构
├── create_admin.py          # 管理员创建脚本
└── requirements.txt         # Python依赖
```

## 技术栈

- **后端**: Flask 3.0, Flask-SQLAlchemy, Flask-Login
- **数据库**: MySQL 5.7+
- **数据处理**: Pandas, OpenPyXL
- **前端**: Bootstrap 5, Font Awesome
- **Python**: 3.8+

## 数据模型

### User (用户表)
- username, password, real_name
- role: Data_admin / BU_admin / Labeller
- category_arr, brand_arr: JSON数组权限控制

### SampleData (样本表)
- 基础信息: eRetailer, brand, category, product_description, note等
- 人工标注: prod_attributes1-5
- 状态: _rule_matched (LABELED/PRE_LABELED/NULL)

## 权限设计

| 角色 | category_arr | brand_arr | 权限说明 |
|------|--------------|-----------|----------|
| Data_admin | NULL | NULL | 全部数据权限 |
| BU_admin | ["Electronics"] | NULL | 指定类别全部品牌 |
| Labeller | ["Electronics"] | ["Sony"] | 指定类别指定品牌 |

## 性能优化

### 导入优化
- ✅ 批量插入 (5000条/批次)
- ✅ 分块读取 (避免内存溢出)
- ✅ 取消预统计 (CSV直接读取)
- ✅ 数据库连接池 (10个连接)

### 查询优化
- ✅ 索引优化 (brand, category, prod_attributes1-5)
- ✅ 分页加载 (50条/页)
- ✅ 权限前置过滤
- ✅ 下拉选项缓存



## 使用流程

### Data_admin工作流程
1. 登录系统
2. **上传数据**: 点击"上传数据",选择CSV/XLSX文件
3. **创建用户**: 点击"用户管理"-"创建用户",设置权限
4. **监控进度**: 查看统计信息了解打标进度
5. **导出数据**: 点击"下载数据",选择导出范围

### BU_admin/Labeller工作流程
1. 登录系统(自动过滤权限范围内数据)
2. **筛选数据**: 使用高级筛选定位目标数据
3. **单个打标**: 点击"编辑"按钮,填写属性,Ctrl+Enter提交
4. **批量打标**: 勾选多条记录,点击"批量打标",统一填写属性
5. **查看统计**: 了解个人打标进度

## 安全建议

### 生产环境必做
- [ ] 修改默认管理员密码
- [ ] 修改 SECRET_KEY 为强随机密钥
- [ ] 配置HTTPS (使用Nginx + Let's Encrypt)
- [ ] 限制数据库只允许本地访问
- [ ] 配置防火墙规则
- [ ] 设置数据库定期备份

## 常见问题

### Q: 导入100万数据需要多久?
A: 约10-20分钟,取决于服务器性能。建议优化MySQL配置。

### Q: 支持哪些文件格式?
A: CSV (UTF-8) 和 XLSX,最大500MB。建议大文件使用CSV格式。

### Q: 如何给用户分配权限?
A: 创建用户时设置category_arr和brand_arr。NULL表示全部权限,数组表示限定范围。

### Q: 批量打标会覆盖已有值吗?
A: 只更新填写的字段,空字段不会修改已有值。

### Q: 如何备份数据?
A: 使用mysqldump导出数据库,或在"下载数据"页面导出CSV。

## 更新日志

### v1.0.0 (2026-01-09)
- ✅ 初始版本发布
- ✅ 支持CSV/Excel批量导入
- ✅ 三级权限系统
- ✅ 单个/批量打标功能
- ✅ 高级筛选和统计
- ✅ 性能优化支持百万级数据

## 贡献指南

欢迎提交Issue和Pull Request!

### 开发环境搭建
```bash
git clone <repo>
cd labeling-platform
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 代码规范
- Python: PEP 8
- 注释: 中文
- 提交: 简洁清晰的commit message

## 许可证

MIT

---

⭐ 如果这个项目对你有帮助,请给个Star!
