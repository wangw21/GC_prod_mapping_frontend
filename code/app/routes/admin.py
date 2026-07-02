from flask import Blueprint, render_template, request, redirect, url_for, flash, send_file, jsonify
from app.models import User, SampleData, db
from app.utils.decorators import admin_required
from app.utils.csv_handler import allowed_file, import_csv_to_db, export_samples_to_csv, get_unique_categories, get_unique_brands
from app.utils.progress_tracker import progress_tracker
from app.utils.cache import clear_cache
from app.utils.audit import log_action
import os
import uuid
from datetime import datetime
from datetime import timedelta
import re
from werkzeug.utils import secure_filename
from threading import Thread
from sqlalchemy import text

bp = Blueprint('admin', __name__, url_prefix='/admin')


def _extract_group_token(detail):
    """从 detail 中提取批次 token（格式: [grp:xxxx]）。"""
    if not detail:
        return None
    m = re.search(r'\[grp:([0-9a-fA-F\-]{8,64})\]', detail)
    return m.group(1) if m else None


def _find_samples_by_business_key(log):
    """按业务身份四列定位当前样本（支持多条重复匹配）。"""
    from app.utils.audit import normalize_key

    pd_v = normalize_key(log.product_description)
    sku_v = normalize_key(log.sku)
    url_v = normalize_key(log.url)
    skuurl_v = normalize_key(log.sku_url)
    return SampleData.query.filter(
        db.func.trim(db.func.coalesce(SampleData.product_description, '')) == pd_v,
        db.func.trim(db.func.coalesce(SampleData.sku, '')) == sku_v,
        db.func.trim(db.func.coalesce(SampleData.url, '')) == url_v,
        db.func.trim(db.func.coalesce(SampleData.sku_url, '')) == skuurl_v,
    ).all()


def _apply_log_change(log, use_old_values):
    """对单条审计日志应用变更。

    use_old_values=True: 回滚到 old；False: 撤销回滚，恢复到 new。
    返回: (ok, msg, matched_ids)
    """
    if log.entity_type != 'sample' or not log.changes:
        return False, '该日志不包含可应用的样本变更', []

    matches = _find_samples_by_business_key(log)
    if not matches:
        return False, '当前数据表中未找到该条业务数据（可能已被本月数据替换）', []

    key_name = 'old' if use_old_values else 'new'
    for sample in matches:
        for field, change in log.changes.items():
            if hasattr(sample, field):
                setattr(sample, field, change.get(key_name))

    return True, '', [s.id for s in matches]


def _find_batch_logs(seed_log):
    """定位与 seed_log 同一次批量提交产生的日志集合。"""
    from app.models import AuditLog

    if seed_log.action not in ('batch_label', 'batch_save'):
        return []

    q = AuditLog.query.filter(
        AuditLog.entity_type == 'sample',
        AuditLog.changes.isnot(None),
        AuditLog.action == seed_log.action,
        AuditLog.user_id == seed_log.user_id,
    )

    group_token = _extract_group_token(seed_log.detail)
    if group_token:
        marker = f'[grp:{group_token}]'
        logs = q.filter(AuditLog.detail.like(f'%{marker}%')).order_by(AuditLog.id.asc()).all()
        return logs

    # 兼容旧日志：无 token 时按 5 秒时间窗近似同批次
    if seed_log.created_at:
        t1 = seed_log.created_at - timedelta(seconds=5)
        t2 = seed_log.created_at + timedelta(seconds=5)
        q = q.filter(AuditLog.created_at >= t1, AuditLog.created_at <= t2)

    return q.order_by(AuditLog.id.asc()).all()


def _find_reverted_batch_scope(seed_log):
    """定位该日志所属批次中当前已回滚的日志。

    规则：同批次(按 grp token 或时间窗近似)且 log.reverted=True。
    用于“撤销回滚”自动判断是否应按整批撤销。
    """
    logs = _find_batch_logs(seed_log)
    return [l for l in logs if l.reverted and l.entity_type == 'sample' and l.changes]

