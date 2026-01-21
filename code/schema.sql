-- 打标平台数据库建表脚本
-- 数据库: labeling_platform

-- 创建数据库（如需要）
-- CREATE DATABASE IF NOT EXISTS labeling_platform DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- USE labeling_platform;

-- =====================================================
-- 表1: 用户表
-- =====================================================
CREATE TABLE `user` (
  `id` INT PRIMARY KEY AUTO_INCREMENT COMMENT '用户ID',
  `username` VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
  `password` VARCHAR(255) NOT NULL COMMENT '密码(加密存储)',
  `real_name` VARCHAR(50) DEFAULT NULL COMMENT '真实姓名',
  `role` ENUM('Data_admin', 'BU_admin', 'Labeller') NOT NULL COMMENT '角色',
  `category_arr` JSON DEFAULT NULL COMMENT 'category权限数组,NULL=全部权限',
  `brand_arr` JSON DEFAULT NULL COMMENT 'brand权限数组,NULL=全部权限',
  `is_active` TINYINT(1) DEFAULT 1 COMMENT '账号是否激活',
  INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- =====================================================
-- 表2: 样本数据表（严格按照CSV表头）
-- =====================================================
CREATE TABLE `sample_data` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `eRetailer` VARCHAR(255) DEFAULT NULL,
  `online_store` VARCHAR(255) DEFAULT NULL,
  `category` VARCHAR(255) DEFAULT NULL,
  `brand` VARCHAR(255) DEFAULT NULL,
  `is_competitor` VARCHAR(255) DEFAULT NULL,
  `product_description` TEXT DEFAULT NULL,
  `url` TEXT DEFAULT NULL,
  `sku_url` TEXT DEFAULT NULL,
  `sku` TEXT DEFAULT NULL,
  `sku_id` VARCHAR(255) DEFAULT NULL,
  `retailer_product_code` VARCHAR(255) DEFAULT NULL,
  `latest_review_date` DATE DEFAULT NULL,
  `image_url` TEXT DEFAULT NULL,
  `total` VARCHAR(255) DEFAULT NULL,
  `total_comments` VARCHAR(255) DEFAULT NULL,
  `last_month_total` VARCHAR(255) DEFAULT NULL,
  `last_total_comments` VARCHAR(255) DEFAULT NULL,
  `note` TEXT DEFAULT NULL,
  `prod_attributes1` VARCHAR(255) DEFAULT NULL COMMENT '打标字段1',
  `prod_attributes2` VARCHAR(255) DEFAULT NULL COMMENT '打标字段2',
  `prod_attributes3` VARCHAR(255) DEFAULT NULL COMMENT '打标字段3',
  `prod_attributes4` VARCHAR(255) DEFAULT NULL COMMENT '打标字段4',
  `prod_attributes5` VARCHAR(255) DEFAULT NULL COMMENT '打标字段5',
  `status` VARCHAR(255) DEFAULT NULL COMMENT '打标状态, Labeled, Unlabeled, Prelabeled, Historical, Incomplete',

  INDEX idx_category (category),
  INDEX idx_brand (brand),
  INDEX idx_status (status),
  INDEX idx_category_brand (category, brand)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='样本数据表';

-- 性能优化索引脚本
-- 用于优化百万级数据的筛选和打标候选项查询

USE labeling_platform;

-- 为常用筛选字段添加索引
ALTER TABLE sample_data ADD INDEX idx_eRetailer (eRetailer(50));
ALTER TABLE sample_data ADD INDEX idx_online_store (online_store(50));
ALTER TABLE sample_data ADD INDEX idx_is_competitor (is_competitor(50));
ALTER TABLE sample_data ADD INDEX idx_latest_review_date (latest_review_date);

-- 为打标属性字段添加索引(用于快速查询distinct值)
ALTER TABLE sample_data ADD INDEX idx_prod_attributes1 (prod_attributes1(50));
ALTER TABLE sample_data ADD INDEX idx_prod_attributes2 (prod_attributes2(50));
ALTER TABLE sample_data ADD INDEX idx_prod_attributes3 (prod_attributes3(50));
ALTER TABLE sample_data ADD INDEX idx_prod_attributes4 (prod_attributes4(50));
ALTER TABLE sample_data ADD INDEX idx_prod_attributes5 (prod_attributes5(50));

-- 为数值型筛选字段添加索引
ALTER TABLE sample_data ADD INDEX idx_total (total(20));
ALTER TABLE sample_data ADD INDEX idx_total_comments (total_comments(20));
ALTER TABLE sample_data ADD INDEX idx_last_month_total (last_month_total(20));
ALTER TABLE sample_data ADD INDEX idx_last_total_comments (last_total_comments(20));

-- 组合索引:用于查询未打标数据
-- ALTER TABLE sample_data ADD INDEX idx_rule_category (category(50), _rule_matched(20));
-- ALTER TABLE sample_data ADD INDEX idx_rule_brand (brand(50), _rule_matched(20));

-- 查看当前所有索引
SHOW INDEX FROM sample_data;