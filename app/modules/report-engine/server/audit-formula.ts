import Decimal from 'decimal.js';
import {
  calculate,
  evaluate,
  FormulaError,
  parseFormula,
  finalize,
  type Ast,
  type FormulaContext,
} from './formula';

type Condition =
  | { kind: 'logic'; op: 'AND' | 'OR'; left: Condition; right: Condition }
  | { kind: 'not'; child: Condition }
  | { kind: 'compare'; op: string; left: Ast; right: Ast };

/** 只识别字符串及括号之外的条件运算符，算术仍由既有白名单解释器处理。 */
function operators(source: string) {
  const found: { at: number; op: string }[] = [];
  let depth = 0,
    quoted = false;
  for (let at = 0; at < source.length; at++) {
    const char = source[at];
    if (quoted) {
      if (char === '\\') at++;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === '(') {
      depth++;
      continue;
    }
    if (char === ')') {
      if (--depth < 0) throw new FormulaError('条件表达式括号不匹配');
      continue;
    }
    if (depth) continue;
    const op = /^(?:AND\b|OR\b|<=|>=|<>|!=|==|=|<|>)/i.exec(source.slice(at))?.[0];
    if (op && (!/^[A-Za-z]/.test(op) || at === 0 || !/[A-Za-z0-9_]/.test(source[at - 1]!))) {
      found.push({ at, op: op.toUpperCase() });
      at += op.length - 1;
    }
  }
  if (quoted || depth) throw new FormulaError('条件表达式引号或括号不匹配');
  return found;
}
function enclosed(source: string) {
  if (!source.startsWith('(') || !source.endsWith(')')) return false;
  let depth = 0,
    quoted = false;
  for (let at = 0; at < source.length; at++) {
    const char = source[at];
    if (quoted) {
      if (char === '\\') at++;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === '(') depth++;
    if (char === ')' && --depth === 0) return at === source.length - 1;
  }
  return false;
}
export function parseAudit(source: string): Condition {
  if (source.length > 2000) throw new FormulaError('条件表达式最多2000字符');
  let nodes = 0;
  const parse = (raw: string, depth: number): Condition => {
    if (++nodes > 512 || depth > 40) throw new FormulaError('条件表达式过于复杂，请拆分审核项');
    const text = raw.trim();
    if (!text) throw new FormulaError('条件表达式不能为空');
    if (enclosed(text)) return parse(text.slice(1, -1), depth + 1);
    const list = operators(text);
    for (const op of ['OR', 'AND'] as const) {
      const token = list.findLast((item) => item.op === op);
      if (token)
        return {
          kind: 'logic',
          op,
          left: parse(text.slice(0, token.at), depth + 1),
          right: parse(text.slice(token.at + token.op.length), depth + 1),
        };
    }
    if (/^NOT\b/i.test(text)) return { kind: 'not', child: parse(text.slice(3), depth + 1) };
    if (list.length !== 1)
      throw new FormulaError('条件须使用一个比较符；多个条件请用 AND 或 OR 连接');
    const token = list[0]!;
    const left = parseFormula(text.slice(0, token.at).trim());
    const right = parseFormula(text.slice(token.at + token.op.length).trim());
    if (left.type === 'string' || right.type === 'string')
      throw new FormulaError('审核条件两侧须为数值表达式');
    return { kind: 'compare', op: token.op, left, right };
  };
  return parse(source, 0);
}
export async function evaluateAudit(
  condition: Condition,
  context: FormulaContext,
  tolerance: string,
): Promise<boolean> {
  context.tick();
  if (condition.kind === 'logic') {
    const left = await evaluateAudit(condition.left, context, tolerance);
    return condition.op === 'AND'
      ? left && (await evaluateAudit(condition.right, context, tolerance))
      : left || (await evaluateAudit(condition.right, context, tolerance));
  }
  if (condition.kind === 'not') return !(await evaluateAudit(condition.child, context, tolerance));
  let left = finalize(await evaluate(condition.left, context));
  let right = finalize(await evaluate(condition.right, context));
  // 无量纲零可与金额或数量零比较，非零常量不隐式改变单位。
  if (left.unit === 'number' && left.amount.isZero())
    left = { ...left, unit: right.unit, currency: right.currency };
  if (right.unit === 'number' && right.amount.isZero())
    right = { ...right, unit: left.unit, currency: left.currency };
  const difference = calculate('-', left, right).amount;
  switch (condition.op) {
    case '=':
    case '==':
      return difference.abs().lte(new Decimal(tolerance));
    case '<>':
    case '!=':
      return difference.abs().gt(new Decimal(tolerance));
    case '<':
      return difference.lt(0);
    case '>':
      return difference.gt(0);
    case '<=':
      return difference.lte(0);
    case '>=':
      return difference.gte(0);
    default:
      throw new FormulaError('不支持的条件比较符');
  }
}
