import Decimal from 'decimal.js';
import { BusinessError } from '@caiwu/core';
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
    actions: [{ label: '返回工资', to }],
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
  | { kind: 'unary'; node: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node };
/** 只有数字、稳定栏目变量、括号和白名单运算符；无代码执行或 SQL。常数/变量均以分计。 */
export function parseFormula(source: string, keys: Set<string>): { ast: Node; refs: Set<string> } {
  const tokens: { text: string; pos: number }[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset]!)) {
      offset++;
      continue;
    }
    const match = /^(?:\d+(?:\.\d+)?|[a-z][a-z0-9_]*|>=|<=|==|!=|[+*/()<>-])/.exec(
      source.slice(offset),
    );
    if (!match) fail('FORMULA', `公式第${offset + 1}位：不支持的字符`);
    tokens.push({ text: match[0], pos: offset });
    offset += match[0].length;
  }
  let index = 0;
  const refs = new Set<string>();
  const error = (s: string): never =>
    fail(
      'FORMULA',
      `公式第${(tokens[index]?.pos ?? source.length) + 1}位：${s}`,
      '仅支持数字、栏目变量、+ - * /、括号及比较运算符',
    );
  const peek = () => tokens[index]?.text;
  const primary = (): Node => {
    const t = peek();
    if (t === '-') {
      index++;
      return { kind: 'unary', node: primary() };
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
      if (!keys.has(t)) error(`未知栏目或未支持的函数 ${t}`);
      refs.add(t);
      index++;
      return { kind: 'variable', key: t };
    }
    return error('缺少参数或运算数');
  };
  const precedence: Record<string, number> = {
    '==': 1,
    '!=': 1,
    '>': 1,
    '<': 1,
    '>=': 1,
    '<=': 1,
    '+': 2,
    '-': 2,
    '*': 3,
    '/': 3,
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
export function evaluate(node: Node, values: Record<string, number>): Decimal {
  if (node.kind === 'number') return new Decimal(node.value);
  if (node.kind === 'variable') return new Decimal(values[node.key] ?? 0);
  if (node.kind === 'unary') return evaluate(node.node, values).neg();
  const a = evaluate(node.left, values),
    b = evaluate(node.right, values);
  switch (node.op) {
    case '+':
      return a.plus(b);
    case '-':
      return a.minus(b);
    case '*':
      return a.mul(b);
    case '/':
      if (b.isZero()) fail('DIV_ZERO', '公式除数为零', '检查除法栏目，或设置非零执行条件');
      return a.div(b);
    case '>':
      return new Decimal(a.gt(b) ? 1 : 0);
    case '<':
      return new Decimal(a.lt(b) ? 1 : 0);
    case '>=':
      return new Decimal(a.gte(b) ? 1 : 0);
    case '<=':
      return new Decimal(a.lte(b) ? 1 : 0);
    case '==':
      return new Decimal(a.eq(b) ? 1 : 0);
    case '!=':
      return new Decimal(a.eq(b) ? 0 : 1);
    default:
      return fail('FORMULA', '未知运算符');
  }
}
export function validateCategory(c: Category | Omit<Category, 'id'>) {
  const keys = new Set(c.fields.map((f) => f.key));
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
export function computeValues(category: Category, input: Record<string, number>) {
  const values: Record<string, number> = {};
  const details: string[] = [];
  const keys = new Set(category.fields.map((f) => f.key));
  for (const k of Object.keys(input)) if (!keys.has(k)) fail('FIELDS', `未知工资栏目 ${k}`);
  for (const f of category.fields)
    values[f.key] = f.disabled || f.kind === 'calculated' ? 0 : (input[f.key] ?? 0);
  for (const f of category.formulas.filter((x: Formula) => x.enabled)) {
    if (f.condition && evaluate(parseFormula(f.condition, keys).ast, values).isZero()) {
      details.push(`${f.name}：条件未满足`);
      continue;
    }
    values[f.target] = cents(evaluate(parseFormula(f.expression, keys).ast, values));
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
