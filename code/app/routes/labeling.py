from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from flask_login import current_user
from app.models import SampleData, db
from app.utils.decorators import login_required
from app.utils.cache import cached, clear_cache
from sqlalchemy import and_, or_
from datetime import datetime

bp = Blueprint('labeling', __name__, url_prefix='/labeling')

# 缓存辅助函数
@cached(timeout=600, user_specific=True)  # 缓存10分钟,并根据用户权限区分
def get_distinct_options_for_user(field_name):
    """
    获取字段的所有不重复选项（根据当前用户权限过滤）
    field_name: 字段名
    返回: 选项值列表
    """
    from app.models import SampleData
    
    # 根据字段名获取对应的模型字段
    field = getattr(SampleData, field_name)

    # 基础查询
    query = db.session.query(field).filter(field.isnot(None), field != '')

    # 根据用户权限过滤
    if current_user.is_authenticated:
        if current_user.brand_arr is not None:
            query = query.filter(SampleData.brand.in_(current_user.brand_arr))
        if current_user.category_arr is not None:
            query = query.filter(SampleData.category.in_(current_user.category_arr))

    # 获取不重复的值
    results = query.distinct().limit(1000).all()
    
    # 提取并排序
    options = sorted([item[0] for item in results])
    return options

@cached(timeout=600, user_specific=True)  # 缓存10分钟,并根据用户权限区分
def get_attribute_options_for_user(attr_num):
    """
    获取属性字段的所有选项（根据当前用户权限过滤）
    attr_num: 属性编号(1-5)
    返回: 排序后的选项值列表
    """
    from app.models import SampleData

    field_name = f'prod_attributes{attr_num}'
    field = getattr(SampleData, field_name)

    # 基础查询
    query = db.session.query(field).filter(field.isnot(None), field != '')

    # 根据用户权限过滤
    if current_user.is_authenticated:
        if current_user.brand_arr is not None:
            query = query.filter(SampleData.brand.in_(current_user.brand_arr))
        if current_user.category_arr is not None:
            query = query.filter(SampleData.category.in_(current_user.category_arr))

    # 获取不重复的值
    results = query.distinct().limit(1000).all()
    
    # 提取并排序
    options = sorted([item[0] for item in results])
    return options

