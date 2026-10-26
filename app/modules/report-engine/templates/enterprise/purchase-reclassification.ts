import { z } from 'zod';
import { isPeriod, makePeriod, periodYear, type Account, type DimensionItem } from '@caiwu/core';
import { balanceFormula, ReportTemplateSchema, type ReportTemplate } from '../../shared';
import { balanceSheetSlots, enterpriseBalanceSheet } from './index';

const code = z.string().regex(/^\d{1,20}$/);
const roots = z.array(code).min(1).max(6);
const reason = z.string().trim().min(1, '必须填写列报依据').max(500);
const ClassificationSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('current'), reason }).strict(),
  z.object({ state: z.literal('excluded'), reason, destination: reason }).strict(),
]);
const PurchaseDateSchema = z
  .object({
    prepayments: roots,
    payables: roots,
    items: z
      .array(
        z
          .object({
            account: code,
            partner: z.string().trim().min(1).max(40),
            debit: ClassificationSchema,
            credit: ClassificationSchema,
          })
          .strict(),
      )
      .min(1)
      .max(120),
  })
  .strict();
export const PurchaseSchema = z
  .object({
    period: z.number().int().refine(isPeriod, '请选择有效的报告期间'),
    current: PurchaseDateSchema,
    previous: PurchaseDateSchema,
  })
  .strict();
export type PurchaseDateBindings = z.input<typeof PurchaseDateSchema>;
export type PurchaseBindings = z.input<typeof PurchaseSchema>;
type DateBindings = z.infer<typeof PurchaseDateSchema>;
type Classification = z.infer<typeof ClassificationSchema>;

export function validatePurchaseDate(
  b: DateBindings,
  accounts: readonly Account[],
  partners: readonly DimensionItem[],
) {
  const allRoots = [...b.prepayments, ...b.payables];
  for (const [i, root] of allRoots.entries()) {
    if (!accounts.some((a) => a.code === root)) throw new Error(`采购侧来源账户 ${root} 不存在`);
    if (allRoots.slice(i + 1).some((r) => r.startsWith(root) || root.startsWith(r)))
      throw new Error('预付/应付来源账户重复或父子重叠');
    if (!accounts.some((a) => a.isLeaf && a.code.startsWith(root)))
      throw new Error(`采购侧来源账户 ${root} 没有可取数的末级账户`);
  }
  const seen = new Set<string>();
  for (const item of b.items) {
    const account = accounts.find((a) => a.code === item.account);
    if (!account?.isLeaf || !allRoots.some((r) => item.account.startsWith(r)))
      throw new Error(`采购侧分类必须指定来源范围内的末级账户：${item.account}`);
    if (!account.dimensions.some((d) => d.type === 'partner'))
      throw new Error(`采购侧末级账户 ${item.account} 缺少往来辅助核算，不能冒充已逐往来分类`);
    if (!partners.some((p) => p.typeId === 'partner' && p.isLeaf && p.code === item.partner))
      throw new Error(`采购侧往来对象 ${item.partner} 不存在或不是末级`);
    const key = JSON.stringify([item.account, item.partner]);
    if (seen.has(key)) throw new Error('同一末级账户及往来对象不能重复分类或同时列入与排除');
    seen.add(key);
  }
}

function put(t: ReportTemplate, address: string, source: string, formula = false) {
  const cell = {
    address,
    source,
    kind: formula ? ('formula' as const) : ('text' as const),
    unit: formula ? ('cents' as const) : ('number' as const),
    currency: 'CNY',
  };
  const index = t.cells.findIndex((c) => c.address === address);
  if (index < 0) t.cells.push(cell);
  else t.cells[index] = cell;
  t.styles = t.styles.filter((s) => s.address !== address);
  t.styles.push({
    address,
    align: formula ? 'right' : 'left',
    wrap: true,
    bold: false,
    format: formula ? 'decimal2' : 'general',
  });
}
function note(t: ReportTemplate, message: string) {
  const row = ++t.rows;
  put(t, `A${row}`, message);
  t.merges.push({ row, col: 1, rows: 1, cols: t.cols });
  t.rowHeights.push({ row, height: 100 });
  return `A${row}`;
}
function description(c: Classification, debit: boolean) {
  return c.state === 'current'
    ? `列入${debit ? '预付款项' : '应付账款'}；依据：${c.reason}`
    : `排除本流动项目；另列去向：${c.destination}；依据：${c.reason}`;
}
function amount(account: string, partner: string | undefined, previous: boolean, debit: boolean) {
  const period = previous ? 'previousYearEnd' : 'current';
  return balanceFormula({
    account,
    metric: 'closing',
    unit: 'cents',
    currency: 'CNY',
    direction: 'signed',
    dimension: partner === undefined ? 'none' : 'partner',
    item: partner ?? '',
    options: {
      from: period,
      to: period,
      groupBy: ['partner'],
      side: debit ? 'debit' : 'credit',
    },
  });
}
function sum(addresses: string[], zero: string) {
  // 没有流动明细时，零仍继承真实来源的金额单位，不将缺失来源当作常量零。
  return addresses.length ? `SUM(${addresses.join(',')})` : `${zero}*0`;
}

