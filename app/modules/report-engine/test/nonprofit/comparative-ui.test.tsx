import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NonprofitConfigurationPanel } from '../../templates/nonprofit/statutory.web';
import { attachComparative } from '../../templates/nonprofit/comparative';
import { assertNonprofitChecks } from '../../templates/nonprofit/statutory.server';
import { activityRows } from '../../templates/nonprofit/forms';
import { annual, blankConfiguration } from './fixture';
import type { Configuration, Sources, Statement } from '../../templates/nonprofit/model';

// Select读取which；为jsdom补齐真实Enter键值，仍走完整键盘选择事件。
const enter = () =>
  fireEvent.keyDown(document.activeElement!, {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
  });

const request = { ...annual, code: '402' as const, from: 202701, to: 202712 };
const sources = {
  entries: [],
  accounts: [],
  balances: [],
  dimensionNames: {},
  to: 202712,
} as unknown as Sources;
function configuration(year: number, detail: string): Configuration {
  const c = blankConfiguration('合成组成重列账套', year);
  c.recognitions = [
    {
      line: {
        voucherId: 1,
        lineId: 1,
        revision: 1,
        period: year * 100 + 1,
        account: '5101',
        debit: 100,
        credit: 0,
      },
      row: 'activityCost',
      allocations: [
        {
          resourceId: 'U',
          classification: 'unrestricted',
          debit: 100,
          credit: 0,
          detail,
          acquisitionReference: '合成资源取得U',
          recognitionReference: `合成已保存${year}原凭证及组成确认`,
          charitableTrust: false,
          fundraisingCost: false,
        },
      ],
    },
  ];
  return c;
}
function statements() {
  const previous: Statement = {
    code: '402',
    name: '业务活动表',
    organization: '合成组织',
    period: { ...annual, code: '402' },
    columns: ['本期非限定', '本期限定', '本期合计', '累计非限定', '累计限定', '累计合计'],
    rows: activityRows
      .filter((r) => r.id !== 'activityDetails')
      .map((r) => ({
        ...r,
        values: r.section ? [] : [0, 0, 0, 0, 0, 0],
        sources: ['合成上年完整来源'],
      })),
    checks: [],
    notes: [],
    unpostedCount: 0,
  };
  for (const [id, n] of [
    ['activityCost', 100],
    ['administration', 100],
    ['expenseTotal', 200],
    ['netChange', -200],
  ] as const)
    previous.rows.find((r) => r.id === id)!.values = [n, 0, n, n, 0, n];
  previous.rows.push({
    id: 'detail:A',
    label: '其中：A',
    values: [100, 0, 100, 100, 0, 100],
    sources: ['合成上年已保存组成A'],
  });
  const current = structuredClone(previous);
  current.period = request;
  current.rows = current.rows.filter((r) => !r.id.startsWith('detail:'));
  current.rows.push({
    id: 'detail:B',
    label: '其中：B',
    values: [100, 0, 100, 100, 0, 100],
    sources: ['合成本年已保存组成B'],
  });
  return { current, previous };
}
const restate = (row: string, amount: number) => ({
  code: '402' as const,
  row,
  amount,
  period: 202601,
  basis: '合成原期间重列凭据',
});

