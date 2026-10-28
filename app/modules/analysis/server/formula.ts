import { Decimal } from 'decimal.js';
import { BusinessError } from '@caiwu/core';

import { ACCOUNT_FUNCTIONS } from '../custom';
const FormulaDecimal = Decimal.clone({ precision: 80 });
export type AccountFunction = (typeof ACCOUNT_FUNCTIONS)[number];
export type FormulaNode =
  | { kind: 'number'; value: string }
  | { kind: 'account'; fn: AccountFunction; code: string }
  | { kind: 'row'; key: number }
  | { kind: 'unary'; sign: '+' | '-'; value: FormulaNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode };
export function formulaError(message: string): never {
  throw new BusinessError({
    code: 'ANALYSIS_FORMULA',
    message,
    hint: '请按函数指南修改公式；原输入仍保留',
  });
}
/** 仅解析数字、四则运算和白名单函数，不执行 JavaScript。数字常量和科目值均以元参与十进制计算。 */
export function parseFormula(source: string): FormulaNode {
  if (!source.trim() || source.length > 1000) formulaError('公式不能为空且不能超过1000字');
  let pos = 0;
  let nodes = 0;
  const skip = () => {
    while (/\s/.test(source[pos] ?? '') && pos < source.length) pos++;
  };
  const take = (s: string) => {
    skip();
    if (source.slice(pos, pos + s.length) === s) {
      pos += s.length;
      return true;
    }
    return false;
  };
  function atom(depth: number): FormulaNode {
    if (++nodes > 300 || depth > 40) formulaError('公式过于复杂，请拆分成项目引用');
    skip();
    if (take('+')) return { kind: 'unary', sign: '+', value: atom(depth + 1) };
    if (take('-')) return { kind: 'unary', sign: '-', value: atom(depth + 1) };
    if (take('(')) {
      const value = expression(depth + 1);
      if (!take(')')) formulaError('公式缺少右括号');
      return value;
    }
    const number = source.slice(pos).match(/^\d+(?:\.\d+)?/);
    if (number) {
      if (number[0].replace('.', '').length > 40) formulaError('公式常量最多40位数字，请缩短数值');
      pos += number[0].length;
      return { kind: 'number', value: number[0] };
    }
    const fn = source.slice(pos).match(/^[\u4e00-\u9fff]+/);
    if (!fn) formulaError(`公式第${pos + 1}字不是有效的数字或函数`);
    pos += fn[0].length;
    if (!take('(')) formulaError('函数名称后需要左括号');
    if (fn[0] === '项目') {
      skip();
      const key = source.slice(pos).match(/^\d{1,4}/);
      if (!key || Number(key[0]) < 1) formulaError('项目函数须填写项目编号，例如 项目(1)');
      pos += key[0].length;
      if (!take(')')) formulaError('项目函数缺少右括号或含多余参数');
      return { kind: 'row', key: Number(key[0]) };
    }
    if (!ACCOUNT_FUNCTIONS.includes(fn[0] as AccountFunction))
      formulaError(`不支持函数“${fn[0]}”，请使用函数指南中的名称`);
    skip();
    const code = source.slice(pos).match(/^(?:"([0-9A-Za-z._-]{1,40})"|'([0-9A-Za-z._-]{1,40})')/);
    if (!code) formulaError('科目编码须用引号括起，例如 借方("1122")');
    pos += code[0].length;
    if (!take(')')) formulaError('科目函数缺少右括号或含多余参数');
    return { kind: 'account', fn: fn[0] as AccountFunction, code: (code[1] ?? code[2])! };
  }
  function product(depth: number): FormulaNode {
    let left = atom(depth);
    for (;;) {
      const op = take('*') ? '*' : take('/') ? '/' : null;
      if (!op) return left;
      left = { kind: 'binary', op, left, right: atom(depth + 1) };
    }
  }
  function expression(depth: number): FormulaNode {
    let left = product(depth);
    for (;;) {
      const op = take('+') ? '+' : take('-') ? '-' : null;
      if (!op) return left;
      left = { kind: 'binary', op, left, right: product(depth + 1) };
    }
  }
  const node = expression(0);
  skip();
  if (pos !== source.length) formulaError(`公式第${pos + 1}字缺少运算符或含不支持的内容`);
  return node;
}
export function inspectFormula(
  node: FormulaNode,
  account: (fn: AccountFunction, code: string) => void,
  row: (key: number) => void,
): void {
  if (node.kind === 'account') account(node.fn, node.code);
  else if (node.kind === 'row') row(node.key);
  else if (node.kind === 'unary') inspectFormula(node.value, account, row);
  else if (node.kind === 'binary') {
    inspectFormula(node.left, account, row);
    inspectFormula(node.right, account, row);
  }
}
export function evaluateFormula(
  node: FormulaNode,
  account: (fn: AccountFunction, code: string) => Decimal,
  row: (key: number) => Decimal,
): Decimal {
  if (node.kind === 'number') return new FormulaDecimal(node.value);
  if (node.kind === 'account') return new FormulaDecimal(account(node.fn, node.code));
  if (node.kind === 'row') return new FormulaDecimal(row(node.key));
  if (node.kind === 'unary') {
    const value = evaluateFormula(node.value, account, row);
    return node.sign === '-' ? value.negated() : value;
  }
  const left = evaluateFormula(node.left, account, row),
    right = evaluateFormula(node.right, account, row);
  if (node.op === '+') return left.plus(right);
  if (node.op === '-') return left.minus(right);
  if (node.op === '*') return left.mul(right);
  if (right.isZero()) formulaError('公式除数为零，无法计算');
  return left.div(right);
}
export function scaledValue(value: Decimal): number {
  const result = new FormulaDecimal(value)
    .mul(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
  if (!Number.isSafeInteger(result)) formulaError('公式结果超出可保存的金额范围');
  return result;
}