@bp.route('/upload', methods=['GET', 'POST'])
@admin_required
def upload():
    """上传CSV文件"""
    if request.method == 'POST':
        if 'file' not in request.files:
            flash('没有选择文件', 'danger')
            return redirect(request.url)

        file = request.files['file']
        if file.filename == '':
            flash('没有选择文件', 'danger')
            return redirect(request.url)

        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"{timestamp}_{filename}"

            # 确保上传目录存在
            upload_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'uploads')
            os.makedirs(upload_folder, exist_ok=True)

            filepath = os.path.join(upload_folder, filename)
            file.save(filepath)

            # 直接同步导入(简单可靠)
            success, message = import_csv_to_db(filepath)
            if success:
                # 导入成功后清空缓存,使新导入的数据在筛选和打标候选项中立即可见
                clear_cache()
                log_action('upload', 'data', detail=f'上传导入文件 {filename}: {message}')
                db.session.commit()
                flash(message, 'success')
            else:
                flash(message, 'danger')

            return redirect(url_for('admin.upload'))
        else:
            flash('只支持CSV和XLSX文件', 'danger')
            return redirect(request.url)

    # GET请求,显示上传页面
    return render_template('admin/upload.html')

@bp.route('/upload/progress/<task_id>')
@admin_required
def upload_progress(task_id):
    """获取导入进度(AJAX接口)"""
    progress = progress_tracker.get_progress(task_id)
    if progress:
        return jsonify(progress)
    else:
        return jsonify({'status': 'not_found', 'message': '任务不存在'}), 404

@bp.route('/users', methods=['GET'])
@admin_required
def users():
    """用户管理列表"""
    users = User.query.all()
    return render_template('admin/users.html', users=users)

@bp.route('/users/create', methods=['GET', 'POST'])
@admin_required
def create_user():
    """创建用户"""
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        real_name = request.form.get('real_name')
        role = request.form.get('role')
        category_arr = request.form.getlist('category_arr')
        brand_arr = request.form.getlist('brand_arr')

        # 验证用户名唯一性
        if User.query.filter_by(username=username).first():
            flash('用户名已存在', 'danger')
            return redirect(url_for('admin.create_user'))

        # 创建用户
        user = User(
            username=username,
            real_name=real_name,
            role=role,
            category_arr=category_arr if category_arr else None,
            brand_arr=brand_arr if brand_arr else None
        )
        user.set_password(password)

        db.session.add(user)
        db.session.commit()

        log_action('user_create', 'user', user.id, detail=f'创建用户 {username}（角色 {role}）')
        db.session.commit()
        flash(f'用户 {username} 创建成功', 'success')
        return redirect(url_for('admin.users'))

    # 获取所有category和brand供选择
    categories = get_unique_categories()
    brands = get_unique_brands()

    return render_template('admin/create_user.html', categories=categories, brands=brands)

@bp.route('/users/<int:user_id>/edit', methods=['GET', 'POST'])
@admin_required
def edit_user(user_id):
    """编辑用户"""
    user = User.query.get_or_404(user_id)

    if request.method == 'POST':
        user.real_name = request.form.get('real_name')
        user.role = request.form.get('role')
        category_arr = request.form.getlist('category_arr')
        brand_arr = request.form.getlist('brand_arr')

        user.category_arr = category_arr if category_arr else None
        user.brand_arr = brand_arr if brand_arr else None

        # 如果提供了新密码则更新
        new_password = request.form.get('password')
        if new_password:
            user.set_password(new_password)

        db.session.commit()
        log_action('user_edit', 'user', user.id, detail=f'编辑用户 {user.username}')
        db.session.commit()
        flash(f'用户 {user.username} 更新成功', 'success')
        return redirect(url_for('admin.users'))

    categories = get_unique_categories()
    brands = get_unique_brands()

    return render_template('admin/edit_user.html', user=user, categories=categories, brands=brands)

@bp.route('/users/<int:user_id>/toggle', methods=['POST'])
@admin_required
def toggle_user(user_id):
    """启用/禁用用户"""
    user = User.query.get_or_404(user_id)
    user.is_active = not user.is_active
    db.session.commit()

    status = '启用' if user.is_active else '禁用'
    log_action('user_toggle', 'user', user.id, detail=f'{status}用户 {user.username}')
    db.session.commit()
    flash(f'用户 {user.username} 已{status}', 'success')
    return redirect(url_for('admin.users'))

