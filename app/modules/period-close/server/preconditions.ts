import { sumMoney as sumCents } from './amounts';
import { BusinessError, formatMoney, periodYear } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { PeriodCloseTables } from './migrations';

export async function openingCheck(svc: CoreServices, year: number) {
  const rows = await svc.opening.list(year);
  if (
    rows.some((r) => ![r.balance, r.ytdDebit, r.ytdCredit, r.fcBalance].every(Number.isSafeInteger))
  )
    throw new BusinessError({
      code: 'PERIOD_CLOSE_UNSAFE_MONEY',
      message: '期初金额超出安全整数分范围或含小数分',
      hint: '先修正期初数，再重试',
      actions: [{ label: '去录入期初', to: `/m/opening?year=${year}` }],
    });
  const balanceDifference = sumCents(rows.map((r) => r.balance));
  const ytdDifference = sumCents(rows.flatMap((r) => [r.ytdDebit, -r.ytdCredit]));
  const book = await svc.book.info();
  const previous =
    year > periodYear(book.startPeriod)
      ? await svc.db
          .withTables<PeriodCloseTables>()
          .selectFrom('period_close_year')
          .selectAll()
          .where('target_year', '=', year)
          .executeTakeFirst()
      : null;
  const yearReady =
    year === periodYear(book.startPeriod) ||
    (!!previous &&
      (await svc.periods.years()).some((y) => y.year === year - 1 && y.status === 'closed'));
  return { rows, balanceDifference, ytdDifference, yearReady };
}
export async function requireOpening(svc: CoreServices, year: number) {
  const check = await openingCheck(svc, year);
  let message = '';
  if (!check.yearReady) message = `${year} 年尚未完成上年度年结`;
  else if (!check.rows.length) message = `${year} 年尚未实际保存期初余额`;
  else if (check.balanceDifference || check.ytdDifference)
    message = `期初试算不平：余额差额 ${formatMoney(check.balanceDifference)}，启用前累计差额 ${formatMoney(check.ytdDifference)}`;
  if (message)
    throw new BusinessError({
      code: 'PERIOD_CLOSE_OPENING',
      message,
      hint: '先录入并分别平衡年初及启用前累计；全零期初也须明确保存',
      actions: [
        { label: '去录入期初', to: `/m/opening?year=${year}` },
        { label: '去年结', to: '/m/period-close' },
      ],
    });
}