function fill(t: ReportTemplate, b: DateBindings, period: number, previous: boolean) {
  const label = `${previous ? '上年年末' : '本期末'} ${period}`;
  const missing = note(
    t,
    `${label}采购分类缺失：来源分借贷金额与已分类往来不符。请补齐未分配往来、未标往来或新增明细的两方向列报及排除依据后重建模板。`,
  );
  const all = { debit: [] as string[], credit: [] as string[] };
  const declared = { debit: [] as string[], credit: [] as string[] };
  const current = { debit: [] as string[], credit: [] as string[] };
  for (const account of [...b.prepayments, ...b.payables]) {
    const row = ++t.rows;
    put(t, `A${row}`, `${label}采购来源 ${account}：逐末级逐往来先分借贷，不相互抵销`);
    put(t, `B${row}`, amount(account, undefined, previous, true), true);
    // side=credit 已返回正贷方金额，不能再取负。
    put(t, `E${row}`, amount(account, undefined, previous, false), true);
    all.debit.push(`B${row}`);
    all.credit.push(`E${row}`);
  }
  for (const item of b.items) {
    note(t, `${label} ${item.account}/${item.partner}：借方${description(item.debit, true)}`);
    note(t, `${label} ${item.account}/${item.partner}：贷方${description(item.credit, false)}`);
    const row = ++t.rows;
    put(t, `A${row}`, `${label}已分类明细 ${item.account}/${item.partner}（B借方/E正贷方）`);
    put(t, `B${row}`, amount(item.account, item.partner, previous, true), true);
    put(t, `E${row}`, amount(item.account, item.partner, previous, false), true);
    declared.debit.push(`B${row}`);
    declared.credit.push(`E${row}`);
    if (item.debit.state === 'current') current.debit.push(`B${row}`);
    if (item.credit.state === 'current') current.credit.push(`E${row}`);
  }
  const row = ++t.rows;
  put(t, `A${row}`, `${label}采购侧完整性：B/E来源借贷；C/F已分类借贷（含明确排除）`);
  put(t, `B${row}`, sum(all.debit, missing), true);
  put(t, `E${row}`, sum(all.credit, missing), true);
  put(t, `C${row}`, sum(declared.debit, `B${row}`), true);
  put(t, `F${row}`, sum(declared.credit, `E${row}`), true);
  const guard = (source: string) =>
    `IF(B${row}=C${row},IF(E${row}=F${row},${source},${missing}),${missing})`;
  const column = previous ? 'comparative' : 'current';
  put(t, balanceSheetSlots.prepayments![column], guard(sum(current.debit, `B${row}`)), true);
  put(t, balanceSheetSlots.accountsPayable![column], guard(sum(current.credit, `E${row}`)), true);
}

/**
 * 201采购侧两行切片。固定报告期和逐方向分类由公共profile事务门禁复核。
 * 仅核对调用方明确指定的预付/应付来源；不推断遗漏来源、合同净额或期限。
 * 未配置的其余官方项目保持文字，不作为完整法定报表。
 */
export function buildPurchaseReclassificationComparatives(
  raw: PurchaseBindings,
  accounts: readonly Account[],
  partners: readonly DimensionItem[],
) {
  const b = PurchaseSchema.parse(raw);
  validatePurchaseDate(b.current, accounts, partners);
  validatePurchaseDate(b.previous, accounts, partners);
  const previousPeriod = makePeriod(periodYear(b.period) - 1, 12);
  const t = enterpriseBalanceSheet();
  put(
    t,
    'A2',
    '采购侧两行取数切片：公共生成事务核验固定报告期、分类和来源。其余官方项目及合计仍待配置，不可作为完整法定报表。禁止使用旧页面底部自动明细链接核对本切片金额。',
  );
  put(
    t,
    'A3',
    `采购分类依据仅用于${b.period}/${previousPeriod}；仅已过账；来源变化须重新明确分类。审核只覆盖已接入采购两行，不代表全表平衡。`,
  );
  note(
    t,
    '每条分类仅适用于指定报告日的该末级账户及往来全部余额；同组需按合同/期限拆分时，须先提供可区分的明细，不在此自动拆分。排除金额仅披露去向，未自动填入其他项目；减值分配仍待实现。',
  );
  fill(t, b.current, b.period, false);
  fill(t, b.previous, previousPeriod, true);
  // 未配置的整表合计仍显示文字，不把它们作为本两行切片的已接入审核。
  t.checks = t.cells.filter(c => c.source.includes('采购侧完整性：')).flatMap(c => {
    const row = c.address.slice(1);
    return [
      { name: `${row}采购来源借方完整分类`, left: `B${row}`, right: `C${row}`, tolerance: '0' },
      { name: `${row}采购来源贷方完整分类`, left: `E${row}`, right: `F${row}`, tolerance: '0' },
    ];
  });
  t.reportIdentity = 'enterprise-purchase';
  t.profile = { mode: 'declaration', version: 1, kind: 'enterprise-purchase', scope: 'posted', period: b.period, mapping: b };
  return ReportTemplateSchema.parse(t);
}
