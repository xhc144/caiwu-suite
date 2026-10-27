import { expect, it } from 'vitest';
import { BookFilterSchema } from '../shared';
import { amountToForm, amountToUrl, conditionAmounts, queryProblem } from '../web/amount-filters';

it.each([
  ['0.01', '1'],
  ['-0.01', '-1'],
  ['1000.00', '100000'],
  ['-1000.00', '-100000'],
  ['0.00', '0'],
  ['90071992547409.91', String(Number.MAX_SAFE_INTEGER)],
  ['-90071992547409.91', String(-Number.MAX_SAFE_INTEGER)],
  ['', ''],
])('w_pz_pzxsb / w_pz_zhcx：元 %s 与旧分值链接 %s 精确往返', (yuan, cents) => {
  expect(amountToUrl(yuan)).toBe(cents);
  expect(amountToForm(cents)).toBe(yuan);
});
it.each(['90071992547409.92', '-90071992547409.92', '不是数字', '1.2.3'])(
  'w_pz_pzxsb：拒绝非法或越界金额 %s',
  (value) => {
    expect(() => amountToUrl(value)).toThrow();
  },
);
it('w_pz_zhcx：仅转换金额条件，日期与编号和制单人保持原义', () => {
  const url = JSON.stringify([
    { field: 'amount', operator: 'gte', value: '-1' },
    { field: 'number', operator: 'eq', value: '100' },
    { field: 'creator', operator: 'contains', value: '张三' },
  ]);
  const form = conditionAmounts(url, amountToForm);
  expect(JSON.parse(form)[0].value).toBe('-0.01');
  expect(conditionAmounts(form, amountToUrl)).toBe(url);
});

it.each(['1.0', ' 1 ', '1e0', '+1'])(
  'w_pz_pzxsb：以前接受的整数分链接 %s 显示为元，不重新解释为元',
  (value) => {
    expect(amountToForm(value)).toBe('0.01');
    expect(amountToUrl(amountToForm(value))).toBe('1');
  },
);

it.each([
  [{ createdBy: NaN }, '制单人'],
  [{ amountFrom: NaN }, '起始金额'],
  [{ statuses: ['unknown'] }, '凭证状态'],
  [{ conditions: [{ field: 'unknown', operator: 'eq', value: '1' }] }, '综合查询条件'],
])('w_pz_pzxsb：非法外部链接给出中文原因和修正步骤 %j', (filter, label) => {
  const result = BookFilterSchema.safeParse(filter);
  expect(result.success).toBe(false);
  if (result.success) throw new Error('应拒绝非法条件');
  const messages = result.error.issues.map(queryProblem).join('；');
  expect(messages).toContain(label);
  expect(messages).toContain('重新查询');
  expect(messages).not.toMatch(/Invalid|expected|unknown|createdBy|statuses/);
});

it('w_pz_kmhz / w_pz_ttsee：打印范围中的综合金额也按元显示，制单人使用姓名和账号', async () => {
  const { reportCaption } = await import('../web/report-print');
  const caption = reportCaption(
    { createdBy: 2, conditions: [{ field: 'amount', operator: 'gte', value: '-1' }] },
    undefined,
    '张三（maker）',
  );
  expect(caption).toContain('金额（元）不小于“-0.01”');
  expect(caption).toContain('制单人 张三（maker）');
  expect(caption).not.toContain('金额（分）');
  expect(caption).not.toContain('制单人编号');
});
