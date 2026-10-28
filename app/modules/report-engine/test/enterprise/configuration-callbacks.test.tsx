import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { EnterpriseConfiguration } from '../../templates/enterprise/statutory.web';
import type { EnterpriseConfig } from '../../templates/enterprise/model';
import { fixture } from './fixture';

const sourceInput = () => screen.getAllByRole('textbox', { name: '依据来源' })[0]!;
const selectPeriod = async (period: number) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '报告期间' }));
  await userEvent.click(
    screen.getByText(String(period), { selector: '.ant-select-item-option-content' }),
  );
};

it('w_bb_def 发布初始和无效完整草稿，挂载不报dirty，保存仍执行配置校验', async () => {
  const { c, d } = fixture();
  const onDraftChange = vi.fn(),
    onDirtyChange = vi.fn(),
    onSave = vi.fn();
  render(
    <EnterpriseConfiguration
      initial={c}
      source={d}
      onSave={onSave}
      onDraftChange={onDraftChange}
      onDirtyChange={onDirtyChange}
    />,
  );
  expect(onDraftChange).toHaveBeenLastCalledWith(c);
  expect(onDirtyChange).not.toHaveBeenCalled();
  fireEvent.change(sourceInput(), { target: { value: '' } });
  expect(onDraftChange.mock.lastCall![0]).toEqual({
    ...c,
    adoption: { ...c.adoption, source: '' },
  });
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  await userEvent.click(screen.getByRole('button', { name: '保存并确认来源' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(onDirtyChange).not.toHaveBeenCalledWith(false);
  expect(screen.getByText(/适用政策／依据来源/)).toBeVisible();
});

it('w_bb_def 已注册保存稳定且读取最新回调，旧initial及普通来源重读不覆盖未保存草稿', async () => {
  const { c, d } = fixture();
  const oldSave = vi.fn(),
    latestSave = vi.fn().mockResolvedValue(undefined);
  const onDraftChange = vi.fn(),
    onDirtyChange = vi.fn();
  let save!: () => Promise<void>;
  const onSaveReady = vi.fn((fn: () => Promise<void>) => {
    save = fn;
  });
  const view = render(
    <EnterpriseConfiguration
      initial={c}
      source={d}
      onSave={oldSave}
      onDraftChange={onDraftChange}
      onDirtyChange={onDirtyChange}
      onSaveReady={onSaveReady}
    />,
  );
  const registered = save;
  fireEvent.change(sourceInput(), { target: { value: '本次尚未保存的完整来源' } });
  view.rerender(
    <EnterpriseConfiguration
      initial={structuredClone(c)}
      source={{ ...d }}
      onSave={latestSave}
      onDraftChange={onDraftChange}
      onDirtyChange={onDirtyChange}
      onSaveReady={onSaveReady}
    />,
  );
  expect(sourceInput()).toHaveValue('本次尚未保存的完整来源');
  expect(save).toBe(registered);
  await act(async () => {
    await registered();
  });
  expect(oldSave).not.toHaveBeenCalled();
  expect(latestSave).toHaveBeenCalledWith({
    ...c,
    adoption: { ...c.adoption, source: '本次尚未保存的完整来源' },
  });
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it('w_bb_def 干净表单接收新报告日及口径配置，草稿回调不误报dirty', async () => {
  const { c, d } = fixture();
  const onSave = vi.fn().mockResolvedValue(undefined),
    onDraftChange = vi.fn(),
    onDirtyChange = vi.fn();
  const view = render(
    <EnterpriseConfiguration
      initial={c}
      source={d}
      onSave={onSave}
      onDraftChange={onDraftChange}
      onDirtyChange={onDirtyChange}
    />,
  );
  const next: EnterpriseConfig = {
    ...c,
    period: 202511,
    scope: 'yearToDate',
    adoption: { ...c.adoption, source: '新报告日已确认来源' },
  };
  view.rerender(
    <EnterpriseConfiguration
      initial={next}
      source={{ ...d }}
      onSave={onSave}
      onDraftChange={onDraftChange}
      onDirtyChange={onDirtyChange}
    />,
  );
  expect(sourceInput()).toHaveValue('新报告日已确认来源');
  expect(onDraftChange).toHaveBeenLastCalledWith(next);
  expect(onDirtyChange).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '保存并确认来源' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(next));
});

it('w_bb_def 编辑后恢复原内容重新clean，可正常接收另一报告期间配置', () => {
  const { c, d } = fixture();
  const onSave = vi.fn(),
    onDirtyChange = vi.fn(),
    onDraftChange = vi.fn();
  const panel = (initial: EnterpriseConfig) => (
    <EnterpriseConfiguration
      initial={initial}
      source={d}
      onSave={onSave}
      onDirtyChange={onDirtyChange}
      onDraftChange={onDraftChange}
    />
  );
  const view = render(panel(c));
  fireEvent.change(sourceInput(), { target: { value: '临时编辑后恢复' } });
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.change(sourceInput(), { target: { value: c.adoption.source } });
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  const next = { ...c, period: 202511 };
  view.rerender(panel(next));
  expect(onDraftChange).toHaveBeenLastCalledWith(next);
  expect(screen.queryByText(/请先保存或明确放弃，再切换/)).not.toBeInTheDocument();
});

it('w_bb_def 同一initial对象切换干净账套时也立即刷新来源视图', async () => {
  const { c, d } = fixture();
  const onSave = vi.fn(),
    onDirtyChange = vi.fn();
  const view = render(
    <EnterpriseConfiguration
      initial={c}
      source={d}
      onSave={onSave}
      onDirtyChange={onDirtyChange}
    />,
  );
  await userEvent.click(screen.getByRole('tab', { name: '科目匹配' }));
  const nextSource = {
    ...d,
    bookId: '另一合成账套',
    accounts: d.accounts.map((a) =>
      a.id === 1 ? { ...a, name: '合成新账套库存现金', fullName: '合成新账套库存现金' } : a,
    ),
  };
  view.rerender(
    <EnterpriseConfiguration
      initial={c}
      source={nextSource}
      onSave={onSave}
      onDirtyChange={onDirtyChange}
    />,
  );
  expect(screen.getByText(/合成新账套库存现金/)).toBeVisible();
  expect(onDirtyChange).not.toHaveBeenCalled();
});

it('w_bb_def 请求换期后接收新期间分录配置，保留换期前及读取期间继续编辑的来源', async () => {
  const { c: annual, d: all } = fixture();
  const d = { ...all, periods: [202511, 202512] };
  const c: EnterpriseConfig = { ...annual, scope: 'month' };
  const onSave = vi.fn().mockResolvedValue(undefined),
    onDraftChange = vi.fn(),
    onDirtyChange = vi.fn(),
    onPeriodChange = vi.fn();
  const panel = (initial: EnterpriseConfig) => (
    <EnterpriseConfiguration
      initial={initial}
      source={d}
      onSave={onSave}
      onDraftChange={onDraftChange}
      onDirtyChange={onDirtyChange}
      onPeriodChange={onPeriodChange}
    />
  );
  const view = render(panel(c));
  fireEvent.change(sourceInput(), { target: { value: '请求换期前尚未保存的来源' } });
  await selectPeriod(202511);
  expect(onPeriodChange).toHaveBeenLastCalledWith(202511, 'month');
  expect(onDraftChange.mock.lastCall![0]).toMatchObject({
    period: 202511,
    scope: 'month',
    adoption: { source: '请求换期前尚未保存的来源' },
  });
  fireEvent.change(sourceInput(), { target: { value: '读取期间继续编辑的来源' } });
  const ids = new Set(d.entries.filter((e) => e.period <= 202511).map((e) => e.lineId));
  const next: EnterpriseConfig = {
    ...c,
    period: 202511,
    cashAllocations: c.cashAllocations.filter((x) => ids.has(x.lineId)),
  };
  view.rerender(panel(next));
  expect(sourceInput()).toHaveValue('读取期间继续编辑的来源');
  const latest = onDraftChange.mock.lastCall![0] as EnterpriseConfig;
  expect(latest.period).toBe(202511);
  expect(latest.cashAllocations).toEqual(next.cashAllocations);
  expect(latest.cashAllocations.length).toBeLessThan(c.cashAllocations.length);
  expect(latest.adoption.source).toBe('读取期间继续编辑的来源');
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  await userEvent.click(screen.getByRole('button', { name: '保存并确认来源' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(latest));
});

it('w_bb_def 未确认的新账套或期间不覆盖脏草稿，明确放弃重挂后才接收新身份', async () => {
  const { c, d } = fixture();
  const onSave = vi.fn(),
    onDraftChange = vi.fn(),
    onDirtyChange = vi.fn();
  const panel = (initial: EnterpriseConfig, bookId: string, epoch: number) => (
    <EnterpriseConfiguration
      key={epoch}
      initial={initial}
      source={{ ...d, bookId }}
      onSave={onSave}
      onDraftChange={onDraftChange}
      onDirtyChange={onDirtyChange}
    />
  );
  const view = render(panel(c, d.bookId, 0));
  fireEvent.change(sourceInput(), { target: { value: '尚未确认放弃的原报告草稿' } });
  const next = { ...c, period: 202511 };
  view.rerender(panel(next, '另一合成账套', 0));
  expect(sourceInput()).toHaveValue('尚未确认放弃的原报告草稿');
  expect(onDraftChange.mock.lastCall![0].period).toBe(202512);
  expect(screen.getByText(/请先保存或明确放弃，再切换/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '保存并确认来源' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(onDirtyChange).not.toHaveBeenCalledWith(false);
  view.rerender(panel(next, '另一合成账套', 1));
  expect(sourceInput()).toHaveValue(c.adoption.source);
  expect(onDraftChange).toHaveBeenLastCalledWith(next);
});

it('w_bb_def 保存完成不能清除保存中新编辑的草稿和dirty，第二次保存才清除', async () => {
  const { c, d } = fixture();
  let finish!: () => void, save!: () => Promise<void>;
  const onSave = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const onDraftChange = vi.fn(),
    onDirtyChange = vi.fn();
  render(
    <EnterpriseConfiguration
      initial={c}
      source={d}
      onSave={onSave}
      onSaveReady={(fn) => {
        save = fn;
      }}
      onDraftChange={onDraftChange}
      onDirtyChange={onDirtyChange}
    />,
  );
  fireEvent.change(sourceInput(), { target: { value: '本次提交的来源' } });
  let pending!: Promise<void>;
  await act(async () => {
    pending = save();
  });
  fireEvent.change(sourceInput(), { target: { value: '保存中继续修改的来源' } });
  await act(async () => {
    finish();
    await pending;
  });
  expect(onSave.mock.calls[0]![0].adoption.source).toBe('本次提交的来源');
  expect(onDraftChange.mock.lastCall![0].adoption.source).toBe('保存中继续修改的来源');
  expect(sourceInput()).toHaveValue('保存中继续修改的来源');
  expect(onDirtyChange).not.toHaveBeenCalledWith(false);
  await act(async () => {
    await save();
  });
  expect(onSave.mock.calls[1]![0].adoption.source).toBe('保存中继续修改的来源');
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it('w_bb_def 取消未确认换期后可回原报告保存，旧草稿不会混入新期间科目来源', async () => {
  const { c, d } = fixture();
  const onSave = vi.fn().mockResolvedValue(undefined),
    onDirtyChange = vi.fn();
  const panel = (initial: EnterpriseConfig, source = d) => (
    <EnterpriseConfiguration
      initial={initial}
      source={source}
      onSave={onSave}
      onDirtyChange={onDirtyChange}
    />
  );
  const view = render(panel(c));
  fireEvent.change(sourceInput(), { target: { value: '取消换期仍需保存的草稿' } });
  const otherSource = {
    ...d,
    accounts: d.accounts.map((a) =>
      a.id === 1 ? { ...a, name: '不应混用的新期间科目', fullName: '不应混用的新期间科目' } : a,
    ),
  };
  view.rerender(panel({ ...c, period: 202511 }, otherSource));
  await userEvent.click(screen.getByRole('tab', { name: '科目匹配' }));
  expect(screen.queryByText(/不应混用的新期间科目/)).not.toBeInTheDocument();
  view.rerender(panel(c));
  expect(screen.queryByText(/请先保存或明确放弃，再切换/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '保存并确认来源' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      ...c,
      adoption: { ...c.adoption, source: '取消换期仍需保存的草稿' },
    }),
  );
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it('w_bb_def 保存中被未确认上下文切换阻断，旧保存成功不能清除新上下文dirty', async () => {
  const { c, d } = fixture();
  let finish!: () => void, save!: () => Promise<void>;
  const onSave = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const onDirtyChange = vi.fn();
  const panel = (bookId: string) => (
    <EnterpriseConfiguration
      initial={c}
      source={{ ...d, bookId }}
      onSave={onSave}
      onDirtyChange={onDirtyChange}
      onSaveReady={(fn) => {
        save = fn;
      }}
    />
  );
  const view = render(panel(d.bookId));
  fireEvent.change(sourceInput(), { target: { value: '旧报告保存中的草稿' } });
  let pending!: Promise<void>;
  await act(async () => {
    pending = save();
  });
  view.rerender(panel('另一合成账套'));
  await act(async () => {
    finish();
    await pending;
  });
  expect(onDirtyChange).not.toHaveBeenCalledWith(false);
  view.rerender(panel(d.bookId));
  await act(async () => {
    await save();
  });
  expect(onSave.mock.calls[1]![0].adoption.source).toBe('旧报告保存中的草稿');
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it('w_bb_def 分录数组换期冲突先保留草稿与旧来源，明确选择返回或放弃后才能保存', async () => {
  const { c: annual, d: all } = fixture();
  const entries = all.entries.filter((e) => e.period >= 202511);
  const ids = new Set(entries.map((e) => e.lineId));
  const c: EnterpriseConfig = {
    ...annual,
    scope: 'month',
    cashAllocations: annual.cashAllocations.filter((x) => ids.has(x.lineId)),
  };
  const d = { ...all, periods: [202511, 202512], entries };
  const onSave = vi.fn().mockResolvedValue(undefined),
    onDraftChange = vi.fn(),
    onPeriodChange = vi.fn(),
    onDirtyChange = vi.fn();
  const panel = (initial: EnterpriseConfig, source = d) => (
    <EnterpriseConfiguration
      initial={initial}
      source={source}
      onSave={onSave}
      onDraftChange={onDraftChange}
      onPeriodChange={onPeriodChange}
      onDirtyChange={onDirtyChange}
    />
  );
  const view = render(panel(c));
  await userEvent.click(screen.getByRole('tab', { name: '现金范围与逐笔分配' }));
  const future = screen.getAllByRole('link', { name: /2025-12/ })[0]!;
  fireEvent.change(within(future.closest('fieldset')!).getByRole('textbox', { name: '依据来源' }), {
    target: { value: '未来分录尚未保存的编辑' },
  });
  const edited = onDraftChange.mock.lastCall![0] as EnterpriseConfig;
  await selectPeriod(202511);
  const oldEntries = entries.filter((e) => e.period <= 202511),
    oldIds = new Set(oldEntries.map((e) => e.lineId));
  const next = {
    ...c,
    period: 202511,
    cashAllocations: c.cashAllocations.filter((x) => oldIds.has(x.lineId)),
  };
  const earlierSource = { ...d, entries: oldEntries };
  view.rerender(panel(next, earlierSource));
  expect(screen.getByText(/所选期间的分类明细与未保存草稿冲突/)).toBeVisible();
  expect(future).toBeVisible();
  expect(screen.getByRole('button', { name: '保存并确认来源' })).toBeDisabled();
  expect(onDraftChange.mock.lastCall![0].cashAllocations).toEqual(edited.cashAllocations);
  await userEvent.click(screen.getByRole('button', { name: '保留草稿，返回原期间' }));
  expect(onPeriodChange).toHaveBeenLastCalledWith(202512, 'month');
  view.rerender(panel(c));
  expect(onDraftChange.mock.lastCall![0].cashAllocations).toEqual(edited.cashAllocations);
  await selectPeriod(202511);
  view.rerender(panel(next, earlierSource));
  await userEvent.click(screen.getByRole('button', { name: '放弃冲突草稿，使用所选期间配置' }));
  expect(onDraftChange).toHaveBeenLastCalledWith(next);
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  expect(screen.queryAllByRole('link', { name: /2025-12/ })).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: '保存并确认来源' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(next));
});
