import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { calculateEnterprise } from '../../templates/enterprise/calculate';
import { enterprisePrintHtml } from '../../templates/enterprise/output';
import { fixture } from '../../test/enterprise/fixture';
// 本域浏览器输出核对；不替代公共系统入口E2E。
test('w_bb_saveas 四表真实A4 PDF，全部权益列、重复表头和首尾项目', async ({ page }, info) => {
  const { c, d } = fixture(),
    result = calculateEnterprise(c, d);
  await page.setContent(enterprisePrintHtml(result));
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(14);
  await expect(
    page.getByRole('columnheader', { name: '其他权益工具·永续债', exact: true }),
  ).toHaveCount(2);
  await expect(page.getByRole('columnheader', { name: '所有者权益合计', exact: true })).toHaveCount(
    2,
  );
  const target = info.outputPath('enterprise-four-statements.pdf');
  await page.pdf({ path: target, preferCSSPageSize: true, printBackground: true });
  expect((await readFile(target)).subarray(0, 5).toString()).toBe('%PDF-');
  const metadata = execFileSync('pdfinfo', ['-f', '1', '-l', '14', target], { encoding: 'utf8' });
  expect(metadata).toMatch(/Pages:\s+14/);
  const sizes = [...metadata.matchAll(/Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/g)];
  expect(sizes).toHaveLength(14);
  for (const match of sizes) {
    const sides = [Number(match[1]), Number(match[2])].sort((a, b) => a - b);
    expect(Math.abs(sides[0]! - 595.28)).toBeLessThan(1);
    expect(Math.abs(sides[1]! - 841.89)).toBeLessThan(1);
  }
  const text = execFileSync('pdftotext', ['-layout', target, '-'], { encoding: 'utf8' });
  for (const label of [
    '货币资金',
    '资产总计',
    '负债和所有者权益',
    '营业收入',
    '基本每股收益',
    '期初现金',
    '期末现金',
    '上年年末余额',
    '本年年末余额',
    '永续债',
    '未分配利润',
    '所有者权益合计',
  ])
    expect(text).toContain(label);
});
