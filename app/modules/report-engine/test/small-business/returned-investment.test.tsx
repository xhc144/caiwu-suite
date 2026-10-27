import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SmallBusinessStatementView } from '../../templates/small-business/statutory.web';
import type { Amount, Statement } from '../../templates/small-business/statements';

it('w_bb_proc 网页在实收资本下展示已归还投资减项及真实Amount.sources联查', () => {
  const amount = (value: number): Amount => ({ value, formula: '合成已计算结果', sources: [] });
  const returned: [Amount, Amount] = [0, 1].map((i) => ({
    ...amount(i ? 1000 : 2000),
    sources: [
      {
        account: '300102',
        from: i ? 202601 : 202612,
        to: i ? 202601 : 202612,
        dimensions: { partner: 7 },
        amount: i ? 1000 : 2000,
        toRoute: `/m/ledgers/detail?account=300102&from=${i ? 202601 : 202612}&to=${i ? 202601 : 202612}&dims=%7B%22partner%22%3A7%7D`,
      },
    ],
  })) as [Amount, Amount];
  const statement: Statement & { returnedInvestmentAmounts: [Amount, Amount] } = {
    code: '301',
    name: '小企业资产负债表',
    columns: ['期末余额', '年初余额'],
    checks: [],
    returnedInvestment: [2000, 1000],
    returnedInvestmentAmounts: returned,
    rows: [
      { line: 48, label: '实收资本', amounts: [amount(10000), amount(10000)] },
      { line: 52, label: '所有者权益合计', amounts: [amount(8000), amount(9000)] },
    ],
  };
  render(<SmallBusinessStatementView statement={statement} orgName="合成小企业" period={202612} />);
  const row = screen.getByText('减：已归还投资').closest('tr')!;
  expect(within(row).getByText('20.00')).toBeVisible();
  expect(within(row).getByText('10.00')).toBeVisible();
  expect(
    within(row)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href')),
  ).toEqual(returned.map((a) => a.sources[0]!.toRoute));
  expect(screen.getByText('80.00')).toBeVisible();
  expect(statement.rows).toHaveLength(2);
});
