import type { Generated } from '@caiwu/db';
import type { AccountClosingRule } from '../account';

/**
 * 核心表的 Kysely 类型，与 migrations.ts 保持一致。
 * 模块自己的表在模块里另写一个接口，用 ctx.db.withTables<MyTables>() 合并进来。
 * 布尔列在库里是 0/1 整数。
 */
export interface CoreDB {
  book_info: {
    id: number;
    book_id: string;
    name: string;
    org_name: string;
    template_id: string;
    template_version: string;
    template_name: string;
    regime: string;
    product: string;
    start_period: number;
    code_scheme: string;
    base_currency: string;
    created_at: string;
    updated_at: string;
  };
  book_setting: { scope: string; key: string; value: string; updated_at: string };
  fiscal_year: {
    year: number;
    opening_period: number;
    opening_stored: number;
    status: 'open' | 'closed';
    closed_at: string | null;
    closed_by: number | null;
  };
  period: {
    period: number;
    year: number;
    month: number;
    start_date: string;
    end_date: string;
    status: 'open' | 'closed';
    closed_at: string | null;
    closed_by: number | null;
  };
  app_user: {
    id: Generated<number>;
    code: string;
    name: string;
    password_hash: string;
    is_admin: number;
    disabled: number;
    created_at: string;
    updated_at: string;
  };
  user_permission: { user_id: number; permission: string };
  operation_log: {
    id: Generated<number>;
    at: string;
    user_id: number | null;
    user_name: string | null;
    module: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    summary: string;
    detail: string | null;
  };
  account_category: {
    id: string;
    name: string;
    direction: 'debit' | 'credit';
    is_pnl: number;
    sort: number;
  };
  currency: {
    code: string;
    name: string;
    symbol: string | null;
    is_base: number;
    disabled: number;
    sort: number;
  };
  exchange_rate: { currency_code: string; period: number; rate: string };
  dimension_type: { id: string; name: string; column_name: string; sort: number };
  dimension_item: {
    id: Generated<number>;
    type_id: string;
    code: string;
    name: string;
    parent_id: number | null;
    is_leaf: number;
    pinyin: string;
    disabled: number;
    attrs: string;
    revision: Generated<number>;
    sort: number;
    created_at: string;
    updated_at: string;
  };
  account: {
    id: Generated<number>;
    code: string;
    name: string;
    full_name: string;
    parent_id: number | null;
    level: number;
    category_id: string;
    direction: 'debit' | 'credit';
    is_contra: Generated<number>;
    balance_nature: Generated<'debit' | 'credit' | 'both' | 'no-closing-balance' | null>;
    closing_rule: Generated<AccountClosingRule | null>;
    source: Generated<string | null>;
    source_version: Generated<string | null>;
    is_leaf: number;
    disabled: number;
    is_cash: number;
    is_bank: number;
    cashflow_required: number;
    is_partner: number;
    currency_code: string | null;
    quantity_unit: string | null;
    pinyin: string;
    mnemonic: string | null;
    sort: number;
    created_at: string;
    updated_at: string;
  };
  account_dimension: {
    account_id: number;
    dimension_type: string;
    required: number;
    default_item_id: number | null;
  };
  voucher_type: {
    id: Generated<number>;
    code: string;
    name: string;
    rule: string | null;
    disabled: number;
    sort: number;
  };
  settlement_method: {
    id: Generated<number>;
    code: string;
    name: string;
    disabled: number;
    sort: number;
  };
  summary_phrase: {
    id: Generated<number>;
    code: string | null;
    text: string;
    pinyin: string;
    use_count: number;
    sort: number;
  };
  voucher: {
    id: Generated<number>;
    period: number;
    voucher_type_id: number;
    number: number | null;
    date: string;
    attachments: number;
    status: 'draft' | 'pending' | 'audited' | 'posted';
    voided: number;
    reversal_of_id: number | null;
    source_module: string | null;
    source_type: string | null;
    source_id: string | null;
    closing_kind: string | null;
    note: string | null;
    debit_total: number;
    credit_total: number;
    created_by: number;
    created_at: string;
    updated_by: number | null;
    updated_at: string;
    audited_by: number | null;
    audited_at: string | null;
    posted_by: number | null;
    posted_at: string | null;
    revision: number;
  };
  voucher_line: {
    id: Generated<number>;
    voucher_id: number;
    cashflow_direction: Generated<'inflow' | 'outflow' | 'internal' | null>;
    entry_side: Generated<'debit' | 'credit' | null>;
    line_no: number;
    period: number;
    summary: string;
    account_id: number;
    dim_project: number | null;
    dim_partner: number | null;
    dim_department: number | null;
    dim_person: number | null;
    dim_cashflow: number | null;
    currency_code: string | null;
    exchange_rate: string | null;
    fc_amount: number | null;
    quantity_e6: number | null;
    unit_price: string | null;
    debit: number;
    credit: number;
    settlement_method_id: number | null;
    ref_no: string | null;
    biz_date: string | null;
  };
  opening_balance: {
    id: Generated<number>;
    year: number;
    account_id: number;
    dim_project: number | null;
    dim_partner: number | null;
    dim_department: number | null;
    dim_person: number | null;
    dims_key: string;
    currency_code: string | null;
    balance: number;
    ytd_debit: number;
    ytd_credit: number;
    fc_balance: number;
    quantity_e6: number;
    updated_at: string;
  };
}
