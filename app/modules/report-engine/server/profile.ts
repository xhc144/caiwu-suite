import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BusinessError, type Account } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { Report, ReportProfile, ReportSnapshot, ReportTemplate } from '../shared';
import type { ReportTables } from './migrations';
import {
  PurchaseSchema,
  buildPurchaseReclassificationComparatives,
} from '../templates/enterprise/purchase-reclassification';
import { extendedBalanceSheetTemplate } from '../templates/small-business/extended';
import {
  inventoryRoles,
  officialInventoryMapping,
  validateInventoryMapping,
  type InventoryMapping,
} from '../templates/small-business/inventory-balance';
import {
  Balance401MappingSchema,
  balance401ClosingTemplate,
  balance401AnnualTemplate,
  checkBalance401Sources,
  validateBalance401AnnualGeneration,
} from '../templates/nonprofit/balance-sheet';
import {
  ActivityTotalsMappingSchema,
  activity402TotalsTemplate,
  checkActivityTotalsSources,
} from '../templates/nonprofit/activity-totals';
import {
  ActivityClassifiedMappingSchema,
  activity402ClassifiedTemplate,
  checkActivityClassifiedSources,
  type ActivityRecognition,
} from '../templates/nonprofit/activity-classified';
import {
  Cashflow403MappingSchema,
  cashflow403Template,
  cashflow403GenerateGuard,
  validateCashflow403Generation,
} from '../templates/nonprofit/cashflow';
import {
  ComparativeCashflowSchema,
  comparativeCashflow403Template,
  validateComparativeCashflow403Generation,
} from '../templates/nonprofit/cashflow-comparative';

export function profileError(message: string): never {
  throw new BusinessError({
    code: 'REPORT_PROFILE',
    message,
    hint: '请核对固定报告期、完整科目及实际来源，明确重新确认分类后引入新版本；旧结果仍保留。',
  });
}
function ordered(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordered);
  if (v !== null && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, value]) => [k, ordered(value)]),
    );
  return v;
}
export const fingerprint = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(ordered(v)) ?? 'undefined')
    .digest('hex');
const profileMeaning = (p: ReportProfile | undefined) =>
  p === undefined
    ? undefined
    : {
        version: p.version,
        kind: p.kind,
        scope: p.scope,
        period: p.period,
        mapping: p.mapping,
      };
/** 复制可改编码/名称和版式；公式、审核及结构化身份不允许借此降级。 */
export const definitionFingerprint = (t: ReportTemplate) =>
  fingerprint({
    rows: t.rows,
    cols: t.cols,
    reportIdentity: t.reportIdentity,
    profile: profileMeaning(t.profile),
    cells: [...t.cells].sort((a, b) => a.address.localeCompare(b.address)),
    checks: t.checks,
  });
const inventorySchema = z.record(
  z.enum(inventoryRoles.map((r) => r.role)),
  z.union([
    z
      .object({
        accounts: z
          .array(z.string().regex(/^\d{4,20}$/))
          .min(1)
          .max(120),
      })
      .strict(),
    z.object({ absent: z.object({ reason: z.string().trim().min(1).max(500) }).strict() }).strict(),
  ]),
);
const inventoryMapping = (p: ReportProfile): InventoryMapping =>
  inventorySchema.parse(p.mapping.inventory);
const annual401 = z
  .object({ closing: Balance401MappingSchema, opening: Balance401MappingSchema })
  .strict();