@bp.route('/samples')
@login_required
def samples():
    """样本列表（根据权限过滤）"""
    page = request.args.get('page', 1, type=int)
    per_page = 50

    # 基础查询
    query = SampleData.query

    # 根据用户权限过滤category
    if current_user.category_arr is not None:
        query = query.filter(SampleData.category.in_(current_user.category_arr))

    # 根据用户权限过滤brand
    if current_user.brand_arr is not None:
        query = query.filter(SampleData.brand.in_(current_user.brand_arr))

    # 搜索过滤（产品描述关键词）
    keyword = request.args.get('keyword', '')
    if keyword:
        query = query.filter(
            or_(
                SampleData.product_description.like(f'%{keyword}%'),
                SampleData.id.like(f'%{keyword}%'),
                SampleData.sku.like(f'%{keyword}%'),

            )
        )

    # 筛选：eRetailer
    eretailer_filter = request.args.getlist('eretailer')
    if eretailer_filter:
        query = query.filter(SampleData.eRetailer.in_(eretailer_filter))

    # 筛选：online_store
    online_store_filter = request.args.getlist('online_store')
    if online_store_filter:
        query = query.filter(SampleData.online_store.in_(online_store_filter))

    # 筛选：brand
    brand_filter = request.args.getlist('brand')
    if brand_filter:
        query = query.filter(SampleData.brand.in_(brand_filter))

    # 筛选：note
    note_filter = request.args.getlist('note')
    if note_filter:
        query = query.filter(SampleData.note.in_(note_filter))

    # 筛选：is_competitor
    is_competitor_filter = request.args.getlist('is_competitor')
    if is_competitor_filter:
        query = query.filter(SampleData.is_competitor.in_(is_competitor_filter))

    # 筛选：latest_review_date (日期范围)
    start_date_str = request.args.get('start_date', '')
    end_date_str = request.args.get('end_date', '')
    start_date, end_date = None, None
    try:
        if start_date_str:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
            query = query.filter(SampleData.latest_review_date >= start_date)
        if end_date_str:
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
            query = query.filter(SampleData.latest_review_date <= end_date)
    except ValueError:
        flash('日期格式无效，请使用 YYYY-MM-DD 格式', 'warning')


    # 筛选：total_comments
    total_comments_filter = request.args.getlist('total_comments')
    if total_comments_filter:
        query = query.filter(SampleData.total_comments.in_(total_comments_filter))

    # 筛选：last_total_comments
    last_total_comments_filter = request.args.getlist('last_total_comments')
    if last_total_comments_filter:
        query = query.filter(SampleData.last_total_comments.in_(last_total_comments_filter))

    # 筛选：属性1-5
    attr1_filter = request.args.getlist('attr1')
    if attr1_filter:
        query = query.filter(SampleData.prod_attributes1.in_(attr1_filter))

    attr2_filter = request.args.getlist('attr2')
    if attr2_filter:
        query = query.filter(SampleData.prod_attributes2.in_(attr2_filter))

    attr3_filter = request.args.getlist('attr3')
    if attr3_filter:
        query = query.filter(SampleData.prod_attributes3.in_(attr3_filter))

    attr4_filter = request.args.getlist('attr4')
    if attr4_filter:
        query = query.filter(SampleData.prod_attributes4.in_(attr4_filter))

    attr5_filter = request.args.getlist('attr5')
    if attr5_filter:
        query = query.filter(SampleData.prod_attributes5.in_(attr5_filter))

    # 状态过滤：status
    status_filter = request.args.getlist('status')
    # 保存原始的status_filter用于模板显示（不被修改）
    status_filter_display = status_filter.copy()
    
    if status_filter:
        conditions = []
        # 如果 'Unlabeled' 在筛选条件中，需要特殊处理
        if 'Unlabeled' in status_filter:
            conditions.append(or_(SampleData.status == 'Unlabeled', SampleData.status.is_(None), SampleData.status == ''))
            status_filter.remove('Unlabeled') # 避免重复处理
        
        # 添加其他状态的筛选条件
        if status_filter:
            conditions.append(SampleData.status.in_(status_filter))
            
        # 使用 or_ 组合所有条件
        if conditions:
            query = query.filter(or_(*conditions))

    # 如果status_filter为空字符串或'all',则不添加状态筛选,显示全部

    # 分页
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    samples = pagination.items

    # 使用新的缓存函数直接获取有权限的筛选选项
    eretailer_options = get_distinct_options_for_user('eRetailer')
    online_store_options = get_distinct_options_for_user('online_store')
    brand_options = get_distinct_options_for_user('brand')
    note_options = get_distinct_options_for_user('note')
    is_competitor_options = get_distinct_options_for_user('is_competitor')
    total_comments_options = get_distinct_options_for_user('total_comments')
    last_total_comments_options = get_distinct_options_for_user('last_total_comments')

    # 属性字段选项(使用新的缓存函数)
    attr1_options = get_attribute_options_for_user(1)
    attr2_options = get_attribute_options_for_user(2)
    attr3_options = get_attribute_options_for_user(3)
    attr4_options = get_attribute_options_for_user(4)
    attr5_options = get_attribute_options_for_user(5)

    return render_template('labeling/samples.html',
                         samples=samples,
                         pagination=pagination,
                         keyword=keyword,
                         status_filter=status_filter_display,
                         eretailer_filter=eretailer_filter,
                         online_store_filter=online_store_filter,
                         brand_filter=brand_filter,
                         note_filter=note_filter,
                         is_competitor_filter=is_competitor_filter,
                         start_date=start_date_str,
                         end_date=end_date_str,
                         total_comments_filter=total_comments_filter,
                         last_total_comments_filter=last_total_comments_filter,
                         attr1_filter=attr1_filter,
                         attr2_filter=attr2_filter,
                         attr3_filter=attr3_filter,
                         attr4_filter=attr4_filter,
                         attr5_filter=attr5_filter,
                         eretailer_options=eretailer_options,
                         online_store_options=online_store_options,
                         brand_options=brand_options,
                         note_options=note_options,
                         is_competitor_options=is_competitor_options,
                         total_comments_options=total_comments_options,
                         last_total_comments_options=last_total_comments_options,
                         attr1_options=attr1_options,
                         attr2_options=attr2_options,
                         attr3_options=attr3_options,
                         attr4_options=attr4_options,
                         attr5_options=attr5_options)

