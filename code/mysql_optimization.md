# MySQL优化配置 - 支持百万级数据导入

## 1. MySQL配置优化 (my.ini 或 my.cnf)

```ini
[mysqld]
# 基础配置
max_allowed_packet = 256M          # 允许大数据包传输
innodb_buffer_pool_size = 2G       # InnoDB缓冲池(建议物理内存的50-80%)
innodb_log_file_size = 512M        # 事务日志大小
innodb_flush_log_at_trx_commit = 2 # 导入时可设为2提升性能,导入后改回1

# 批量导入优化
innodb_flush_method = O_DIRECT     # 避免双重缓存
bulk_insert_buffer_size = 64M      # 批量插入缓冲
innodb_autoinc_lock_mode = 2       # 自增锁优化

# LOAD DATA INFILE支持(极速导入需要)
local_infile = 1                   # 允许客户端使用LOAD DATA LOCAL INFILE

# 性能优化
innodb_io_capacity = 2000          # IO容量(SSD可设更高)
innodb_read_io_threads = 8         # 读线程
innodb_write_io_threads = 8        # 写线程
```

修改配置后重启MySQL服务:
```bash
# Windows
net stop mysql
net start mysql

# Linux
systemctl restart mysql
```

## 2. 导入前的数据库优化

### 2.1 导入前禁用索引(可选,针对空表)
```sql
-- 如果是首次导入空表,可以先删除索引加速导入
ALTER TABLE sample_data DROP INDEX idx_brand;
ALTER TABLE sample_data DROP INDEX idx_category;
ALTER TABLE sample_data DROP INDEX idx_prod_attributes1;
ALTER TABLE sample_data DROP INDEX idx_prod_attributes2;
ALTER TABLE sample_data DROP INDEX idx_prod_attributes3;
ALTER TABLE sample_data DROP INDEX idx_prod_attributes4;
ALTER TABLE sample_data DROP INDEX idx_prod_attributes5;
```

### 2.2 导入后重建索引
```sql
-- 导入完成后重建索引
ALTER TABLE sample_data ADD INDEX idx_brand (brand);
ALTER TABLE sample_data ADD INDEX idx_category (category);
ALTER TABLE sample_data ADD INDEX idx_prod_attributes1 (prod_attributes1);
ALTER TABLE sample_data ADD INDEX idx_prod_attributes2 (prod_attributes2);
ALTER TABLE sample_data ADD INDEX idx_prod_attributes3 (prod_attributes3);
ALTER TABLE sample_data ADD INDEX idx_prod_attributes4 (prod_attributes4);
ALTER TABLE sample_data ADD INDEX idx_prod_attributes5 (prod_attributes5);
```

## 3. 三种导入方案对比

### 方案1: 标准导入 (当前默认方案)
- **适用**: 10万以内数据
- **速度**: 1万条/分钟
- **优点**: 稳定可靠,内存占用低
- **使用**: `import_csv_to_db(file_path)`

### 方案2: 批量导入 (已实现,推荐)
- **适用**: 100万级数据
- **速度**: 5-10万条/分钟
- **优点**: 分块读取,批量提交,内存可控
- **使用**: `import_csv_to_db(file_path, chunk_size=5000)`
- **估算时间**: 100万数据约10-20分钟

### 方案3: 极速导入 (可选)
- **适用**: 100万+超大数据
- **速度**: 50-100万条/分钟
- **优点**: 速度极快,但需要MySQL配置支持
- **使用**: `import_csv_to_db_ultra_fast(file_path)`
- **估算时间**: 100万数据约1-2分钟
- **前提**: MySQL需开启 `local_infile=1`

## 4. 文件大小估算

100万行数据文件大小估算:
- **CSV格式**: 约150-300MB (取决于字段内容长度)
- **Excel格式**: 约50-100MB (压缩格式)

建议:
- 超过50万数据使用CSV格式
- Excel文件建议小于20万行

## 5. 导入监控

导入时可通过以下SQL监控进度:
```sql
-- 查看当前表记录数
SELECT COUNT(*) FROM sample_data;

-- 查看正在执行的SQL
SHOW PROCESSLIST;

-- 查看InnoDB状态
SHOW ENGINE INNODB STATUS;
```

## 6. 使用建议

### 小于50万数据:
直接使用默认方案,无需特殊配置

### 50万-200万数据:
1. 调整MySQL配置 (max_allowed_packet, innodb_buffer_pool_size)
2. 使用批量导入方案
3. 导入时避免其他数据库操作

### 超过200万数据:
1. 考虑使用极速导入方案
2. 或分批次导入(每次100万)
3. 导入前禁用索引,导入后重建

## 7. 常见问题

### Q: 导入时内存不足
A: 减小chunk_size参数,比如改为3000或1000

### Q: 导入超时
A: 调整MySQL的wait_timeout和max_execution_time参数

### Q: LOAD DATA INFILE权限错误
A: 确保MySQL配置中local_infile=1,并重启服务
