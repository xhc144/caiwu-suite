import { defineServerModule, type ServerModule } from '@caiwu/server-kit';
import type { DependencyBlock } from '@caiwu/core/server';
import type { PayrollTables } from '../../../modules/payroll/server/migrations';
import type { FixedAssetsTables } from '../../../modules/fixed-assets/server/migrations';
import type { InvoiceTables } from '../../../modules/invoice/server/migrations';
import type { CashierTables } from '../../../modules/cashier/server/migrations';

/** The host registers documented module tables; the core never scans or guesses private schemas. */
export function withSharedDependencies<R extends ServerModule>(module: R): R {
  if (module.manifest.id === 'payroll')
    return defineServerModule(module.manifest, {
      ...module,
      providers: {
        ...module.providers,
        dimensionReferences: [
          ...(module.providers?.dimensionReferences ?? []),
          async (ctx, id) => {
            const rows = await ctx.db
              .withTables<PayrollTables>()
              .selectFrom('payroll_employee')
              .select('id')
              .where('department_id', '=', id)
              .execute();
            return [{ category: '工资人员', count: rows.length, to: '/m/payroll/employees' }];
          },
        ],
        periodDependencies: [
          ...(module.providers?.periodDependencies ?? []),
          async (ctx, input) => {
            const db = ctx.db.withTables<PayrollTables>();
            const blocks: DependencyBlock[] = [];
            if (input.mode === 'business' && ctx.moduleId === 'payroll') {
              const closed = await db
                .selectFrom('payroll_period')
                .select('batch_id')
                .where('period', '=', input.period)
                .where('closed', '=', 1)
                .execute();
              blocks.push({ category: '工资已结账批次', count: closed.length, to: '/m/payroll' });
            }
            if (input.mode === 'year-close') {
              const unvouchered = await db
                .selectFrom('payroll_batch as b')
                .leftJoin('payroll_voucher as v', 'v.batch_id', 'b.id')
                .select('b.id')
                .where('b.period', '=', input.period)
                .where('v.voucher_id', 'is', null)
                .execute();
              blocks.push({
                category: '未制证工资批次',
                count: unvouchered.length,
                to: '/m/payroll',
              });
            }
            return blocks;
          },
        ],
      },
    }) as R;
  if (module.manifest.id === 'fixed-assets')
    return defineServerModule(module.manifest, {
      ...module,
      providers: {
        ...module.providers,
        dimensionReferences: [
          ...(module.providers?.dimensionReferences ?? []),
          async (ctx, id) => {
            const db = ctx.db.withTables<FixedAssetsTables>();
            const cards = await db
              .selectFrom('fixed_assets_card')
              .select('id')
              .where('department_id', '=', id)
              .execute();
            const lines = await db
              .selectFrom('fixed_assets_line')
              .select('id')
              .where('department_id', '=', id)
              .execute();
            return [
              { category: '固定资产卡片', count: cards.length, to: '/m/fixed-assets/cards' },
              { category: '历史折旧分配', count: lines.length, to: '/m/fixed-assets/queries' },
            ];
          },
        ],
        periodDependencies: [
          ...(module.providers?.periodDependencies ?? []),
          async (ctx, input) => {
            if (input.mode !== 'year-close') return [];
            const rows = await ctx.db
              .withTables<FixedAssetsTables>()
              .selectFrom('fixed_assets_batch')
              .select('id')
              .where('period', '=', input.period)
              .where('voucher_id', 'is', null)
              .execute();
            return [
              {
                category: '未制证折旧批次',
                count: rows.length,
                to: '/m/fixed-assets/depreciation',
              },
            ];
          },
        ],
      },
    }) as R;
  if (module.manifest.id === 'invoice')
    return defineServerModule(module.manifest, {
      ...module,
      providers: {
        ...module.providers,
        periodDependencies: [
          ...(module.providers?.periodDependencies ?? []),
          async (ctx, input) => {
            const db = ctx.db.withTables<InvoiceTables>();
            const blocks: DependencyBlock[] = [];
            if (input.mode === 'business' && ctx.moduleId === 'invoice') {
              const rows = await db
                .selectFrom('invoice_period')
                .select('period')
                .where('period', '=', input.period)
                .where('closed', '=', 1)
                .execute();
              blocks.push({ category: '发票已结账月份', count: rows.length, to: '/m/invoice' });
            }
            if (input.mode === 'year-close') {
              const rows = await db
                .selectFrom('invoice_document as d')
                .leftJoin('invoice_group as g', 'g.id', 'd.group_id')
                .select('d.id')
                .where('d.period', '=', input.period)
                .where('d.state', '=', 'audited')
                .where('g.voucher_id', 'is', null)
                .execute();
              blocks.push({ category: '未制证已审核发票', count: rows.length, to: '/m/invoice' });
            }
            return blocks;
          },
        ],
      },
    }) as R;
  if (module.manifest.id === 'cashier')
    return defineServerModule(module.manifest, {
      ...module,
      providers: {
        ...module.providers,
        periodDependencies: [
          ...(module.providers?.periodDependencies ?? []),
          async (ctx, input) => {
            const db = ctx.db.withTables<CashierTables>();
            const blocks: DependencyBlock[] = [];
            if (input.mode === 'business' && ctx.moduleId === 'cashier') {
              const rows = await db
                .selectFrom('cashier_period')
                .select('period')
                .where('period', '=', input.period)
                .where('closed', '=', 1)
                .execute();
              blocks.push({ category: '出纳已结账月份', count: rows.length, to: '/m/cashier' });
            }
            if (input.mode === 'year-close') {
              const rows = await db
                .selectFrom('cashier_document as d')
                .leftJoin('cashier_batch_document as b', 'b.document_id', 'd.id')
                .select('d.id')
                .where('d.period', '=', input.period)
                .where('d.deleted', '=', 0)
                .where('b.voucher_id', 'is', null)
                .execute();
              blocks.push({ category: '未制证出纳单据', count: rows.length, to: '/m/cashier' });
            }
            return blocks;
          },
        ],
      },
    }) as R;
  return module;
}
