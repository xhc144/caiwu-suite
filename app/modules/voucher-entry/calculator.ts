import { BusinessError, Decimal, parseMoney } from '@caiwu/core';
const CalculationDecimal = Decimal.clone({ precision: 220 });

/** 仅数字、四则运算和括号；不执行脚本，结果按金额四舍五入到整数分。 */
export function calculateMoney(expression: string): number {
  const invalid = () =>
    new BusinessError({
      code: 'ENTRY_CALC_INVALID',
      message: '请输入数字、加减乘除和配对括号',
      hint: '例如 (100.25 + 20) / 3；不能除以零或超出安全金额范围',
    });
  if (expression.length > 200 || /[\d.]\s+[\d.]/.test(expression)) throw invalid();
  const source = expression.replace(/\s/g, '');
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)|[+\-*/()]/g) ?? [];
  if (!tokens.length || tokens.join('') !== source || tokens.length > 100) throw invalid();
  let index = 0;
  const atom = (): Decimal => {
    const token = tokens[index++];
    if (token === '+' || token === '-') {
      const value = atom();
      return token === '-' ? value.negated() : value;
    }
    if (token === '(') {
      const value = sum();
      if (tokens[index++] !== ')') throw invalid();
      return value;
    }
    if (!token || !/^(\d+(\.\d*)?|\.\d+)$/.test(token)) throw invalid();
    return new CalculationDecimal(token);
  };
  const product = (): Decimal => {
    let value = atom();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const op = tokens[index++];
      const other = atom();
      if (op === '/' && other.isZero()) throw invalid();
      value = op === '*' ? value.times(other) : value.div(other);
    }
    return value;
  };
  const sum = (): Decimal => {
    let value = product();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const op = tokens[index++];
      const other = product();
      value = op === '+' ? value.plus(other) : value.minus(other);
    }
    return value;
  };
  try {
    const value = sum();
    if (index !== tokens.length || !value.isFinite()) throw invalid();
    const cents = parseMoney(value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2));
    if (cents == null) throw invalid();
    return cents === 0 ? 0 : cents;
  } catch {
    throw invalid();
  }
}
