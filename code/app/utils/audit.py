"""操作审计：统一记录用户对数据的更改，支持溯源与找回。

设计要点：
- log_action 仅追加 AuditLog 记录，不主动 commit（与业务在同一事务内提交，保证一致性）。
- diff_fields 计算字段级 {old,new} 快照，仅在确有变更时记录，用于一键回滚。
- 记录失败不应影响主流程，故捕获异常并安全降级。
- 业务身份四列(product_description/sku/url/sku_url)是稳定键：数据每月清空重传后
  自增 id 会变，凭这四列可与下游联动，也可跨月定位同一条数据进行回滚。
"""
from flask import request
from flask_login import current_user
from app.models import db, AuditLog


def normalize_key(value):
    """业务身份四列的归一化：去首尾空白、None 视为空串，便于稳定匹配。"""
    if value is None:
        return ''
    return str(value).strip()


def diff_fields(old_values, new_values):
    """计算字段级差异: {field: {'old':..., 'new':...}}，无差异返回空 dict。"""
    changes = {}
    for field, new_val in new_values.items():
        old_val = old_values.get(field)
        if (old_val or '') != (new_val or ''):
            changes[field] = {'old': old_val, 'new': new_val}
    return changes


def snapshot_fields(old_values, new_values):
    """构造字段级完整快照: {field: {'old':..., 'new':...}}，包含所有字段
    （无论是否变更）。

    与 diff_fields 的区别：diff 只保留变化字段，用于判断"是否需要记录/回滚哪些字段"；
    snapshot 则完整保留 prod_attributes1-5、status 等全部字段的前后值，
    便于日志长期归档后，仅凭下载的日志即可完整恢复整行数据。
    """
    snap = {}
    for field, new_val in new_values.items():
        snap[field] = {'old': old_values.get(field), 'new': new_val}
    return snap



def log_action(action, entity_type, entity_id=None, changes=None, detail='', sample=None):
    """追加一条审计日志（不 commit，交由调用方与业务一起提交）。

    sample: 可选的 SampleData 实例；若提供，则记录其业务身份四列，
            用于下游联动与跨月回滚。
    """
    try:
        uid = current_user.id if getattr(current_user, 'is_authenticated', False) else None
        uname = current_user.username if getattr(current_user, 'is_authenticated', False) else None
        ip = request.remote_addr if request else None
        log = AuditLog(
            user_id=uid,
            username=uname,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            product_description=(sample.product_description if sample is not None else None),
            sku=(sample.sku if sample is not None else None),
            url=(sample.url if sample is not None else None),
            sku_url=(sample.sku_url if sample is not None else None),
            changes=changes or None,
            detail=detail,
            ip=ip,
        )
        db.session.add(log)
    except Exception:
        # 审计失败不阻断业务
        pass
