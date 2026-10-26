/**
 * 会计期间用整数 yyyymm 表示，例如 202607 = 2026 年 7 月。会计年度 = 自然年。
 * 日期一律是 'YYYY-MM-DD' 字符串，不带时区。
 */
export type Period = number;

export function makePeriod(year: number, month: number): Period {
  if (!Number.isInteger(year) || year < 1900 || year > 9999)
    throw new RangeError(`年份不对：${year}`);
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new RangeError(`月份不对：${month}`);
  return year * 100 + month;
}

export function isPeriod(value: unknown): value is Period {
  if (typeof value !== 'number' || !Number.isInteger(value)) return false;
  const m = value % 100;
  const y = Math.trunc(value / 100);
  return m >= 1 && m <= 12 && y >= 1900 && y <= 9999;
}

export function periodYear(p: Period): number {
  return Math.trunc(p / 100);
}

export function periodMonth(p: Period): number {
  return p % 100;
}

export function nextPeriod(p: Period): Period {
  const m = periodMonth(p);
  return m === 12 ? makePeriod(periodYear(p) + 1, 1) : p + 1;
}

export function prevPeriod(p: Period): Period {
  const m = periodMonth(p);
  return m === 1 ? makePeriod(periodYear(p) - 1, 12) : p - 1;
}

/** 闭区间内的所有期间。 */
export function periodRange(from: Period, to: Period): Period[] {
  const out: Period[] = [];
  for (let p = from; p <= to; p = nextPeriod(p)) out.push(p);
  return out;
}

export function formatPeriod(p: Period): string {
  return `${periodYear(p)}年${String(periodMonth(p)).padStart(2, '0')}月`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 日期所在期间。 */
export function periodOfDate(date: string): Period {
  if (!isValidDate(date)) throw new RangeError(`日期格式应为 YYYY-MM-DD：${date}`);
  return makePeriod(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
}

export function periodStartDate(p: Period): string {
  return `${periodYear(p)}-${String(periodMonth(p)).padStart(2, '0')}-01`;
}

export function periodEndDate(p: Period): string {
  const y = periodYear(p);
  const m = periodMonth(p);
  return `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

/** 今天的日期（本地时区），'YYYY-MM-DD'。 */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
