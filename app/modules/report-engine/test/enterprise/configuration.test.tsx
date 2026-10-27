import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EnterpriseConfiguration } from '../../templates/enterprise/statutory.web';
import { fixture, provenance } from './fixture';
it('w_bb_def 企业中文配置可用键盘保存真实配置，不要求JSON或终端', async () => {
  const { c, d } = fixture(),
    onSave = vi.fn(async (_value: typeof c) => {});
  render(<EnterpriseConfiguration initial={c} source={d} onSave={onSave} />);
  const save = screen.getByRole('button', { name: '保存并确认来源' });
  save.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]?.[0]).toEqual(c);
  expect(screen.getByRole('tab', { name: '科目匹配' })).toBeVisible();
});
it('w_bb_def 缺失中文来源在界面准确阻止保存', async () => {
  const { c, d } = fixture();
  c.adoption.source = '';
  const onSave = vi.fn(async (_value: typeof c) => {});
  render(<EnterpriseConfiguration initial={c} source={d} onSave={onSave} />);
  await userEvent.click(screen.getByRole('button', { name: '保存并确认来源' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByText(/适用政策／依据来源/)).toBeVisible();
});
it('w_bb_def 现金限制活动分配和真实用途可在中文表单编辑保存', async () => {
  const { c, d } = fixture();
  c.cashScopeChanges.push({
    period: 202512,
    date: '2025-12-31',
    accountId: 1,
    kind: 'restriction',
    amount: '-220000',
    parts: [{ line: 'otherFinancingPayments', amount: '-220000', purpose: '待核实用途' }],
    ...provenance,
  });
  const onSave = vi.fn(async (_value: typeof c) => {});
  render(<EnterpriseConfiguration initial={c} source={d} onSave={onSave} />);
  await userEvent.click(screen.getByRole('tab', { name: '其他综合收益、股份及调整' }));
  await userEvent.click(screen.getByRole('tab', { name: '现金范围变化' }));
  const purpose = screen.getByRole('textbox', { name: '限制及解除用途依据' });
  await userEvent.clear(purpose);
  await userEvent.type(purpose, '非金融企业短期借款质押合同');
  await userEvent.click(screen.getByRole('button', { name: '保存并确认来源' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]![0].cashScopeChanges[0]!.parts).toEqual([
    { line: 'otherFinancingPayments', amount: '-220000', purpose: '非金融企业短期借款质押合同' },
  ]);
});