it('w_bb_get 从真实上年逐笔确认选择组成A，管理费100重列成本同时补组成100可生成；少一分仍阻止', async () => {
  const previous = configuration(2026, 'A'),
    current = configuration(2027, 'B');
  current.comparison = {
    basis: '合成上年重列底稿',
    restatements: [restate('administration', -100), restate('activityCost', 100)],
  };
  const user = userEvent.setup(),
    onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <NonprofitConfigurationPanel
      sources={sources}
      request={request}
      initial={current}
      previousConfiguration={previous}
      periods={[{ period: 202601, label: '2026年1月' }]}
      onRequestChange={vi.fn()}
      onSave={onSave}
      onGenerate={vi.fn()}
    />,
  );
  await user.click(screen.getByText('核对上年度可比口径及项目重列'));
  await user.click(screen.getByRole('button', { name: '增加明细项目重列' }));
  const row = within(screen.getByText('项目重列3').closest('fieldset')!);
  await user.click(row.getByRole('combobox', { name: '报表' }));
  enter();
  const detail = row.getByRole('combobox', { name: '真实明细项目' });
  await user.click(detail);
  await user.type(detail, '业务组成：A');
  enter();
  expect(row.getByText('业务组成：A')).toBeVisible();
  await user.click(row.getByRole('combobox', { name: '上年实际发生期间' }));
  enter();
  fireEvent.change(
    row.getByRole('textbox', { name: '重列调整金额（增加填正数，减少填负数，元）' }),
    { target: { value: '1.00' } },
  );
  await user.type(
    row.getByRole('textbox', { name: '原始凭据及重列依据' }),
    '合成管理费重列为A项目实际业务成本',
  );
  await user.click(screen.getByRole('button', { name: '确认上年比较口径' }));
  await user.click(screen.getByRole('button', { name: '保存来源配置' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  const saved = onSave.mock.lastCall![0] as Configuration;
  expect(saved.comparison!.restatements.at(-1)).toEqual({
    ...restate('detail:A', 100),
    basis: '合成管理费重列为A项目实际业务成本',
  });
  const { current: cs, previous: ps } = statements();
  attachComparative(cs, ps, saved, { ...request, from: 202601, to: 202612 });
  expect(() => assertNonprofitChecks(cs)).not.toThrow();
  expect(cs.rows.find((r) => r.id === 'activityCost')!.values.slice(6)).toEqual([200, 200]);
  expect(cs.rows.find((r) => r.id === 'detail:A')!.values.slice(6)).toEqual([200, 200]);
  expect(cs.rows.find((r) => r.id === 'administration')!.values.slice(6)).toEqual([0, 0]);
  expect(cs.rows.find((r) => r.id === 'expenseTotal')!.values.slice(6)).toEqual([200, 200]);
  const bad = structuredClone(saved);
  bad.comparison!.restatements.at(-1)!.amount = 99;
  const invalid = statements();
  attachComparative(invalid.current, invalid.previous, bad, {
    ...request,
    from: 202601,
    to: 202612,
  });
  expect(() => assertNonprofitChecks(invalid.current)).toThrow(/业务组成/);
});

it('w_bb_get 当前与比较配置的真实组成取并集，可在界面完成A转B而不改变成本母项', async () => {
  const previous = configuration(2026, 'A'),
    current = configuration(2027, 'B');
  current.comparison = {
    basis: '合成组成项目重列依据',
    restatements: [restate('activityCost', -100), restate('activityCost', 100)],
  };
  const user = userEvent.setup(),
    onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <NonprofitConfigurationPanel
      sources={sources}
      request={request}
      initial={current}
      previousConfiguration={previous}
      periods={[{ period: 202601, label: '2026年1月' }]}
      onRequestChange={vi.fn()}
      onSave={onSave}
      onGenerate={vi.fn()}
    />,
  );
  await user.click(screen.getByText('核对上年度可比口径及项目重列'));
  for (const [i, label] of ['业务组成：A', '业务组成：B'].entries()) {
    const row = within(screen.getByText(`项目重列${i + 1}`).closest('fieldset')!);
    const input = row.getByRole('combobox', { name: '真实明细项目' });
    await user.click(input);
    await user.type(input, label);
    enter();
  }
  await user.click(screen.getByRole('button', { name: '确认上年比较口径' }));
  await user.click(screen.getByRole('button', { name: '保存来源配置' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  const saved = onSave.mock.lastCall![0] as Configuration;
  expect(saved.comparison!.restatements.map((r) => [r.row, r.amount])).toEqual([
    ['detail:A', -100],
    ['detail:B', 100],
  ]);
  const { current: cs, previous: ps } = statements();
  attachComparative(cs, ps, saved, { ...request, from: 202601, to: 202612 });
  expect(() => assertNonprofitChecks(cs)).not.toThrow();
  expect(cs.rows.find((r) => r.id === 'activityCost')!.values.slice(6)).toEqual([100, 100]);
  expect(cs.rows.find((r) => r.id === 'detail:A')!.values.slice(6)).toEqual([0, 0]);
  expect(cs.rows.find((r) => r.id === 'detail:B')!.values.slice(6)).toEqual([100, 100]);
});
