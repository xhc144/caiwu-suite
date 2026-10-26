import { isValidDate, periodOfDate, sumCents } from '@caiwu/core';
import {
  TABLES,
  type ImportAccount,
  type ImportBalance,
  type ImportOpening,
  type ImportPlan,
  type ImportVoucher,
  type PrepareInput,
} from '../shared';
import { fail, mapRows, type ParsedFiles } from './parse';

/** 不接受舍入、科学计数、千分位或二进制浮点数转金额。 */
export function exactCents(text: string): number {
  if (!/^-?(0|[1-9]\d*)(\.\d{1,2})?$/.test(text))
    fail(`金额「${text}」不是最多两位小数的十进制元文本`);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const value = (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))) * (negative ? -1n : 1n);
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))
    fail('金额超过安全整数范围');
  return Number(value);
}

const integer = (text: string, max: number, label: string, min = 1) => {
  if (
    !/^(0|[1-9]\d*)$/.test(text) ||
    !Number.isSafeInteger(Number(text)) ||
    Number(text) < min ||
    Number(text) > max
  )
    fail(`${label}必须为 ${min} 至 ${max} 的整数文本`);
  return Number(text);
};
const flag = (text: string | undefined) => {
  if (text === '否') return false;
  if (text === '是') return true;
  return fail('标志字段必须为「是」或「否」');
};
function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) fail(`${label}重复`);
}
function required(text: string | undefined, label: string, max = 80): string {
  if (!text || text.length > max) fail(`${label}不能为空或超过 ${max} 字符`);
  return text;
}

