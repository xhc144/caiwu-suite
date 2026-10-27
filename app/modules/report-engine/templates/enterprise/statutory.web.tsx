import { useState } from 'react';
import { Alert, Button, Checkbox, Input, InputNumber, Select, Space, Tabs } from 'antd';
import Decimal from 'decimal.js';
import { ASSETS, LIABILITIES_EQUITY, PROFIT, CASHFLOW } from './lines';
import { EQUITY, EQUITY_LABELS } from './equity-lines';
import { NET_ROLES, enterpriseRanges } from './calculate';
import {
  parseEnterpriseConfiguration,
  EQUITY_COLUMNS,
  balanceBucket,
  type EnterpriseConfig,
  type SourceData,
} from './model';
import { suggestEnterpriseRules, suggestEnterpriseCashAllocations } from './mapping';
import { enterprisePages, displayEnterpriseCell } from './output';
import { FactSegments, AdditionalEnterpriseConfiguration } from './configuration-extra.web';
import type { EnterpriseResult } from './model';
const inputStyle = { minWidth: 160 };
const kinds = [
  ['balance', '直接余额'],
  ['receivable', '应收及税费分析'],
  ['payable', '采购往来分析'],
  ['contract', '同一合同净额'],
  ['financial', '金融资产分类'],
  ['maturity', '期限及营业周期'],
  ['contractCost', '合同成本'],
  ['return', '退货资产或负债'],
  ['equityInstrument', '发行金融工具'],
  ['pnl', '损益发生额'],
  ['oci', '其他综合收益'],
  ['currentProfit', '本年利润'],
] as const;
const roles = [
  ['gross', '账面余额'],
  ['allowance', '减值备抵'],
  ['depreciation', '累计折旧或折耗'],
  ['amortization', '累计摊销'],
  ['clearing', '清理余额'],
  ['financing', '未确认融资费用'],
  ['special', '专项应付款'],
] as const;
const options = (items: readonly (readonly [string, string])[]) =>
  items.map(([value, label]) => ({ value, label }));
