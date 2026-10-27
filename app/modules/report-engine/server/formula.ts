import Decimal from 'decimal.js';
import {
  BALANCE_ARGUMENTS,
  BalanceFunctionSchema,
  coordinates,
  type BalanceFunction,
  type Unit,
} from '../shared';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Value = { amount: Decimal; unit: Unit; currency: string; empty?: boolean };
export const value = (amount: Decimal.Value, unit: Unit = 'number', currency = 'CNY'): Value => ({
  amount: new D(amount),
  unit,
  currency,
});
export type Ast =
  | { type: 'number'; source: string }
  | { type: 'string'; source: string }
  | { type: 'cell'; address: string }
  | { type: 'range'; from: string; to: string }
  | { type: 'unary'; child: Ast }
  | { type: 'binary'; op: string; left: Ast; right: Ast }
  | { type: 'call'; name: 'SUM' | 'REF' | 'BALANCE'; args: Ast[] };
type Token = { text: string; type: 'number' | 'string' | 'word' | 'symbol' | 'end'; pos: number };
export class FormulaError extends Error {
  constructor(
    message: string,
    readonly position?: number,
  ) {
    super(position == null ? message : `第${position + 1}字符：${message}`);
  }
}
function tokenize(raw: string): Token[] {
  const source = raw.startsWith('=') ? raw.slice(1) : raw;
  if (source.length > 2000) throw new FormulaError('公式过长，最多2000字符');
  const tokens: Token[] = [];
  for (let pos = 0; pos < source.length;) {
    if (/\s/.test(source[pos]!)) {
      pos++;
      continue;
    }
    const rest = source.slice(pos);
    const number = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(rest)?.[0];
    const word = /^[A-Za-z][A-Za-z0-9]*/.exec(rest)?.[0];
    if (number) {
      tokens.push({ text: number, type: 'number', pos });
      pos += number.length;
    } else if (word) {
      tokens.push({ text: word.toUpperCase(), type: 'word', pos });
      pos += word.length;
    } else if (source[pos] === '"') {
      const string = /^"(?:[^"\\\r\n]|\\["\\])*"/.exec(rest)?.[0];
      if (!string) throw new FormulaError('字符串未结束或含不支持的转义', pos);
      tokens.push({ text: JSON.parse(string) as string, type: 'string', pos });
      pos += string.length;
    } else if ('+-*/(),:'.includes(source[pos]!)) {
      tokens.push({ text: source[pos]!, type: 'symbol', pos });
      pos++;
    } else throw new FormulaError('不允许的字符；只支持白名单函数、单元格与四则运算', pos);
    if (tokens.length > 512) throw new FormulaError('公式计算项过多，最多512个');
  }
  tokens.push({ text: '', type: 'end', pos: source.length });
  return tokens;
}
export function parseFormula(source: string): Ast {
  const tokens = tokenize(source);
  let i = 0;
  let nodes = 0;
  const peek = () => tokens[i]!;
  const take = (text: string) => {
    if (peek().text === text && peek().type === 'symbol') {
      i++;
      return true;
    }
    return false;
  };
  const expect = (text: string) => {
    if (!take(text)) throw new FormulaError(`缺少或不匹配的“${text}”`, peek().pos);
  };
  const node = (ast: Ast) => {
    if (++nodes > 256) throw new FormulaError('公式节点过多，最多256个');
    return ast;
  };
  const primary = (depth: number): Ast => {
    if (depth > 40) throw new FormulaError('公式嵌套过深，最多40层');
    if (take('-')) return node({ type: 'unary', child: primary(depth + 1) });
    if (take('(')) {
      const a = expression(0, depth + 1);
      expect(')');
      return a;
    }
    const t = peek();
    i++;
    if (t.type === 'number') return node({ type: 'number', source: t.text });
    if (t.type === 'string') return node({ type: 'string', source: t.text });
    if (t.type === 'word') {
      if (take('(')) {
        if (!['SUM', 'REF', 'BALANCE'].includes(t.text))
          throw new FormulaError(`未知函数 ${t.text}`, t.pos);
        const args: Ast[] = [];
        if (!take(')')) {
          do {
            args.push(expression(0, depth + 1));
          } while (take(','));
          expect(')');
        }
        if (t.text === 'REF' && (args.length !== 2 || args.some((a) => a.type !== 'string')))
          throw new FormulaError('REF 必须使用两个字符串参数：报表编码、单元格地址', t.pos);
        if (t.text === 'BALANCE') balanceArguments(args);
        if (t.text === 'SUM' && (args.length === 0 || args.some((a) => a.type === 'string')))
          throw new FormulaError('SUM 至少需要一个数值、单元格或区域', t.pos);
        return node({ type: 'call', name: t.text as 'SUM' | 'REF' | 'BALANCE', args });
      }
      if (coordinates(t.text).row === 0) throw new FormulaError(`未知名称 ${t.text}`, t.pos);
      if (take(':')) {
        const to = peek();
        i++;
        if (to.type !== 'word' || coordinates(to.text).row === 0)
          throw new FormulaError('区域终点须为单元格地址', to.pos);
        return node({ type: 'range', from: t.text, to: to.text });
      }
      return node({ type: 'cell', address: t.text });
    }
    throw new FormulaError('缺少计算项', t.pos);
  };
  const precedence = (s: string) => (s === '+' || s === '-' ? 1 : s === '*' || s === '/' ? 2 : -1);
  const expression = (min: number, depth: number): Ast => {
    let left = primary(depth);
    while (peek().type === 'symbol' && precedence(peek().text) >= min) {
      const op = peek().text;
      i++;
      left = node({ type: 'binary', op, left, right: expression(precedence(op) + 1, depth + 1) });
    }
    return left;
  };
  const ast = expression(0, 0);
  if (peek().type !== 'end') throw new FormulaError('计算项之间无运算符或有多余括号', peek().pos);
  return ast;
}
export function balanceArguments(args: Ast[]): BalanceFunction {
  if (args.length !== BALANCE_ARGUMENTS.length || args.some((a) => a.type !== 'string'))
    throw new FormulaError(
      'BALANCE 需要7个字符串参数：科目、指标、单位、币种、方向、辅助类型、辅助编码',
    );
  const parsed = BalanceFunctionSchema.safeParse(
    Object.fromEntries(
      BALANCE_ARGUMENTS.map((key, index) => [key, (args[index] as { source: string }).source]),
    ),
  );
  if (!parsed.success) throw new FormulaError(parsed.error.issues.map((e) => e.message).join('；'));
  return parsed.data;
}
function same(a: Value, b: Value) {
  if (a.unit !== b.unit || (a.unit === 'foreignCents' && a.currency !== b.currency))
    throw new FormulaError('运算两侧单位或币种不一致；金额为分，比例为普通数值');
}
export function calculate(op: string, a: Value, b: Value): Value {
  if (op === '+' || op === '-') {
    if (a.empty && !b.empty) a = { ...a, unit: b.unit, currency: b.currency };
    if (b.empty && !a.empty) b = { ...b, unit: a.unit, currency: a.currency };
    same(a, b);
    return {
      ...a,
      empty: !!a.empty && !!b.empty,
      amount: op === '+' ? a.amount.plus(b.amount) : a.amount.minus(b.amount),
    };
  }
  if (op === '*') {
    if (a.unit !== 'number' && b.unit !== 'number')
      throw new FormulaError('乘法至少一侧须为普通数值（比例）');
    return { ...(a.unit === 'number' ? b : a), amount: a.amount.times(b.amount) };
  }
  if (b.amount.isZero()) throw new FormulaError('除数为零');
  if (b.unit === 'number') return { ...a, amount: a.amount.div(b.amount) };
  same(a, b);
  return value(a.amount.div(b.amount));
}
export function finalize(v: Value): Value {
  if (!v.amount.isFinite() || v.amount.abs().greaterThan(Number.MAX_SAFE_INTEGER))
    throw new FormulaError('结果超出安全数值范围');
  return {
    ...v,
    amount: ['cents', 'foreignCents'].includes(v.unit)
      ? v.amount.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      : v.amount.toDecimalPlaces(10, Decimal.ROUND_HALF_UP),
  };
}
export type FormulaContext = {
  cell(address: string): Promise<Value>;
  reference(code: string, address: string): Promise<Value>;
  balance(input: BalanceFunction): Promise<Value>;
  tick(): void;
};
export async function evaluate(ast: Ast, ctx: FormulaContext, depth = 0): Promise<Value> {
  ctx.tick();
  if (depth > 64) throw new FormulaError('公式运算或引用过深，最多64层');
  const ev = (a: Ast) => evaluate(a, ctx, depth + 1);
  switch (ast.type) {
    case 'number':
      return value(ast.source);
    case 'string':
      throw new FormulaError('字符串只能用于函数参数');
    case 'cell':
      return ctx.cell(ast.address);
    case 'range':
      throw new FormulaError('区域只能作为SUM参数');
    case 'unary': {
      const a = await ev(ast.child);
      return { ...a, amount: a.amount.negated() };
    }
    case 'binary':
      return calculate(ast.op, await ev(ast.left), await ev(ast.right));
    case 'call': {
      if (ast.name === 'BALANCE') return ctx.balance(balanceArguments(ast.args));
      if (ast.name === 'REF')
        return ctx.reference(
          (ast.args[0] as { source: string }).source,
          (ast.args[1] as { source: string }).source,
        );
      let result: Value | undefined;
      const add = (v: Value) => {
        if (!v.empty) result = result ? calculate('+', result, v) : v;
      };
      for (const a of ast.args) {
        if (a.type !== 'range') {
          add(await ev(a));
          continue;
        }
        const from = coordinates(a.from),
          to = coordinates(a.to);
        if (
          from.row > to.row ||
          from.col > to.col ||
          (to.row - from.row + 1) * (to.col - from.col + 1) > 5000
        )
          throw new FormulaError('区域倒置或超过5000个单元格');
        // 先验证终点，即使区域为空也不能忽略越界。
        await ctx.cell(a.to);
        for (let row = from.row; row <= to.row; row++)
          for (let col = from.col; col <= to.col; col++) {
            ctx.tick();
            let name = '';
            for (let n = col; n > 0; n = Math.floor((n - 1) / 26))
              name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
            add(await ctx.cell(`${name}${row}`));
          }
      }
      return result ?? { ...value(0), empty: true };
    }
  }
}
