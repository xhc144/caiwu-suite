import { Decimal } from './decimal';

/**
 * 金额，单位是"分"，必须是安全整数。全系统的金额都用它存储、传输和计算。
 * 例：123.45 元 = 12345。禁止用浮点数做金额运算。
 */
export type Cents = number;

export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertCents(value: number, label = '金额'): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label}必须是以"分"为单位的整数，收到 ${value}`);
  }
  return value;
}

/** 元（字符串或数字）转分，四舍五入到分。 */
export function toCents(yuan: string | number | Decimal): Cents {
  const d = new Decimal(yuan);
  return assertCents(d.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber());
}

/** 分转"元"字符串，固定两位小数，不带千分位。用于导出、接口。 */
export function centsToYuan(cents: Cents): string {
  assertCents(cents);
  return new Decimal(cents).div(100).toFixed(2);
}

export interface FormatMoneyOptions {
  /** 千分位，默认开 */
  thousands?: boolean;
  /** 0 显示为空字符串（账簿里常用），默认关 */
  blankZero?: boolean;
  /** 前缀，如 "¥" */
  prefix?: string;
}

/** 分格式化为显示用字符串："1,234.56"、"-1,234.56"。 */
export function formatMoney(
  cents: Cents | null | undefined,
  opts: FormatMoneyOptions = {},
): string {
  if (cents == null) return '';
  assertCents(cents);
  if (cents === 0 && opts.blankZero) return '';
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const intPart = Math.trunc(abs / 100).toString();
  const frac = (abs % 100).toString().padStart(2, '0');
  const grouped =
    opts.thousands === false ? intPart : intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${opts.prefix ?? ''}${grouped}.${frac}`;
}

/**
 * 解析用户输入的金额，返回分；无法解析返回 null。
 * 接受："1234.5"、"1,234.50"、"-12"、"¥12.30"、"（12.30）"表示负数、全角数字。
 * 超过两位小数按四舍五入。
 */
export function parseMoney(text: string): Cents | null {
  let s = text
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[－—]/g, '-')
    .replace(/[,，\s¥￥元]/g, '');
  let negative = false;
  const paren = /^[(（](.*)[)）]$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1] ?? '';
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const cents = toCents(s);
  return negative && cents !== 0 ? -cents : cents;
}

export function sumCents(values: Iterable<Cents | null | undefined>): Cents {
  let total = 0n;
  for (const v of values) {
    if (v == null) continue;
    total += BigInt(assertCents(v));
  }
  return assertCents(Number(total));
}

/**
 * 两个十进制数相乘得到金额（分），四舍五入。
 * 例：数量 "2.5" × 单价（元）"3.33" → 833 分；外币金额（元）× 汇率。
 */
export function multiplyToCents(a: string | number, b: string | number): Cents {
  return toCents(new Decimal(a).mul(b));
}

/** 外币金额（分）× 汇率 → 本位币金额（分），四舍五入。 */
export function convertCurrency(fcCents: Cents, rate: string): Cents {
  assertCents(fcCents);
  return assertCents(
    new Decimal(fcCents).mul(rate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
  );
}

const CN_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
const CN_UNITS = ['', '拾', '佰', '仟'];
const CN_SECTIONS = ['', '万', '亿', '万亿'];

/** 金额大写，用于凭证、支票打印。例：12345 → "壹佰贰拾叁元肆角伍分"。 */
export function moneyToChinese(cents: Cents): string {
  assertCents(cents);
  if (cents === 0) return '零元整';
  const negative = cents < 0;
  let abs = Math.abs(cents);
  const fen = abs % 10;
  const jiao = Math.trunc(abs / 10) % 10;
  abs = Math.trunc(abs / 100);
  let intText = '';
  let section = 0;
  let needZero = false;
  while (abs > 0) {
    const part = abs % 10000;
    let partText = '';
    let zero = false;
    for (let i = 0, p = part; i < 4; i++, p = Math.trunc(p / 10)) {
      const digit = p % 10;
      if (digit === 0) {
        if (partText) zero = true;
      } else {
        partText = CN_DIGITS[digit]! + CN_UNITS[i]! + (zero ? '零' : '') + partText;
        zero = false;
      }
    }
    if (partText) {
      intText = partText + CN_SECTIONS[section]! + (needZero ? '零' : '') + intText;
    }
    needZero = part < 1000 && part > 0 ? true : part === 0 && intText !== '';
    abs = Math.trunc(abs / 10000);
    section++;
  }
  let text = intText ? `${intText}元` : '';
  if (jiao === 0 && fen === 0) {
    text += '整';
  } else {
    if (jiao > 0) text += `${CN_DIGITS[jiao]}角`;
    else if (intText) text += '零';
    if (fen > 0) text += `${CN_DIGITS[fen]}分`;
    else text += '整';
  }
  return (negative ? '负' : '') + text;
}
