import { Select, Space, Tag, type SelectProps } from 'antd';
import { useMemo } from 'react';
import type { Account } from '@caiwu/core';
import { useAccounts } from '@caiwu/web-kit';

/**
 * 科目模糊搜索：编码前缀、名称、全名、拼音首字母、助记码。
 * 排序：编码完全相同 > 编码前缀 > 拼音首字母开头 > 其它，同级按编码。
 */
export function accountMatchScore(a: Account, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 5;
  if (a.code === q) return 0;
  if (a.code.startsWith(q)) return 1;
  if (a.pinyin.startsWith(q) || a.mnemonic?.toLowerCase().startsWith(q)) return 2;
  if (a.name.toLowerCase().includes(q)) return 3;
  if (a.fullName.toLowerCase().includes(q) || a.pinyin.includes(q)) return 4;
  return -1;
}

export function filterAccounts(accounts: readonly Account[], query: string): Account[] {
  return accounts
    .map((a) => ({ a, score: accountMatchScore(a, query) }))
    .filter((x) => x.score >= 0)
    .sort((x, y) => x.score - y.score || x.a.code.localeCompare(y.a.code))
    .map((x) => x.a);
}

export interface AccountSelectProps extends Omit<
  SelectProps<number>,
  'options' | 'showSearch' | 'filterOption'
> {
  /** 只能选末级科目（默认 true，录凭证时必须是末级） */
  leafOnly?: boolean;
  /** 包含停用科目（默认 false） */
  includeDisabled?: boolean;
  /** 进一步筛选可选科目，例如只要现金银行科目 */
  filter?: (a: Account) => boolean;
}

/** 科目选择器。value 是科目 id。 */
export function AccountSelect({
  leafOnly = true,
  includeDisabled = false,
  filter,
  ...rest
}: AccountSelectProps) {
  const { accounts, byId, loading } = useAccounts();
  const candidates = useMemo(
    () =>
      accounts.filter(
        (a) =>
          (!leafOnly || a.isLeaf) && (includeDisabled || !a.disabled) && (!filter || filter(a)),
      ),
    [accounts, leafOnly, includeDisabled, filter],
  );
  const options = useMemo(
    () =>
      candidates.map((a) => ({
        value: a.id,
        label: `${a.code} ${a.name}`,
        account: a,
      })),
    [candidates],
  );
  return (
    <Select<number>
      placeholder="编码、名称或拼音首字母"
      loading={loading}
      {...rest}
      options={options}
      showSearch={{
        filterOption: (input, option) =>
          accountMatchScore((option as { account: Account }).account, input) >= 0,
        filterSort: (x, y, info) => {
          const a = (x as { account: Account }).account;
          const b = (y as { account: Account }).account;
          return (
            accountMatchScore(a, info.searchValue) - accountMatchScore(b, info.searchValue) ||
            a.code.localeCompare(b.code)
          );
        },
      }}
      optionRender={(opt) => {
        const a = (opt.data as { account: Account }).account;
        return (
          <Space size={4} wrap={false}>
            <span className="cw-code">{a.code}</span>
            <span>{a.fullName}</span>
            {a.currency && <Tag color="blue">{a.currency}</Tag>}
            {a.quantityUnit && <Tag color="green">{a.quantityUnit}</Tag>}
            {a.dimensions.map((d) => (
              <Tag key={d.type}>{dimensionShortName(d.type)}</Tag>
            ))}
          </Space>
        );
      }}
      labelRender={(v) => {
        const a = byId.get(v.value as number);
        return a ? `${a.code} ${a.fullName}` : v.label;
      }}
      popupMatchSelectWidth={false}
    />
  );
}

function dimensionShortName(type: string): string {
  return (
    { project: '项目', partner: '客供', department: '部门', person: '个人', cashflow: '现金流' }[
      type
    ] ?? type
  );
}