/** 唯一注册点，使用产品真实工厂和校验器，不另写取数实现。 */
async function canonical(svc: CoreServices, p: ReportProfile): Promise<ReportTemplate> {
  switch (p.kind) {
    case 'enterprise-purchase':
      return buildPurchaseReclassificationComparatives(
        PurchaseSchema.parse(p.mapping),
        await svc.accounts.list(),
        await svc.dimensions.items('partner'),
      );
    case 'small-business-inventory': {
      const mapping = inventoryMapping(p);
      if (fingerprint(mapping) === fingerprint(officialInventoryMapping) && p.period === undefined)
        return extendedBalanceSheetTemplate();
      return extendedBalanceSheetTemplate({
        mapping,
        accounts: await svc.accounts.list(),
        ...(p.period === undefined ? {} : { period: p.period }),
      });
    }
    case 'nonprofit-balance401':
      return balance401ClosingTemplate(Balance401MappingSchema.parse(p.mapping));
    case 'nonprofit-balance401-annual': {
      const m = annual401.parse(p.mapping);
      return balance401AnnualTemplate(m.closing, m.opening);
    }
    case 'nonprofit-activity402-totals':
      return activity402TotalsTemplate(ActivityTotalsMappingSchema.parse(p.mapping));
    case 'nonprofit-activity402-classified':
      return activity402ClassifiedTemplate(ActivityClassifiedMappingSchema.parse(p.mapping));
    case 'nonprofit-cashflow403':
      return cashflow403Template(
        Cashflow403MappingSchema.parse(p.mapping),
        p.period ?? profileError('现金流量profile缺少固定报告期'),
      );
    case 'nonprofit-cashflow403-comparative':
      return comparativeCashflow403Template(
        ComparativeCashflowSchema.parse(p.mapping),
        p.period ?? profileError('比较现金流量profile缺少固定报告期'),
      );
  }
}
export async function validateProfileDefinition(svc: CoreServices, t: ReportTemplate) {
  if (!t.profile) return;
  if (t.reportIdentity !== t.profile.kind) profileError('模板身份与持久profile不一致');
  const expectedRegime = t.profile.kind.startsWith('nonprofit-')
    ? 'nonprofit'
    : t.profile.kind.startsWith('small-business-')
      ? 'small-business'
      : 'enterprise';
  if ((await svc.book.info()).regime !== expectedRegime)
    profileError('实际账套会计制度与profile模板类型不一致，不能仅换名称使用');
  try {
    if (definitionFingerprint(await canonical(svc, t.profile)) !== definitionFingerprint(t))
      profileError('模板公式、审核或分类与profile工厂不一致，不能以自定义公式冒充已绑定切片');
  } catch (e) {
    profileError(`profile模板校验失败：${e instanceof Error ? e.message : '定义无效'}`);
  }
}