@bp.route('/samples/<int:sample_id>/edit', methods=['GET', 'POST'])
@login_required
def edit_sample(sample_id):
    """编辑样本（打标）"""
    sample = SampleData.query.get_or_404(sample_id)

    # 权限检查
    if not current_user.has_permission(sample.category, sample.brand):
        flash('无权限访问该数据', 'danger')
        return redirect(url_for('labeling.samples'))

    if request.method == 'POST':
        # 更新打标字段
        sample.note = request.form.get('note', '').strip()
        sample.prod_attributes1 = request.form.get('prod_attributes1', '').strip()
        sample.prod_attributes2 = request.form.get('prod_attributes2', '').strip()
        sample.prod_attributes3 = request.form.get('prod_attributes3', '').strip()
        sample.prod_attributes4 = request.form.get('prod_attributes4', '').strip()
        sample.prod_attributes5 = request.form.get('prod_attributes5', '').strip()

        # 根据新逻辑决定状态
        attr1 = sample.prod_attributes1
        attr_others = [
            sample.prod_attributes2,
            sample.prod_attributes3,
            sample.prod_attributes4,
            sample.prod_attributes5
        ]

        if attr1 and any(attr_others):
            sample.status = 'Labeled'
        else:
            sample.status = 'Incomplete'

        db.session.commit()
        clear_cache(user_specific=True)  # 只清空当前用户相关的缓存
        flash('打标成功', 'success')

        # 跳转到下一条未打标数据
        labeled_statuses = ['Labeled', 'Historical', 'Incomplete']
        next_sample = SampleData.query.filter(
            and_(
                SampleData.id > sample_id,
                or_(
                    SampleData.status.notin_(labeled_statuses),
                    SampleData.status.is_(None)
                )
            )
        )

        # 权限过滤
        if current_user.category_arr is not None:
            next_sample = next_sample.filter(SampleData.category.in_(current_user.category_arr))
        if current_user.brand_arr is not None:
            next_sample = next_sample.filter(SampleData.brand.in_(current_user.brand_arr))

        next_sample = next_sample.first()

        if next_sample:
            return redirect(url_for('labeling.edit_sample', sample_id=next_sample.id))
        else:
            flash('已完成所有打标任务', 'info')
            return redirect(url_for('labeling.samples'))

    # 获取每个字段已有的不重复的值（用于下拉选择），应用权限过滤
    brand_tuple = tuple(current_user.brand_arr) if current_user.brand_arr else None
    category_tuple = tuple(current_user.category_arr) if current_user.category_arr else None

    # 使用缓存函数获取候选项（缓存完整数据+内存过滤）
    all_attr1 = get_all_attribute_options(1)
    all_attr2 = get_all_attribute_options(2)
    all_attr3 = get_all_attribute_options(3)
    all_attr4 = get_all_attribute_options(4)
    all_attr5 = get_all_attribute_options(5)
    
    attr1_options = filter_attribute_options(all_attr1, brand_tuple, category_tuple)
    attr2_options = filter_attribute_options(all_attr2, brand_tuple, category_tuple)
    attr3_options = filter_attribute_options(all_attr3, brand_tuple, category_tuple)
    attr4_options = filter_attribute_options(all_attr4, brand_tuple, category_tuple)
    attr5_options = filter_attribute_options(all_attr5, brand_tuple, category_tuple)

    return render_template('labeling/edit_sample.html',
                         sample=sample,
                         attr1_options=attr1_options,
                         attr2_options=attr2_options,
                         attr3_options=attr3_options,
                         attr4_options=attr4_options,
                         attr5_options=attr5_options)