@bp.route('/brands_for_category')
@admin_required
def brands_for_category():
    category = request.args.get('category', '')
    if not category:
        return jsonify([])
    
    brands = db.session.query(SampleData.brand).filter(SampleData.category == category).distinct().all()
    brand_names = [brand[0] for brand in brands if brand[0]]
    return jsonify(sorted(brand_names))

@bp.route('/download', methods=['GET', 'POST'])
@admin_required
def download():
    """下载数据"""
    if request.method == 'POST':
        download_type = request.form.get('type', 'all')

        # 根据类型获取数据
        if download_type == 'labeled':
            # 将 HISTORICAL 一并视为已打标
            samples = SampleData.query.filter(SampleData.status.in_(['Labeled', 'Historical'])).all()
        else:
            samples = SampleData.query.all()

        if not samples:
            flash('没有数据可导出', 'warning')
            return redirect(url_for('admin.download'))

        # 生成文件
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"export_{download_type}_{timestamp}.csv"
        output_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'exports')
        os.makedirs(output_folder, exist_ok=True)

        output_path = os.path.join(output_folder, filename)
        success, message = export_samples_to_csv(samples, output_path)

        if success:
            return send_file(output_path, as_attachment=True, download_name=filename)
        else:
            flash(message, 'danger')
            return redirect(url_for('admin.download'))

    # 统计信息
    total_count = SampleData.query.count()
    # 已打标包含 LABELED 与 HISTORICAL
    labeled_count = SampleData.query.filter(SampleData.status.in_(['LABELED', 'HISTORICAL'])).count()
    unlabeled_count = total_count - labeled_count

    return render_template('admin/download.html',
                         total_count=total_count,
                         labeled_count=labeled_count,
                         unlabeled_count=unlabeled_count)

@bp.route('/clear_data', methods=['POST'])
@admin_required
def clear_data():
    """
    清除 sample_data 表中的所有数据。
    """
    try:
        # 使用 TRUNCATE 命令高效地清空表
        db.session.execute(text('TRUNCATE TABLE sample_data'))
        db.session.commit()
        num_deleted = SampleData.query.count()  # 获取删除的样本数量
        clear_cache() # 清空所有缓存
        log_action('clear_data', 'data', detail=f'清除全部样本数据，共 {num_deleted} 条')
        db.session.commit()
        flash(f'成功删除 {num_deleted} 条样本数据', 'success')

    except Exception as e:
        db.session.rollback()
        flash(f'清除数据失败: {str(e)}', 'danger')

    return redirect(url_for('admin.download'))

@bp.route('/dashboard', methods=['GET'])
@admin_required
def dashboard():
    """仪表盘"""
    # 总样本数
    total_samples = SampleData.query.count()

    # 状态统计 (包含 Incomplete)
    status_counts = db.session.query(
        SampleData.status, 
        db.func.count(SampleData.id)
    ).group_by(SampleData.status).all()
    
    status_data = {
        'Labeled': 0,
        'Historical': 0,
        'Incomplete': 0,
        'Unlabeled': 0
    }
    for status, count in status_counts:
        if status in status_data:
            status_data[status] = count
        elif status is None or status == '':
            status_data['Unlabeled'] += count

    return render_template('admin/dashboard.html', 
                           total_samples=total_samples, 
                           status_data=status_data)


