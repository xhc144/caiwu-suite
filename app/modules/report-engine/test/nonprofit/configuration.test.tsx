import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTestBook, type TestBook } from '@caiwu/testkit';
import { chart } from './chart';
import { annual, seedFullYear, confirmFixture } from './fixture';
import { readNonprofitSources } from '../../templates/nonprofit/sources.server';
import { NonprofitConfigurationPanel } from '../../templates/nonprofit/statutory.web';
import type { Configuration, Sources } from '../../templates/nonprofit/model';

let book: TestBook, c: Configuration, s: Sources;
beforeAll(async () => {
  book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  c = await confirmFixture(book.svc, await seedFullYear(book.svc));
  s = await readNonprofitSources(book.svc, annual);
});
afterAll(async () => book?.close());
it('w_bb_get 中文配置组件保存后才生成，真实来源由受控回调保存且不要求输入JSON', async () => {
  const user = userEvent.setup(),
    onSave = vi.fn().mockResolvedValue(undefined),
    onGenerate = vi.fn().mockResolvedValue(undefined);
  render(
    <NonprofitConfigurationPanel
      sources={s}
      request={annual}
      initial={c}
      periods={[
        { period: 202601, label: '2026年1月' },
        { period: 202612, label: '2026年12月' },
      ]}
      onRequestChange={vi.fn()}
      onSave={onSave}
      onGenerate={onGenerate}
    />,
  );
  expect(screen.getByRole('button', { name: '生成所选报表' })).toBeDisabled();
  expect(screen.getByText(/资产负债表仍须填列新账年初余额/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: '保存来源配置' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(c));
  await waitFor(() => expect(screen.getByRole('button', { name: '生成所选报表' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: '生成所选报表' }));
  await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(annual));
  const input = screen.getByRole('textbox', { name: '年初凭据' });
  await user.type(input, '补充来源');
  expect(screen.getByRole('button', { name: '生成所选报表' })).toBeDisabled();
  expect(screen.queryByText(/整数分|profile|guard|slice/)).not.toBeInTheDocument();
});
it('w_bb_proc 新增分录尚未确认时以中文提示实际笔数，并可从分录打开正确凭证联查', async () => {
  const draft = structuredClone(c);
  draft.recognitions = draft.recognitions.slice(1);
  render(
    <NonprofitConfigurationPanel
      sources={s}
      request={annual}
      initial={draft}
      periods={[{ period: 202612, label: '2026年12月' }]}
      onRequestChange={vi.fn()}
      onSave={vi.fn()}
      onGenerate={vi.fn()}
    />,
  );
  await userEvent.setup().click(screen.getByRole('tab', { name: /收入费用确认/ }));
  expect(screen.getByText('尚有1笔')).toBeVisible();
  expect(
    screen
      .getAllByRole('link')
      .some(
        (a) => a.getAttribute('href') === `/m/voucher-entry/edit?id=${s.entries[0]!.voucherId}`,
      ),
  ).toBe(true);
});
