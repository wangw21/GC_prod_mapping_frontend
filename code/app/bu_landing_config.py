"""非 Data_admin 用户登录后的默认落地筛选配置。

通过用户的 category 权限判断所属 BU，返回登录后跳转到 Sample List 的默认筛选参数。
若需新增/调整 BU 落地规则，只修改本文件即可。
"""

# 默认落地筛选（非特殊 BU）：仅 Unlabeled/Prelabeled，且 Note 为 New Links
DEFAULT_LANDING = {
    'status': ['Unlabeled', 'Prelabeled'],
    'note': ['New Links'],
}

# 各 BU 专属落地筛选：键为 category 名称（大写匹配），值为筛选参数
BU_LANDING = {
    'HAIR CARE': {
        'status': ['Unlabeled', 'Prelabeled'],
    },
}


def get_landing_filters(user):
    """根据用户所属 BU 返回登录默认筛选参数。

    user: 当前登录用户。
    返回: dict，可直接用于 url_for('labeling.samples', **filters)。
    """
    categories = user.category_arr or []
    cats_upper = {str(c).upper() for c in categories}
    for bu, filters in BU_LANDING.items():
        if bu.upper() in cats_upper:
            return filters
    return DEFAULT_LANDING