@bp.route('/batch-label', methods=['GET', 'POST'])
@login_required
def batch_label():
    """批量打标"""
    # 获取选中的ID列表
    ids_str = request.args.get('ids', '')
    if request.method == 'POST':
        ids_str = request.form.get('ids', '')

    if not ids_str:
        flash('未选择任何记录', 'warning')
        return redirect(url_for('labeling.samples'))

    # 解析ID列表
    try:
        ids = [int(id_str.strip()) for id_str in ids_str.split(',') if id_str.strip()]
    except ValueError:
        flash('无效的ID列表', 'danger')
        return redirect(url_for('labeling.samples'))

    # 查询样本
    samples = SampleData.query.filter(SampleData.id.in_(ids)).all()

    # 权限检查
    for sample in samples:
        if not current_user.has_permission(sample.category, sample.brand):
            flash(f'无权限访问样本 ID {sample.id}', 'danger')
            return redirect(url_for('labeling.samples'))

    if request.method == 'POST':
        # 批量更新打标字段
        prod_attributes1 = request.form.get('prod_attributes1', '').strip()
        prod_attributes2 = request.form.get('prod_attributes2', '').strip()
        prod_attributes3 = request.form.get('prod_attributes3', '').strip()
        prod_attributes4 = request.form.get('prod_attributes4', '').strip()
        prod_attributes5 = request.form.get('prod_attributes5', '').strip()

        # 更新所有选中的样本
        for sample in samples:
            if prod_attributes1:
                sample.prod_attributes1 = prod_attributes1
            if prod_attributes2:
                sample.prod_attributes2 = prod_attributes2
            if prod_attributes3:
                sample.prod_attributes3 = prod_attributes3
            if prod_attributes4:
                sample.prod_attributes4 = prod_attributes4
            if prod_attributes5:
                sample.prod_attributes5 = prod_attributes5

            # 根据新逻辑决定状态
            attr1 = sample.prod_attributes1
            attr_others = [
                sample.prod_attributes2,
                sample.prod_attributes3,
                sample.prod_attributes4,
                sample.prod_attributes5
            ]

            if attr1 and any(attr_others):
                sample.status = 'Labeled'
            else:
                sample.status = 'Incomplete'

        db.session.commit()
        clear_cache()  # 清空缓存,使新打标值立即可用
        flash(f'成功批量打标 {len(samples)} 条记录', 'success')
        return redirect(url_for('labeling.samples'))

    # GET请求:显示批量打标表单
    # 使用新的缓存函数直接获取有权限的打标选项
    attr1_options = get_attribute_options_for_user(1)
    attr2_options = get_attribute_options_for_user(2)
    attr3_options = get_attribute_options_for_user(3)
    attr4_options = get_attribute_options_for_user(4)
    attr5_options = get_attribute_options_for_user(5)

    return render_template('labeling/batch_label.html',
                         samples=samples,
                         ids_str=ids_str,
                         attr1_options=attr1_options,
                         attr2_options=attr2_options,
                         attr3_options=attr3_options,
                         attr4_options=attr4_options,
                         attr5_options=attr5_options)

