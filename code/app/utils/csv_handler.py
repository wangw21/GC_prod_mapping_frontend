import pandas as pd
import os
from werkzeug.utils import secure_filename
from app.models import SampleData, db
from sqlalchemy import text
from dateutil.parser import parse as date_parse

def allowed_file(filename):
    """检查文件扩展名是否允许"""
    ALLOWED_EXTENSIONS = {'csv', 'xlsx'}
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def import_csv_to_db(file_path, chunk_size=5000, progress_callback=None):
    """
    导入CSV文件到数据库(优化版,支持百万级数据)

    优化策略:
    1. 分块读取CSV,避免一次性加载全部数据到内存
    2. 使用bulk_insert_mappings批量插入,比逐行add快10-50倍
    3. 增大每批次提交数量到5000条
    4. 支持进度回调

    参数:
        file_path: 文件路径
        chunk_size: 每块大小(默认5000)
        progress_callback: 进度回调函数 callback(current, total, message)
    """
    try:
        total_count = 0

        # 辅助函数：安全转换值
        def safe_value(val):
            """安全转换值，处理nan和None"""
            if val is None:
                return None
            if pd.isna(val):
                return None
            # 如果是数字类型，转换为字符串
            if isinstance(val, (int, float)):
                return str(val)
            return str(val) if val else None

        # 辅助函数：解析日期
        def parse_date(date_str):
            if not date_str or pd.isna(date_str):
                return None
            try:
                # 尝试将各种格式的日期字符串解析为date对象
                return date_parse(str(date_str)).date()
            except (ValueError, TypeError):
                # 如果解析失败，返回None
                return None

        # 分块读取CSV文件
        if file_path.endswith('.csv'):
            if progress_callback:
                progress_callback(0, 0, '正在读取文件...')

            # 直接分块读取,不预先统计行数(避免读取两遍)
            reader = pd.read_csv(file_path, encoding='utf-8-sig', chunksize=chunk_size)
            total_rows = 0  # 使用动态总数
        elif file_path.endswith('.xlsx'):
            # Excel文件不支持chunksize,需要一次性读取
            if progress_callback:
                progress_callback(0, 0, '正在读取Excel文件...')
            df = pd.read_excel(file_path)
            total_rows = len(df)
            if progress_callback:
                progress_callback(0, total_rows, f'准备导入 {total_rows} 条数据...')
            reader = [df]
        else:
            raise ValueError('不支持的文件格式')

        # 处理每个数据块
        for chunk_idx, df_chunk in enumerate(reader):
            # 替换NaN为None
            df_chunk = df_chunk.where(pd.notnull(df_chunk), None)

            # 准备批量插入的数据
            mappings = []
            for _, row in df_chunk.iterrows():
                mapping = {
                    'eRetailer': safe_value(row.get('eRetailer')),
                    'online_store': safe_value(row.get('online_store')),
                    'category': safe_value(row.get('category')),
                    'brand': safe_value(row.get('brand')),
                    'is_competitor': safe_value(row.get('is_competitor')),
                    'product_description': safe_value(row.get('product_description')),
                    'url': safe_value(row.get('url')),
                    'sku_url': safe_value(row.get('sku_url')),
                    'sku': safe_value(row.get('sku')),
                    'sku_id': safe_value(row.get('sku_id')),
                    'retailer_product_code': safe_value(row.get('retailer_product_code')),
                    'latest_review_date': parse_date(row.get('latest_review_date')),
                    'image_url': safe_value(row.get('image_url')),
                    'total': safe_value(row.get('total')),
                    'total_comments': safe_value(row.get('total_comments')),
                    'last_month_total': safe_value(row.get('last_month_total')),
                    'last_total_comments': safe_value(row.get('last_total_comments')),
                    'note': safe_value(row.get('note')),
                    'prod_attributes1': safe_value(row.get('prod_attributes1')),
                    'prod_attributes2': safe_value(row.get('prod_attributes2')),
                    'prod_attributes3': safe_value(row.get('prod_attributes3')),
                    'prod_attributes4': safe_value(row.get('prod_attributes4')),
                    'prod_attributes5': safe_value(row.get('prod_attributes5')),
                    'status': safe_value(row.get('status')) or 'Unlabeled'  # 优先使用文件中的status,否则默认为Unlabeled
                }
                mappings.append(mapping)

            # 批量插入当前块
            if mappings:
                db.session.bulk_insert_mappings(SampleData, mappings)
                db.session.commit()
                total_count += len(mappings)

                # 进度回调
                if progress_callback:
                    # CSV文件total_rows为0时显示未知总数
                    if total_rows > 0:
                        progress_callback(total_count, total_rows, f'已导入 {total_count} / {total_rows} 条数据')
                    else:
                        progress_callback(total_count, total_count, f'已导入 {total_count} 条数据...')
                else:
                    # 打印进度(每5000条输出一次)
                    print(f'已导入 {total_count} 条数据...')

        return True, f'成功导入 {total_count} 条数据'

    except Exception as e:
        db.session.rollback()
        return False, f'导入失败: {str(e)}'