function Amount({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange(v: string): void;
  label: string;
}) {
  return (
    <InputNumber<string>
      aria-label={label}
      stringMode
      value={new Decimal(value).div(100).toFixed(2)}
      onChange={(v) => {
        if (v !== null && new Decimal(v).times(100).isInteger())
          onChange(new Decimal(v).times(100).toFixed());
      }}
      precision={2}
    />
  );
}
function Provenance({
  value,
  onChange,
}: {
  value: { source: string; version: string };
  onChange(v: { source: string; version: string }): void;
}) {
  return (
    <Space wrap>
      <Input
        aria-label="依据来源"
        placeholder="合同、会计政策或核实记录"
        value={value.source}
        style={{ width: 280 }}
        onChange={(e) => onChange({ ...value, source: e.target.value })}
      />
      <Input
        aria-label="依据版本"
        placeholder="版本"
        value={value.version}
        style={{ width: 90 }}
        onChange={(e) => onChange({ ...value, version: e.target.value })}
      />
    </Space>
  );
}
const sourceEmpty = { source: '', version: '1' };
/** 公共页面提供读取、保存及事务绑定回调；本组件不新建路由或第二套配置存储。 */
export function EnterpriseConfiguration({
  initial,
  source,
  onSave,
  onPeriodChange,
}: {
  initial: EnterpriseConfig;
  source: SourceData;
  onSave(c: EnterpriseConfig): Promise<void>;
  onPeriodChange?(period: number, scope: EnterpriseConfig['scope']): void;
}) {
  const [c, set] = useState(initial),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const change = <K extends keyof EnterpriseConfig>(key: K, value: EnterpriseConfig[K]) =>
    set((old) => ({ ...old, [key]: value }));
  const accountOptions = source.accounts
    .filter((a) => a.isLeaf)
    .map((a) => ({ value: a.id, label: `${a.code} ${a.fullName}` }));
  let dates: number[] = [];
  try {
    const r = enterpriseRanges(c);
    dates = [
      ...new Set([
        c.period,
        r.balancePrevious,
        r.current.from,
        r.previous.from,
        r.previous.to,
        ...(c.scope === 'annual' ? [Math.floor(c.period / 100) * 100 - 188] : []),
      ]),
    ];
  } catch {
    /* 年报月份由保存校验显示。 */
  }
  const factItems = dates.flatMap((period) =>
    (source.balances[period] ?? []).flatMap((row) => {
      const rule = c.rules.find((r) => r.accountId === row.accountId);
      if (
        !rule ||
        (['balance', 'pnl', 'oci', 'currentProfit'].includes(rule.kind) &&
          rule.line !== 'investmentProperty')
      )
        return [];
      const bases = [
        'closing',
        ...(c.scope === 'annual' && period % 100 === 1 ? ['opening'] : []),
      ] as ('opening' | 'closing')[];
      return bases.map((basis) => ({ period, row, rule, basis }));
    }),
  );
  const lineOptions = [...ASSETS, ...LIABILITIES_EQUITY, ...PROFIT]
    .filter((l) => !l.total && !l.section)
    .map((l) => ({ value: l.key, label: l.label }));
  const patchFact = (
    period: number,
    bucket: string,
    basis: 'opening' | 'closing',
    patch: Partial<EnterpriseConfig['facts'][number]>,
  ) => {
    const existing = c.facts.find(
        (f) => f.period === period && f.bucket === bucket && f.basis === basis,
      ),
      next = { period, bucket, basis, ...sourceEmpty, ...existing, ...patch };
    change('facts', [
      ...c.facts.filter((f) => !(f.period === period && f.bucket === bucket && f.basis === basis)),
      next,
    ]);
  };
  const cashEntries = source.entries.filter(
    (e) =>
      source.accounts.some((a) => a.id === e.accountId && (a.isCash || a.isBank)) ||
      c.cashPolicies.some((p) => [...p.accounts, ...p.restrictedAccounts].includes(e.accountId)),
  );
  const equityEntries = source.entries.filter(
    (e) =>
      c.rules.some(
        (r) =>
          r.accountId === e.accountId &&
          (r.kind === 'equityInstrument' ||
            [
              'capital',
              'capitalReserve',
              'treasuryStock',
              'otherComprehensive',
              'specialReserve',
              'surplusReserve',
              'retainedEarnings',
            ].includes(r.line)),
      ) && !source.vouchers.some((v) => v.id === e.voucherId && v.closingKind === 'pnl'),
  );
  const save = async () => {
    setError('');
    setSaving(true);
    try {
      await onSave(parseEnterpriseConfiguration(c));
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请核实必填项目');
    } finally {
      setSaving(false);
    }
  };
  const sourceLink = (id: number) => `/m/voucher-entry/edit?id=${id}`;
  return (
    <div style={{ maxWidth: '100%' }}>
      <Space wrap style={{ marginBottom: 12 }}>
        <label>
          报告期间{' '}
          <Select
            aria-label="报告期间"
            value={c.period}
            options={source.periods.map((p) => ({ value: p, label: String(p) }))}
            onChange={(p) => {
              change('period', p);
              onPeriodChange?.(p, c.scope);
            }}
          />
        </label>
        <label>
          比较口径{' '}
          <Select
            aria-label="比较口径"
            value={c.scope}
            options={options([
              ['month', '本月及上年同月'],
              ['yearToDate', '年初至今及上年同期'],
              ['annual', '完整年度及上年度'],
            ])}
            onChange={(scope) => {
              change('scope', scope);
              onPeriodChange?.(c.period, scope);
            }}
          />
        </label>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存并确认来源
        </Button>
      </Space>
      {error && <Alert type="error" showIcon title={error} />}
      <Alert
        type="info"
        title="期间或来源变化后需重新确认；正式报表仅取已过账数据。资产负债表比较日为上年12月，流量表按所选同期范围。"
      />
      <Tabs
        items={[
          {
            key: 'policy',
            label: '适用政策',
            children: (
              <Space orientation="vertical">
                <label>
                  主体类别{' '}
                  <Select
                    aria-label="主体类别"
                    style={{ width: 300 }}
                    value={c.adoption.entityClass}
                    options={options([
                      ['dualListed', '境内外同时上市'],
                      ['overseasListed', '境外上市（国际或企业准则）'],
                      ['domesticListed', '其他境内上市'],
                      ['unlisted', '执行企业准则的非上市企业'],
                    ])}
                    onChange={(entityClass) => change('adoption', { ...c.adoption, entityClass })}
                  />
                </label>
                {(['financial', 'revenue', 'lease', 'cas30_2026'] as const).map((k, i) => (
                  <label key={k}>
                    {
                      [
                        '新金融准则采用日',
                        '新收入准则采用日',
                        '新租赁准则采用日',
                        '2026列报准则提前采用日',
                      ][i]
                    }{' '}
                    <Input
                      type="date"
                      aria-label={
                        [
                          '新金融准则采用日',
                          '新收入准则采用日',
                          '新租赁准则采用日',
                          '2026列报准则提前采用日',
                        ][i]
                      }
                      value={c.adoption[k] ?? ''}
                      onChange={(e) =>
                        change('adoption', { ...c.adoption, [k]: e.target.value || null })
                      }
                    />
                  </label>
                ))}
                <p>
                  2026列报准则分阶段强制执行：2027／2029／2030年。本格式为2019附件2，完整财务报告还需附注。
                </p>
                <Provenance
                  value={c.adoption}
                  onChange={(v) => change('adoption', { ...c.adoption, ...v })}
                />
              </Space>
            ),
          },
          {
            key: 'accounts',
            label: '科目匹配',
            children: (
              <>
                <Button
                  onClick={() => {
                    const next = suggestEnterpriseRules(source.accounts);
                    change('rules', next.suggestions);
                    setError(
                      next.unmatched.length
                        ? `仍需核实：${next.unmatched.map((a) => a.name).join('、')}`
                        : '',
                    );
                  }}
                >
                  按标准科目名称匹配
                </Button>
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>实际科目</th>
                        <th>列报项目</th>
                        <th>取数方法</th>
                        <th>组成角色</th>
                      </tr>
                    </thead>
                    <tbody>
                      {source.accounts
                        .filter((a) => a.isLeaf)
                        .map((a) => {
                          const r = c.rules.find((r) => r.accountId === a.id);
                          const patch = (p: Partial<EnterpriseConfig['rules'][number]>) =>
                            change('rules', [
                              ...c.rules.filter((x) => x.accountId !== a.id),
                              {
                                accountId: a.id,
                                line: '',
                                kind: 'balance',
                                role: 'gross',
                                ...r,
                                ...p,
                              },
                            ]);
                          return (
                            <tr key={a.id}>
                              <td>
                                {a.code} {a.fullName}
                              </td>
                              <td>
                                <Select
                                  aria-label={`${a.code}列报项目`}
                                  style={{ width: 260 }}
                                  value={r?.line}
                                  options={[
                                    ...lineOptions,
                                    ...options([
                                      ['contractAcquisition', '合同取得成本'],
                                      ['contractFulfilment', '合同履约成本'],
                                      ['returnAsset', '应收退货成本'],
                                      ['returnLiability', '应付退货款'],
                                    ]),
                                  ]}
                                  showSearch={{ optionFilterProp: 'label' }}
                                  onChange={(line) => patch({ line })}
                                />
                              </td>
                              <td>
                                <Select
                                  aria-label={`${a.code}取数方法`}
                                  style={inputStyle}
                                  value={r?.kind}
                                  options={options(kinds)}
                                  onChange={(kind) => patch({ kind })}
                                />
                              </td>
                              <td>
                                <Select
                                  aria-label={`${a.code}组成角色`}
                                  style={inputStyle}
                                  value={r?.role}
                                  options={options(roles)}
                                  onChange={(role) => patch({ role })}
                                />
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </>
            ),
          },
          {
            key: 'facts',
            label: '合同、期限及工具',
            children: (
              <Space orientation="vertical" style={{ width: '100%' }}>
                {factItems.map(({ period, row, rule, basis }) => {
                  const targets = (source.balances[period] ?? []).flatMap((x) => {
                    const item = c.facts.find(
                      (f) =>
                        f.period === period && f.basis === basis && f.bucket === balanceBucket(x),
                    );
                    return item?.segments?.length
                      ? item.segments.map((part) => ({
                          value: balanceBucket(x) + '#' + part.key,
                          label: `${x.accountCode} ${x.accountName} · ${part.key}`,
                        }))
                      : [
                          {
                            value: balanceBucket(x),
                            label: `${x.accountCode} ${x.accountName} · 往来${x.dimensions.partner ?? '无'} 项目${x.dimensions.project ?? '无'}`,
                          },
                        ];
                  });
                  const bucket = balanceBucket(row),
                    f = c.facts.find(
                      (f) => f.period === period && f.bucket === bucket && f.basis === basis,
                    ),
                    patch = (p: Partial<EnterpriseConfig['facts'][number]>) =>
                      patchFact(period, bucket, basis, p);
                  return (
                    <fieldset
                      key={`${period}:${basis}:${bucket}`}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    >
                      <legend>
                        {period} {basis === 'opening' ? '期初' : '期末'} · {row.accountCode}{' '}
                        {row.accountName} · 往来{row.dimensions.partner ?? '无'} 项目
                        {row.dimensions.project ?? '无'}
                      </legend>
                      <Space wrap>
                        <Checkbox
                          checked={f?.current ?? false}
                          onChange={(e) => patch({ current: e.target.checked })}
                        >
                          一年或正常营业周期内变现／清偿
                        </Checkbox>
                        <Input
                          aria-label="合同编号"
                          placeholder="同一合同编号"
                          value={f?.contractId ?? ''}
                          onChange={(e) => patch({ contractId: e.target.value })}
                        />
                        <InputNumber
                          aria-label="到期期间"
                          placeholder="到期期间"
                          value={f?.duePeriod}
                          onChange={(v) => {
                            if (v) patch({ duePeriod: v });
                          }}
                        />
                        <InputNumber
                          aria-label="初始摊销月数"
                          placeholder="初始摊销月数"
                          value={f?.initialTermMonths}
                          onChange={(v) => {
                            if (v) patch({ initialTermMonths: v });
                          }}
                        />
                        <InputNumber
                          aria-label="正常营业周期月数"
                          placeholder="正常营业周期月数"
                          value={f?.normalCycleMonths}
                          onChange={(v) => {
                            if (v) patch({ normalCycleMonths: v });
                          }}
                        />
                        <Select
                          aria-label="金融资产计量类别"
                          placeholder="金融资产计量类别"
                          style={{ width: 240 }}
                          value={f?.category}
                          options={options([
                            ['amortized', '摊余成本'],
                            ['fvoci', '债务工具公允价值计入其他综合收益'],
                            ['fvtpl', '公允价值计入当期损益'],
                            ['equity-fvoci', '指定权益工具计入其他综合收益'],
                          ])}
                          onChange={(category) => patch({ category })}
                        />
                        <InputNumber
                          aria-label="预期持有月数"
                          placeholder="预期持有月数"
                          value={f?.expectedHoldMonths}
                          onChange={(v) => {
                            if (v !== null) patch({ expectedHoldMonths: v });
                          }}
                        />
                        <Checkbox
                          checked={f?.originallyLongTerm ?? false}
                          onChange={(e) => patch({ originallyLongTerm: e.target.checked })}
                        >
                          初始属于长期投资
                        </Checkbox>
                        <Select
                          aria-label="房地产计量模式"
                          style={inputStyle}
                          placeholder="房地产计量模式"
                          value={f?.measurementModel}
                          options={options([
                            ['cost', '成本模式'],
                            ['fairValue', '公允价值模式'],
                          ])}
                          onChange={(measurementModel) => patch({ measurementModel })}
                        />
                        {rule.role === 'allowance' && (
                          <Select
                            aria-label="对应减值明细"
                            placeholder="对应减值明细"
                            style={{ width: 300 }}
                            value={f?.allowanceFor}
                            options={(source.balances[period] ?? [])
                              .filter((x) => x.closing > 0)
                              .map((x) => ({
                                value: balanceBucket(x),
                                label: `${x.accountCode} 往来${x.dimensions.partner ?? '无'} 项目${x.dimensions.project ?? '无'}`,
                              }))}
                            onChange={(allowanceFor) => patch({ allowanceFor })}
                          />
                        )}
                      </Space>
                      <Provenance value={f ?? sourceEmpty} onChange={patch} />
                      <FactSegments
                        fact={f ?? { period, bucket, basis, ...sourceEmpty }}
                        targets={targets}
                        onChange={patch}
                      />
                      {rule.kind === 'equityInstrument' && (
                        <>
                          <Button
                            onClick={() =>
                              patch({
                                parts: [
                                  ...(f?.parts ?? []),
                                  {
                                    id: '',
                                    amount: '0',
                                    classification: 'equity',
                                    instrument: 'other',
                                    ...sourceEmpty,
                                  },
                                ],
                              })
                            }
                          >
                            增加工具分项
                          </Button>
                          {f?.parts?.map((part, i) => (
                            <Space wrap key={i}>
                              <Input
                                aria-label="工具编号"
                                placeholder="工具编号"
                                value={part.id}
                                onChange={(e) =>
                                  patch({
                                    parts: f.parts!.map((x, j) =>
                                      j === i ? { ...x, id: e.target.value } : x,
                                    ),
                                  })
                                }
                              />
                              <Select
                                aria-label="工具性质"
                                value={part.instrument}
                                options={options([
                                  ['ordinary', '普通股'],
                                  ['preferred', '优先股'],
                                  ['perpetual', '永续债'],
                                  ['other', '其他工具'],
                                ])}
                                onChange={(instrument) =>
                                  patch({
                                    parts: f.parts!.map((x, j) =>
                                      j === i ? { ...x, instrument } : x,
                                    ),
                                  })
                                }
                              />
                              <Select
                                aria-label="权益或负债"
                                value={part.classification}
                                options={options([
                                  ['equity', '权益'],
                                  ['liability', '负债'],
                                ])}
                                onChange={(classification) =>
                                  patch({
                                    parts: f.parts!.map((x, j) =>
                                      j === i ? { ...x, classification } : x,
                                    ),
                                  })
                                }
                              />
                              <InputNumber
                                aria-label="工具到期期间"
                                placeholder="负债工具到期期间"
                                value={part.duePeriod}
                                onChange={(v) => {
                                  if (v)
                                    patch({
                                      parts: f.parts!.map((x, j) =>
                                        j === i ? { ...x, duePeriod: v } : x,
                                      ),
                                    });
                                }}
                              />
                              <Select
                                aria-label="工具流动性"
                                placeholder="工具流动性"
                                value={part.current}
                                options={[
                                  { value: true, label: '流动' },
                                  { value: false, label: '非流动' },
                                ]}
                                onChange={(current) =>
                                  patch({
                                    parts: f.parts!.map((x, j) =>
                                      j === i ? { ...x, current } : x,
                                    ),
                                  })
                                }
                              />
                              <Amount
                                label="工具借方为正贷方为负金额"
                                value={part.amount}
                                onChange={(amount) =>
                                  patch({
                                    parts: f.parts!.map((x, j) => (j === i ? { ...x, amount } : x)),
                                  })
                                }
                              />
                              <Provenance
                                value={part}
                                onChange={(v) =>
                                  patch({
                                    parts: f.parts!.map((x, j) => (j === i ? { ...x, ...v } : x)),
                                  })
                                }
                              />
                              <Button
                                onClick={() => patch({ parts: f.parts!.filter((_, j) => i !== j) })}
                              >
                                移除此分项
                              </Button>
                            </Space>
                          ))}
                        </>
                      )}
                    </fieldset>
                  );
                })}
              </Space>
            ),
          },
          {
            key: 'roles',
            label: '备抵及不适用依据',
            children: (
              <Space orientation="vertical">
                {dates.flatMap((period) =>
                  Object.entries(NET_ROLES)
                    .filter(([line]) => c.rules.some((r) => r.line === line && r.role === 'gross'))
                    .flatMap(([line, rs]) =>
                      rs
                        .filter((role) => !c.rules.some((r) => r.line === line && r.role === role))
                        .map((role) => {
                          const existing = c.absentRoles.find(
                            (x) => x.period === period && x.line === line && x.role === role,
                          );
                          return (
                            <div key={`${period}:${line}:${role}`}>
                              {period}{' '}
                              {[...ASSETS, ...LIABILITIES_EQUITY].find((l) => l.key === line)
                                ?.label ?? line}{' '}
                              · {roles.find((x) => x[0] === role)?.[1] ?? role}
                              <Provenance
                                value={existing ?? sourceEmpty}
                                onChange={(v) =>
                                  change('absentRoles', [
                                    ...c.absentRoles.filter(
                                      (x) =>
                                        !(
                                          x.period === period &&
                                          x.line === line &&
                                          x.role === role
                                        ),
                                    ),
                                    { period, line, role, ...v },
                                  ])
                                }
                              />
                            </div>
                          );
                        }),
                    ),
                )}
              </Space>
            ),
          },
          {
            key: 'cash',
            label: '现金范围与逐笔分配',
            children: (
              <Space orientation="vertical" style={{ width: '100%' }}>
                <Button
                  onClick={() => {
                    const suggested = suggestEnterpriseCashAllocations(source);
                    const ids = new Set(suggested.map((x) => x.lineId));
                    change('cashAllocations', [
                      ...c.cashAllocations.filter((x) => !ids.has(x.lineId)),
                      ...suggested,
                    ]);
                  }}
                >
                  按账务现金项目匹配
                </Button>
                {dates.flatMap((period) =>
                  (['opening', 'closing'] as const).map((basis) => {
                    const policy = c.cashPolicies.find(
                      (p) => p.period === period && p.basis === basis,
                    );
                    const patch = (v: Partial<EnterpriseConfig['cashPolicies'][number]>) =>
                      change('cashPolicies', [
                        ...c.cashPolicies.filter(
                          (p) => !(p.period === period && p.basis === basis),
                        ),
                        {
                          period,
                          basis,
                          accounts: [],
                          restrictedAccounts: [],
                          ...sourceEmpty,
                          ...policy,
                          ...v,
                        },
                      ]);
                    return (
                      <fieldset key={`${period}:${basis}`}>
                        <legend>
                          {period} {basis === 'opening' ? '期初' : '期末'}现金范围
                        </legend>
                        <Select
                          aria-label={`${period}${basis === 'opening' ? '期初' : '期末'}现金及等价物`}
                          mode="multiple"
                          style={{ width: 420 }}
                          placeholder="现金及现金等价物"
                          value={policy?.accounts ?? []}
                          options={accountOptions}
                          onChange={(accounts) => patch({ accounts })}
                        />
                        <Select
                          aria-label={`${period}受限资金`}
                          mode="multiple"
                          style={{ width: 420 }}
                          placeholder="受限资金／不在现金范围"
                          value={policy?.restrictedAccounts ?? []}
                          options={accountOptions}
                          onChange={(restrictedAccounts) => patch({ restrictedAccounts })}
                        />
                        <Provenance value={policy ?? sourceEmpty} onChange={patch} />
                      </fieldset>
                    );
                  }),
                )}
                {cashEntries.map((e) => {
                  const allocation = c.cashAllocations.find((a) => a.lineId === e.lineId),
                    patch = (v: Partial<EnterpriseConfig['cashAllocations'][number]>) =>
                      change('cashAllocations', [
                        ...c.cashAllocations.filter((a) => a.lineId !== e.lineId),
                        { lineId: e.lineId, parts: [], ...sourceEmpty, ...allocation, ...v },
                      ]);
                  return (
                    <fieldset key={e.lineId}>
                      <legend>
                        <a href={sourceLink(e.voucherId)}>
                          {e.date} {e.displayNo} 第{e.lineNo}行
                        </a>{' '}
                        {e.summary}
                      </legend>
                      <Button
                        onClick={() =>
                          patch({
                            parts: [...(allocation?.parts ?? []), { line: '', amount: '0' }],
                          })
                        }
                      >
                        增加分配
                      </Button>
                      {allocation?.parts.map((p, i) => (
                        <Space key={i} wrap>
                          <Select
                            aria-label="现金流量项目"
                            style={{ width: 380 }}
                            value={p.line}
                            options={[
                              ...CASHFLOW.filter(
                                (l) => !l.section && !l.total && !['cashOpening'].includes(l.key),
                              ).map((l) => ({ value: l.key, label: l.label })),
                              ...options([
                                ['internal', '现金范围内划转抵销'],
                                ['excluded', '受限或非现金排除'],
                              ]),
                            ]}
                            onChange={(line) =>
                              patch({
                                parts: allocation.parts.map((x, j) =>
                                  i === j ? { ...x, line } : x,
                                ),
                              })
                            }
                          />
                          <Amount
                            label="现金分配金额（收入为正、支付为负）"
                            value={p.amount}
                            onChange={(amount) =>
                              patch({
                                parts: allocation.parts.map((x, j) =>
                                  i === j ? { ...x, amount } : x,
                                ),
                              })
                            }
                          />
                          <Button
                            onClick={() =>
                              patch({ parts: allocation.parts.filter((_, j) => i !== j) })
                            }
                          >
                            移除分配
                          </Button>
                        </Space>
                      ))}
                      <Provenance value={allocation ?? sourceEmpty} onChange={patch} />
                    </fieldset>
                  );
                })}
              </Space>
            ),
          },
          {
            key: 'equity',
            label: '权益变动分类',
            children: (
              <Space orientation="vertical">
                {equityEntries.map((e) => {
                  const event = c.equityEvents.find((x) => x.lineId === e.lineId),
                    patch = (v: Partial<EnterpriseConfig['equityEvents'][number]>) =>
                      change('equityEvents', [
                        ...c.equityEvents.filter((x) => x.lineId !== e.lineId),
                        {
                          lineId: e.lineId,
                          row: 'otherContributions',
                          liabilityAmount: '0',
                          parts: [],
                          ...sourceEmpty,
                          ...event,
                          ...v,
                        },
                      ]);
                  return (
                    <fieldset key={e.lineId}>
                      <legend>
                        <a href={sourceLink(e.voucherId)}>
                          {e.date} {e.displayNo} 第{e.lineNo}行
                        </a>
                      </legend>
                      <Select
                        aria-label="权益变动事项"
                        style={{ width: 350 }}
                        value={event?.row}
                        options={EQUITY.filter((l) =>
                          [
                            'ordinaryContributions',
                            'instrumentContributions',
                            'sharePayments',
                            'otherContributions',
                            'surplusAppropriation',
                            'distributions',
                            'otherDistribution',
                            'capitalizationReserve',
                            'capitalizationSurplus',
                            'lossRecovery',
                            'benefitTransfer',
                            'ociTransfer',
                            'otherTransfer',
                          ].includes(l.key),
                        ).map((l) => ({ value: l.key, label: l.label }))}
                        onChange={(row) =>
                          patch({ row: row as EnterpriseConfig['equityEvents'][number]['row'] })
                        }
                      />
                      <Amount
                        label="本分录归属负债部分（增加为正）"
                        value={event?.liabilityAmount ?? '0'}
                        onChange={(liabilityAmount) => patch({ liabilityAmount })}
                      />
                      <Button
                        onClick={() =>
                          patch({
                            parts: [...(event?.parts ?? []), { column: 'capital', amount: '0' }],
                          })
                        }
                      >
                        增加权益列分项
                      </Button>
                      {event?.parts.map((part, i) => (
                        <Space key={i} wrap>
                          <Select
                            aria-label="权益列"
                            value={part.column}
                            style={{ width: 230 }}
                            options={EQUITY_COLUMNS.map((value, j) => ({
                              value,
                              label: EQUITY_LABELS[j],
                            }))}
                            onChange={(column) =>
                              patch({
                                parts: event.parts.map((x, j) => (j === i ? { ...x, column } : x)),
                              })
                            }
                          />
                          <Amount
                            label="权益增加为正、减少为负"
                            value={part.amount}
                            onChange={(amount) =>
                              patch({
                                parts: event.parts.map((x, j) => (j === i ? { ...x, amount } : x)),
                              })
                            }
                          />
                          <Input
                            aria-label="对应金融工具编号"
                            placeholder="对应金融工具编号"
                            value={part.instrumentId ?? ''}
                            onChange={(e) =>
                              patch({
                                parts: event.parts.map((x, j) =>
                                  j === i ? { ...x, instrumentId: e.target.value } : x,
                                ),
                              })
                            }
                          />
                          <Button
                            onClick={() => patch({ parts: event.parts.filter((_, j) => i !== j) })}
                          >
                            移除此分项
                          </Button>
                        </Space>
                      ))}
                      <Provenance value={event ?? sourceEmpty} onChange={patch} />
                    </fieldset>
                  );
                })}
              </Space>
            ),
          },
          {
            key: 'additional',
            label: '其他综合收益、股份及调整',
            children: <AdditionalEnterpriseConfiguration c={c} source={source} onChange={set} />,
          },
        ]}
      />
    </div>
  );
}
export function EnterpriseStatements({ result }: { result: EnterpriseResult }) {
  return (
    <div>
      {result.checks
        .filter((c) => c.difference !== '0')
        .map((c, i) => (
          <Alert
            key={i}
            type="error"
            title={`${c.period} ${c.row} 差额${new Decimal(c.difference).div(100).toFixed(2)}元`}
            description={c.hint}
          />
        ))}
      {enterprisePages(result).map((p, i) => (
        <section key={i}>
          <h2>{p.title}</h2>
          <p>
            {p.orgName} {p.period} 单位：元
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {p.headers.map((h, j) => (
                    <th key={j}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((c, k) => (
                      <td
                        key={k}
                        style={{
                          textAlign: c.amount ? 'right' : 'left',
                          fontWeight: c.bold ? 'bold' : 'normal',
                          padding: 6,
                        }}
                      >
                        {displayEnterpriseCell(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