@bp.route('/logs', methods=['GET'])
@admin_required
def logs():
    """操作日志：溯源查询，可按用户/操作/实体筛选，支持导出与回滚。"""
    from app.models import AuditLog

    page = request.args.get('page', 1, type=int)
    action_filter = request.args.get('action', '')
    user_filter = request.args.get('username', '')
    entity_filter = request.args.get('entity_id', '')
    pd_filter = request.args.get('product_description', '')
    sku_filter = request.args.get('sku', '')
    url_filter = request.args.get('url', '')
    skuurl_filter = request.args.get('sku_url', '')

    query = AuditLog.query
    if action_filter:
        query = query.filter(AuditLog.action == action_filter)
    if user_filter:
        query = query.filter(AuditLog.username.like(f'%{user_filter}%'))
    if entity_filter:
        try:
            query = query.filter(AuditLog.entity_id == int(entity_filter))
        except ValueError:
            pass
    if pd_filter:
        query = query.filter(AuditLog.product_description.like(f'%{pd_filter}%'))
    if sku_filter:
        query = query.filter(AuditLog.sku.like(f'%{sku_filter}%'))
    if url_filter:
        query = query.filter(AuditLog.url.like(f'%{url_filter}%'))
    if skuurl_filter:
        query = query.filter(AuditLog.sku_url.like(f'%{skuurl_filter}%'))

    pagination = query.order_by(AuditLog.created_at.desc()).paginate(page=page, per_page=50, error_out=False)
    total_logs_count = AuditLog.query.count()
    actions = [a[0] for a in db.session.query(AuditLog.action).distinct().all() if a[0]]
    return render_template('admin/logs.html',
                           logs=pagination.items,
                           pagination=pagination,
                           total_logs_count=total_logs_count,
                           actions=actions,
                           action_filter=action_filter,
                           user_filter=user_filter,
                           entity_filter=entity_filter,
                           pd_filter=pd_filter,
                           sku_filter=sku_filter,
                           url_filter=url_filter,
                           skuurl_filter=skuurl_filter)


@bp.route('/logs/export', methods=['GET'])
@admin_required
def logs_export():
    """导出操作日志为 CSV 文档，用于归档/汇报。"""
    from app.models import AuditLog

    rows = AuditLog.query.order_by(AuditLog.created_at.desc()).all()
    return _build_logs_csv_response(rows)


def _build_logs_csv_response(rows):
    """将日志列表构造为 CSV 下载响应（含 BOM，Excel 中文正常）。"""
    import csv
    from io import StringIO
    from flask import Response

    buf = StringIO()
    buf.write('\ufeff')  # BOM，便于 Excel 正确识别中文
    writer = csv.writer(buf)
    writer.writerow(['Time', 'User', 'Action', 'Entity', 'Entity ID',
                     'product_description', 'sku', 'url', 'sku_url',
                     'Detail', 'Changes', 'IP', 'Reverted'])
    for r in rows:
        writer.writerow([
            r.created_at.strftime('%Y-%m-%d %H:%M:%S') if r.created_at else '',
            r.username or '', r.action or '', r.entity_type or '',
            r.entity_id if r.entity_id is not None else '',
            r.product_description or '', r.sku or '', r.url or '', r.sku_url or '',
            r.detail or '', str(r.changes or ''), r.ip or '',
            'Yes' if r.reverted else 'No',
        ])
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    return Response(buf.getvalue(), mimetype='text/csv',
                    headers={'Content-Disposition': f'attachment; filename=audit_logs_{ts}.csv'})


@bp.route('/logs/clear', methods=['POST'])
@admin_required
def logs_clear():
    """清除某时间点之前的操作日志：先自动下载被清除的日志备份，再删除。

    安全设计：删除前把将被删的记录导出为 CSV 一并返回下载，避免误删无备份。
    """
    from app.models import AuditLog

    before_str = request.form.get('before', '').strip()
    query = AuditLog.query
    label = '全部'
    if before_str:
        try:
            before_dt = datetime.strptime(before_str, '%Y-%m-%d')
            query = query.filter(AuditLog.created_at < before_dt)
            label = f'{before_str} 之前'
        except ValueError:
            flash('日期格式无效，请使用 YYYY-MM-DD', 'danger')
            return redirect(url_for('admin.logs'))

    rows = query.order_by(AuditLog.created_at.desc()).all()
    if not rows:
        flash(f'没有可清除的日志（{label}）', 'info')
        return redirect(url_for('admin.logs'))

    # 先构造备份下载（在删除前捕获数据）
    response = _build_logs_csv_response(rows)

    # 再删除
    try:
        ids = [r.id for r in rows]
        AuditLog.query.filter(AuditLog.id.in_(ids)).delete(synchronize_session=False)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        flash(f'清除日志失败: {str(e)}', 'danger')
        return redirect(url_for('admin.logs'))

    # 返回备份文件下载（浏览器会自动下载被清除的日志备份）
    return response


