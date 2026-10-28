import type { Category, Employee, RowInput, SalaryRow } from '../shared';
import { calculateTax, computeValues, fail, sum } from './engine';

export type PriorSalary = { period: number; row: SalaryRow };
export function calculateSalarySnapshot(
  category: Category,
  period: number,
  input: RowInput,
  employee: Employee,
  history: PriorSalary[],
): SalaryRow {
  const computed = computeValues(category, input.values, { period }, input.quantities);
  if (category.taxMode === 'custom') {
    if (!input.tax.confirmed)
      fail(
        'TAX_CONFIRM',
        '尚未确认本次自定义计税资料',
        '核对公式适用范围、工资及扣除资料，再确认计算',
      );
    const formula = category.formulas.find((f) => f.enabled && f.tax);
    if (!formula) fail('TAX_FORMULA', '缺少启用的自定义计税公式');
    const amount = computed.values[formula.target];
    if (amount === undefined || !Number.isSafeInteger(amount) || amount < 0)
      fail(
        'TAX_FORMULA',
        '自定义计税结果须为非负安全整数分',
        '修正公式；退税或已扣税调整须另行核对，不能用负税额自动退款',
      );
    return {
      ...input,
      employee,
      calculatedValues: computed.values,
      ...(input.quantities ? { calculatedQuantities: { ...input.quantities } } : {}),
      formulaDetails: [
        ...computed.details,
        `自定义计税「${formula.name}」：${formula.expression}，本次税额${amount}分`,
      ],
      gross: computed.gross,
      deductions: computed.deductions,
      taxAmount: amount,
      net: sum([computed.gross, -computed.deductions, -amount]),
      detail: {
        version: `custom-formula-${category.id}-${category.revision}`,
        income: computed.gross,
        exempt: input.tax.exempt,
        months: 0,
        expense: 0,
        special: input.tax.special,
        additional: input.tax.additional,
        other: input.tax.other,
        taxable: 0,
        rate: '自定义',
        quick: 0,
        relief: input.tax.relief,
        cumulativeTax: amount,
        openingTax: input.tax.openingTax,
        allocatedTax: 0,
        alreadyWithheld: 0,
        currentTax: amount,
        refundDeferred: 0,
      },
    };
  }
  const prior = history.filter(
    (p) => p.row.employeeId === input.employeeId && (period >= 201901 || p.period === period),
  );
  for (const p of prior) {
    if (
      p.row.tax.openingIncome !== input.tax.openingIncome ||
      p.row.tax.openingTax !== input.tax.openingTax
    )
      fail(
        'OPENING_CHANGED',
        '同年本单位期初收入或已扣税与历史不一致',
        '从该人员本年首批工资发起前期更正，统一核对期初数',
      );
    if (
      p.period === period &&
      (['special', 'additional', 'other', 'relief', 'confirmed'] as const).some(
        (k) => p.row.tax[k] !== input.tax[k],
      )
    )
      fail(
        'MONTH_DEDUCTION',
        '同人同月跨类别的累计扣除必须一致',
        '复用本月已确认的扣除；更正时核对所有同月类别',
      );
    if (
      p.row.employee.taxKind !== employee.taxKind ||
      p.row.employee.policy !== employee.policy ||
      p.row.employee.qualificationYear !== employee.qualificationYear
    )
      fail(
        'POLICY_CHANGED',
        '同年计税方式已被历史批次使用',
        '历史更正使用原人事快照；如需改计税身份须先核对全年工资',
      );
  }
  const income = sum([input.tax.openingIncome, computed.gross, ...prior.map((p) => p.row.gross)]);
  const exempt = sum([input.tax.exempt, ...prior.map((p) => p.row.tax.exempt)]);
  if (income < 0 || exempt > income) fail('TAX_BASE', '累计收入不能为负且累计免税收入不能超过收入');
  const detail = calculateTax(
    employee,
    period,
    input.tax,
    income,
    exempt,
    sum(prior.map((p) => p.row.taxAmount)),
  );
  return {
    ...input,
    employee,
    calculatedValues: computed.values,
    ...(input.quantities ? { calculatedQuantities: { ...input.quantities } } : {}),
    formulaDetails: computed.details,
    gross: computed.gross,
    deductions: computed.deductions,
    taxAmount: detail.currentTax,
    net: sum([computed.gross, -computed.deductions, -detail.currentTax]),
    detail,
  };
}