export function buildPlan(
  parsed: ParsedFiles,
  input: PrepareInput,
  startPeriod: number,
): ImportPlan {
  if (startPeriod % 100 !== 1) fail('本阶段仅支持 1 月启用的新空账，年中启用语义尚待核对');
  const rows = Object.fromEntries(
    TABLES.map((k) => [k, mapRows(k, parsed.tables[k], input.mappings[k])]),
  ) as Record<(typeof TABLES)[number], Record<string, string>[]>;
  const accounts: ImportAccount[] = rows.accounts
    .map((r): ImportAccount => {
      if (r.direction !== '借' && r.direction !== '贷') fail('科目余额方向必须为「借」或「贷」');
      const code = required(r.code, '科目编码', 30);
      if (!/^\d+$/.test(code)) fail(`科目编码 ${code} 必须为数字文本`);
      return {
        code,
        name: required(r.name, '科目名称'),
        category: required(r.category, '类别'),
        direction: r.direction === '借' ? 'debit' : 'credit',
        cash: flag(r.cash),
        bank: flag(r.bank),
        cashflow: flag(r.cashflow),
        partner: flag(r.partner),
        disabled: flag(r.disabled),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  unique(
    accounts.map((a) => a.code),
    '科目编码',
  );
  const leafCodes = accounts
    .filter((a) => !accounts.some((b) => b.code !== a.code && b.code.startsWith(a.code)))
    .map((a) => a.code);
  const opening: ImportOpening[] = rows.opening
    .map((r) => ({
      code: required(r.code, '期初科目'),
      balance: exactCents(r.balance!),
      ytdDebit: exactCents(r.ytdDebit!),
      ytdCredit: exactCents(r.ytdCredit!),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  unique(
    opening.map((r) => r.code),
    '期初科目',
  );
  if (opening.some((r) => r.ytdDebit !== 0 || r.ytdCredit !== 0))
    fail('1 月启用的期初累计借贷必须为零，不能猜测历史累计口径');
  if (sumCents(opening.map((r) => r.balance)) !== 0) fail('期初余额借贷不平');

  const groups = new Map<string, ImportVoucher>();
  for (const r of rows.vouchers) {
    if (r.status !== '待审核')
      fail('仅支持「待审核」凭证；已审核、已过账、草稿和作废状态不能降级导入');
    const sourceId = required(r.sourceId, '来源凭证号');
    const date = required(r.date, '日期');
    if (
      !isValidDate(date) ||
      Math.trunc(periodOfDate(date) / 100) !== Math.trunc(startPeriod / 100)
    )
      fail(`凭证 ${sourceId} 日期不合法或不在启用年度`);
    const header = {
      sourceId,
      date,
      type: required(r.type, '凭证类型', 20),
      number: integer(r.number!, 10000, '凭证编号'),
      attachments: integer(r.attachments!, 9999, '附单数', 0),
    };
    const group = groups.get(sourceId) ?? { ...header, lines: [] };
    if (Object.entries(header).some(([key, value]) => group[key as keyof typeof header] !== value))
      fail(`来源凭证 ${sourceId} 的日期、类型、编号或附单数不一致`);
    const line = {
      line: integer(r.line!, 999, '分录序号'),
      code: required(r.code, '分录科目'),
      summary: required(r.summary, '摘要', 200),
      debit: exactCents(r.debit!),
      credit: exactCents(r.credit!),
    };
    if (line.summary.length > 200) fail(`凭证 ${sourceId} 摘要超过 200 字符`);
    if ((line.debit === 0) === (line.credit === 0)) fail(`凭证 ${sourceId} 每行须且只能有一方金额`);
    group.lines.push(line);
    groups.set(sourceId, group);
  }
  const vouchers = [...groups.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  unique(
    vouchers.map((v) => `${periodOfDate(v.date)}:${v.type}:${v.number}`),
    '同期间同类型凭证编号',
  );
  for (const v of vouchers) {
    v.lines.sort((a, b) => a.line - b.line);
    if (v.lines.length < 2 || v.lines.length > 999 || v.lines.some((l, i) => l.line !== i + 1))
      fail(`凭证 ${v.sourceId} 分录序号必须从 1 连续且至少两行`);
    if (sumCents(v.lines.map((l) => l.debit)) !== sumCents(v.lines.map((l) => l.credit)))
      fail(`凭证 ${v.sourceId} 借贷不平`);
  }
  const balances: ImportBalance[] = rows.balances
    .map((r) => ({
      code: required(r.code, '余额科目'),
      opening: exactCents(r.opening!),
      debit: exactCents(r.debit!),
      credit: exactCents(r.credit!),
      closing: exactCents(r.closing!),
      ytdDebit: exactCents(r.ytdDebit!),
      ytdCredit: exactCents(r.ytdCredit!),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  unique(
    balances.map((r) => r.code),
    '余额科目',
  );
  for (const [name, codes] of [
    ['期初', opening.map((r) => r.code)],
    ['余额', balances.map((r) => r.code)],
  ] as const) {
    if (JSON.stringify([...codes].sort()) !== JSON.stringify([...leafCodes].sort()))
      fail(`${name}必须完整覆盖来源末级科目（含零额），不得含父级或缺项`);
  }
  for (const v of vouchers)
    for (const l of v.lines)
      if (!leafCodes.includes(l.code))
        fail(`凭证 ${v.sourceId} 科目 ${l.code} 不存在或不是来源末级科目`);

  // 限制所有金额绝对值总和，避免查询内部中间求和越过安全整数。
  const allMoney = [
    ...opening.flatMap((r) => [r.balance, r.ytdDebit, r.ytdCredit]),
    ...vouchers.flatMap((v) => v.lines.flatMap((l) => [l.debit, l.credit])),
    ...balances.flatMap((r) => [r.opening, r.debit, r.credit, r.closing, r.ytdDebit, r.ytdCredit]),
  ];
  if (
    allMoney.reduce((s, v) => s + (BigInt(v) < 0n ? -BigInt(v) : BigInt(v)), 0n) >
    BigInt(Number.MAX_SAFE_INTEGER)
  )
    fail('来源金额绝对值合计超过本阶段安全范围');
  for (const b of balances) {
    const o = opening.find((r) => r.code === b.code)!;
    const lines = vouchers.flatMap((v) => v.lines.filter((l) => l.code === b.code));
    const debit = sumCents(lines.map((l) => l.debit)),
      credit = sumCents(lines.map((l) => l.credit));
    if (
      b.opening !== o.balance ||
      b.debit !== debit ||
      b.credit !== credit ||
      b.closing !== sumCents([o.balance, debit, -credit]) ||
      b.ytdDebit !== debit ||
      b.ytdCredit !== credit
    )
      fail(`科目 ${b.code} 来源余额与期初、凭证或累计不一致`);
  }
  const counts = {
    accounts: accounts.length,
    opening: opening.length,
    vouchers: vouchers.length,
    lines: rows.vouchers.length,
    balances: balances.length,
  };
  if (
    Object.keys(counts).some(
      (k) => counts[k as keyof typeof counts] !== input.expected[k as keyof typeof counts],
    )
  )
    fail('来源实际计数与独立填写的来源总数不一致，请核对是否漏文件或漏行');
  return {
    accounts,
    opening,
    vouchers,
    balances,
    counts,
    periodFrom: startPeriod,
    periodTo: Math.max(...vouchers.map((v) => periodOfDate(v.date))),
  };
}
