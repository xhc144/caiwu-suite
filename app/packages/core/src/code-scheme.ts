/**
 * 科目编码级次规则，例如 [4, 3, 3] 表示一级 4 位、二级再加 3 位、三级再加 3 位。
 * 文本形式 "4-3-3"。原版把 4-3-3 和 4-2-2 做成两个模板，新版改成账套参数。
 */
export type CodeScheme = readonly number[];

export const MAX_ACCOUNT_LEVELS = 8;

export function parseCodeScheme(text: string): CodeScheme {
  const parts = text.split('-').map((s) => Number(s.trim()));
  if (parts.length === 0 || parts.length > MAX_ACCOUNT_LEVELS) {
    throw new RangeError(`科目级次最多 ${MAX_ACCOUNT_LEVELS} 级：${text}`);
  }
  for (const n of parts) {
    if (!Number.isInteger(n) || n < 1 || n > 6)
      throw new RangeError(`每级编码长度应为 1–6 位：${text}`);
  }
  return parts;
}

export function formatCodeScheme(scheme: CodeScheme): string {
  return scheme.join('-');
}

/** 各级编码的累计长度，例如 [4,3,3] → [4,7,10]。 */
export function cumulativeLengths(scheme: CodeScheme): number[] {
  let sum = 0;
  return scheme.map((n) => (sum += n));
}

/** 编码属于第几级（从 1 开始）；长度不符合级次规则或含非数字时返回 null。 */
export function levelOfCode(code: string, scheme: CodeScheme): number | null {
  if (!/^\d+$/.test(code)) return null;
  const idx = cumulativeLengths(scheme).indexOf(code.length);
  return idx === -1 ? null : idx + 1;
}

/** 上级科目编码；一级科目返回 null。 */
export function parentCodeOf(code: string, scheme: CodeScheme): string | null {
  const level = levelOfCode(code, scheme);
  if (level == null)
    throw new RangeError(`科目编码 ${code} 不符合级次规则 ${formatCodeScheme(scheme)}`);
  if (level === 1) return null;
  return code.slice(0, cumulativeLengths(scheme)[level - 2]);
}
