import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import type { CardInput } from '../shared';

let app: TestApp;
const caller = (value: TestApp, token?: string) => value.call(server, token);
let api: ReturnType<typeof caller>;
let data: CardInput;

beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'minfei' });
  api = caller(app);
  data = {
    code: 'DEP-001',
    name: '部门测试设备',
    categoryId: await api.saveMaster({ data: { kind: 'category', code: '01', name: '设备' } }),
    purposeId: await api.saveMaster({ data: { kind: 'purpose', code: '01', name: '管理用' } }),
    statusId: await api.saveMaster({ data: { kind: 'status', code: '01', name: '在用' } }),
    departmentId: (await api.departments()).find((item) => item.code === '01')!.id,
    acquired: '2026-01-01',
    useDate: '2026-01-01',
    original: 600_000,
    rate: '0',
    method: '1',
    lifeMonths: 60,
  };
});
afterEach(async () => app.close());

describe('w_zc_sydw_bak 部门维护', () => {
  it('修改保持资产关联，停用保留历史并允许原卡片一般编辑，禁止新增及改派选择停用部门', async () => {
    const department = await api.saveDepartment({ code: 'ASSET', name: '资产部门' });
    const id = await api.save({ data: { ...data, departmentId: department.id } });
    const renamed = await api.saveDepartment({
      id: department.id,
      revision: department.revision,
      code: 'ASSET2',
      name: '资产管理部门',
    });
    expect(renamed.id).toBe(department.id);
    expect((await api.list({}))[0]).toMatchObject({
      department_id: department.id,
      department: '资产管理部门',
    });
    const disabled = await api.setDepartmentDisabled({
      id: department.id,
      revision: renamed.revision!,
      disabled: true,
    });
    expect((await api.departments()).find((item) => item.id === department.id)?.disabled).toBe(
      true,
    );
    await api.save({
      id,
      revision: (await api.detail({ id })).card.revision,
      data: { ...data, departmentId: department.id, name: '原部门停用后仍可更名' },
    });
    expect((await api.detail({ id })).card.name).toBe('原部门停用后仍可更名');
    await expect(
      api.save({ data: { ...data, code: 'DEP-002', departmentId: department.id } }),
    ).rejects.toThrow(/启用的末级部门/);
    const other = await api.save({ data: { ...data, code: 'DEP-003' } });
    await expect(
      api.save({
        id: other,
        revision: 1,
        data: { ...data, code: 'DEP-003', departmentId: department.id },
      }),
    ).rejects.toThrow(/启用的末级部门/);
    await api.setDepartmentDisabled({
      id: department.id,
      revision: disabled.revision!,
      disabled: false,
    });
    await expect(
      api.save({ data: { ...data, code: 'DEP-002', departmentId: department.id } }),
    ).resolves.toBeTypeOf('number');
  });

  it('被卡片及折旧历史使用时，各入口列出引用并拒绝删除', async () => {
    await api.save({ data });
    const preview = await api.preview({ period: 202602 });
    await api.depreciate({ period: 202602, token: preview.token, confirm: true });
    const plan = await api.departmentDeletePreview({ id: data.departmentId });
    expect(plan.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: '资产卡片', count: 1 }),
        expect.objectContaining({ category: '资产折旧记录', count: 1 }),
      ]),
    );
    await expect(api.removeDepartment({ plan, confirm: true })).rejects.toThrow(
      /不能删除.*资产卡片/,
    );
    const corePlan = await app.svc.dimensions.previewDelete(data.departmentId);
    expect(corePlan.references).toEqual(plan.references);
    await expect(app.svc.dimensions.delete(corePlan, true)).rejects.toThrow(/不能删除/);
    expect(await app.svc.dimensions.get(data.departmentId)).not.toBeNull();
  });

  it('未使用部门删除必须明确确认，实际删除并写操作日志', async () => {
    const department = await api.saveDepartment({ code: 'EMPTY', name: '未用部门' });
    const plan = await api.departmentDeletePreview({ id: department.id });
    expect(plan.references).toEqual([]);
    await expect(api.removeDepartment({ plan, confirm: false })).rejects.toThrow(/确认删除/);
    expect(await app.svc.dimensions.get(department.id)).not.toBeNull();
    await api.removeDepartment({ plan, confirm: true });
    expect(await app.svc.dimensions.get(department.id)).toBeNull();
    const actions = await app.svc.db.selectFrom('operation_log').select('action').execute();
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining(['department.create', 'dimension.delete']),
    );
  });

  it('修改、停用及删除的版本过期均拒绝，失败不覆盖新内容', async () => {
    const department = await api.saveDepartment({ code: 'RACE', name: '原部门' });
    const plan = await api.departmentDeletePreview({ id: department.id });
    const changed = await api.saveDepartment({
      id: department.id,
      revision: department.revision,
      code: 'RACE',
      name: '已修改',
    });
    await expect(
      api.saveDepartment({
        id: department.id,
        revision: department.revision,
        code: 'RACE',
        name: '旧值覆盖',
      }),
    ).rejects.toThrow(/档案已变化/);
    await expect(
      api.setDepartmentDisabled({
        id: department.id,
        revision: department.revision!,
        disabled: true,
      }),
    ).rejects.toThrow(/档案已变化/);
    await expect(api.removeDepartment({ plan, confirm: true })).rejects.toThrow(
      /预览已过期|已变化/,
    );
    expect(await app.svc.dimensions.get(department.id)).toEqual(changed);
  });

  it('预览后新增资产引用会作废删除计划，事务复核不删除部门', async () => {
    const department = await api.saveDepartment({ code: 'LATER', name: '稍后使用' });
    const plan = await api.departmentDeletePreview({ id: department.id });
    await api.save({ data: { ...data, departmentId: department.id } });
    await expect(api.removeDepartment({ plan, confirm: true })).rejects.toThrow(
      /预览已过期|引用已变化/,
    );
    expect(await app.svc.dimensions.get(department.id)).not.toBeNull();
    expect(await api.list({})).toHaveLength(1);
  });

  it('部门维护不能修改、停用或删除其他辅助档案', async () => {
    const partner = (await app.svc.dimensions.items('partner'))[0]!;
    const plan = await app.svc.dimensions.previewDelete(partner.id);
    await expect(
      api.saveDepartment({
        id: partner.id,
        revision: partner.revision,
        code: partner.code,
        name: '非法更名',
      }),
    ).rejects.toThrow(/部门/);
    await expect(
      api.setDepartmentDisabled({ id: partner.id, revision: partner.revision!, disabled: true }),
    ).rejects.toThrow(/部门/);
    await expect(api.departmentDeletePreview({ id: partner.id })).rejects.toThrow(/部门/);
    await expect(api.removeDepartment({ plan, confirm: true })).rejects.toThrow(/部门/);
    expect(await app.svc.dimensions.get(partner.id)).toEqual(partner);
  });

  it('编号与名称必填、编号唯一；只读用户不能绕过页面维护', async () => {
    await expect(api.saveDepartment({ code: ' ', name: '名称' })).rejects.toThrow();
    await expect(api.saveDepartment({ code: 'NEW', name: ' ' })).rejects.toThrow();
    await expect(api.saveDepartment({ code: '01', name: '重复' })).rejects.toThrow(/已.*存在/);
    const viewer = caller(
      app,
      await app.addUser('asset-reader', { permissions: ['fixed-assets.view'] }),
    );
    await expect(viewer.departments()).resolves.toBeInstanceOf(Array);
    await expect(viewer.saveDepartment({ code: 'DENIED', name: '禁止' })).rejects.toThrow(/权限/);
    await expect(
      viewer.setDepartmentDisabled({ id: data.departmentId, revision: 1, disabled: true }),
    ).rejects.toThrow(/权限/);
    await expect(viewer.departmentDeletePreview({ id: data.departmentId })).rejects.toThrow(/权限/);
    const editor = caller(
      app,
      await app.addUser('asset-editor', { permissions: ['fixed-assets.edit'] }),
    );
    await expect(
      editor.saveDepartment({ code: 'OWN', name: '资产编辑员新增' }),
    ).resolves.toMatchObject({ code: 'OWN' });
  });
});
