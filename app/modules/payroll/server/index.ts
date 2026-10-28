import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { payrollRouter } from './router';
import type { PayrollTables } from './migrations';
import type { SalaryRow } from '../shared';
export default defineServerModule(manifest, {
  router: payrollRouter,
  migrations,
  providers: {
    dimensionReferences: [
      async (ctx, id) => {
        const db = ctx.db.withTables<PayrollTables>();
        const employees = await db
          .selectFrom('payroll_employee')
          .select('id')
          .where('department_id', '=', id)
          .execute();
        const snapshots = await db
          .selectFrom('payroll_row')
          .select('snapshot_json')
          .where('snapshot_json', 'is not', null)
          .execute();
        const previous = await db.selectFrom('payroll_batch').select('previous_json').execute();
        const historical =
          snapshots.filter(
            (r) => (JSON.parse(r.snapshot_json!) as SalaryRow).employee.departmentId === id,
          ).length +
          previous.reduce(
            (count, r) =>
              count +
              (JSON.parse(r.previous_json) as SalaryRow[]).filter(
                (s) => s.employee.departmentId === id,
              ).length,
            0,
          );
        const settings = await ctx.db
          .selectFrom('book_setting')
          .select('value')
          .where('scope', '=', 'payroll')
          .where('key', 'like', 'mapping.%')
          .execute();
        const mappings = settings.filter((r) => {
          const mapping = JSON.parse(r.value) as {
            rules?: { departmentId?: number }[];
            auxiliaries?: { values: Record<string, number | null> }[];
          };
          return (
            mapping.rules?.some((rule) => rule.departmentId === id) ||
            mapping.auxiliaries?.some((aux) => Object.values(aux.values).includes(id))
          );
        }).length;
        return [
          { category: '工资人事档案', count: employees.length, to: '/m/payroll/employees' },
          { category: '已计算工资部门快照', count: historical, to: '/m/payroll' },
          { category: '工资凭证辅助核算映射', count: mappings, to: '/m/payroll' },
        ].filter((r) => r.count > 0);
      },
    ],
  },
});
