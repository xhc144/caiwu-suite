import Decimal from 'decimal.js';
import { BusinessError, isPeriod } from '@caiwu/core';
import type { Category, Employee, Formula, TaxDetail, TaxInput } from '../shared';
import { TAX_RULE } from '../shared';
export function fail(
  code: string,
  message: string,
  hint = '检查输入后重试',
  to = '/m/payroll',
): never {
  throw new BusinessError({
    code: `PAYROLL_${code}`,
    message,
    hint,
    actions: [
      {
        label: to.startsWith('/m/voucher-entry/')
          ? '查看来源凭证'
          : to === '/m/payroll/tax'
            ? '配置计税参数'
            : to === '/m/payroll/employees'
              ? '维护人事档案'
              : to.includes('id=')
                ? '打开相关工资批次'
                : '返回工资',
        to,
      },
    ],
  });
}
export function cents(value: Decimal.Value): number {
  const d = new Decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const n = d.toNumber();
  if (!Number.isSafeInteger(n)) fail('OVERFLOW', '计算金额超出安全整数范围', '减少金额或拆分批次');
  return n;
}
export const sum = (values: number[]) => cents(values.reduce((a, v) => a.plus(v), new Decimal(0)));
type Node =
  | { kind: 'number'; value: string }
  | { kind: 'variable'; key: string }
  | { kind: 'unary'; op: string; node: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[]; pos: number };
export type FormulaContext = { period: number };
const functions: Record<string, readonly [number, number]> = {
  abs: [1, 1],
  min: [1, 40],
  max: [1, 40],
  sum: [1, 40],
  round: [1, 2],
  trunc: [1, 2],
  truncate: [1, 2],
  int: [1, 1],
  floor: [1, 1],
  ceil: [1, 1],
  ceiling: [1, 1],
  sign: [1, 1],
  mod: [2, 2],
  if: [3, 3],
  iif: [3, 3],
  today: [0, 0],
  daybefore: [2, 2],
  monthbefore: [2, 2],
};
/** 数字、稳定栏目变量、白名单函数与运算符；常数和金额变量均以分计，无代码或 SQL 执行。 */
export function parseFormula(source: string, keys: Set<string>): { ast: Node; refs: Set<string> } {
  if (source.length > 300) fail('FORMULA', '公式第301位：公式不能超过300个字符');
  const tokens: { text: string; pos: number }[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset]!)) {
      offset++;
      continue;
    }
    const match = /^(?:\d+(?:\.\d+)?|[a-z][a-z0-9_]*|>=|<=|==|!=|<>|&&|\|\||[+*/%(),<>=!-])/i.exec(
      source.slice(offset),
    );
    if (!match) fail('FORMULA', `公式第${offset + 1}位：不支持的字符`);
    tokens.push({ text: match[0].toLowerCase(), pos: offset });
    offset += match[0].length;
  }
  let index = 0;
  const refs = new Set<string>();
  const error = (s: string): never =>
    fail(
      'FORMULA',
      `公式第${(tokens[index]?.pos ?? source.length) + 1}位：${s}`,
      '使用栏目变量、白名单函数、逗号及成对括号；逻辑条件可用 and、or、not',
    );
  const peek = () => tokens[index]?.text;
  const primary = (): Node => {
    const t = peek();
    if (t === 'not' && !keys.has(t)) {
      index++;
      return { kind: 'unary', op: t, node: expression(3) };
    }
    if (t === '-' || t === '+' || t === '!') {
      index++;
      return { kind: 'unary', op: t, node: primary() };
    }
    if (t === '(') {
      index++;
      const n = expression(0);
      if (peek() !== ')') error('缺少右括号');
      index++;
      return n;
    }
    if (t && /^\d/.test(t)) {
      index++;
      return { kind: 'number', value: t };
    }
    if (t && /^[a-z]/.test(t)) {
      const pos = tokens[index]!.pos;
      index++;
      if (peek() === '(') {
        const arity = Object.hasOwn(functions, t) ? functions[t]! : null;
        if (!arity) return error(`未知函数 ${t}`);
        index++;
        const args: Node[] = [];
        if (peek() !== ')') {
          while (true) {
            if (peek() === ',' || peek() === ')' || !peek()) error(`函数 ${t} 缺少参数`);
            args.push(expression(0));
            if (peek() === ')') break;
            if (!peek()) error(`函数 ${t} 缺少右括号`);
            if (peek() !== ',') error(`函数 ${t} 缺少逗号或右括号`);
            index++;
          }
        }
        if (args.length < arity[0] || args.length > arity[1])
          error(
            `函数 ${t} 需要${arity[0] === arity[1] ? arity[0] : `${arity[0]}至${arity[1]}`}个参数`,
          );
        index++;
        return { kind: 'call', name: t, args, pos };
      }
      if (!keys.has(t)) {
        index--;
        error(Object.hasOwn(functions, t) ? `函数 ${t} 缺少左括号` : `未知栏目 ${t}`);
      }
      refs.add(t);
      return { kind: 'variable', key: t };
    }
    return error('缺少参数或运算数');
  };
  const precedence: Record<string, number> = {
    or: 1,
    '||': 1,
    and: 2,
    '&&': 2,
    '=': 3,
    '==': 3,
    '!=': 3,
    '<>': 3,
    '>': 3,
    '<': 3,
    '>=': 3,
    '<=': 3,
    '+': 4,
    '-': 4,
    '*': 5,
    '/': 5,
    '%': 5,
  };
  const expression = (minimum: number): Node => {
    let left = primary();
    while (peek() && (precedence[peek()!] ?? -1) >= minimum) {
      const op = peek()!;
      index++;
      const right = expression(precedence[op]! + 1);
      left = { kind: 'binary', op, left, right };
    }
    return left;
  };
  const ast = expression(0);
  if (index !== tokens.length) error('缺少运算符或多余括号');
  return { ast, refs };
}
const truth = (value: boolean) => new Decimal(value ? 1 : 0);
// 原版静态规则仅确认日期函数名与参数数目，未记录日期语义。本版约定使用
// 工资期间月末及 YYYYMMDD 日期整数；回退月份夹到目标月末，不读取机器当前日期。
function formulaDate(value: Decimal, failDate: () => never): Date {
  if (!value.isInteger() || value.lt(10000101) || value.gt(99991231)) failDate();
  const text = value.toFixed(0);
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    failDate();
  return date;
}
const dateNumber = (date: Date) =>
  new Decimal(date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate());
