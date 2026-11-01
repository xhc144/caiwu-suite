import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import TemplateCreationFields from '../web/TemplateCreationFields';
import { checkTemplateCreation } from '../creation-policy';
import type { TemplateFacts } from '../shared';

function Host() {
  const [facts, setFacts] = useState<TemplateFacts>();
  const [year, setYear] = useState(2026);
  const input = {
    templateId: 'financing-guarantee-cas25-2026',
    startYear: year,
    startMonth: 1,
    facts,
  };
  return (
    <>
      <TemplateCreationFields {...input} value={facts} onChange={setFacts} />
      <button onClick={() => setYear(2025)}>改为2025年</button>
      <button disabled={!checkTemplateCreation(input).allowed}>创建</button>
    </>
  );
}

it('w_xt_kgzb_a2 / a5：不自动勾选担保口径和条件，年月改动立即阻止创建', async () => {
  const user = userEvent.setup();
  render(<Host />);
  expect(screen.getByRole('radio', { name: '金融工具确认和计量准则' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: '保险合同准则' })).not.toBeChecked();
  expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  await user.click(screen.getByRole('radio', { name: '保险合同准则' }));
  for (const checkbox of screen.getAllByRole('checkbox')) await user.click(checkbox);
  expect(screen.getByRole('button', { name: '创建' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '改为2025年' }));
  expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  expect(screen.getByText(/不能用于2025-01-01/)).toBeVisible();
});

it('w_xt_kgzb_a5：清空年月时保留条件输入并提示，不使向导崩溃', () => {
  render(
    <TemplateCreationFields
      templateId="financing-guarantee-cas25-2026"
      startYear={Number.NaN}
      startMonth={0}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByText('请填写有效的启用年份和月份')).toBeVisible();
  expect(screen.getByRole('radio', { name: '保险合同准则' })).not.toBeChecked();
});
