import Decimal from 'decimal.js';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import type { Employee, TaxDetail, TaxInput } from '../shared';
import { HistoricalTaxConfirmSchema, HISTORICAL_TAX_RULES } from '../shared-history';
import { cents, fail, sum } from './engine';

export function historicalTaxRule(period: number) {
  const rule = HISTORICAL_TAX_RULES.find((r) => period >= r.from && period <= r.to);
  if (!rule)
    fail(
      'TAX_DATE',
      '该期间不在内置历史工资税制范围',
      '历史固定税制支持2008年3月至2018年12月；2019年起使用累计预扣',
    );
  return rule;
}
export async function historicalTaxConfig(svc: CoreServices) {
  return Promise.all(
    HISTORICAL_TAX_RULES.map(async (rule) => ({
      ...rule,
      confirmed: await svc.settings.get(`historicalTax.${rule.version}`, false),
    })),
  );
}
export async function confirmHistoricalTax(
  svc: CoreServices,
  raw: z.input<typeof HistoricalTaxConfirmSchema>,
) {
  const input = HistoricalTaxConfirmSchema.parse(raw);
  const rule = historicalTaxRule(input.period);
  if (!input.confirmed) fail('CONFIRM', '历史税制须先核对来源并确认');
  if (input.monthlyExpense !== rule.monthlyExpense)
    fail(
      'TAX_THRESHOLD',
      `${rule.name}的月减除费用应为${rule.monthlyExpense / 100}元`,
      '按实际取得工资的月份选用税制，不能将3500元和5000元标准跨期套用',
    );
  return svc.tx(async (t) => {
    await t.settings.set(`historicalTax.${rule.version}`, true);
    await t.log.write({
      action: 'payroll.tax.historical',
      summary: `确认${rule.name}，减除费用${rule.monthlyExpense / 100}元`,
    });
    return historicalTaxConfig(t);
  });
}
export async function assertTaxConfirmed(
  svc: CoreServices,
  period: number,
  currentVersion: string,
) {
  const confirmed =
    period < 201901
      ? await svc.settings.get(`historicalTax.${historicalTaxRule(period).version}`, false)
      : (await svc.settings.get('taxVersion', '')) === currentVersion;
  if (!confirmed)
    fail(
      'UNVERIFIED_TAX',
      '尚未确认本账套该期间的计税范围与参数',
      '在计税参数中核对该期间适用税制与来源并确认',
      '/m/payroll/tax',
    );
}
export function calculateHistoricalTax(
  employee: Employee,
  period: number,
  tax: TaxInput,
  income: number,
  exempt: number,
  allocatedTax: number,
): TaxDetail {
  const rule = historicalTaxRule(period);
  if (employee.taxKind !== 'resident' || employee.policy !== 'employment')
    fail(
      'UNSUPPORTED_TAX',
      '历史固定税制只适用于境内普通工资薪金',
      '核对人员所得类型，历史税制不使用2019年后的简便扣除方式',
    );
  if (!tax.confirmed)
    fail('TAX_CONFIRM', '尚未确认本月历史工资扣除', '核对本月专项及其他依法扣除，再勾选确认');
  if (tax.additional || tax.openingIncome || tax.openingTax)
    fail(
      'HISTORICAL_DEDUCTION',
      '历史按月税制不能录入2019年后的专项附加或年度期初累计数',
      '专项、其他扣除和减免按当月确认金额录入；同月跨类别金额须一致',
    );
  if (income < 0 || exempt > income) fail('TAX_BASE', '本月收入不能为负且免税收入不能超过收入');
  const taxable = Math.max(
    0,
    sum([income, -exempt, -rule.monthlyExpense, -tax.special, -tax.other]),
  );
  const bracket = rule.brackets.find((b) => taxable <= b[0])!;
  const cumulativeTax = Math.max(
    0,
    cents(new Decimal(taxable).mul(bracket[1]).minus(bracket[2]).minus(tax.relief)),
  );
  const diff = sum([cumulativeTax, -allocatedTax]);
  return {
    version: rule.version,
    income,
    exempt,
    months: 1,
    expense: rule.monthlyExpense,
    special: tax.special,
    additional: 0,
    other: tax.other,
    taxable,
    rate: bracket[1],
    quick: bracket[2],
    relief: tax.relief,
    cumulativeTax,
    openingTax: 0,
    allocatedTax,
    alreadyWithheld: allocatedTax,
    currentTax: Math.max(0, diff),
    refundDeferred: Math.max(0, -diff),
  };
}