function relevantAccounts(p: ReportProfile, accounts: Account[], pnl: Set<string>) {
  if (p.kind === 'enterprise-purchase') {
    const m = PurchaseSchema.parse(p.mapping);
    const roots = [
      ...m.current.prepayments,
      ...m.current.payables,
      ...m.previous.prepayments,
      ...m.previous.payables,
    ];
    return accounts.filter((a) => roots.some((r) => a.code.startsWith(r)));
  }
  if (p.kind.startsWith('nonprofit-activity402'))
    return accounts.filter((a) => pnl.has(a.categoryId));
  if (p.kind.startsWith('nonprofit-cashflow403')) {
    const roots = accounts.filter((a) => a.isCash || a.isBank).map((a) => a.code);
    return accounts.filter((a) => roots.some((r) => a.code.startsWith(r)));
  }
  // 401及301还读取其它余额项目，完整相关账务来源包含其所有取数账户。
  return accounts;
}
export async function profileSourceState(svc: CoreServices, p: ReportProfile, period: number) {
  const book = await svc.book.info();
  const accounts = await svc.accounts.list({ includeDisabled: true });
  const categories = await svc.accounts.categories();
  const related = relevantAccounts(
    p,
    accounts,
    new Set(categories.filter((c) => c.isPnl).map((c) => c.id)),
  );
  const ids = related.map((a) => a.id);
  const dimensions = await svc.db.selectFrom('dimension_item').selectAll().orderBy('id').execute();
  let entriesQuery = svc.db
    .selectFrom('voucher_line as l')
    .innerJoin('voucher as v', 'v.id', 'l.voucher_id')
    .selectAll('l')
    .select([
      'v.revision as source_revision',
      'v.date as source_date',
      'v.status as source_status',
      'v.voided as source_voided',
      'v.source_module',
      'v.source_type',
      'v.source_id',
      'v.closing_kind',
      'v.period as source_period',
    ])
    .where('l.account_id', 'in', ids.length ? ids : [-1])
    .where('l.period', '<=', period);
  if (p.kind.startsWith('nonprofit-activity402'))
    entriesQuery = entriesQuery
      .where('l.period', '>=', Math.floor(period / 100) * 100 + 1)
      .where((eb) => eb.or([eb('v.closing_kind', 'is', null), eb('v.closing_kind', '!=', 'pnl')]));
  const entries = await entriesQuery.orderBy('l.id').limit(200001).execute();
  if (entries.length > 200000) profileError('相关来源分录超过200000条，无法保证完整核验');
  const openings = await svc.db
    .selectFrom('opening_balance')
    .selectAll()
    .where('account_id', 'in', ids.length ? ids : [-1])
    .where('year', '<=', Math.floor(period / 100))
    .orderBy('id')
    .execute();
  const fiscal = await svc.db
    .selectFrom('fiscal_year')
    .selectAll()
    .where('year', '<=', Math.floor(period / 100))
    .orderBy('year')
    .execute();
  const periods = await svc.periods.list();
  const state = {
    bookId: book.id,
    accountFingerprint: fingerprint({
      accounts: accounts.map((a) => ({
        id: a.id,
        code: a.code,
        parentId: a.parentId,
        level: a.level,
        categoryId: a.categoryId,
        direction: a.direction,
        isLeaf: a.isLeaf,
        isCash: a.isCash,
        isBank: a.isBank,
        cashflowRequired: a.cashflowRequired,
        isPartner: a.isPartner,
        currency: a.currency,
        quantityUnit: a.quantityUnit,
        dimensions: a.dimensions,
      })),
      categories,
    }),
    dimensionFingerprint: fingerprint(
      dimensions.map((d) => ({
        id: d.id,
        type_id: d.type_id,
        code: d.code,
        parent_id: d.parent_id,
        is_leaf: d.is_leaf,
        attrs: d.attrs,
      })),
    ),
    sourceFingerprint: fingerprint({
      entries,
      openings,
      fiscal,
      periods: periods.filter((v) => v.period <= period).map((v) => v.period),
      startPeriod: book.startPeriod,
      baseCurrency: book.baseCurrency,
      regime: book.regime,
      templateId: book.templateId,
      product: book.product,
    }),
  };
  return { state, entries, accounts };
}
type SourceState = Awaited<ReturnType<typeof profileSourceState>>['state'];
const accountMeaning = (a: Account) => ({
  id: a.id,
  code: a.code,
  categoryId: a.categoryId,
  direction: a.direction,
  currency: a.currency,
  quantityUnit: a.quantityUnit,
  dimensions: a.dimensions,
  isCash: a.isCash,
  isBank: a.isBank,
  cashflowRequired: a.cashflowRequired,
});
type Recognition = ActivityRecognition;
async function recognitionManifest(
  svc: CoreServices,
  p: ReportProfile,
  period: number,
): Promise<Recognition[]> {
  if (p.kind !== 'nonprofit-activity402-classified') return [];
  const m = ActivityClassifiedMappingSchema.parse(p.mapping);
  const { entries, accounts } = await profileSourceState(svc, p, period);
  const classes = Object.values(m.groups).flatMap((g) =>
    (['unrestricted', 'restricted'] as const).flatMap((classification) =>
      g[classification].map((leaf) => ({ ...leaf, classification })),
    ),
  );
  const actual = entries
    .filter((e) => e.source_status === 'posted' && !e.source_voided)
    .map((e) => {
      const account = accounts.find((a) => a.id === e.account_id)!.code;
      const leaf = classes.find((c) => c.account === account);
      if (!leaf?.exclusiveResource)
        profileError(`实际分录${e.id}没有专用末级排他来源声明：${account}`);
      return {
        voucherId: e.voucher_id,
        lineId: e.id,
        revision: e.source_revision,
        period: e.period,
        account,
        debit: e.debit,
        credit: e.credit,
        classification: leaf.classification,
        resourceReference: leaf.evidence.resourceReference,
        sourceReference: leaf.evidence.sourceReference,
        classificationBasis: {
          exclusiveResource: leaf.exclusiveResource,
          evidence: leaf.evidence,
          ...('recognitionReference' in leaf
            ? { recognitionReference: leaf.recognitionReference }
            : {}),
        },
      };
    });
  if (fingerprint([...m.recognitions].sort((a, b) => a.lineId - b.lineId)) !== fingerprint(actual))
    profileError(
      '完整逐笔确认清单与实际分录ID、金额、期间、来源版本、资源或分类依据不一致，须重新逐笔确认；同末级混合分类尚不支持',
    );
  // 保存用户明确提交并经逐行核对的确认，不能把来源冻结当作初始分类确认。
  return [...m.recognitions].sort((a, b) => a.lineId - b.lineId);
}
export type ProfileBinding = {
  version: 1;
  definitionRevision: number;
  profileFingerprint: string;
  definitionFingerprint: string;
  sourcePeriod: number;
  fixedPeriod: number | null;
  initial: SourceState;
  recognitions: Recognition[];
  confirmedBy: number;
  confirmedAt: string;
  accountMeanings: ReturnType<typeof accountMeaning>[];
};
export async function createProfileBinding(
  svc: CoreServices,
  t: ReportTemplate,
): Promise<ProfileBinding | null> {
  if (!t.profile) return null;
  await validateProfileDefinition(svc, t);
  const p = t.profile;
  if (p.period === undefined && !rollingInventory(p))
    profileError('分类profile必须明确固定报告期，不能由首次生成或重新导入隐式改变');
  let sourcePeriod = p.period;
  if (sourcePeriod === undefined) {
    const mapping = p.mapping;
    const year =
      p.kind === 'nonprofit-cashflow403'
        ? Cashflow403MappingSchema.parse(mapping).year
        : p.kind === 'nonprofit-cashflow403-comparative'
          ? ComparativeCashflowSchema.parse(mapping).current.year
          : undefined;
    sourcePeriod =
      year === undefined
        ? Math.max(...(await svc.periods.list()).map((v) => v.period))
        : year * 100 + 12;
  }
  const initial = (await profileSourceState(svc, p, sourcePeriod)).state;
  if (p.mode === 'bound' && fingerprint(p.binding) !== fingerprint({ ...initial, sourcePeriod }))
    profileError('导入的已绑定profile与原账套或实际来源印记不一致，不能靠换编码重新绑定旧分类');
  return {
    version: 1,
    definitionRevision: 1,
    profileFingerprint: fingerprint(profileMeaning(p)),
    definitionFingerprint: definitionFingerprint(t),
    sourcePeriod,
    fixedPeriod: p.period ?? null,
    initial,
    recognitions: await recognitionManifest(svc, p, sourcePeriod),
    confirmedBy: svc.user.id,
    confirmedAt: svc.ctx.now().toISOString(),
    accountMeanings: (await svc.accounts.list({ includeDisabled: true })).map(accountMeaning),
  };
}
export function boundTemplate(t: ReportTemplate, binding: ProfileBinding | null): ReportTemplate {
  if (!t.profile || !binding) return t;
  return {
    ...t,
    profile: {
      ...t.profile,
      mode: 'bound',
      binding: { ...binding.initial, sourcePeriod: binding.sourcePeriod },
    },
  };
}
export async function readProfileBinding(svc: CoreServices, id: number) {
  const row = await svc.db
    .withTables<ReportTables>()
    .selectFrom('report_engine_template')
    .select('profile_binding_json')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return row.profile_binding_json ? (JSON.parse(row.profile_binding_json) as ProfileBinding) : null;
}
export const rollingInventory = (p: ReportProfile) =>
  p.kind === 'small-business-inventory' &&
  p.period === undefined &&
  fingerprint(inventoryMapping(p)) === fingerprint(officialInventoryMapping);