@bp.route('/logs/<int:log_id>/revert', methods=['POST'])
@admin_required
def logs_revert(log_id):
    """一键找回：按业务身份四列匹配"当前数据"，将其恢复到修改前旧值。

    数据每月清空重传后自增 id 会变，故不按 id 回滚，而按
    product_description/sku/url/sku_url 四列（归一化后）定位当前月的同一条数据。
    若匹配到多条完全相同的数据，则提示并全部恢复。
    """
    from app.models import AuditLog

    log = AuditLog.query.get_or_404(log_id)
    if log.entity_type != 'sample' or not log.changes or log.reverted:
        flash('该日志不可回滚或已回滚', 'warning')
        return redirect(url_for('admin.logs'))

    ok, msg, matched_ids = _apply_log_change(log, use_old_values=True)
    if not ok:
        flash(f'{msg}，无法自动回滚；请查阅归档日志。', 'danger')
        return redirect(url_for('admin.logs'))

    log.reverted = True
    ids_str = ', '.join(str(i) for i in matched_ids)
    log_action('revert', 'sample', matched_ids[0],
               detail=f'回滚日志 #{log.id}，匹配 {len(matched_ids)} 条（当前 ID: {ids_str}）',
               sample=_find_samples_by_business_key(log)[0])
    db.session.commit()
    clear_cache()

    if len(matched_ids) > 1:
        flash(f'检测到 {len(matched_ids)} 条相同业务数据，已全部回滚至修改前状态（ID: {ids_str}）', 'warning')
    else:
        flash(f'已回滚业务数据至修改前状态（当前 ID: {ids_str}）', 'success')
    return redirect(url_for('admin.logs'))


@bp.route('/logs/<int:log_id>/revert-batch', methods=['POST'])
@admin_required
def logs_revert_batch(log_id):
    """按批次一键回滚：对同一次批量提交产生的日志全部回滚。"""
    from app.models import AuditLog

    seed = AuditLog.query.get_or_404(log_id)
    if seed.action not in ('batch_label', 'batch_save'):
        flash('该日志不属于批量操作，无法批量回滚', 'warning')
        return redirect(url_for('admin.logs'))

    target_logs = [l for l in _find_batch_logs(seed) if not l.reverted]
    if not target_logs:
        flash('未找到可回滚的批量日志（可能已回滚）', 'info')
        return redirect(url_for('admin.logs'))

    affected_ids = set()
    reverted_count = 0
    for log in target_logs:
        ok, _, ids = _apply_log_change(log, use_old_values=True)
        if ok:
            log.reverted = True
            reverted_count += 1
            for sid in ids:
                affected_ids.add(sid)

    if reverted_count == 0:
        flash('当前数据表中未找到该条业务数据（可能已被本月数据替换），无法自动回滚；请查阅归档日志。', 'danger')
        return redirect(url_for('admin.logs'))

    sample_for_log = SampleData.query.get(min(affected_ids)) if affected_ids else None
    detail = f'批量回滚: seed_log #{seed.id}, 日志 {reverted_count} 条, 样本 {len(affected_ids)} 条, grp={_extract_group_token(seed.detail) or "legacy-window"}'
    log_action('batch_revert', 'sample', min(affected_ids) if affected_ids else None,
               detail=detail, sample=sample_for_log)
    db.session.commit()
    clear_cache()

    flash(f'批量回滚完成（整批）：回滚日志 {reverted_count} 条，影响样本 {len(affected_ids)} 条', 'success')
    return redirect(url_for('admin.logs'))