def import_csv_to_db_ultra_fast(file_path):
    """
    极速导入方案(使用LOAD DATA INFILE,仅支持MySQL)
    适用于超大文件(100万+),速度可提升10-100倍

    注意:需要MySQL配置允许local_infile
    """
    try:
        import csv

        # 读取CSV并转换为临时文件
        temp_file = file_path + '.prepared.csv'

        # 辅助函数
        def safe_value(val):
            if val is None or val == '' or (isinstance(val, float) and pd.isna(val)):
                return '\\N'  # MySQL的NULL表示
            return str(val)

        # 预处理CSV
        if file_path.endswith('.csv'):
            df = pd.read_csv(file_path, encoding='utf-8-sig')
        elif file_path.endswith('.xlsx'):
            df = pd.read_excel(file_path)
        else:
            raise ValueError('不支持的文件格式')

        # 替换NaN为None
        df = df.where(pd.notnull(df), None)

        # 写入临时CSV(按数据库列顺序)
        columns = [
            'eRetailer', 'online_store', 'category', 'brand', 'is_competitor',
            'product_description', 'url', 'sku_url', 'sku', 'sku_id',
            'retailer_product_code', 'latest_review_date', 'image_url',
            'total', 'total_comments', 'last_month_total', 'last_total_comments',
            'note',
            'prod_attributes1', 'prod_attributes2', 'prod_attributes3',
            'prod_attributes4', 'prod_attributes5', 'status'
        ]

        with open(temp_file, 'w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            for _, row in df.iterrows():
                writer.writerow([safe_value(row.get(col)) for col in columns])

        # 使用LOAD DATA INFILE导入
        temp_file_escaped = temp_file.replace('\\', '/')
        sql = f"""
        LOAD DATA LOCAL INFILE '{temp_file_escaped}'
        INTO TABLE sample_data
        FIELDS TERMINATED BY ',' ENCLOSED BY '"'
        LINES TERMINATED BY '\\n'
        ({', '.join(columns)})
        """

        db.session.execute(text(sql))
        db.session.commit()

        # 清理临时文件
        if os.path.exists(temp_file):
            os.remove(temp_file)

        row_count = len(df)
        return True, f'成功导入 {row_count} 条数据'

    except Exception as e:
        db.session.rollback()
        if os.path.exists(temp_file):
            os.remove(temp_file)
        return False, f'极速导入失败: {str(e)}'

def export_samples_to_csv(samples, output_path):
    """导出样本数据到CSV"""
    try:
        # 转换为字典列表
        data = [sample.to_dict() for sample in samples]

        # 创建DataFrame
        df = pd.DataFrame(data)

        # 删除id列
        if 'id' in df.columns:
            df = df.drop('id', axis=1)

        # 导出CSV
        df.to_csv(output_path, index=False, encoding='utf-8-sig')
        return True, '导出成功'

    except Exception as e:
        return False, f'导出失败: {str(e)}'

def get_unique_categories():
    """获取所有不重复的category"""
    result = db.session.query(SampleData.category).distinct().all()
    return [r[0] for r in result if r[0]]

def get_unique_brands():
    """获取所有不重复的brand"""
    result = db.session.query(SampleData.brand).distinct().all()
    return [r[0] for r in result if r[0]]