export async function validateSavedProfile(
  svc: CoreServices,
  report: Report,
  input: { period: number; includeUnposted: boolean },
): Promise<NonNullable<ReportSnapshot['profileProofs']>[number] | null> {
  const p = report.template.profile;
  const binding = await readProfileBinding(svc, report.id);
  if (!p) {
    if (binding || report.template.reportIdentity)
      profileError('法定模板缺少持久profile绑定，旧无guard定义不能作为可信报表生成');
    return null;
  }
  if (
    !binding ||
    p.mode !== 'bound' ||
    binding.version !== 1 ||
    binding.definitionRevision !== report.revision ||
    binding.profileFingerprint !== fingerprint(profileMeaning(p)) ||
    fingerprint(p.binding) !==
      fingerprint({ ...binding.initial, sourcePeriod: binding.sourcePeriod }) ||
    binding.definitionFingerprint !== definitionFingerprint(report.template)
  )
    profileError('已保存模板及revision与持久profile绑定不一致');
  if (input.includeUnposted) profileError('已绑定切片仅允许已过账口径');
  if (binding.fixedPeriod !== null && binding.fixedPeriod !== input.period)
    profileError('生成报告期与固定分类依据期间不一致，请重新确认该月profile');
  await validateProfileDefinition(svc, report.template);
  try {
    switch (p.kind) {
      case 'enterprise-purchase': {
        const m = PurchaseSchema.parse(p.mapping);
        if (input.period !== m.period) profileError('采购分类依据报告期不一致');
        await svc.periods.require(m.period);
        await svc.periods.require((Math.floor(m.period / 100) - 1) * 100 + 12);
        break;
      }
      case 'small-business-inventory':
        {
          const accounts = await svc.accounts.list({ includeDisabled: true });
          validateInventoryMapping(inventoryMapping(p), accounts);
          for (const a of accounts) {
            const previous = binding.accountMeanings.find((old) => old.code === a.code);
            if (previous && fingerprint(previous) !== fingerprint(accountMeaning(a)))
              profileError(`科目语义或核算角色已变更，须重新确认profile：${a.code}`);
          }
          const pnl = new Set(
            (await svc.accounts.categories()).filter((c) => c.isPnl).map((c) => c.id),
          );
          for (const a of accounts)
            if (inventoryRoles.some((r) => a.code.startsWith(r.code)) && pnl.has(a.categoryId))
              profileError(`存货角色不能映射损益类实际科目：${a.code}`);
        }
        break;
      case 'nonprofit-balance401':
        await checkBalance401Sources(
          svc,
          input.period,
          Balance401MappingSchema.parse(p.mapping),
          input,
        );
        break;
      case 'nonprofit-balance401-annual':
        await validateBalance401AnnualGeneration(svc, input, annual401.parse(p.mapping));
        break;
      case 'nonprofit-activity402-totals':
        await checkActivityTotalsSources(
          svc,
          input.period,
          ActivityTotalsMappingSchema.parse(p.mapping),
          input,
        );
        break;
      case 'nonprofit-activity402-classified':
        await checkActivityClassifiedSources(
          svc,
          input.period,
          ActivityClassifiedMappingSchema.parse(p.mapping),
          input,
        );
        if (
          fingerprint(await recognitionManifest(svc, p, binding.sourcePeriod)) !==
          fingerprint(binding.recognitions)
        )
          profileError('实际收入费用分录或资源分类已变更，须重新逐笔确认；不支持同末级混合分类');
        break;
      case 'nonprofit-cashflow403':
        await validateCashflow403Generation(
          svc,
          input,
          cashflow403GenerateGuard(Cashflow403MappingSchema.parse(p.mapping)),
        );
        break;
      case 'nonprofit-cashflow403-comparative':
        await validateComparativeCashflow403Generation(
          svc,
          input,
          ComparativeCashflowSchema.parse(p.mapping),
        );
        break;
    }
  } catch (e) {
    profileError(`profile来源校验失败：${e instanceof Error ? e.message : '来源无效'}`);
  }
  const imported = (await profileSourceState(svc, p, binding.sourcePeriod)).state;
  if (imported.bookId !== binding.initial.bookId) profileError('profile所属账套不一致');
  if (
    p.kind !== 'small-business-inventory' &&
    fingerprint(imported) !== fingerprint(binding.initial)
  )
    profileError('profile相关来源、科目结构或分类版本已变更，请重新确认，不能复用旧快照');
  const current = (await profileSourceState(svc, p, input.period)).state;
  return {
    reportId: report.id,
    revision: report.revision,
    profileFingerprint: binding.profileFingerprint,
    definitionFingerprint: binding.definitionFingerprint,
    ...current,
  };
}
