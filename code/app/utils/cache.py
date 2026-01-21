from functools import wraps
from datetime import datetime, timedelta
from flask_login import current_user

# 简单的内存缓存
_cache = {}
_cache_expiry = {}

def cached(timeout=300, user_specific=False):
    """
    缓存装饰器
    timeout: 缓存过期时间(秒),默认5分钟
    user_specific: 是否根据用户权限生成独立缓存
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # 基础缓存key
            base_key = f"{func.__name__}:{str(args)}:{str(kwargs)}"

            # 如果是用户相关的缓存，添加用户权限信息到key中
            if user_specific and current_user.is_authenticated:
                brand_key = tuple(sorted(current_user.brand_arr)) if current_user.brand_arr else ()
                category_key = tuple(sorted(current_user.category_arr)) if current_user.category_arr else ()
                cache_key = f"{base_key}:user_brands={brand_key}:user_cats={category_key}"
            else:
                cache_key = base_key

            # 检查缓存是否存在且未过期
            if cache_key in _cache:
                expiry_time = _cache_expiry.get(cache_key)
                if expiry_time and datetime.now() < expiry_time:
                    return _cache[cache_key]

            # 执行函数并缓存结果
            result = func(*args, **kwargs)
            _cache[cache_key] = result
            _cache_expiry[cache_key] = datetime.now() + timedelta(seconds=timeout)

            return result
        return wrapper
    return decorator

def clear_cache(user_specific=False):
    """
    清空缓存
    user_specific: 如果为True, 只清空当前用户权限相关的缓存
    """
    global _cache, _cache_expiry
    
    if not user_specific or not current_user.is_authenticated:
        # 清空所有缓存
        _cache = {}
        _cache_expiry = {}
    else:
        # 只清空与当前用户权限相关的缓存
        brand_key = tuple(sorted(current_user.brand_arr)) if current_user.brand_arr else ()
        category_key = tuple(sorted(current_user.category_arr)) if current_user.category_arr else ()
        user_key_part = f":user_brands={brand_key}:user_cats={category_key}"
        
        keys_to_delete = [key for key in _cache if user_key_part in key]
        for key in keys_to_delete:
            if key in _cache:
                del _cache[key]
            if key in _cache_expiry:
                del _cache_expiry[key]
