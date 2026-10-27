import { Button, Input, Select, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  balanceSide,
  Decimal,
  dimensionName,
  formatMoney,
  isDecimalString,
  type Account,
  type DimensionTypeId,
  type DimensionItem,
  type VoucherLineInput,
} from '@caiwu/core';
import { AccountSelect, MoneyInput } from '@caiwu/ui';
import { useAccounts } from '@caiwu/web-kit';
import { isEntryDate, foreignAmount, quantityAmount } from '../shared';
import { api } from './api';

type Props = {
  lines: VoucherLineInput[];
  accounts: Account[];
  items: DimensionItem[];
  date: string;
  methods: { id: number; code: string; name: string; disabled: boolean }[];
  summaries: { id: number; text: string }[];
  readonly: boolean;
  active: number;
  onActive: (index: number, field?: string) => void;
  onChange: (lines: VoucherLineInput[]) => void;
  onInfo: () => void;
};
export default function LineGrid(p: Props) {
  const accountCatalog = useAccounts();
  const defaultWidths = [48, 200, 250, 150, 150, 300];
  const minimumWidths = [42, 140, 180, 110, 110, 200];
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem('voucher-entry.grid.widths') ?? 'null',
      );
      if (
        Array.isArray(saved) &&
        saved.length === 6 &&
        saved.every(
          (value, i) =>
            typeof value === 'number' &&
            Number.isFinite(value) &&
            value >= minimumWidths[i]! &&
            value <= 1600,
        )
      )
        return saved;
    } catch {
      /* 存储不可用时仍可录入 */
    }
    return defaultWidths;
  });
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const resize = (index: number, width: number) =>
    setWidths((current) => {
      const next = [...current];
      next[index] = Math.max(minimumWidths[index]!, Math.min(1600, Math.round(width)));
      try {
        localStorage.setItem('voucher-entry.grid.widths', JSON.stringify(next));
      } catch {
        /* 当前布局仍生效 */
      }
      return next;
    });
  const table = useRef<HTMLTableElement>(null);
  const focusField = (index: number, field: string) =>
    setTimeout(() => {
      const cell = table.current?.querySelector<HTMLElement>(
        `[data-line="${index}"] [data-field="${field}"]`,
      );
      (cell?.tagName === 'INPUT' ? cell : cell?.querySelector<HTMLElement>('input'))?.focus();
    }, 0);
  const set = (i: number, patch: Partial<VoucherLineInput>) =>
    p.onChange(p.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  return (
    <div style={{ overflowX: 'auto', marginTop: 16 }}>
      <table
        ref={table}
        style={{
          width: widths.reduce((sum, width) => sum + width, 0),
          tableLayout: 'fixed',
          borderCollapse: 'collapse',
          minWidth: 1000,
        }}
        aria-label="分录网格"
      >
        <colgroup>
          {widths.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {['行', '摘要', '科目', '借方', '贷方', '辅助与明细'].map((title, index) => (
              <th
                key={title}
                style={{
                  textAlign: 'left',
                  padding: 8,
                  background: '#f0f5ff',
                  position: 'relative',
                }}
              >
                {title}
                <span
                  role="separator"
                  tabIndex={0}
                  aria-label={`调整${title}列宽`}
                  aria-orientation="vertical"
                  aria-valuenow={widths[index]}
                  aria-valuemin={minimumWidths[index]}
                  aria-valuemax={1600}
                  title="拖动或用左右箭头调整列宽，自动记住"
                  style={{
                    position: 'absolute',
                    inset: '0 0 0 auto',
                    width: 6,
                    cursor: 'col-resize',
                    background: '#d6e4ff',
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                      event.preventDefault();
                      resize(index, widths[index]! + (event.key === 'ArrowRight' ? 16 : -16));
                    }
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    dragCleanup.current?.();
                    const startX = event.clientX;
                    const width = widths[index]!;
                    const move = (e: PointerEvent) => resize(index, width + e.clientX - startX);
                    const finish = () => {
                      document.removeEventListener('pointermove', move);
                      document.removeEventListener('pointerup', finish);
                      dragCleanup.current = null;
                    };
                    dragCleanup.current = finish;
                    document.addEventListener('pointermove', move);
                    document.addEventListener('pointerup', finish);
                  }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.lines.map((l, i) => {
            const a = p.accounts.find((x) => x.id === l.accountId);
            const dims = a?.dimensions.filter((d) => d.type !== 'cashflow') ?? [];
            return (
              <tr
                key={i}
                data-line={i}
                style={{
                  background: p.active === i ? '#f6faff' : undefined,
                  borderBottom: '1px solid #e8e8e8',
                }}
                onFocusCapture={(e) =>
                  p.onActive(i, (e.target as HTMLElement).getAttribute('data-field') ?? undefined)
                }
              >
                <td style={{ padding: 6 }}>{i + 1}</td>
                <td style={{ padding: 6, minWidth: 180 }}>
                  <Input
                    aria-label={`第${i + 1}行摘要`}
                    data-field="summary"
                    value={l.summary}
                    disabled={p.readonly}
                    maxLength={200}
                    onChange={(e) => set(i, { summary: e.target.value })}
                  />
                  {p.active === i && (
                    <Space size={0} wrap>
                      <Button
                        size="small"
                        type="link"
                        disabled={p.readonly || i === 0}
                        onClick={() => set(i, { summary: p.lines[i - 1]?.summary ?? '' })}
                      >
                        复制上行摘要
                      </Button>
                      <Select
                        aria-label={`第${i + 1}行摘要库`}
                        size="small"
                        placeholder="摘要库"
                        style={{ width: 100 }}
                        disabled={p.readonly}
                        value={undefined}
                        options={p.summaries.map((s) => ({ value: s.text, label: s.text }))}
                        onChange={(v) => set(i, { summary: v })}
                      />
                    </Space>
                  )}
                </td>
                <td style={{ padding: 6, minWidth: 230 }}>
                  <AccountSelect
                    aria-label={`第${i + 1}行科目`}
                    data-field="accountId"
                    style={{ width: '100%' }}
                    value={l.accountId ?? undefined}
                    disabled={p.readonly || accountCatalog.loading}
                    notFoundContent="未搜索到可用末级科目，请更换编码、名称或拼音"
                    onChange={(id: number) => {
                      const account = p.accounts.find((x) => x.id === id);
                      const dimensions = Object.fromEntries(
                        (account?.dimensions ?? [])
                          .filter((d) => d.defaultItemId != null)
                          .map((d) => [d.type, d.defaultItemId]),
                      );
                      set(i, {
                        accountId: id,
                        dimensions,
                        currency: account?.currency ?? null,
                        exchangeRate: null,
                        fcAmount: null,
                        quantity: null,
                        unitPrice: null,
                      });
                      const required = account?.dimensions.find(
                        (d) => d.required && d.defaultItemId == null && d.type !== 'cashflow',
                      );
                      focusField(
                        i,
                        required?.type ?? (account?.cashflowRequired ? 'cashflow' : 'debit'),
                      );
                    }}
                  />
                  {a && (
                    <AccountContext
                      account={a}
                      date={p.date}
                      line={l}
                      readonly={p.readonly}
                      onRate={(rate) => set(i, { exchangeRate: rate })}
                    />
                  )}
                </td>
                <td style={{ padding: 6, minWidth: 140 }}>
                  <MoneyInput
                    aria-label={`第${i + 1}行借方`}
                    data-field="debit"
                    disabled={p.readonly}
                    value={l.debit}
                    onChange={(v) => set(i, { debit: v ?? 0 })}
                  />
                </td>
                <td style={{ padding: 6, minWidth: 140 }}>
                  <MoneyInput
                    aria-label={`第${i + 1}行贷方`}
                    data-field="credit"
                    disabled={p.readonly}
                    value={l.credit}
                    onChange={(v) => set(i, { credit: v ?? 0 })}
                  />
                </td>
                <td style={{ padding: 6, minWidth: 240 }}>
                  <Button
                    onClick={() => {
                      p.onActive(i);
                      p.onInfo();
                    }}
                  >
                    分录信息（F6）
                  </Button>
                  {dims.map((d) => (
                    <DimensionInput
                      key={d.type}
                      label={`第${i + 1}行${dimensionName(d.type)}`}
                      field={d.type}
                      items={p.items.filter((x) => x.typeId === d.type)}
                      value={l.dimensions?.[d.type]}
                      required={d.required}
                      disabled={p.readonly}
                      onChange={(id) => set(i, { dimensions: { ...l.dimensions, [d.type]: id } })}
                    />
                  ))}
                  {a?.cashflowRequired && (
                    <DimensionInput
                      label={`第${i + 1}行现金流量`}
                      field="cashflow"
                      items={p.items.filter((x) => x.typeId === 'cashflow')}
                      value={l.dimensions?.cashflow}
                      required
                      disabled={p.readonly}
                      onChange={(id) => set(i, { dimensions: { ...l.dimensions, cashflow: id } })}
                    />
                  )}
                  {dims.some((d) => d.defaultItemId != null) && (
                    <Typography.Text type="secondary">已带出科目默认辅助项，请核对</Typography.Text>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function AccountContext({
  account,
  date,
  line,
  readonly,
  onRate,
}: {
  account: Account;
  date: string;
  line: VoucherLineInput;
  readonly: boolean;
  onRate: (rate: string) => void;
}) {
  const q = useQuery({
    ...api.context.queryOptions({ accountId: account.id, date }),
    enabled: isEntryDate(date),
  });
  const side = balanceSide(q.data?.balance ?? 0, account.direction);
  let conversionProblem = '';
  if (
    account.currency &&
    line.fcAmount != null &&
    line.exchangeRate &&
    isDecimalString(line.exchangeRate) &&
    new Decimal(line.exchangeRate).gt(0)
  ) {
    try {
      const expected = foreignAmount(line.fcAmount, line.exchangeRate);
      const actual = line.credit ? line.credit : (line.debit ?? 0);
      if (expected !== actual)
        conversionProblem = `本币折算不一致：原币金额×汇率应为 ${formatMoney(expected)}，当前 ${formatMoney(actual)}；F6 核对后重新折算。正式保存会阻止。`;
    } catch {
      conversionProblem = '原币金额×汇率超出安全整数分范围，请核对；正式保存会阻止。';
    }
  }
  useEffect(() => {
    if (!readonly && account.currency && !line.exchangeRate && q.data?.rate) onRate(q.data.rate);
  }, [readonly, account.currency, line.exchangeRate, q.data?.rate, onRate]);
  return (
    <div style={{ fontSize: 12, color: '#666' }}>
      {q.data && (
        <span>
          余额 {q.data.period}（含未过账）{side.side} {formatMoney(side.amount)}
        </span>
      )}
      {account.currency &&
        !line.exchangeRate &&
        !readonly &&
        (q.data?.rate ? (
          <Button size="small" type="link" onClick={() => onRate(q.data!.rate!)}>
            带入期间汇率 {q.data.rate}
          </Button>
        ) : (
          <span style={{ color: '#c33' }}>该期间缺少汇率，请到外币档案设置</span>
        ))}
      {conversionProblem && (
        <div role="note" style={{ color: '#c33' }}>
          {conversionProblem}
        </div>
      )}
    </div>
  );
}
export function DimensionInput({
  label,
  field,
  items,
  value,
  required,
  disabled,
  onChange,
}: {
  label: string;
  field: string;
  items: DimensionItem[];
  value?: number | null;
  required?: boolean;
  disabled: boolean;
  onChange: (id: number | null) => void;
}) {
  return (
    <label style={{ display: 'block', marginTop: 4 }}>
      {label.replace(/^第\d+行/, '')}
      {required ? ' *' : ''}
      <Select
        aria-label={label}
        data-field={field}
        style={{ width: '100%' }}
        value={value ?? undefined}
        allowClear
        disabled={disabled}
        options={items.map((x) => ({
          value: x.id,
          label: `${x.code} ${x.name}${x.typeId === 'cashflow' ? `（${({ inflow: '流入', outflow: '流出', internal: '内部流动' } as Record<string, string>)[String(x.attrs.cashflowDirection)] ?? '方向未配置，无法核验'}）` : ''}${x.disabled || !x.isLeaf ? '（不可用）' : ''}`,
          disabled: x.disabled || !x.isLeaf,
          search: `${x.code} ${x.name} ${x.pinyin}`,
        }))}
        showSearch={{
          filterOption: (input, option) =>
            (option?.search ?? '').toLowerCase().includes(input.toLowerCase()),
        }}
        notFoundContent="没有可用辅助项，请到基础档案维护"
        onChange={(v) => onChange(v ?? null)}
      />
    </label>
  );
}
export function LineDetails({
  line,
  index,
  accounts,
  items,
  methods,
  readonly,
  onChange,
}: {
  line: VoucherLineInput;
  index: number;
  accounts: Account[];
  items: DimensionItem[];
  methods: Props['methods'];
  readonly: boolean;
  onChange: (patch: Partial<VoucherLineInput>) => void;
}) {
  const a = accounts.find((x) => x.id === line.accountId);
  const [calculationError, setCalculationError] = useState('');
  const unsupportedDimensions = Object.entries(line.dimensions ?? {}).filter(
    ([type, value]) =>
      value != null &&
      (type === 'cashflow' ? !a?.cashflowRequired : !a?.dimensions.some((d) => d.type === type)),
  );
  const obsoleteCurrency =
    !a?.currency &&
    ((!!line.currency && line.currency !== 'CNY') || line.exchangeRate != null || !!line.fcAmount);
  const obsoleteQuantity =
    !a?.quantityUnit &&
    [line.quantity, line.unitPrice].some(
      (value) =>
        value != null && value !== '' && (!isDecimalString(value) || !new Decimal(value).isZero()),
    );
  const update = (patch: Partial<VoucherLineInput>) => {
    const next = { ...line, ...patch };
    let amount: number | null = null;
    setCalculationError('');
    try {
      if (
        a?.quantityUnit &&
        ('quantity' in patch || 'unitPrice' in patch) &&
        next.quantity &&
        next.unitPrice &&
        isDecimalString(next.quantity) &&
        isDecimalString(next.unitPrice)
      )
        amount = quantityAmount(next.quantity, next.unitPrice);
      if (
        a?.currency &&
        ('fcAmount' in patch || 'exchangeRate' in patch) &&
        next.fcAmount != null &&
        next.exchangeRate &&
        isDecimalString(next.exchangeRate)
      )
        amount = foreignAmount(next.fcAmount, next.exchangeRate);
    } catch {
      setCalculationError('数值超出精确计算范围，请核对数量、单价或汇率');
    }
    onChange(
      amount == null
        ? patch
        : {
            ...patch,
            ...(line.credit || line.entrySide === 'credit'
              ? { credit: amount }
              : { debit: amount }),
          },
    );
  };
  const hierarchy: Account[] = [];
  let current = a;
  while (current) {
    hierarchy.unshift(current);
    current = accounts.find((x) => x.id === current?.parentId);
  }
  const textField = (
    name: string,
    field: 'exchangeRate' | 'quantity' | 'unitPrice' | 'refNo' | 'bizDate',
  ) => (
    <label style={{ display: 'block', marginTop: 10 }}>
      {name}
      <Input
        aria-label={`第${index + 1}行${name}`}
        data-field={field}
        value={line[field] ?? ''}
        disabled={readonly}
        onChange={(e) => update({ [field]: e.target.value || null })}
      />
    </label>
  );
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      {calculationError && <Typography.Text type="danger">{calculationError}</Typography.Text>}
      {!(line.debit || line.credit) && (a?.currency || a?.quantityUnit) && (
        <label>
          借贷方向
          <Select
            aria-label={`第${index + 1}行借贷方向`}
            data-field="entrySide"
            disabled={readonly}
            value={line.entrySide ?? undefined}
            placeholder="请选择借方或贷方"
            style={{ width: 160 }}
            options={[
              { value: 'debit', label: '借方' },
              { value: 'credit', label: '贷方' },
            ]}
            onChange={(entrySide) => update({ entrySide })}
          />
        </label>
      )}
      {!!(unsupportedDimensions.length || obsoleteCurrency || obsoleteQuantity) && (
        <>
          <Typography.Text type="danger">
            存在当前科目未启用的信息，正式保存会阻止：
            {unsupportedDimensions
              .map(([type]) => dimensionName(type as DimensionTypeId))
              .join('、')}
            {obsoleteCurrency ? ' 外币/汇率/原币' : ''}
            {obsoleteQuantity ? ' 数量/单价' : ''}
          </Typography.Text>
          <Button
            danger
            disabled={readonly}
            onClick={() =>
              onChange({
                dimensions: Object.fromEntries(
                  Object.entries(line.dimensions ?? {}).filter(
                    ([type]) => !unsupportedDimensions.some(([invalid]) => invalid === type),
                  ),
                ),
                ...(obsoleteCurrency ? { currency: null, fcAmount: null, exchangeRate: null } : {}),
                ...(obsoleteQuantity ? { quantity: null, unitPrice: null } : {}),
              })
            }
          >
            清除当前科目未启用的信息
          </Button>
        </>
      )}
      <p>
        摘要：{line.summary || '未填写'}
        <br />
        科目层级：{hierarchy.map((x) => `${x.code} ${x.name}`).join(' → ') || '未选择'}
      </p>
      {Object.entries(line.dimensions ?? {})
        .filter(([, id]) => id != null)
        .map(([type, id]) => {
          const item = items.find((x) => x.id === id);
          return (
            <div key={type}>
              {dimensionName(type as DimensionTypeId)}：
              {item ? `${item.code} ${item.name}` : `已失效（${id}）`}
            </div>
          );
        })}
      {a?.cashflowRequired && (
        <Typography.Text type="warning">
          {['inflow', 'outflow', 'internal'].includes(
            String(items.find((x) => x.id === line.dimensions?.cashflow)?.attrs.cashflowDirection),
          )
            ? '现金流量方向已配置，保存时核验'
            : '方向未配置，无法核验；请配置现金流量档案'}
        </Typography.Text>
      )}
      <label>
        币种
        <Input aria-label={`第${index + 1}行币种`} value={line.currency ?? 'CNY'} disabled />
      </label>
      {a?.currency && (
        <>
          <div style={{ color: '#666' }}>
            本位币须等于原币金额×汇率，四舍五入到分。手动修改本位币后仍会核验，不能用借贷找平替代折算。
          </div>
          {textField('汇率', 'exchangeRate')}
          <label>
            原币金额
            <MoneyInput
              aria-label={`第${index + 1}行原币金额`}
              data-field="fcAmount"
              value={line.fcAmount}
              disabled={readonly}
              onChange={(v) => update({ fcAmount: v })}
            />
          </label>
          <Button
            disabled={readonly || line.fcAmount == null || !line.exchangeRate}
            onClick={() => {
              if (line.exchangeRate) update({ exchangeRate: line.exchangeRate });
            }}
          >
            原币×汇率折算（四舍五入到分）
          </Button>
        </>
      )}
      {a?.quantityUnit && (
        <>
          {textField(`数量（${a.quantityUnit}）`, 'quantity')}
          {textField('单价', 'unitPrice')}
          <Button
            disabled={readonly || !line.quantity || !line.unitPrice}
            onClick={() => {
              if (line.unitPrice) update({ unitPrice: line.unitPrice });
            }}
          >
            数量×单价计算（数量六位小数，金额舍入到分）
          </Button>
        </>
      )}
      <label>
        结算类别
        <Select
          aria-label={`第${index + 1}行结算类别`}
          style={{ width: '100%' }}
          value={line.settlementMethodId ?? undefined}
          allowClear
          disabled={readonly}
          options={methods.map((m) => ({
            value: m.id,
            label: `${m.code} ${m.name}`,
            disabled: m.disabled,
          }))}
          onChange={(v) => onChange({ settlementMethodId: v ?? null })}
        />
      </label>
      {textField('票号', 'refNo')}
      {textField('业务日期', 'bizDate')}
    </Space>
  );
}
