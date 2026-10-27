import { Button, Checkbox, Input, InputNumber, Select, Space, Tabs } from 'antd';
import Decimal from 'decimal.js';
import { ASSETS, LIABILITIES_EQUITY, PROFIT, CASHFLOW } from './lines';
import {
  EQUITY_COLUMNS,
  type EnterpriseConfig,
  type ClassificationFact,
  type SourceData,
} from './model';
import { EQUITY_LABELS } from './equity-lines';
const blank = { source: '', version: '1' };
const opts = (items: readonly (readonly [string, string])[]) =>
  items.map(([value, label]) => ({ value, label }));
export function Evidence({
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
        placeholder="依据来源"
        value={value.source}
        onChange={(e) => onChange({ ...value, source: e.target.value })}
      />
      <Input
        aria-label="依据版本"
        placeholder="依据版本"
        value={value.version}
        onChange={(e) => onChange({ ...value, version: e.target.value })}
      />
    </Space>
  );
}
export function AmountEditor({
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
      stringMode
      aria-label={label}
      value={new Decimal(value).div(100).toFixed(2)}
      precision={2}
      onChange={(v) => {
        if (v !== null) onChange(new Decimal(v).times(100).toFixed(0));
      }}
    />
  );
}
export function FactSegments({
  fact,
  onChange,
  targets = [],
}: {
  fact: ClassificationFact;
  targets?: { value: string; label: string }[];
  onChange(v: Partial<ClassificationFact>): void;
}) {
  return (
    <>
      <Space wrap>
        <Select
          aria-label="合同是否约定到期"
          placeholder="合同是否约定到期"
          value={fact.contractualMaturity}
          options={opts([
            ['dated', '有约定到期日'],
            ['none', '无合同到期日'],
          ])}
          onChange={(contractualMaturity) => onChange({ contractualMaturity })}
        />
        <Checkbox
          checked={fact.sppi ?? false}
          onChange={(e) => onChange({ sppi: e.target.checked })}
        >
          合同现金流仅本金及利息（含解释20穿透评估）
        </Checkbox>
        <Select
          aria-label="金融资产业务模式"
          placeholder="金融资产业务模式"
          style={{ width: 240 }}
          value={fact.businessModel}
          options={opts([
            ['collect', '收取合同现金流量'],
            ['collectAndSell', '收取并出售'],
            ['other', '其他业务模式'],
          ])}
          onChange={(businessModel) => onChange({ businessModel })}
        />
        <Checkbox
          checked={fact.nonTrading ?? false}
          onChange={(e) => onChange({ nonTrading: e.target.checked })}
        >
          非交易性权益投资
        </Checkbox>
        <Checkbox
          checked={fact.irrevocableElection ?? false}
          onChange={(e) => onChange({ irrevocableElection: e.target.checked })}
        >
          已作不可撤销指定
        </Checkbox>
        <Button
          onClick={() =>
            onChange({ segments: [...(fact.segments ?? []), { key: '', amount: '0', ...blank }] })
          }
        >
          增加合同或期限分项
        </Button>
      </Space>
      {fact.segments?.map((s, i) => {
        const patch = (v: Partial<typeof s>) =>
          onChange({ segments: fact.segments!.map((x, j) => (j === i ? { ...x, ...v } : x)) });
        return (
          <div key={i}>
            <Space wrap>
              <Input
                aria-label="分类分项编号"
                placeholder="分类分项编号"
                value={s.key}
                onChange={(e) => patch({ key: e.target.value })}
              />
              <AmountEditor
                label="分项借方为正贷方为负金额"
                value={s.amount}
                onChange={(amount) => patch({ amount })}
              />
              <Input
                aria-label="分项合同编号"
                placeholder="分项合同编号"
                value={s.contractId ?? ''}
                onChange={(e) => patch({ contractId: e.target.value })}
              />
              <Select
                aria-label="分项流动性"
                placeholder="分项流动性"
                style={{ width: 140 }}
                value={s.current}
                options={[
                  { value: true, label: '流动' },
                  { value: false, label: '非流动' },
                ]}
                onChange={(current) => patch({ current })}
              />
              <InputNumber
                aria-label="分项到期期间"
                placeholder="分项到期期间"
                value={s.duePeriod}
                onChange={(v) => {
                  if (v) patch({ duePeriod: v });
                }}
              />
              <Select
                options={targets}
                style={{ width: 300 }}
                aria-label="分项对应备抵明细"
                placeholder="对应明细编号"
                value={s.allowanceFor ?? ''}
                onChange={(allowanceFor) => patch({ allowanceFor })}
              />
              <Button
                onClick={() => onChange({ segments: fact.segments!.filter((_, j) => i !== j) })}
              >
                移除分类分项
              </Button>
            </Space>
            <Evidence value={s} onChange={patch} />
          </div>
        );
      })}
    </>
  );
}
export function AdditionalEnterpriseConfiguration({
  c,
  source,
  onChange,
}: {
  c: EnterpriseConfig;
  source: SourceData;
  onChange(v: EnterpriseConfig): void;
}) {
  const set = <K extends keyof EnterpriseConfig>(key: K, value: EnterpriseConfig[K]) =>
    onChange({ ...c, [key]: value });
  const periods = source.periods.map((value) => ({ value, label: String(value) }));
  const accounts = source.accounts
    .filter((a) => a.isLeaf)
    .map((a) => ({ value: a.id, label: `${a.code} ${a.fullName}` }));
  const entries = source.entries.filter(
    (e) =>
      c.rules.some((r) => r.accountId === e.accountId && ['pnl', 'oci'].includes(r.kind)) &&
      !source.vouchers.some((v) => v.id === e.voucherId && v.closingKind === 'pnl'),
  );
  const lines = [...ASSETS, ...LIABILITIES_EQUITY, ...PROFIT, ...CASHFLOW]
    .filter((l) => !l.total && !l.section)
    .map((l) => ({ value: l.key, label: l.label }));
  return (
    <Tabs
      items={[
        {
          key: 'oci',
          label: '其他综合收益及终止经营',
          children: (
            <Space orientation="vertical">
              {entries.map((e) => {
                const rule = c.rules.find((r) => r.accountId === e.accountId)!,
                  item = c.oci.find((x) => x.lineId === e.lineId),
                  patch = (v: Partial<EnterpriseConfig['oci'][number]>) =>
                    set('oci', [
                      ...c.oci.filter((x) => x.lineId !== e.lineId),
                      { lineId: e.lineId, line: '', gross: '0', tax: '0', ...blank, ...item, ...v },
                    ]);
                return (
                  <fieldset key={e.lineId}>
                    <legend>
                      <a href={`/m/voucher-entry/edit?id=${e.voucherId}`}>
                        {e.date} {e.displayNo} 第{e.lineNo}行
                      </a>{' '}
                      {e.summary}
                    </legend>
                    {rule.kind === 'oci' ? (
                      <Space wrap>
                        <Select
                          aria-label="其他综合收益明细"
                          style={{ width: 320 }}
                          value={item?.line}
                          options={PROFIT.filter((l) =>
                            [
                              'remeasurement',
                              'equityNonreclass',
                              'otherEquityFairValue',
                              'ownCreditRisk',
                              'otherNonreclass',
                              'equityReclass',
                              'debtFairValue',
                              'financialReclassification',
                              'debtImpairment',
                              'cashflowHedge',
                              'translation',
                              'otherReclass',
                            ].includes(l.key),
                          ).map((l) => ({ value: l.key, label: l.label }))}
                          onChange={(line) => patch({ line })}
                        />
                        <AmountEditor
                          label="其他综合收益税前金额"
                          value={item?.gross ?? '0'}
                          onChange={(gross) => patch({ gross })}
                        />
                        <AmountEditor
                          label="其他综合收益所得税分配"
                          value={item?.tax ?? '0'}
                          onChange={(tax) => patch({ tax })}
                        />
                        <Evidence value={item ?? blank} onChange={patch} />
                      </Space>
                    ) : (
                      <>
                        <Checkbox
                          checked={c.discontinued.some((x) => x.lineId === e.lineId)}
                          onChange={(ev) =>
                            set(
                              'discontinued',
                              ev.target.checked
                                ? [...c.discontinued, { lineId: e.lineId, ...blank }]
                                : c.discontinued.filter((x) => x.lineId !== e.lineId),
                            )
                          }
                        >
                          属于终止经营（所得税须同时分类）
                        </Checkbox>
                        {c.discontinued.find((x) => x.lineId === e.lineId) && (
                          <Evidence
                            value={c.discontinued.find((x) => x.lineId === e.lineId)!}
                            onChange={(v) =>
                              set(
                                'discontinued',
                                c.discontinued.map((x) =>
                                  x.lineId === e.lineId ? { ...x, ...v } : x,
                                ),
                              )
                            }
                          />
                        )}
                      </>
                    )}
                  </fieldset>
                );
              })}
            </Space>
          ),
        },
        {
          key: 'eps',
          label: '股份及每股收益',
          children: (
            <Space orientation="vertical">
              <Button
                onClick={() =>
                  set('shares', [...c.shares, { from: '', to: '', ordinary: '0', ...blank }])
                }
              >
                增加普通股持有区间
              </Button>
              {c.shares.map((s, i) => {
                const patch = (v: Partial<typeof s>) =>
                  set(
                    'shares',
                    c.shares.map((x, j) => (j === i ? { ...x, ...v } : x)),
                  );
                return (
                  <Space key={i} wrap>
                    <Input
                      type="date"
                      aria-label="股份区间开始日期"
                      value={s.from}
                      onChange={(e) => patch({ from: e.target.value })}
                    />
                    <Input
                      type="date"
                      aria-label="股份区间结束日期"
                      value={s.to}
                      onChange={(e) => patch({ to: e.target.value })}
                    />
                    <InputNumber<string>
                      aria-label="实际普通股股数"
                      stringMode
                      value={s.ordinary}
                      onChange={(v) => {
                        if (v !== null) patch({ ordinary: v });
                      }}
                    />
                    <Evidence value={s} onChange={patch} />
                    <Button
                      onClick={() =>
                        set(
                          'shares',
                          c.shares.filter((_, j) => i !== j),
                        )
                      }
                    >
                      移除股份区间
                    </Button>
                  </Space>
                );
              })}
              <Button
                onClick={() =>
                  set('eps', [
                    ...c.eps,
                    {
                      from: c.period,
                      to: c.period,
                      applicable: false,
                      preference: '0',
                      dilutions: [],
                      ...blank,
                    },
                  ])
                }
              >
                增加每股收益适用资料
              </Button>
              {c.eps.map((e, i) => {
                const patch = (v: Partial<typeof e>) =>
                  set(
                    'eps',
                    c.eps.map((x, j) => (j === i ? { ...x, ...v } : x)),
                  );
                return (
                  <fieldset key={i}>
                    <legend>每股收益期间及适用性</legend>
                    <Space wrap>
                      <Select
                        aria-label="每股收益起期"
                        value={e.from}
                        options={periods}
                        onChange={(from) => patch({ from })}
                      />
                      <Select
                        aria-label="每股收益止期"
                        value={e.to}
                        options={periods}
                        onChange={(to) => patch({ to })}
                      />
                      <Checkbox
                        checked={e.applicable}
                        onChange={(ev) => patch({ applicable: ev.target.checked })}
                      >
                        适用每股收益
                      </Checkbox>
                      <AmountEditor
                        label="归属优先工具的利润"
                        value={e.preference}
                        onChange={(preference) => patch({ preference })}
                      />
                      <Evidence value={e} onChange={patch} />
                      <Button
                        onClick={() =>
                          patch({
                            dilutions: [...e.dilutions, { numerator: '0', shares: '0', ...blank }],
                          })
                        }
                      >
                        增加潜在普通股工具
                      </Button>
                      {e.dilutions.map((d, j) => (
                        <Space wrap key={j}>
                          <AmountEditor
                            label="稀释工具税后利润调整"
                            value={d.numerator}
                            onChange={(numerator) =>
                              patch({
                                dilutions: e.dilutions.map((x, k) =>
                                  j === k ? { ...x, numerator } : x,
                                ),
                              })
                            }
                          />
                          <InputNumber<string>
                            aria-label="稀释工具加权增量股数"
                            stringMode
                            value={d.shares}
                            onChange={(v) => {
                              if (v !== null)
                                patch({
                                  dilutions: e.dilutions.map((x, k) =>
                                    j === k ? { ...x, shares: v } : x,
                                  ),
                                });
                            }}
                          />
                          <Evidence
                            value={d}
                            onChange={(v) =>
                              patch({
                                dilutions: e.dilutions.map((x, k) =>
                                  j === k ? { ...x, ...v } : x,
                                ),
                              })
                            }
                          />
                          <Button
                            onClick={() =>
                              patch({ dilutions: e.dilutions.filter((_, k) => j !== k) })
                            }
                          >
                            移除此工具
                          </Button>
                        </Space>
                      ))}
                      <Button
                        onClick={() =>
                          set(
                            'eps',
                            c.eps.filter((_, j) => i !== j),
                          )
                        }
                      >
                        移除此期间
                      </Button>
                    </Space>
                  </fieldset>
                );
              })}
            </Space>
          ),
        },
        {
          key: 'adjustments',
          label: '追溯调整与衔接',
          children: (
            <Space orientation="vertical">
              <Button
                onClick={() =>
                  set('adjustments', [
                    ...c.adjustments,
                    {
                      period: c.period,
                      statement: 'balance',
                      row: '',
                      amount: '0',
                      kind: 'policy',
                      ...blank,
                    },
                  ])
                }
              >
                增加调整来源
              </Button>
              {c.adjustments.map((a, i) => {
                const patch = (v: Partial<typeof a>) =>
                  set(
                    'adjustments',
                    c.adjustments.map((x, j) => (j === i ? { ...x, ...v } : x)),
                  );
                return (
                  <Space wrap key={i}>
                    <Select
                      aria-label="调整期间"
                      value={a.period}
                      options={periods}
                      onChange={(period) => patch({ period })}
                    />
                    <Select
                      aria-label="调整报表"
                      value={a.statement}
                      options={opts([
                        ['balance', '资产负债表'],
                        ['profit', '利润表'],
                        ['cashflow', '现金流量表'],
                        ['equity', '权益期初调整'],
                      ])}
                      onChange={(statement) => patch({ statement })}
                    />
                    <Select
                      aria-label="调整性质"
                      value={a.kind}
                      options={opts([
                        ['policy', '会计政策变更'],
                        ['error', '前期差错更正'],
                        ['other', '其他有据调整'],
                      ])}
                      onChange={(kind) => patch({ kind })}
                    />
                    <Select
                      aria-label="调整项目"
                      style={{ width: 300 }}
                      value={a.row}
                      options={lines}
                      onChange={(row) => patch({ row })}
                    />
                    <Select
                      aria-label="调整权益列"
                      placeholder="权益调整必填"
                      value={a.column}
                      options={EQUITY_COLUMNS.map((value, j) => ({
                        value,
                        label: EQUITY_LABELS[j],
                      }))}
                      onChange={(column) => patch({ column })}
                    />
                    <AmountEditor
                      label="调整金额"
                      value={a.amount}
                      onChange={(amount) => patch({ amount })}
                    />
                    <Evidence value={a} onChange={patch} />
                    <Button
                      onClick={() =>
                        set(
                          'adjustments',
                          c.adjustments.filter((_, j) => i !== j),
                        )
                      }
                    >
                      移除此调整
                    </Button>
                  </Space>
                );
              })}
            </Space>
          ),
        },
        {
          key: 'scope',
          label: '现金范围变化',
          children: (
            <Space orientation="vertical">
              <p>
                以变动日期零点账面余额核实非账务范围变化。不会将限制解除或政策变化塞入汇兑影响。
              </p>
              <Button
                onClick={() =>
                  set('cashScopeChanges', [
                    ...c.cashScopeChanges,
                    {
                      period: c.period,
                      date: '',
                      accountId: source.accounts.find((a) => a.isLeaf)?.id ?? 1,
                      amount: '0',
                      kind: 'policy',
                      ...blank,
                    },
                  ])
                }
              >
                增加现金范围变化
              </Button>
              {c.cashScopeChanges.map((a, i) => {
                const patch = (v: Partial<typeof a>) =>
                  set(
                    'cashScopeChanges',
                    c.cashScopeChanges.map((x, j) => (i === j ? { ...x, ...v } : x)),
                  );
                return (
                  <Space wrap key={i}>
                    <Select
                      aria-label="范围变化期间"
                      value={a.period}
                      options={periods}
                      onChange={(period) => patch({ period })}
                    />
                    <Input
                      type="date"
                      aria-label="范围变化日期"
                      value={a.date}
                      onChange={(e) => patch({ date: e.target.value })}
                    />
                    <Select
                      aria-label="范围变化科目"
                      value={a.accountId}
                      options={accounts}
                      style={{ width: 260 }}
                      onChange={(accountId) => patch({ accountId })}
                    />
                    <Select
                      aria-label="范围变化性质"
                      value={a.kind}
                      options={opts([
                        ['restriction', '新增限制'],
                        ['release', '解除限制'],
                        ['policy', '现金等价物政策变化'],
                      ])}
                      onChange={(kind) => patch({ kind })}
                    />
                    <AmountEditor
                      label="现金范围变化金额"
                      value={a.amount}
                      onChange={(amount) => patch({ amount })}
                    />
                    <Evidence value={a} onChange={patch} />
                    <Button
                      onClick={() =>
                        set(
                          'cashScopeChanges',
                          c.cashScopeChanges.filter((_, j) => i !== j),
                        )
                      }
                    >
                      移除此变化
                    </Button>
                  </Space>
                );
              })}
            </Space>
          ),
        },
        {
          key: 'net',
          label: '合同净额期限分配',
          children: (
            <Space orientation="vertical">
              <Button
                onClick={() =>
                  set('contractNetAllocations', [
                    ...c.contractNetAllocations,
                    {
                      period: c.period,
                      basis: 'closing',
                      contractId: '',
                      currentAmount: '0',
                      noncurrentAmount: '0',
                      ...blank,
                    },
                  ])
                }
              >
                增加合同净额期限分配
              </Button>
              {c.contractNetAllocations.map((a, i) => {
                const patch = (v: Partial<typeof a>) =>
                  set(
                    'contractNetAllocations',
                    c.contractNetAllocations.map((x, j) => (j === i ? { ...x, ...v } : x)),
                  );
                return (
                  <Space wrap key={i}>
                    <Select
                      aria-label="合同分配报告日"
                      value={a.period}
                      options={periods}
                      onChange={(period) => patch({ period })}
                    />
                    <Select
                      aria-label="合同分配时点"
                      value={a.basis}
                      options={opts([
                        ['opening', '期初'],
                        ['closing', '期末'],
                      ])}
                      onChange={(basis) => patch({ basis })}
                    />
                    <Input
                      aria-label="净额分配合同编号"
                      value={a.contractId}
                      onChange={(e) => patch({ contractId: e.target.value })}
                    />
                    <AmountEditor
                      label="合同净额流动部分"
                      value={a.currentAmount}
                      onChange={(currentAmount) => patch({ currentAmount })}
                    />
                    <AmountEditor
                      label="合同净额非流动部分"
                      value={a.noncurrentAmount}
                      onChange={(noncurrentAmount) => patch({ noncurrentAmount })}
                    />
                    <Evidence value={a} onChange={patch} />
                    <Button
                      onClick={() =>
                        set(
                          'contractNetAllocations',
                          c.contractNetAllocations.filter((_, j) => i !== j),
                        )
                      }
                    >
                      移除此分配
                    </Button>
                  </Space>
                );
              })}
            </Space>
          ),
        },
      ]}
    />
  );
}
