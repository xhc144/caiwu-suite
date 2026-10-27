import { Alert, Button, Input, Select, Space, Table, Tabs } from 'antd';
import type { Account, BalanceRow, EntryRow } from '@caiwu/core';
import { MoneyInput, MoneyText, downloadBlob } from '@caiwu/ui';
import { printHtml, type PrintJob } from '@caiwu/print';
import {
  roles,
  incomeDetails,
  rowKey,
  entrySignature,
  resolveRoles,
  type Configuration,
  type Role,
  pnlRoles,
} from './configuration';
import { cashflowItems, cashflowLines } from './catalogue';
import type { Statement } from './statements';

export type AnalysisRow = {
  period: number;
  row: BalanceRow;
  balance: number;
  destinations: Role[];
};
export function SmallBusinessConfiguration({
  value,
  accounts,
  entries,
  analysisRows,
  startPeriod,
  openingRows = [],
  onChange,
  onSave,
  saving = false,
}: {
  value: Configuration;
  accounts: Account[];
  entries: EntryRow[];
  analysisRows: AnalysisRow[];
  startPeriod: number;
  openingRows?: { key: string; label: string; ytdDebit: number; ytdCredit: number; role?: Role }[];
  onChange: (v: Configuration) => void;
  onSave: () => void;
  saving?: boolean;
}) {
  const mapped = resolveRoles(accounts, value, { allowStaleMappings: true });
  const roleOptions = Object.entries(roles).map(([value, label]) => ({ value, label }));
  const update = (patch: Partial<Configuration>) => onChange({ ...value, ...patch });
  const factEditor = (a: AnalysisRow) => {
    const key = rowKey(a.row),
      fact = value.facts.find((f) => f.key === key && f.period === a.period);
    const set = (
      parts: Configuration['facts'][number]['allocations'],
      reason = fact?.reason ?? '',
    ) =>
      update({
        facts: [
          ...value.facts.filter((f) => !(f.key === key && f.period === a.period)),
          { key, period: a.period, balance: a.balance, allocations: parts, reason },
        ],
      });
    return (
      <Space orientation="vertical" style={{ width: '100%' }}>
        {(fact?.allocations ?? []).map((p, i) => (
          <Space key={i} wrap>
            <Select
              aria-label={`${a.period} ${a.row.accountCode} 分类${i + 1}`}
              value={p.role}
              options={a.destinations.map((v) => ({
                value: v,
                label:
                  v === 'administration' && mapped.get(a.row.accountCode) === 'development'
                    ? '费用化研究支出（尚未转入损益）'
                    : roles[v],
              }))}
              style={{ width: 180 }}
              onChange={(role) =>
                set(fact!.allocations.map((v, j) => (j === i ? { ...v, role } : v)))
              }
            />
            <MoneyInput
              aria-label="分类金额（元）"
              value={p.amount}
              onChange={(amount) =>
                set(fact!.allocations.map((v, j) => (j === i ? { ...v, amount: amount ?? 0 } : v)))
              }
            />
            <Button onClick={() => set(fact!.allocations.filter((_, j) => j !== i))}>移除</Button>
          </Space>
        ))}
        <Button
          onClick={() =>
            set([...(fact?.allocations ?? []), { role: a.destinations[0]!, amount: 0 }])
          }
        >
          增加分类
        </Button>
        <Input
          aria-label={`${a.period} ${a.row.accountCode} 确认依据`}
          placeholder="合同到期日、摊销计划或资本性质等确认依据"
          value={fact?.reason ?? ''}
          onChange={(e) => set(fact?.allocations ?? [], e.target.value)}
        />
      </Space>
    );
  };
  const cashEntries = entries.filter((e) => mapped.get(e.accountCode) === 'money');
  const allocationEditor = (e: EntryRow, kind: 'income' | 'cash') => {
    const field = kind === 'cash' ? 'cashAllocations' : 'incomeAllocations',
      old = value[field][String(e.lineId)];
    const set = (
      parts: Configuration['cashAllocations'][string]['parts'],
      reason = old?.reason ?? '',
    ) =>
      update({
        [field]: {
          ...value[field],
          [String(e.lineId)]: { signature: entrySignature(e, entries), reason, parts },
        },
      });
    const options =
      kind === 'cash'
        ? cashflowItems.map((x) => ({ value: x.line, label: cashflowLines[x.line - 1]! }))
        : [
            ...Object.entries(incomeDetails)
              .filter(([, d]) => d.role === mapped.get(e.accountCode))
              .map(([line, d]) => ({ value: Number(line), label: d.label })),
            { value: 0, label: '其他（不属于所列其中项）' },
          ];
    return (
      <Space orientation="vertical">
        {old?.parts.map((p, i) => (
          <Space key={i} wrap>
            <Select
              aria-label={`分录${e.lineId}明细项目${i + 1}`}
              style={{ width: 260 }}
              value={p.line}
              options={options}
              onChange={(line) => set(old.parts.map((x, j) => (j === i ? { ...x, line } : x)))}
            />
            <MoneyInput
              aria-label="项目金额（元）"
              value={p.amount}
              onChange={(amount) =>
                set(old.parts.map((x, j) => (j === i ? { ...x, amount: amount ?? 0 } : x)))
              }
            />
            <Button onClick={() => set(old.parts.filter((_, j) => j !== i))}>移除</Button>
          </Space>
        ))}
        <Button
          onClick={() => set([...(old?.parts ?? []), { line: options[0]!.value, amount: 0 }])}
        >
          增加明细分配
        </Button>
        <Input
          aria-label={`分录${e.lineId}明细依据`}
          value={old?.reason ?? ''}
          placeholder="按实际业务用途填写分类依据，退款填写负数"
          onChange={(ev) => set(old?.parts ?? [], ev.target.value)}
        />
      </Space>
    );
  };
  const evidence = value.openingEvidence.find((e) => e.startPeriod === startPeriod),
    evidenceYear = Math.floor(startPeriod / 100);
  const setEvidence = (patch: Partial<Configuration['openingEvidence'][number]>) =>
    update({
      openingEvidence: [
        ...value.openingEvidence.filter((e) => e.startPeriod !== startPeriod),
        {
          year: evidenceYear,
          startPeriod,
          reason: '',
          pnlClosing: [],
          cashHistory: [],
          ...evidence,
          ...patch,
        },
      ],
    });
  const sections = [
    {
      key: 'accounts',
      label: '科目对应项目',
      children: (
        <Table
          rowKey="code"
          dataSource={accounts.filter((a) => a.isLeaf)}
          pagination={{ pageSize: 12 }}
          columns={[
            { title: '科目', render: (_, a: Account) => `${a.code} ${a.fullName}` },
            {
              title: '报表项目',
              render: (_, a: Account) => (
                <Select
                  aria-label={`${a.code} 报表项目`}
                  style={{ width: 240 }}
                  options={roleOptions}
                  value={mapped.get(a.code)}
                  showSearch={{ optionFilterProp: 'label' }}
                  onChange={(role: Role) =>
                    update({
                      mappings: {
                        ...value.mappings,
                        [a.code]: {
                          role,
                          reason: value.mappings[a.code]?.reason ?? '按当前科目用途确认',
                        },
                      },
                    })
                  }
                />
              ),
            },
            {
              title: '依据',
              render: (_, a: Account) => (
                <Input
                  aria-label={`${a.code} 映射依据`}
                  value={
                    value.mappings[a.code]?.reason ?? (mapped.has(a.code) ? '制度标准科目' : '')
                  }
                  onChange={(e) => {
                    const role = mapped.get(a.code);
                    if (role)
                      update({
                        mappings: { ...value.mappings, [a.code]: { role, reason: e.target.value } },
                      });
                  }}
                />
              ),
            },
          ]}
        />
      ),
    },
    {
      key: 'details',
      label: '费用与税费明细',
      children: (
        <Table
          rowKey="code"
          dataSource={accounts.filter(
            (a) =>
              a.isLeaf && Object.values(incomeDetails).some((d) => d.role === mapped.get(a.code)),
          )}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '科目', render: (_, a: Account) => `${a.code} ${a.fullName}` },
            {
              title: '明细项目',
              render: (_, a: Account) => (
                <Select
                  aria-label={`${a.code} 明细项目`}
                  style={{ width: 300 }}
                  value={value.details[a.code]?.line ?? undefined}
                  options={[
                    ...Object.entries(incomeDetails)
                      .filter(([, d]) => d.role === mapped.get(a.code))
                      .map(([line, d]) => ({ value: Number(line), label: d.label })),
                    { value: 0, label: '不属于所列其中项（填写依据）' },
                  ]}
                  onChange={(line) =>
                    update({
                      details: {
                        ...value.details,
                        [a.code]: {
                          line: line === 0 ? null : line,
                          reason: value.details[a.code]?.reason ?? '按真实业务用途确认',
                        },
                      },
                    })
                  }
                />
              ),
            },
            {
              title: '分类依据',
              render: (_, a: Account) => (
                <Input
                  aria-label={`${a.code} 明细依据`}
                  value={value.details[a.code]?.reason ?? ''}
                  onChange={(e) =>
                    update({
                      details: {
                        ...value.details,
                        [a.code]: {
                          line: value.details[a.code]?.line ?? null,
                          reason: e.target.value,
                        },
                      },
                    })
                  }
                />
              ),
            },
          ]}
        />
      ),
    },
    {
      key: 'income-lines',
      label: '逐笔费用分配',
      children: (
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Alert
            type="info"
            title="同一科目包含多种费用时可逐笔拆分；各项合计必须等于凭证净额。未逐笔分配时采用已确认的科目明细。退款按原项目冲减。"
          />
          <Table
            rowKey="lineId"
            dataSource={entries.filter((e) =>
              Object.values(incomeDetails).some((d) => d.role === mapped.get(e.accountCode)),
            )}
            pagination={{ pageSize: 8 }}
            columns={[
              {
                title: '日期与凭证',
                render: (_, e: EntryRow) => (
                  <a href={`/m/voucher-entry/edit?id=${e.voucherId}`}>
                    {e.date} {e.displayNo} 第{e.lineNo}行 {e.accountCode}
                  </a>
                ),
              },
              {
                title: '净发生额（元）',
                render: (_, e: EntryRow) => (
                  <MoneyText
                    value={
                      (e.debit - e.credit) *
                      (mapped.get(e.accountCode) === 'nonoperatingIncome' ? -1 : 1)
                    }
                  />
                ),
              },
              { title: '明细分配', render: (_, e: EntryRow) => allocationEditor(e, 'income') },
            ]}
          />
        </Space>
      ),
    },
    {
      key: 'openingEvidence',
      label: '启用前资料',
      children:
        startPeriod % 100 === 1 ? (
          <Alert title="账套在1月启用，年初及全年发生额直接读取总账。" type="info" />
        ) : (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Alert
              type="info"
              title="年初余额逐明细按启用期初及启用前累计还原。请确认期初累计完整，并补充真实损益结转、现金分类。未知项目不能按零确认。"
            />
            <Input
              aria-label="启用前资料依据"
              placeholder="完整期初及累计的来源、核对日期与凭证依据"
              value={evidence?.reason ?? ''}
              onChange={(e) => setEvidence({ reason: e.target.value })}
            />
            <Table
              rowKey="key"
              dataSource={openingRows.filter(
                (r) => r.role && pnlRoles.includes(r.role) && (r.ytdDebit || r.ytdCredit),
              )}
              pagination={{ pageSize: 8 }}
              columns={[
                { title: '损益明细', dataIndex: 'label' },
                {
                  title: '累计借方（元）',
                  render: (_, r: (typeof openingRows)[number]) => <MoneyText value={r.ytdDebit} />,
                },
                {
                  title: '累计贷方（元）',
                  render: (_, r: (typeof openingRows)[number]) => <MoneyText value={r.ytdCredit} />,
                },
                {
                  title: '其中真实损益结转',
                  render: (_, r: (typeof openingRows)[number]) => {
                    const old = evidence?.pnlClosing.find((p) => p.key === r.key);
                    const set = (patch: Partial<NonNullable<typeof old>>) =>
                      setEvidence({
                        pnlClosing: [
                          ...(evidence?.pnlClosing.filter((p) => p.key !== r.key) ?? []),
                          { key: r.key, debit: 0, credit: 0, reason: '', ...old, ...patch },
                        ],
                      });
                    return (
                      <Space orientation="vertical">
                        <MoneyInput
                          aria-label={`${r.key}启用前损益结转借方（元）`}
                          value={old?.debit}
                          onChange={(v) => set({ debit: v ?? 0 })}
                        />
                        <MoneyInput
                          aria-label={`${r.key}启用前损益结转贷方（元）`}
                          value={old?.credit}
                          onChange={(v) => set({ credit: v ?? 0 })}
                        />
                        <Input
                          aria-label={`${r.key}损益结转依据`}
                          value={old?.reason ?? ''}
                          onChange={(e) => set({ reason: e.target.value })}
                          placeholder="无结转也须说明核对依据"
                        />
                      </Space>
                    );
                  },
                },
              ]}
            />
            <Table
              rowKey={(_, i) => String(i)}
              dataSource={evidence?.cashHistory ?? []}
              pagination={false}
              columns={[
                {
                  title: '现金明细',
                  render: (
                    _,
                    h: Configuration['openingEvidence'][number]['cashHistory'][number],
                    i: number,
                  ) => (
                    <Select
                      aria-label={`启用前现金明细${i + 1}`}
                      value={h.key}
                      options={openingRows
                        .filter((r) => r.role === 'money')
                        .map((r) => ({ value: r.key, label: r.label }))}
                      style={{ width: 200 }}
                      onChange={(key) =>
                        setEvidence({
                          cashHistory: evidence!.cashHistory.map((x, j) =>
                            j === i ? { ...x, key } : x,
                          ),
                        })
                      }
                    />
                  ),
                },
                {
                  title: '日期',
                  render: (
                    _,
                    h: Configuration['openingEvidence'][number]['cashHistory'][number],
                    i: number,
                  ) => (
                    <Input
                      type="date"
                      aria-label={`启用前现金日期${i + 1}`}
                      value={h.date}
                      onChange={(e) =>
                        setEvidence({
                          cashHistory: evidence!.cashHistory.map((x, j) =>
                            j === i ? { ...x, date: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  ),
                },
                {
                  title: '项目',
                  render: (
                    _,
                    h: Configuration['openingEvidence'][number]['cashHistory'][number],
                    i: number,
                  ) => (
                    <Select
                      aria-label={`启用前现金项目${i + 1}`}
                      value={h.line}
                      options={[
                        ...cashflowItems.map((x) => ({
                          value: x.line,
                          label: cashflowLines[x.line - 1]!,
                        })),
                        { value: 0, label: '现金内部划转' },
                      ]}
                      style={{ width: 230 }}
                      onChange={(line) =>
                        setEvidence({
                          cashHistory: evidence!.cashHistory.map((x, j) =>
                            j === i ? { ...x, line } : x,
                          ),
                        })
                      }
                    />
                  ),
                },
                {
                  title: '流入/流出（元）',
                  render: (
                    _,
                    h: Configuration['openingEvidence'][number]['cashHistory'][number],
                    i: number,
                  ) => (
                    <Space orientation="vertical">
                      <MoneyInput
                        aria-label={`启用前现金流入${i + 1}（元）`}
                        value={h.inflow}
                        allowNegative={false}
                        onChange={(v) =>
                          setEvidence({
                            cashHistory: evidence!.cashHistory.map((x, j) =>
                              j === i ? { ...x, inflow: v ?? 0 } : x,
                            ),
                          })
                        }
                      />
                      <MoneyInput
                        aria-label={`启用前现金流出${i + 1}（元）`}
                        value={h.outflow}
                        allowNegative={false}
                        onChange={(v) =>
                          setEvidence({
                            cashHistory: evidence!.cashHistory.map((x, j) =>
                              j === i ? { ...x, outflow: v ?? 0 } : x,
                            ),
                          })
                        }
                      />
                    </Space>
                  ),
                },
                {
                  title: '依据及操作',
                  render: (
                    _,
                    h: Configuration['openingEvidence'][number]['cashHistory'][number],
                    i: number,
                  ) => (
                    <Space orientation="vertical">
                      <Input
                        aria-label={`启用前现金依据${i + 1}`}
                        value={h.reason}
                        onChange={(e) =>
                          setEvidence({
                            cashHistory: evidence!.cashHistory.map((x, j) =>
                              j === i ? { ...x, reason: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      <Button
                        onClick={() =>
                          setEvidence({
                            cashHistory: evidence!.cashHistory.filter((_, j) => j !== i),
                          })
                        }
                      >
                        移除
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
            <Button
              onClick={() =>
                setEvidence({
                  cashHistory: [
                    ...(evidence?.cashHistory ?? []),
                    {
                      key: openingRows.find((r) => r.role === 'money')?.key ?? '',
                      date: `${evidenceYear}-01-01`,
                      line: 1,
                      inflow: 0,
                      outflow: 0,
                      reason: '',
                    },
                  ],
                })
              }
            >
              增加启用前现金分类
            </Button>
          </Space>
        ),
    },
    {
      key: 'analysis',
      label: '期末与年初分析',
      children: (
        <Table
          rowKey={(a) => `${a.period}:${rowKey(a.row)}`}
          dataSource={analysisRows}
          pagination={{ pageSize: 8 }}
          columns={[
            {
              title: '日期及明细',
              render: (_, a: AnalysisRow) => `${a.period} ${a.row.accountCode} ${rowKey(a.row)}`,
            },
            {
              title: '账面余额（元）',
              render: (_, a: AnalysisRow) => <MoneyText value={a.balance} />,
            },
            { title: '分类及依据', render: (_, a: AnalysisRow) => factEditor(a) },
          ]}
        />
      ),
    },
    {
      key: 'scope',
      label: '现金范围',
      children: (
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Alert
            title="逐账户确认可随时用于支付的资金。受限资金请选择不纳入，并填写限制依据。日期范围不得重叠。"
            type="info"
          />
          <Table
            rowKey={(s) => `${s.account}:${s.from}`}
            dataSource={value.cashScope}
            pagination={false}
            columns={[
              { title: '账户', dataIndex: 'account' },
              {
                title: '生效日期',
                render: (_, s: Configuration['cashScope'][number]) => (
                  <Input
                    type="date"
                    aria-label={`${s.account} 现金范围生效日期`}
                    value={s.from}
                    onChange={(e) =>
                      update({
                        cashScope: value.cashScope.map((x) =>
                          x === s ? { ...x, from: e.target.value } : x,
                        ),
                      })
                    }
                  />
                ),
              },
              {
                title: '截止日期',
                render: (_, s: Configuration['cashScope'][number]) => (
                  <Input
                    type="date"
                    aria-label={`${s.account} 现金范围截止日期`}
                    value={s.to}
                    onChange={(e) =>
                      update({
                        cashScope: value.cashScope.map((x) =>
                          x === s ? { ...x, to: e.target.value } : x,
                        ),
                      })
                    }
                  />
                ),
              },
              {
                title: '可用于支付',
                render: (_, s: Configuration['cashScope'][number]) => (
                  <Select
                    aria-label={`${s.account} 现金范围`}
                    value={s.available ? 1 : 0}
                    options={[
                      { value: 1, label: '纳入现金' },
                      { value: 0, label: '受限或其他不纳入' },
                    ]}
                    onChange={(v) =>
                      update({
                        cashScope: value.cashScope.map((x) =>
                          x === s ? { ...x, available: !!v } : x,
                        ),
                      })
                    }
                  />
                ),
              },
              {
                title: '依据',
                render: (_, s: Configuration['cashScope'][number]) => (
                  <Input
                    aria-label={`${s.account} 现金依据`}
                    value={s.reason}
                    onChange={(e) =>
                      update({
                        cashScope: value.cashScope.map((x) =>
                          x === s ? { ...x, reason: e.target.value } : x,
                        ),
                      })
                    }
                  />
                ),
              },
              {
                title: '操作',
                render: (_, s: Configuration['cashScope'][number]) => (
                  <Button
                    onClick={() => update({ cashScope: value.cashScope.filter((x) => x !== s) })}
                  >
                    移除此日期范围
                  </Button>
                ),
              },
            ]}
          />
          {accounts
            .filter((a) => a.isLeaf && mapped.get(a.code) === 'money')
            .map((a) => (
              <Button
                key={a.code}
                onClick={() =>
                  update({
                    cashScope: [
                      ...value.cashScope,
                      {
                        account: a.code,
                        from: '2000-01-01',
                        to: '2100-12-31',
                        available: false,
                        reason: '',
                      },
                    ],
                  })
                }
              >
                增加 {a.code} {a.name} 的现金范围确认
              </Button>
            ))}
        </Space>
      ),
    },
    {
      key: 'cash',
      label: '现金分录分类',
      children: (
        <Table
          rowKey="lineId"
          dataSource={cashEntries}
          pagination={{ pageSize: 8 }}
          columns={[
            {
              title: '凭证及金额',
              render: (_, e: EntryRow) => (
                <>
                  <a href={`/m/voucher-entry/edit?id=${e.voucherId}`}>
                    {e.date} {e.displayNo} 第{e.lineNo}行
                  </a>
                  <p>
                    {e.summary} <MoneyText value={e.debit - e.credit} />
                  </p>
                </>
              ),
            },
            {
              title: '项目分配',
              render: (_, e: EntryRow) => {
                const old = value.cashAllocations[String(e.lineId)];
                const set = (
                  parts: Configuration['cashAllocations'][string]['parts'],
                  reason = old?.reason ?? '',
                ) =>
                  update({
                    cashAllocations: {
                      ...value.cashAllocations,
                      [String(e.lineId)]: { signature: entrySignature(e, entries), reason, parts },
                    },
                  });
                return (
                  <Space orientation="vertical">
                    {old?.parts.map((p, i) => (
                      <Space key={i} wrap>
                        <Select
                          aria-label={`分录${e.lineId}项目${i + 1}`}
                          style={{ width: 260 }}
                          value={p.line}
                          options={cashflowItems.map((x) => ({
                            value: x.line,
                            label: cashflowLines[x.line - 1]!,
                          }))}
                          onChange={(line) =>
                            set(old.parts.map((x, j) => (j === i ? { ...x, line } : x)))
                          }
                        />
                        <MoneyInput
                          aria-label="现金分配金额（元，流入为正流出为负）"
                          value={p.amount}
                          onChange={(amount) =>
                            set(
                              old.parts.map((x, j) =>
                                j === i ? { ...x, amount: amount ?? 0 } : x,
                              ),
                            )
                          }
                        />
                        <Button onClick={() => set(old.parts.filter((_, j) => j !== i))}>
                          移除
                        </Button>
                      </Space>
                    ))}
                    <Button onClick={() => set([...(old?.parts ?? []), { line: 1, amount: 0 }])}>
                      增加项目分配
                    </Button>
                    <Input
                      aria-label={`分录${e.lineId}分类依据`}
                      value={old?.reason ?? ''}
                      placeholder="说明退款、处置净额、工程薪酬或借款利息等实际用途"
                      onChange={(event) => set(old?.parts ?? [], event.target.value)}
                    />
                  </Space>
                );
              },
            },
          ]}
        />
      ),
    },
    {
      key: 'comparison',
      label: '比较年度',
      children: (
        <Space orientation="vertical">
          <Input
            aria-label="首次会计年度"
            placeholder="仅企业首个会计年度填写，例如2026"
            value={value.firstYear?.year ?? ''}
            onChange={(e) =>
              update({
                firstYear: e.target.value
                  ? { year: Number(e.target.value), reason: value.firstYear?.reason ?? '' }
                  : null,
              })
            }
          />
          <Input
            aria-label="首年依据"
            value={value.firstYear?.reason ?? ''}
            onChange={(e) => {
              if (value.firstYear)
                update({ firstYear: { ...value.firstYear, reason: e.target.value } });
            }}
            placeholder="企业设立日期及首个会计年度依据"
          />
        </Space>
      ),
    },
  ];
  return (
    <section>
      {Object.keys(value.mappings)
        .filter((code) => !accounts.some((a) => a.code === code))
        .map((code) => (
          <Alert
            key={code}
            type="error"
            title={`原映射科目${code}已不存在，请移除后重新确认相关项目。`}
            action={
              <Button
                onClick={() => {
                  const mappings = { ...value.mappings };
                  delete mappings[code];
                  update({ mappings });
                }}
              >
                移除失效映射
              </Button>
            }
          />
        ))}
      <Tabs items={sections} />
      <div style={{ position: 'sticky', bottom: 0, padding: 12, background: 'white' }}>
        <Button type="primary" loading={saving} onClick={onSave}>
          保存配置
        </Button>
      </div>
    </section>
  );
}
export function SmallBusinessStatementView({
  statement,
  comparisonNote,
  orgName,
  period,
}: {
  statement: Statement;
  comparisonNote?: string | null;
  orgName: string;
  period: number;
}) {
  return (
    <section>
      <h2>{statement.name}</h2>
      <p>
        编制单位：{orgName} 报告期：{Math.floor(period / 100)}年{period % 100}月 仅已过账 单位：元
      </p>
      {statement.notes?.map((n) => (
        <Alert key={n} title={n} type="info" />
      ))}
      {comparisonNote && <Alert title={comparisonNote} type="info" />}
      {statement.checks
        .filter((c) => c.difference !== 0)
        .map((c, i) => (
          <Alert
            key={i}
            type="error"
            title={
              <a href={`#small-${statement.code}-${c.line}`}>
                {statement.columns[c.column]} {c.name}：差额 <MoneyText value={c.difference} />
                ，定位到行{c.line}
              </a>
            }
          />
        ))}
      <Table
        rowKey="line"
        dataSource={statement.rows}
        pagination={false}
        scroll={{ x: 700 }}
        onRow={(row) => ({ id: `small-${statement.code}-${row.line}` })}
        columns={[
          { title: '行次', dataIndex: 'line', width: 64 },
          { title: '项目', dataIndex: 'label', width: 360 },
          ...[0, 1].map((column) => ({
            title: statement.columns[column],
            render: (_: unknown, row: Statement['rows'][number]) => {
              const a = row.amounts[column];
              return a ? (
                <Space orientation="vertical">
                  <MoneyText value={a.value} />
                  {a.sources.map((s, i) => (
                    <a key={i} href={s.toRoute}>
                      {s.account} {s.from}—{s.to}
                    </a>
                  ))}
                </Space>
              ) : (
                '不适用'
              );
            },
          })),
        ]}
      />
    </section>
  );
}

/** 输出回调必须由公共输出路由重新核实成功快照及来源后返回。 */
export function SmallBusinessStatementActions({
  name,
  stale = false,
  loadWorkbook,
  loadPrintJob,
  onError,
}: {
  name: string;
  stale?: boolean;
  loadWorkbook: () => Promise<string>;
  loadPrintJob: () => Promise<PrintJob>;
  onError: (error: unknown) => void;
}) {
  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      onError(error);
    }
  };
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1,
        background: 'white',
        padding: 8,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
      }}
    >
      {stale && <Alert title="筛选条件或来源已改变，请重新生成后导出或打印。" type="warning" />}
      <Button
        disabled={stale}
        onClick={() =>
          void run(async () => {
            const base64 = await loadWorkbook();
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            downloadBlob(
              new Blob([bytes], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              }),
              `${name}.xlsx`,
            );
          })
        }
      >
        导出Excel
      </Button>
      <Button
        disabled={stale}
        onClick={() =>
          void run(async () => {
            await printHtml(await loadPrintJob());
          })
        }
      >
        打印
      </Button>
    </div>
  );
}
