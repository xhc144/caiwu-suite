import { expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NonprofitConfigurationPanel } from '../../templates/nonprofit/statutory.web';
import { blankConfiguration, annual } from './fixture';
import type { Sources } from '../../templates/nonprofit/model';

const sources = {
  entries: [],
  accounts: [],
  balances: [],
  dimensionNames: {},
} as unknown as Sources;

it('w_bb_get 重开比较口径再确认保存，已存追溯余额和凭据完整保留', async () => {
  const c = blankConfiguration('合成保存测试', 2027);
  c.comparison = {
    basis: '合成上年同口径',
    restatements: [],
    balanceAdjustments: [
      { at: 'closing', key: '1002::', originalBalance: 100, delta: 10, basis: '合成真实收款追溯' },
      { at: 'closing', key: '3101::', originalBalance: -100, delta: -10, basis: '合成净资产承接' },
    ],
  };
  const user = userEvent.setup(),
    onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <NonprofitConfigurationPanel
      sources={sources}
      request={{ ...annual, from: 202701, to: 202712 }}
      initial={c}
      periods={[]}
      onRequestChange={vi.fn()}
      onSave={onSave}
      onGenerate={vi.fn()}
    />,
  );
  await user.click(screen.getByText('核对上年度可比口径及项目重列'));
  expect(screen.getByDisplayValue('合成真实收款追溯')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '确认上年比较口径' }));
  await user.click(screen.getByRole('button', { name: '保存来源配置' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(c));
});

it('w_bb_get 保存期间继续修改，旧保存成功不能把新修改标成已保存', async () => {
  const c = blankConfiguration('合成并发保存测试');
  let finish!: () => void;
  const onSave = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  const onDirtyChange = vi.fn();
  render(
    <NonprofitConfigurationPanel
      sources={sources}
      request={annual}
      initial={c}
      periods={[]}
      onRequestChange={vi.fn()}
      onSave={onSave}
      onGenerate={vi.fn()}
      onDirtyChange={onDirtyChange}
    />,
  );
  await user.click(screen.getByRole('button', { name: '保存来源配置' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  await user.type(screen.getByRole('textbox', { name: '年初凭据' }), '合成新增凭据');
  await act(async () => {
    finish();
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /保存来源配置/ })).not.toHaveClass('ant-btn-loading'),
  );
  expect(screen.getByRole('button', { name: '生成所选报表' })).toBeDisabled();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  expect(onDirtyChange).not.toHaveBeenCalledWith(false);
});

it('w_bb_get 可选dirty回调初始不误报，子表单编辑和失败保留dirty，确认并成功保存后clean', async () => {
  const c = blankConfiguration('合成导航守卫', 2027);
  c.comparison = { basis: '合成原口径', restatements: [] };
  const user = userEvent.setup(),
    onDirtyChange = vi.fn(),
    onSave = vi.fn().mockRejectedValueOnce(new Error('合成保存失败')).mockResolvedValue(undefined);
  render(
    <NonprofitConfigurationPanel
      sources={sources}
      request={{ ...annual, from: 202701, to: 202712 }}
      initial={c}
      periods={[]}
      onRequestChange={vi.fn()}
      onSave={onSave}
      onGenerate={vi.fn()}
      onDirtyChange={onDirtyChange}
    />,
  );
  expect(onDirtyChange).not.toHaveBeenCalled();
  await user.click(screen.getByText('核对上年度可比口径及项目重列'));
  await user.type(
    screen.getByRole('textbox', { name: '上年可比项目及口径核对依据' }),
    '合成新增凭据',
  );
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  await user.click(screen.getByRole('button', { name: '保存来源配置' }));
  await waitFor(() => expect(screen.getByText(/请先确认或取消正在填写/)).toBeVisible());
  expect(onSave).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '确认上年比较口径' }));
  await user.click(screen.getByRole('button', { name: /保存来源配置/ }));
  await waitFor(() => expect(screen.getByText('合成保存失败')).toBeVisible());
  expect(onDirtyChange).not.toHaveBeenCalledWith(false);
  await user.click(screen.getByRole('button', { name: /保存来源配置/ }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
});
