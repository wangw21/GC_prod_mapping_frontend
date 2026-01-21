from flask import Blueprint, render_template, request, redirect, url_for, flash, send_file, jsonify
from app.models import User, SampleData, db
from app.utils.decorators import admin_required
from app.utils.csv_handler import allowed_file, import_csv_to_db, export_samples_to_csv, get_unique_categories, get_unique_brands
from app.utils.progress_tracker import progress_tracker
from app.utils.cache import clear_cache
import os
import uuid
from datetime import datetime
from werkzeug.utils import secure_filename
from threading import Thread

bp = Blueprint('admin', __name__, url_prefix='/admin')

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
    """清除所有样本数据"""
    try:
        # 使用更高效的 delete() 方法
        num_deleted = db.session.query(SampleData).delete()
        db.session.commit()
        clear_cache() # 清空所有缓存
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