@bp.route('/logs/revert-user', methods=['POST'])
@admin_required
def logs_revert_user_before():
    """按用户回滚到指定时间之前：撤销该用户在时间点之后(含)的操作。"""
    from app.models import AuditLog

    username = request.form.get('username', '').strip()
    before_str = request.form.get('before', '').strip()
    if not username or not before_str:
        flash('请填写用户名和时间点', 'warning')
        return redirect(url_for('admin.logs'))

    try:
        # datetime-local: YYYY-MM-DDTHH:MM
        cutoff = datetime.strptime(before_str, '%Y-%m-%dT%H:%M')
    except ValueError:
        flash('时间格式无效，请使用页面选择器', 'danger')
        return redirect(url_for('admin.logs'))

    target_logs = AuditLog.query.filter(
        AuditLog.username == username,
        AuditLog.entity_type == 'sample',
        AuditLog.changes.isnot(None),
        AuditLog.reverted.is_(False),
        AuditLog.created_at >= cutoff,
        AuditLog.action.notin_(['revert', 'batch_revert', 'time_revert', 'undo_revert']),
    ).order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).all()

    if not target_logs:
        flash(f'未找到用户 {username} 在该时间点之后可回滚的日志', 'info')
        return redirect(url_for('admin.logs'))

    affected_ids = set()
    reverted_count = 0
    for log in target_logs:
        ok, _, ids = _apply_log_change(log, use_old_values=True)
        if ok:
            log.reverted = True
            reverted_count += 1
            for sid in ids:
                affected_ids.add(sid)

    if reverted_count == 0:
        flash(f'用户 {username} 的目标日志均无法匹配当前数据，未执行回滚', 'warning')
        return redirect(url_for('admin.logs'))

    sample_for_log = SampleData.query.get(min(affected_ids)) if affected_ids else None
    detail = f'按用户时间点回滚: user={username}, cutoff={before_str}, 日志 {reverted_count} 条, 样本 {len(affected_ids)} 条'
    log_action('time_revert', 'sample', min(affected_ids) if affected_ids else None,
               detail=detail, sample=sample_for_log)
    db.session.commit()
    clear_cache()

    flash(f'已将用户 {username} 回滚至 {before_str} 之前：回滚日志 {reverted_count} 条，影响样本 {len(affected_ids)} 条', 'success')
    return redirect(url_for('admin.logs'))


@bp.route('/logs/<int:log_id>/undo-revert', methods=['POST'])
@admin_required
def logs_undo_revert(log_id):
    """撤销回滚：自动判断单条/整批并恢复为回滚前（new 值）。"""
    from app.models import AuditLog

    log = AuditLog.query.get_or_404(log_id)
    if log.entity_type != 'sample' or not log.changes or not log.reverted:
        flash('该日志未处于已回滚状态，无法撤销回滚', 'warning')
        return redirect(url_for('admin.logs'))

    # 自动判断：如果该日志属于批量操作且同批次有多条已回滚，则按整批撤销；否则按单条撤销。
    batch_scope = []
    if log.action in ('batch_label', 'batch_save'):
        batch_scope = _find_reverted_batch_scope(log)

    if len(batch_scope) > 1:
        restored_logs = 0
        affected_ids = set()
        for item in batch_scope:
            ok, _, ids = _apply_log_change(item, use_old_values=False)
            if ok:
                item.reverted = False
                restored_logs += 1
                for sid in ids:
                    affected_ids.add(sid)

        if restored_logs == 0:
            flash('未能匹配到可撤销回滚的数据，请查阅归档日志。', 'danger')
            return redirect(url_for('admin.logs'))

        sample_for_log = SampleData.query.get(min(affected_ids)) if affected_ids else None
        log_action('undo_revert', 'sample', min(affected_ids) if affected_ids else None,
                   detail=f'撤销整批回滚: seed_log #{log.id}, 恢复日志 {restored_logs} 条, 样本 {len(affected_ids)} 条',
                   sample=sample_for_log)
        db.session.commit()
        clear_cache()
        flash(f'撤销整批回滚成功：恢复日志 {restored_logs} 条，影响样本 {len(affected_ids)} 条', 'success')
        return redirect(url_for('admin.logs'))

    ok, msg, matched_ids = _apply_log_change(log, use_old_values=False)
    if not ok:
        flash(f'{msg}，无法撤销回滚；请查阅归档日志。', 'danger')
        return redirect(url_for('admin.logs'))

    log.reverted = False
    sample_for_log = SampleData.query.get(matched_ids[0]) if matched_ids else None
    log_action('undo_revert', 'sample', matched_ids[0] if matched_ids else None,
               detail=f'撤销单条回滚日志 #{log.id}，恢复 {len(matched_ids)} 条样本',
               sample=sample_for_log)
    db.session.commit()
    clear_cache()

    flash(f'撤销单条回滚成功：恢复样本 {len(matched_ids)} 条', 'success')
    return redirect(url_for('admin.logs'))
