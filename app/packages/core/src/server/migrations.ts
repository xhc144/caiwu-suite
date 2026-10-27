import { defineMigrations } from '@caiwu/db';

/**
 * 核心表。金额列一律是 INTEGER（分）；数量列带 _e6 后缀（百万分之一）；
 * 汇率、单价是 TEXT 十进制字符串；日期是 'YYYY-MM-DD'；时间戳是 ISO 字符串；期间是 INTEGER yyyymm。
 * 余额一律"借正贷负"。
 *
 * 已发布的迁移不能修改。要加字段，在后面新增迁移；模块给核心表加字段放在模块自己的迁移里。
 */
export const coreMigrations = defineMigrations([
  {
    id: '0001_core',
    sql: /* sql */ `
-- 账套信息（单行）
CREATE TABLE book_info (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  book_id TEXT NOT NULL,                 -- 账套 id（与文件名一致）
  name TEXT NOT NULL,                    -- 账套名称
  org_name TEXT NOT NULL,                -- 单位名称
  template_id TEXT NOT NULL,             -- 会计制度模板
  template_version TEXT NOT NULL,
  template_name TEXT NOT NULL,
  regime TEXT NOT NULL,                  -- 会计制度归属 enterprise / small-business / nonprofit ...
  product TEXT NOT NULL,                 -- 产品形态 qingsong / minfei / chengben
  start_period INTEGER NOT NULL,         -- 启用期间
  code_scheme TEXT NOT NULL,             -- 科目级次 "4-2-2"
  base_currency TEXT NOT NULL DEFAULT 'CNY',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 账套级参数（各模块的设置都放这里，scope = 模块 id）
CREATE TABLE book_setting (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,                   -- JSON
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

-- 会计年度。opening_stored = 1 表示该年的期初余额以 opening_balance 为准（首年；年结后的新年度）
CREATE TABLE fiscal_year (
  year INTEGER PRIMARY KEY,
  opening_period INTEGER NOT NULL,       -- 该年期初对应的期间（首年为启用期间，其余为 1 月）
  opening_stored INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at TEXT,
  closed_by INTEGER
);

CREATE TABLE period (
  period INTEGER PRIMARY KEY,
  year INTEGER NOT NULL REFERENCES fiscal_year(year),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at TEXT,
  closed_by INTEGER
);

-- 操作员
CREATE TABLE app_user (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_permission (
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE operation_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER,
  user_name TEXT,
  module TEXT NOT NULL,                  -- 'core' 或模块 id
  action TEXT NOT NULL,                  -- 例如 voucher.create
  target_type TEXT,
  target_id TEXT,
  summary TEXT NOT NULL,                 -- 中文说明
  detail TEXT                            -- JSON
);
CREATE INDEX operation_log_at ON operation_log(at);
CREATE INDEX operation_log_target ON operation_log(target_type, target_id);

-- 科目类别（来自会计制度模板）
CREATE TABLE account_category (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  is_pnl INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE currency (
  code TEXT PRIMARY KEY,                 -- ISO 4217，例如 USD
  name TEXT NOT NULL,
  symbol TEXT,
  is_base INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

-- 期间汇率（记账汇率）
CREATE TABLE exchange_rate (
  currency_code TEXT NOT NULL REFERENCES currency(code),
  period INTEGER NOT NULL,
  rate TEXT NOT NULL,
  PRIMARY KEY (currency_code, period)
);

-- 辅助核算维度类型（内置 5 种，见 @caiwu/core DIMENSION_TYPES）
CREATE TABLE dimension_type (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  column_name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

-- 辅助核算维度项：项目、客供、部门、个人、现金流量项目
CREATE TABLE dimension_item (
  id INTEGER PRIMARY KEY,
  type_id TEXT NOT NULL REFERENCES dimension_type(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES dimension_item(id),
  is_leaf INTEGER NOT NULL DEFAULT 1,
  pinyin TEXT NOT NULL DEFAULT '',
  disabled INTEGER NOT NULL DEFAULT 0,
  attrs TEXT NOT NULL DEFAULT '{}',      -- JSON：各维度自己的扩展字段
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (type_id, code)
);

CREATE TABLE account (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,               -- "银行存款/工商银行"
  parent_id INTEGER REFERENCES account(id),
  level INTEGER NOT NULL,
  category_id TEXT NOT NULL REFERENCES account_category(id),
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  is_leaf INTEGER NOT NULL DEFAULT 1,
  disabled INTEGER NOT NULL DEFAULT 0,
  is_cash INTEGER NOT NULL DEFAULT 0,    -- 现金科目
  is_bank INTEGER NOT NULL DEFAULT 0,    -- 银行科目
  cashflow_required INTEGER NOT NULL DEFAULT 0, -- 现金流量标志
  is_partner INTEGER NOT NULL DEFAULT 0, -- 往来科目
  currency_code TEXT REFERENCES currency(code), -- 外币核算
  quantity_unit TEXT,                    -- 数量核算单位
  pinyin TEXT NOT NULL DEFAULT '',
  mnemonic TEXT,                         -- 助记码
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX account_parent ON account(parent_id);

-- 科目启用的辅助核算
CREATE TABLE account_dimension (
  account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  dimension_type TEXT NOT NULL REFERENCES dimension_type(id),
  required INTEGER NOT NULL DEFAULT 1,
  default_item_id INTEGER REFERENCES dimension_item(id),
  PRIMARY KEY (account_id, dimension_type)
);

CREATE TABLE voucher_type (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,             -- 凭证字：记、收、付、转
  name TEXT NOT NULL,                    -- 记账凭证
  rule TEXT,                             -- JSON：限制条件（借方必有/贷方必有/凭证必有/凭证必无科目）
  disabled INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settlement_method (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

-- 摘要库
CREATE TABLE summary_phrase (
  id INTEGER PRIMARY KEY,
  code TEXT,
  text TEXT NOT NULL,
  pinyin TEXT NOT NULL DEFAULT '',
  use_count INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE voucher (
  id INTEGER PRIMARY KEY,
  period INTEGER NOT NULL REFERENCES period(period),
  voucher_type_id INTEGER NOT NULL REFERENCES voucher_type(id),
  number INTEGER,                        -- 凭证编号；草稿为空
  date TEXT NOT NULL,
  attachments INTEGER NOT NULL DEFAULT 0, -- 附单据数
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'audited', 'posted')),
  voided INTEGER NOT NULL DEFAULT 0,
  reversal_of_id INTEGER REFERENCES voucher(id), -- 红字冲销的原凭证
  source_module TEXT,                    -- 生成该凭证的模块；手工凭证为空
  source_type TEXT,
  source_id TEXT,
  closing_kind TEXT,                     -- 结转凭证标记，例如 pnl
  note TEXT,
  debit_total INTEGER NOT NULL DEFAULT 0,
  credit_total INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_by INTEGER REFERENCES app_user(id),
  updated_at TEXT NOT NULL,
  audited_by INTEGER REFERENCES app_user(id),
  audited_at TEXT,
  posted_by INTEGER REFERENCES app_user(id),
  posted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX voucher_number ON voucher(period, voucher_type_id, number) WHERE number IS NOT NULL;
CREATE INDEX voucher_period_status ON voucher(period, status);
CREATE INDEX voucher_source ON voucher(source_module, source_type, source_id);

CREATE TABLE voucher_line (
  id INTEGER PRIMARY KEY,
  voucher_id INTEGER NOT NULL REFERENCES voucher(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  period INTEGER NOT NULL,               -- 冗余自 voucher.period，便于按期间查
  summary TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES account(id),
  dim_project INTEGER REFERENCES dimension_item(id),
  dim_partner INTEGER REFERENCES dimension_item(id),
  dim_department INTEGER REFERENCES dimension_item(id),
  dim_person INTEGER REFERENCES dimension_item(id),
  dim_cashflow INTEGER REFERENCES dimension_item(id),
  currency_code TEXT REFERENCES currency(code),
  exchange_rate TEXT,
  fc_amount INTEGER,                     -- 外币金额（分）
  quantity_e6 INTEGER,                   -- 数量（百万分之一）
  unit_price TEXT,
  debit INTEGER NOT NULL DEFAULT 0,
  credit INTEGER NOT NULL DEFAULT 0,
  settlement_method_id INTEGER REFERENCES settlement_method(id),
  ref_no TEXT,                           -- 票号
  biz_date TEXT,                         -- 业务日期
  UNIQUE (voucher_id, line_no)
);
CREATE INDEX voucher_line_account_period ON voucher_line(account_id, period);
CREATE INDEX voucher_line_period ON voucher_line(period);

-- 期初余额：每个会计年度一套（首年为启用期间的期初，年结后为新年度年初）
CREATE TABLE opening_balance (
  id INTEGER PRIMARY KEY,
  year INTEGER NOT NULL REFERENCES fiscal_year(year),
  account_id INTEGER NOT NULL REFERENCES account(id),
  dim_project INTEGER REFERENCES dimension_item(id),
  dim_partner INTEGER REFERENCES dimension_item(id),
  dim_department INTEGER REFERENCES dimension_item(id),
  dim_person INTEGER REFERENCES dimension_item(id),
  dims_key TEXT NOT NULL DEFAULT '',     -- 维度组合规范化键（dimensionsKey）
  currency_code TEXT REFERENCES currency(code), -- 空 = 本位币
  balance INTEGER NOT NULL DEFAULT 0,    -- 期初余额（借正贷负）
  ytd_debit INTEGER NOT NULL DEFAULT 0,  -- 年中启用：启用前本年累计借方
  ytd_credit INTEGER NOT NULL DEFAULT 0, -- 年中启用：启用前本年累计贷方
  fc_balance INTEGER NOT NULL DEFAULT 0, -- 外币期初余额（分，借正贷负）
  quantity_e6 INTEGER NOT NULL DEFAULT 0, -- 数量期初（借正贷负）
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX opening_balance_key ON opening_balance(year, account_id, dims_key, IFNULL(currency_code, ''));
`,
  },
  {
    id: '0002_shared_semantics',
    sql: `
ALTER TABLE voucher_line ADD COLUMN cashflow_direction TEXT CHECK(cashflow_direction IN ('inflow','outflow','internal'));
ALTER TABLE voucher_line ADD COLUMN entry_side TEXT CHECK(entry_side IN ('debit','credit'));
ALTER TABLE account ADD COLUMN is_contra INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account ADD COLUMN balance_nature TEXT CHECK(balance_nature IN ('debit','credit','both','no-closing-balance'));
ALTER TABLE account ADD COLUMN source TEXT;
ALTER TABLE account ADD COLUMN source_version TEXT;
ALTER TABLE dimension_item ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
`,
  },
  {
    id: '0003_account_closing_rule',
    // 只新增可空字段；旧科目不自动补语义，不改凭证、期初或余额。
    sql: `
ALTER TABLE account ADD COLUMN closing_rule TEXT CHECK(closing_rule IN ('none','profit','retained-earnings','year-retained-earnings','clearing','seasonal-allocation'));
`,
  },
]);
