# 快速开始指南

## 5分钟快速部署

### 前置条件
- Python 3.8+
- MySQL 5.7+

### 步骤1: 安装依赖

```bash
cd D:\01workplace\打标平台\code
pip install -r requirements.txt
```

### 步骤2: 配置数据库

```bash
# 登录MySQL
mysql -u root -p

# 创建数据库
CREATE DATABASE labeling_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EXIT;

# 导入表结构
mysql -u root -p labeling_platform < schema.sql
```

### 步骤3: 修改数据库配置

编辑 `config.py` 文件,修改数据库密码:

```python
MYSQL_PASSWORD = ''  # 改为你的MySQL密码
```

### 步骤4: 创建管理员

编辑 `create_admin.py` 文件,修改数据库密码:

```python
DB_CONFIG = {
    'password': '',  # 改为你的MySQL密码
}
```

运行创建脚本:

```bash
python create_admin.py
```

### 步骤5: 启动应用

```bash
python run.py
```

### 步骤6: 访问系统

浏览器打开: http://localhost:5000

默认账号:
- 用户名: `admin`
- 密码: `admin123`

---

## 功能使用

### 1. 管理员功能 (Data_admin)

#### 上传数据
1. 登录后点击 "上传数据"
2. 选择CSV或XLSX文件
3. 点击 "上传并导入"
4. 等待导入完成

#### 创建用户
1. 点击 "用户管理"
2. 点击 "创建用户"
3. 填写用户信息:
   - 用户名
   - 密码
   - 真实姓名
   - 角色 (Data_admin/BU_admin/Labeller)
   - 权限 (category和brand)
4. 点击创建

#### 下载数据
1. 点击 "下载数据"
2. 选择下载选项:
   - 全部数据
   - 已打标数据
   - 未打标数据
3. 点击下载

### 2. 打标功能 (所有角色)

#### 查看样本列表
1. 点击 "样本列表"
2. 使用筛选条件过滤数据:
   - 关键词搜索
   - eRetailer
   - Online Store
   - Brand
   - 状态 (已打标/未打标)
   - 等10多个筛选字段

#### 单个打标
1. 在样本列表点击 "编辑" 按钮
2. 填写5个属性字段 (可选择或输入)
3. 按 Ctrl+Enter 或点击 "提交打标"
4. 自动跳转到下一条未打标数据

#### 批量打标
1. 在样本列表勾选多条记录
2. 点击 "批量打标" 按钮
3. 填写统一的属性值
4. 点击 "确认批量打标"

### 3. 统计功能

点击 "统计信息" 查看:
- 总数据量
- 已打标数量
- 未打标数量
- 各类别完成进度

---

## CSV文件格式要求

### 必需字段

```csv
eRetailer,online_store,category,brand,product_description,url,sku,...
Amazon,Amazon.com,Electronics,Sony,Sony TV 55inch,https://...,SKU123,...
```

### 完整字段列表

| 字段名 | 说明 | 示例 |
|--------|------|------|
| eRetailer | 电商平台 | Amazon |
| online_store | 在线商店 | Amazon.com |
| category | 产品类别 | Electronics |
| brand | 品牌 | Sony |
| is_competitor | 是否竞品 | Yes/No |
| product_description | 产品描述 | Sony TV 55inch |
| url | 产品链接 | https://... |
| sku_url | SKU链接 | https://... |
| sku | SKU编号 | SKU123 |
| sku_id | SKU ID | 12345 |
| retailer_product_code | 零售商产品代码 | ABC123 |
| latest_review_date | 最新评论日期 | 2024-01-01 |
| image_url | 图片链接 | https://... |
| total | Total值 | 4.5 |
| total_comments | 评论总数 | 100 |
| last_month_total | 上月Total | 4.3 |
| last_total_comments | 上月评论数 | 90 |
| prod_attributes1 | 属性1 | Color |
| prod_attributes2 | 属性2 | Size |
| prod_attributes3 | 属性3 | Material |
| prod_attributes4 | 属性4 | Style |
| prod_attributes5 | 属性5 | Feature |
| _rule_matched | 状态标记 | LABELED/PRE_LABELED |

### 文件要求
- 编码: UTF-8 with BOM
- 格式: CSV或XLSX
- 大小: 最大500MB
- 表头: 必须包含上述字段(顺序可变)

---

## 权限说明

### Data_admin (数据管理员)
- ✅ 上传/下载数据
- ✅ 创建/管理用户
- ✅ 查看所有数据
- ✅ 打标所有数据
- ✅ 查看统计信息

### BU_admin (业务管理员)
- ❌ 上传/下载数据
- ❌ 创建/管理用户
- ✅ 查看指定category的数据
- ✅ 打标指定category的数据
- ✅ 查看权限范围内的统计

### Labeller (打标员)
- ❌ 上传/下载数据
- ❌ 创建/管理用户
- ✅ 查看指定category+brand的数据
- ✅ 打标指定category+brand的数据
- ✅ 查看权限范围内的统计

### 权限配置示例

```python
# Data_admin - 全部权限
category_arr: NULL
brand_arr: NULL

# BU_admin - 只能访问Electronics和Home类别
category_arr: ["Electronics", "Home"]
brand_arr: NULL

# Labeller - 只能访问Electronics类别下的Sony和LG品牌
category_arr: ["Electronics"]
brand_arr: ["Sony", "LG"]
```

---

## 性能参考

### 导入性能
- 500条: 约5-10秒
- 1万条: 约10-20秒
- 10万条: 约1-2分钟
- 100万条: 约10-20分钟

### 优化建议
1. **小于10万数据**: 直接导入,无需优化
2. **10万-50万数据**: 按照 `mysql_optimization.md` 优化MySQL配置
3. **超过50万数据**: 使用CSV格式,避免Excel

---

## 常见问题

### Q1: 导入时提示 "nan can not be used with MySQL"
**A**: 已修复,请确保使用最新版本代码

### Q2: 导入速度很慢
**A**:
1. 检查MySQL配置是否优化
2. 确保使用CSV而非Excel
3. 减少数据量分批导入

### Q3: 登录后无法访问某些页面
**A**: 检查用户权限配置,确认category_arr和brand_arr设置正确

### Q4: 忘记管理员密码
**A**:
```sql
-- 重置为admin123
UPDATE user SET password='scrypt:32768:8:1$...' WHERE username='admin';
-- 或重新运行 create_admin.py
```

### Q5: 批量打标后属性没更新
**A**: 批量打标只更新填写的字段,空字段不会修改

---

## 技术支持

如需帮助,请提供:
1. 错误截图
2. 浏览器控制台错误信息
3. 服务器日志
4. Python和MySQL版本信息

---

## 下一步

✅ 完成快速部署后,建议:
1. 阅读 `DEPLOYMENT.md` 了解生产环境部署
2. 阅读 `mysql_optimization.md` 优化大数据导入
3. 修改默认管理员密码
4. 创建实际使用的用户账号
5. 配置数据库定期备份
