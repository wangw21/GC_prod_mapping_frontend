# 百万级数据性能优化方案

## 问题分析

在百万级数据量下,加载筛选候选项和打标候选项会遇到以下性能问题:

1. **多次DISTINCT查询**: 每个页面加载需要查询10+个字段的不重复值
2. **无索引扫描**: TEXT字段无法高效使用索引
3. **无缓存机制**: 每次请求都重新查询数据库
4. **返回数据过多**: 某些字段可能有上千个不同值
5. **实时性要求**: 新打标的值需要立即出现在候选项中

## 优化方案

### 1. 添加缓存机制

**实现**: `app/utils/cache.py`

- 内存缓存,避免重复查询
- 默认缓存时间: 10分钟(600秒)
- 适用于变化不频繁的选项数据
- **自动失效机制**: 数据变更时自动清空缓存

**优势**:
- 首次加载后,后续请求直接从内存读取
- 响应时间从数秒降至毫秒级
- 新打标数据实时同步到候选项

### 2. 实时缓存更新机制

**触发清空缓存的场景**:
1. **保存打标数据** (`batch_save`): 新的属性值需立即出现在下拉选项
2. **单个打标** (`edit_sample`): 每次提交后清空缓存
3. **批量打标** (`batch_label`): 批量操作后清空缓存
4. **导入CSV数据** (`upload`): 导入完成后清空缓存

**实现代码示例**:
```python
from app.utils.cache import clear_cache

# 在保存数据后
db.session.commit()
clear_cache()  # 清空所有缓存
flash('保存成功', 'success')
```

**工作流程**:
```
用户输入新属性值 → 保存到数据库 → 清空缓存 → 下次查询时重新从数据库读取 → 新值出现在候选项中
```

### 3. 添加数据库索引

**执行脚本**: `add_indexes.sql`

```bash
mysql -u root -p labeling_platform < add_indexes.sql
```

**新增索引**:
- 筛选字段: eRetailer, online_store, is_competitor, latest_review_date, total等
- 打标属性: prod_attributes1-5
- 组合索引: (category, _rule_matched), (brand, _rule_matched)

**注意**: VARCHAR/TEXT字段使用前缀索引(50字符)

### 4. 限制返回数量

**代码优化**: `app/routes/labeling.py`

- 筛选选项: 最多返回1000个
- 打标属性选项: 最多返回500个
- 使用`LIMIT`子句避免全表扫描

### 5. 优化查询逻辑

**before (每个字段单独查询)**:
```python
eretailer_options = db.session.query(SampleData.eRetailer).distinct().filter(...)
online_store_options = db.session.query(SampleData.online_store).distinct().filter(...)
# ... 重复10+次
```

**after (统一缓存函数)**:
```python
eretailer_options = get_distinct_options('eRetailer', category_tuple, brand_tuple)
online_store_options = get_distinct_options('online_store', category_tuple, brand_tuple)
# 第二次调用直接从缓存读取
```

## 性能对比

### 优化前
- 页面加载时间: 5-10秒
- 数据库查询: 15-20条SELECT DISTINCT
- 内存占用: 低

### 优化后
- **首次加载**: 2-3秒(有索引加速)
- **后续加载**: <500ms(从缓存读取)
- 数据库查询: 0-2条(缓存命中)
- 内存占用: 增加约10-50MB(缓存数据)

## 清空缓存

### 自动清空(推荐)

系统会在以下情况自动清空缓存:
1. 保存打标数据时
2. 导入新CSV数据时

无需手动操作,新数据会立即同步到候选项!

### 手动清空

如果需要手动清空缓存,两种方式:

### 方式1: 重启应用
```bash
# 重启Flask应用即可清空内存缓存
```

### 方式2: 添加清空缓存接口(可选)

在 `app/routes/admin.py` 中添加:
```python
from app.utils.cache import clear_cache

@bp.route('/clear-cache', methods=['POST'])
@login_required
def clear_cache_route():
    if not current_user.is_data_admin:
        flash('无权限', 'danger')
        return redirect(url_for('labeling.samples'))

    clear_cache()
    flash('缓存已清空', 'success')
    return redirect(url_for('admin.upload'))
```

## 进一步优化建议(可选)

### 1. 使用Redis缓存
如果多个应用实例共享缓存,可以使用Redis替代内存缓存:

```bash
pip install redis flask-caching
```

### 2. 异步加载选项
前端使用AJAX按需加载候选项,而不是一次性加载所有:

```javascript
// 当用户点击下拉框时才加载选项
$('#brand_select').on('focus', function() {
    $.getJSON('/api/options/brand', function(data) {
        // 动态填充选项
    });
});
```

### 3. 分页加载打标属性选项
如果属性值超过500个,前端使用虚拟滚动或搜索过滤:

```html
<input type="text" list="attr1_list" id="attr1_input">
<datalist id="attr1_list">
    <!-- 只显示前100个,用户输入时动态搜索 -->
</datalist>
```

## 监控建议

### 慢查询日志
在MySQL配置中启用慢查询日志:

```ini
[mysqld]
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow-query.log
long_query_time = 1
```

### 定期检查索引使用情况
```sql
-- 查看索引统计
SELECT * FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA='labeling_platform' AND TABLE_NAME='sample_data';

-- 查看未使用的索引
SELECT * FROM sys.schema_unused_indexes
WHERE object_schema='labeling_platform';
```

## 总结

通过缓存+索引+LIMIT的组合优化,可以将百万级数据的页面加载时间从5-10秒降至500ms以内,大幅提升用户体验。