@bp.route('/batch-save', methods=['POST'])
@login_required
def batch_save():
    """批量保存当前页的编辑
    
    新逻辑：
    1. 修改了数据 → 状态变为 Labeled（无论之前是什么状态）
    2. Prelabeled + 没修改 + 点击了"接受" → Labeled
    3. Prelabeled + 没修改 + 没点击"接受" → 保持 Prelabeled（不处理）
    4. Historical + 没修改 → 保持 Historical（不处理）
    5. Historical + 修改了 → Labeled
    6.（最新修改）满足标注条件（属性1不为空，2-5有一个不为空）→ Labeled，否则 Incomplete
    """
    try:
        # 获取所有sample_ids
        sample_ids = request.form.getlist('sample_ids[]')
        if not sample_ids:
            flash('没有要保存的数据', 'warning')
            return redirect(url_for('labeling.samples'))

        manual_update_count = 0
        prelabel_accept_count = 0

        for sample_id in sample_ids:
            sample = SampleData.query.get(int(sample_id))
            if not sample:
                continue

            # 权限检查
            if not current_user.has_permission(sample.category, sample.brand):
                continue

            # 获取新值
            attr1 = request.form.get(f'attr1_{sample_id}', '').strip()
            attr2 = request.form.get(f'attr2_{sample_id}', '').strip()
            attr3 = request.form.get(f'attr3_{sample_id}', '').strip()
            attr4 = request.form.get(f'attr4_{sample_id}', '').strip()
            attr5 = request.form.get(f'attr5_{sample_id}', '').strip()
            
            # 获取原始值（从隐藏字段）
            orig_attr1 = request.form.get(f'orig_attr1_{sample_id}', '').strip()
            orig_attr2 = request.form.get(f'orig_attr2_{sample_id}', '').strip()
            orig_attr3 = request.form.get(f'orig_attr3_{sample_id}', '').strip()
            orig_attr4 = request.form.get(f'orig_attr4_{sample_id}', '').strip()
            orig_attr5 = request.form.get(f'orig_attr5_{sample_id}', '').strip()
            orig_status = request.form.get(f'status_{sample_id}', '').strip()
            
            # 获取Prelabeled的接受状态
            accepted = request.form.get(f'accept_{sample_id}') == '1'

            # 检查是否有手动修改（与原始值比较）
            changed = (
                attr1 != orig_attr1 or
                attr2 != orig_attr2 or
                attr3 != orig_attr3 or
                attr4 != orig_attr4 or
                attr5 != orig_attr5
            )

            is_prelabeled = orig_status == "Prelabeled"
            is_historical = orig_status == 'Historical'

            # 根据新逻辑处理
            if changed:
                # 情况1/5: 有修改，无论之前状态如何
                sample.prod_attributes1 = attr1
                sample.prod_attributes2 = attr2
                sample.prod_attributes3 = attr3
                sample.prod_attributes4 = attr4
                sample.prod_attributes5 = attr5
                
                # 根据新逻辑决定状态
                if attr1 and any([attr2, attr3, attr4, attr5]):
                    sample.status = 'Labeled'
                else:
                    sample.status = 'Incomplete'
                manual_update_count += 1
            elif is_prelabeled and accepted:
                # 情况2: Prelabeled + 没修改 + 点击了接受
                # 检查是否满足Labeled条件
                if sample.prod_attributes1 and any([sample.prod_attributes2, sample.prod_attributes3, sample.prod_attributes4, sample.prod_attributes5]):
                    sample.status = 'Labeled'
                else:
                    sample.status = 'Incomplete'
                prelabel_accept_count += 1
            # 情况3: Prelabeled + 没修改 + 没点击接受 → 不处理，保持Prelabeled
            # 情况4: Historical + 没修改 → 不处理，保持Historical

        db.session.commit()

        # 构建详细的flash消息
        flash_messages = []
        if manual_update_count > 0:
            flash_messages.append(f'成功保存 {manual_update_count} 条手动修改')
        if prelabel_accept_count > 0:
            flash_messages.append(f'成功接受 {prelabel_accept_count} 条Prelabeled数据')

        if flash_messages:
            clear_cache()
            flash('；'.join(flash_messages), 'success')
        else:
            flash('没有检测到任何修改或需要确认的数据', 'info')

    except Exception as e:
        db.session.rollback()
        flash(f'保存失败: {str(e)}', 'danger')

    # 获取当前页码和所有筛选条件
    current_page = int(request.form.get('current_page', 1))
    keyword = request.form.get('keyword', '')
    
    # 获取所有筛选条件（多值字段使用getlist）
    status_filter = request.form.getlist('status')
    eretailer_filter = request.form.getlist('eretailer')
    online_store_filter = request.form.getlist('online_store')
    brand_filter = request.form.getlist('brand')
    note_filter = request.form.getlist('note')
    is_competitor_filter = request.form.getlist('is_competitor')
    start_date = request.form.get('start_date', '')
    end_date = request.form.get('end_date', '')
    total_comments_filter = request.form.getlist('total_comments')
    last_total_comments_filter = request.form.getlist('last_total_comments')
    attr1_filter = request.form.getlist('attr1')
    attr2_filter = request.form.getlist('attr2')
    attr3_filter = request.form.getlist('attr3')
    attr4_filter = request.form.getlist('attr4')
    attr5_filter = request.form.getlist('attr5')

    # 保存后保持当前筛选条件，跳转到当前页（因为打标后数据会自动移除，下一批数据会补上）
    return redirect(url_for('labeling.samples',
                           page=current_page,
                           keyword=keyword,
                           status=status_filter,
                           eretailer=eretailer_filter,
                           online_store=online_store_filter,
                           brand=brand_filter,
                           note=note_filter,
                           is_competitor=is_competitor_filter,
                           start_date=start_date,
                           end_date=end_date,
                           total_comments=total_comments_filter,
                           last_total_comments=last_total_comments_filter,
                           attr1=attr1_filter,
                           attr2=attr2_filter,
                           attr3=attr3_filter,
                           attr4=attr4_filter,
                           attr5=attr5_filter))

