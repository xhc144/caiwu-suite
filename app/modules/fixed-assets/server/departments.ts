import { BusinessError, notFound } from '@caiwu/core';
import type { CoreServiceProviders, CoreServices } from '@caiwu/core/server';
import type { FixedAssetsTables } from './migrations';

/** Keep department deletion safe even when invoked from another module. */
export const assetDepartmentReferences: NonNullable<
  CoreServiceProviders['dimensionReferences']
>[number] = async (ctx, id) => {
  const db = ctx.db.withTables<FixedAssetsTables>();
  const [cards, lines] = await Promise.all([
    db
      .selectFrom('fixed_assets_card')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('department_id', '=', id)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('fixed_assets_line')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('department_id', '=', id)
      .executeTakeFirstOrThrow(),
  ]);
  return [
    { category: '资产卡片', count: cards.count, to: '/m/fixed-assets/cards?includeDisposed=true' },
    { category: '资产折旧记录', count: lines.count, to: '/m/fixed-assets/queries' },
  ].filter((reference) => reference.count > 0);
};

export type DepartmentDeletePlan = {
  id: number;
  revision: number;
  expiresAt: number;
  fingerprint: string;
};

export function departmentService(svc: CoreServices) {
  const requireEdit = () => svc.permissions.require('fixed-assets.edit');
  const requireDepartment = async (id: number) => {
    const item = await svc.dimensions.get(id);
    if (!item || item.typeId !== 'department') throw notFound('部门', id);
    return item;
  };
  return {
    async list() {
      svc.permissions.require('fixed-assets.view');
      return svc.dimensions.items('department');
    },
    async save(input: {
      id?: number;
      revision?: number;
      code: string;
      name: string;
      disabled: boolean;
    }) {
      requireEdit();
      return svc.tx(async (ts) => {
        if (input.id == null) {
          const item = await ts.dimensions.create({
            type: 'department',
            code: input.code,
            name: input.name,
            disabled: input.disabled,
          });
          await ts.log.write({
            action: 'department.create',
            summary: `新增部门 ${item.code} ${item.name}`,
            targetId: item.id,
          });
          return item;
        }
        await departmentService(ts).requireDepartment(input.id);
        if (input.revision == null)
          throw new BusinessError({
            code: 'DIMENSION_STALE',
            message: '缺少部门版本，不能保存',
            hint: '刷新部门列表后重新修改',
          });
        return ts.dimensions.update(
          input.id,
          { code: input.code, name: input.name, disabled: input.disabled },
          { expectedRevision: input.revision },
        );
      });
    },
    async setDisabled(id: number, disabled: boolean, revision: number) {
      requireEdit();
      return svc.tx(async (ts) => {
        await departmentService(ts).requireDepartment(id);
        return ts.dimensions.setDisabled(id, disabled, { expectedRevision: revision });
      });
    },
    async previewDelete(id: number) {
      requireEdit();
      await requireDepartment(id);
      return svc.dimensions.previewDelete(id);
    },
    async remove(plan: DepartmentDeletePlan, confirm: boolean) {
      requireEdit();
      return svc.tx(async (ts) => {
        await departmentService(ts).requireDepartment(plan.id);
        await ts.dimensions.delete(plan, confirm);
      });
    },
    requireDepartment,
  };
}