export function evaluate(
  node: Node,
  values: Record<string, number>,
  context?: FormulaContext,
): Decimal {
  const run = (n: Node) => evaluate(n, values, context);
  if (node.kind === 'number') return new Decimal(node.value);
  if (node.kind === 'variable') return new Decimal(values[node.key] ?? 0);
  if (node.kind === 'unary') {
    const value = run(node.node);
    return node.op === '-' ? value.neg() : node.op === '+' ? value : truth(value.isZero());
  }
  if (node.kind === 'call') {
    const arg = (index: number) => run(node.args[index]!);
    const invalid = (message: string): never =>
      fail('FORMULA', `公式第${node.pos + 1}位：函数 ${node.name} ${message}`);
    // 分支与逻辑运算均短路；未执行的除零分支不会影响满足条件的员工。
    if (node.name === 'if' || node.name === 'iif') return arg(0).isZero() ? arg(2) : arg(1);
    if (node.name === 'today') {
      const period = context?.period;
      if (!period || !isPeriod(period)) return invalid('缺少有效工资期间');
      return dateNumber(new Date(Date.UTC(Math.trunc(period / 100), period % 100, 0)));
    }
    if (node.name === 'daybefore' || node.name === 'monthbefore') {
      const date = formulaDate(arg(0), () => invalid('日期须为有效的 YYYYMMDD 整数'));
      const offset = arg(1);
      if (!offset.isInteger() || offset.lt(0) || offset.gt(120000))
        return invalid('第二参数须为0至120000的整数');
      if (node.name === 'daybefore') date.setUTCDate(date.getUTCDate() - offset.toNumber());
      else {
        const day = date.getUTCDate();
        date.setUTCDate(1);
        date.setUTCMonth(date.getUTCMonth() - offset.toNumber());
        const last = new Date(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
        ).getUTCDate();
        date.setUTCDate(Math.min(day, last));
      }
      if (date.getUTCFullYear() < 1000) return invalid('回退日期超出支持范围');
      return dateNumber(date);
    }
    const a = arg(0);
    switch (node.name) {
      case 'abs':
        return a.abs();
      case 'min':
        return Decimal.min(...node.args.map(run));
      case 'max':
        return Decimal.max(...node.args.map(run));
      case 'sum':
        return node.args.reduce((total, n) => total.plus(run(n)), new Decimal(0));
      case 'floor':
        return a.floor();
      case 'ceil':
      case 'ceiling':
        return a.ceil();
      case 'int':
        return a.trunc();
      case 'sign':
        return new Decimal(a.isZero() ? 0 : a.isPositive() ? 1 : -1);
      case 'round':
      case 'trunc':
      case 'truncate': {
        const digits = node.args.length > 1 ? arg(1) : new Decimal(0);
        if (!digits.isInteger() || digits.lt(-12) || digits.gt(12))
          return invalid('小数位数须为-12至12的整数');
        const scale = new Decimal(10).pow(digits);
        return a
          .mul(scale)
          .toDecimalPlaces(0, node.name === 'round' ? Decimal.ROUND_HALF_UP : Decimal.ROUND_DOWN)
          .div(scale);
      }
      case 'mod': {
        const b = arg(1);
        if (b.isZero()) return invalid('除数为零');
        return a.mod(b);
      }
      default:
        return invalid('未支持');
    }
  }
  const a = run(node.left);
  if (node.op === 'and' || node.op === '&&') return truth(!a.isZero() && !run(node.right).isZero());
  if (node.op === 'or' || node.op === '||') return truth(!a.isZero() || !run(node.right).isZero());
  const b = run(node.right);
  switch (node.op) {
    case '+':
      return a.plus(b);
    case '-':
      return a.minus(b);
    case '*':
      return a.mul(b);
    case '/':
    case '%':
      if (b.isZero()) fail('DIV_ZERO', '公式除数为零', '检查除法栏目，或设置非零执行条件');
      return node.op === '/' ? a.div(b) : a.mod(b);
    case '>':
      return truth(a.gt(b));
    case '<':
      return truth(a.lt(b));
    case '>=':
      return truth(a.gte(b));
    case '<=':
      return truth(a.lte(b));
    case '=':
    case '==':
      return truth(a.eq(b));
    case '<>':
    case '!=':
      return truth(!a.eq(b));
    default:
      return fail('FORMULA', '未知运算符');
  }
}
export function validateCategory(c: Category | Omit<Category, 'id'>) {
  const keys = new Set(c.fields.map((f) => f.key));
  if (
    c.fields.some((f) =>
      ['constructor', 'prototype', '__proto__', 'gross', 'deductions', 'net'].includes(f.key),
    )
  )
    fail('FIELDS', '栏目变量使用了保留字', '换一个稳定变量名');
  if (keys.size !== c.fields.length) fail('FIELDS', '栏目变量重复');
  const formulas = c.formulas.filter((f) => f.enabled);
  if (formulas.some((f) => f.tax))
    fail(
      'TAX_FORMULA',
      '累计预扣已由内置税引擎执行，不能再定义计税公式',
      '取消自定义公式的计税标志',
    );
  const targets = new Set<string>();
  const seen = new Set<string>();
  const allTargets = new Set(formulas.map((f) => f.target));
  for (const f of formulas) {
    const field = c.fields.find((x) => x.key === f.target && !x.disabled);
    if (!field || field.kind !== 'calculated')
      fail('TARGET', `公式「${f.name}」目标须是启用的计算栏目`);
    if (targets.has(f.target)) fail('CYCLE', `栏目 ${f.target} 有重复目标公式`);
    targets.add(f.target);
    const p = parseFormula(f.expression, keys);
    const cond = f.condition ? parseFormula(f.condition, keys) : null;
    for (const ref of [...p.refs, ...(cond?.refs ?? [])]) {
      if (c.fields.find((x) => x.key === ref)?.disabled)
        fail('FIELDS', `公式引用了停用栏目 ${ref}`);
      if (allTargets.has(ref) && !seen.has(ref))
        fail(
          'CYCLE',
          `公式「${f.name}」存在循环或引用了尚未执行的目标 ${ref}`,
          '按依赖顺序排列公式，不能引用自身',
        );
    }
    seen.add(f.target);
  }
  for (const f of c.fields)
    if (!f.disabled && f.kind === 'calculated' && !targets.has(f.key))
      fail('TARGET', `计算栏目 ${f.name} 缺少启用公式`);
}
export function computeValues(
  category: Category,
  input: Record<string, number>,
  context?: FormulaContext,
) {
  const values: Record<string, number> = {};
  const details: string[] = [];
  const keys = new Set(category.fields.map((f) => f.key));
  for (const k of Object.keys(input)) if (!keys.has(k)) fail('FIELDS', `未知工资栏目 ${k}`);
  for (const f of category.fields)
    values[f.key] = f.disabled || f.kind === 'calculated' ? 0 : (input[f.key] ?? 0);
  for (const f of category.formulas.filter((x: Formula) => x.enabled)) {
    if (f.condition && evaluate(parseFormula(f.condition, keys).ast, values, context).isZero()) {
      details.push(`${f.name}：条件未满足`);
      continue;
    }
    values[f.target] = cents(evaluate(parseFormula(f.expression, keys).ast, values, context));
    details.push(`${f.name}：${f.expression} → ${values[f.target]}分`);
  }
  const total = (role: string) =>
    sum(
      category.fields.filter((f) => !f.disabled && f.role === role).map((f) => values[f.key] ?? 0),
    );
  return { values, details, gross: total('earning'), deductions: total('deduction') };
}
// 官方居民工资薪金预扣率表一；金额边界和速算扣除均以分存储。
export const BRACKETS = [
  [3600000, '0.03', 0],
  [14400000, '0.10', 252000],
  [30000000, '0.20', 1692000],
  [42000000, '0.25', 3192000],
  [66000000, '0.30', 5292000],
  [96000000, '0.35', 8592000],
  [Number.MAX_SAFE_INTEGER, '0.45', 18192000],
] as const;
export function taxForTaxable(taxable: number) {
  const b = BRACKETS.find((b) => taxable <= b[0])!;
  return {
    rate: b[1],
    quick: b[2],
    amount: Math.max(0, cents(new Decimal(Math.max(0, taxable)).mul(b[1]).minus(b[2]))),
  };
}
export function calculateTax(
  employee: Employee,
  period: number,
  tax: TaxInput,
  income: number,
  exempt: number,
  allocatedTax: number,
): TaxDetail {
  if (employee.taxKind !== 'resident')
    fail(
      'UNSUPPORTED_TAX',
      '此人员所得类型尚不支持自动计税',
      '本版仅支持居民个人普通工资薪金，请勿套用本税表',
    );
  if (period < 201901) fail('TAX_DATE', '该期间早于内置税参数施行日期');
  if (!tax.confirmed)
    fail(
      'TAX_CONFIRM',
      '尚未确认本单位累计扣除及期初税额',
      '核对专项附加不含大病医疗、其他单位已享受额后勾选确认',
    );
  const year = Math.trunc(period / 100),
    month = period % 100;
  const startYear = Number(employee.startDate.slice(0, 4)),
    startMonth = Number(employee.startDate.slice(5, 7));
  const endPeriod = employee.endDate
    ? Number(employee.endDate.slice(0, 7).replace('-', ''))
    : period;
  const first = startYear < year ? 1 : startYear === year ? startMonth : 13;
  const last = Math.min(
    month,
    endPeriod < year * 100 + 1 ? 0 : endPeriod >= year * 100 + 12 ? 12 : endPeriod % 100,
  );
  const months = Math.max(0, last - first + 1);
  if (months === 0)
    fail(
      'EMPLOYMENT',
      '该人员在本年度当前月前没有任职受雇月份',
      '核对任职起止日期；离职补发按原任职月数处理',
    );
  let expense = months * 500000;
  if (employee.policy !== 'employment') {
    if (employee.qualificationYear !== year || !employee.qualificationConfirmed)
      fail('QUALIFICATION', '优惠方式尚未逐年确认适用资格', '核对官方条件并在人事档案记录当年资格');
    if (employee.policy === 'annual60000') {
      if (period < 202101) fail('TAX_DATE', '全年费用简便方式自2021年1月起适用');
      expense = 6000000;
    } else {
      if (period < 202007) fail('TAX_DATE', '首次取得工资方式自2020年7月起适用');
      expense = month * 500000;
    }
  }
  const taxable = Math.max(
    0,
    sum([income, -exempt, -expense, -tax.special, -tax.additional, -tax.other]),
  );
  const bracket = taxForTaxable(taxable);
  const cumulativeTax = Math.max(0, sum([bracket.amount, -tax.relief]));
  const alreadyWithheld = sum([tax.openingTax, allocatedTax]);
  const diff = sum([cumulativeTax, -alreadyWithheld]);
  return {
    version: TAX_RULE.version,
    income,
    exempt,
    months,
    expense,
    special: tax.special,
    additional: tax.additional,
    other: tax.other,
    taxable,
    rate: bracket.rate,
    quick: bracket.quick,
    relief: tax.relief,
    cumulativeTax,
    openingTax: tax.openingTax,
    allocatedTax,
    alreadyWithheld,
    currentTax: Math.max(0, diff),
    refundDeferred: Math.max(0, -diff),
  };
}