@bp.route('/stats')
@login_required
def stats():
    """数据统计页面"""
    # 基础查询,应用权限
    base_query = SampleData.query
    if current_user.category_arr is not None:
        base_query = base_query.filter(SampleData.category.in_(current_user.category_arr))
    if current_user.brand_arr is not None:
        base_query = base_query.filter(SampleData.brand.in_(current_user.brand_arr))

    # 总体统计
    total_count = base_query.count()
    unlabeled_count = base_query.filter(or_(SampleData.status == 'Unlabeled', SampleData.status.is_(None), SampleData.status == '')).count()
    labeled_count = base_query.filter_by(status='Labeled').count()
    prelabeled_count = base_query.filter_by(status='Prelabeled').count()
    historical_count = base_query.filter_by(status='Historical').count()
    incomplete_count = base_query.filter_by(status='Incomplete').count()

    # 按category统计
    category_stats = {}
    
    # 先获取所有有权限的category
    categories_query = base_query.with_entities(SampleData.category).distinct()
    categories = [c[0] for c in categories_query.all()]

    for category in categories:
        if not category: continue

        cat_query = base_query.filter(SampleData.category == category)
        
        total = cat_query.count()
        unlabeled = cat_query.filter(or_(SampleData.status == 'Unlabeled', SampleData.status.is_(None), SampleData.status == '')).count()
        labeled = cat_query.filter_by(status='Labeled').count()
        prelabeled = cat_query.filter_by(status='Prelabeled').count()
        historical = cat_query.filter_by(status='Historical').count()
        incomplete = cat_query.filter_by(status='Incomplete').count()
        
        # 计算进度
        completed = labeled + historical + incomplete
        progress = round((completed / total) * 100, 2) if total > 0 else 0

        category_stats[category] = {
            'total': total,
            'unlabeled': unlabeled,
            'labeled': labeled,
            'prelabeled': prelabeled,
            'historical': historical,
            'incomplete': incomplete,
            'progress': progress
        }

    return render_template('labeling/stats.html',
                           total_count=total_count,
                           unlabeled_count=unlabeled_count,
                           labeled_count=labeled_count,
                           prelabeled_count=prelabeled_count,
                           historical_count=historical_count,
                           incomplete_count=incomplete_count,
                           category_stats=category_stats)
