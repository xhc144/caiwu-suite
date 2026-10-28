import { createHash } from 'node:crypto';
import {
  periodOfDate,
  DIMENSION_TYPES,
  type DimensionValues,
  type VoucherLineInput,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  BatchSaveSchema,
  CategorySchema,
  EmployeeSchema,
  TAX_RULE,
  type Batch,
  type Category,
  type Employee,
  type RowInput,
} from '../shared';
import type { z } from 'zod';
import type { PayrollTables } from './migrations';
import { fail, sum, validateCategory } from './engine';
import { assertPayrollStart } from './start-period';
import { calculateSalarySnapshot } from './calculation';
import { assertTaxConfirmed, historicalTaxRule } from './historical-tax';
import { loadHrData, assertEmployeeDatesMatchProfile, syncSingleEmployment } from './hr';
import {
  quantityFromE6,
  quantityToE6,
  encodeSalaryRow,
  decodeSalaryRow,
  encodeSalaryRows,
  decodeSalaryRows,
} from '../quantity';
import { VoucherMappingSchema } from '../shared-voucher';
import { aggregatePayrollLines, validateVoucherAuxiliaries } from './voucher-extra';
const decode = <T>(s: string): T => JSON.parse(s) as T;
export function payrollService(svc: CoreServices) {
  const db = svc.db.withTables<PayrollTables>();
  const loadCategory = async (id: number): Promise<Category> => {
    const row = await db
      .selectFrom('payroll_category')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) fail('NOT_FOUND', '工资类别不存在', '刷新类别列表');
    return { ...decode<Category>(row.data), id: row.id, revision: row.revision };
  };
  const loadEmployee = async (id: number): Promise<Employee> => {
    const row = await db
      .selectFrom('payroll_employee')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) fail('NOT_FOUND', '人员不存在', '刷新人员列表');
    const dept = await svc.dimensions.get(row.department_id);
    const employee = { ...decode<Employee>(row.data), id: row.id, revision: row.revision };
    const enriched = {
      ...employee,
      employmentSpells: (await loadHrData(svc, employee)).employmentSpells,
      id: row.id,
      revision: row.revision,
      departmentName: dept?.name ?? '部门已停用',
    };
    return enriched;
  };
  const batchRow = async (id: number) => {
    const b = await db
      .selectFrom('payroll_batch')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!b) fail('NOT_FOUND', '工资批次不存在', '刷新批次列表');
    return b;
  };
  const requireRevision = (actual: number, expected: number) => {
    if (actual !== expected) fail('STALE', '工资资料已被其他操作修改', '刷新后重新编辑或预览');
  };
  const assertMutable = async (id: number, revision: number) => {
    const b = await batchRow(id);
    requireRevision(b.revision, revision);
    await assertPayrollStart(svc, b.period);
    const link = await db
      .selectFrom('payroll_voucher')
      .select('voucher_id')
      .where('batch_id', '=', id)
      .executeTakeFirst();
    if (b.closed || link)
      fail(
        'LOCKED',
        '工资批次已经结账或生成凭证，不能更改',
        '未审核凭证可先在来源处确认撤销；已审核凭证须保持来源金额',
        link ? `/m/voucher-entry/edit?id=${link.voucher_id}` : '/m/payroll',
      );
    // 普通保存不得静默改写已被引用的累计数；前期更正经独立预览及原子级联完成。
    const later = await db
      .selectFrom('payroll_batch as b')
      .innerJoin('payroll_row as r', 'r.batch_id', 'b.id')
      .select('b.id')
      .where('b.calculated', '=', 1)
      .where('b.id', '!=', id)
      .where('b.period', '>=', b.period)
      .where('b.period', '<', (Math.trunc(b.period / 100) + 1) * 100)
      .where((eb) => eb.or([eb('b.period', '>', b.period), eb('b.id', '>', id)]))
      .where(
        'r.employee_id',
        'in',
        db.selectFrom('payroll_row').select('employee_id').where('batch_id', '=', id),
      )
      .executeTakeFirst();
    if (later)
      fail(
        'DEPENDENT',
        '后续工资批次已引用本批累计，不能覆盖历史',
        '请使用前期更正，预览并确认后续批次的级联重算',
        `/m/payroll?id=${later.id}`,
      );
    await svc.periods.assertOpen(b.period, '修改工资');
    return b;
  };
  const self = {
    async categories() {
      return Promise.all(
        (await db.selectFrom('payroll_category').select('id').orderBy('id').execute()).map((r) =>
          loadCategory(r.id),
        ),
      );
    },
    async employees() {
      return Promise.all(
        (await db.selectFrom('payroll_employee').select('id').orderBy('code').execute()).map((r) =>
          loadEmployee(r.id),
        ),
      );
    },
    async saveCategory(raw: z.input<typeof CategorySchema>) {
      const c = CategorySchema.parse(raw);
      validateCategory(c);
      return svc.tx(async (t) => {
        const td = t.db.withTables<PayrollTables>();
        const duplicate = await td
          .selectFrom('payroll_category')
          .select('id')
          .where('name', '=', c.name)
          .executeTakeFirst();
        if (duplicate && duplicate.id !== c.id) fail('CATEGORY_DUPLICATE', '工资类别名称已存在');
        let id = c.id;
        if (id) {
          const old = await payrollService(t).category(id);
          requireRevision(old.revision, c.revision);
          if (
            (old.taxMode ?? 'builtin') !== (c.taxMode ?? 'builtin') ||
            (c.taxMode === 'custom' &&
              JSON.stringify({ fields: old.fields, formulas: old.formulas }) !==
                JSON.stringify({ fields: c.fields, formulas: c.formulas }))
          )
            t.permissions.require('payroll.tax.configure');
          const used = await td
            .selectFrom('payroll_batch')
            .select('id')
            .where('category_id', '=', id)
            .executeTakeFirst();
          if (used) {
            for (const f of old.fields) {
              const next = c.fields.find((x) => x.key === f.key);
              if (!next || next.kind !== f.kind)
                fail(
                  'FIELD_USED',
                  '已使用栏目的变量和类型不能删除或更改',
                  '保留栏目并停用；历史批次保留原结构快照',
                );
            }
          }
          await td
            .updateTable('payroll_category')
            .set({ name: c.name, revision: c.revision + 1, data: JSON.stringify(c) })
            .where('id', '=', id)
            .execute();
        } else {
          if (c.taxMode === 'custom') t.permissions.require('payroll.tax.configure');
          id = (
            await td
              .insertInto('payroll_category')
              .values({ name: c.name, revision: 1, data: JSON.stringify(c) })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        }
        return payrollService(t).category(id);
      });
    },
    category: loadCategory,
    async saveEmployee(raw: z.input<typeof EmployeeSchema>) {
      const e = EmployeeSchema.parse(raw);
      if (e.endDate && e.endDate < e.startDate) fail('DATES', '离职日期不能早于任职日期');
      return svc.tx(async (t) => {
        const td = t.db.withTables<PayrollTables>();
        const existing = e.id ? await payrollService(t).employee(e.id) : null;
        if (existing) assertEmployeeDatesMatchProfile(existing, e);
        const dept = await t.dimensions.get(e.departmentId);
        if (
          !dept ||
          dept.typeId !== 'department' ||
          !dept.isLeaf ||
          (dept.disabled && existing?.departmentId !== e.departmentId)
        )
          fail('DEPARTMENT', '请选择启用的末级部门');
        const duplicate = await td
          .selectFrom('payroll_employee')
          .select('id')
          .where('code', '=', e.code)
          .executeTakeFirst();
        if (duplicate && duplicate.id !== e.id)
          fail(
            'EMPLOYEE_DUPLICATE',
            '人员编号重复',
            '换一个唯一编号；修改编号会保留原内部标识及历史',
          );
        let id = e.id;
        if (id) {
          const old = await payrollService(t).employee(id);
          requireRevision(old.revision, e.revision);
          const history = await td
            .selectFrom('payroll_row as r')
            .innerJoin('payroll_batch as b', 'b.id', 'r.batch_id')
            .select(['b.period'])
            .where('r.employee_id', '=', id)
            .where('b.calculated', '=', 1)
            .orderBy('b.period', 'desc')
            .executeTakeFirst();
          if (
            history &&
            (e.startDate !== old.startDate ||
              (e.endDate !== old.endDate && e.endDate && periodOfDate(e.endDate) < history.period))
          )
            fail(
              'EMPLOYMENT_HISTORY',
              '任职日期变更会改变已计算历史的任职月数',
              '保留已计算月份的原任职记录；离职日期不能改到已计算期间以前',
            );
          await td
            .updateTable('payroll_employee')
            .set({
              code: e.code,
              department_id: e.departmentId,
              revision: e.revision + 1,
              data: JSON.stringify(e),
            })
            .where('id', '=', id)
            .execute();
        } else
          id = (
            await td
              .insertInto('payroll_employee')
              .values({
                code: e.code,
                department_id: e.departmentId,
                revision: 1,
                data: JSON.stringify(e),
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        await syncSingleEmployment(t, { ...e, id } as Employee);
        return payrollService(t).employee(id);
      });
    },
    employee: loadEmployee,
    async departments() {
      return svc.dimensions.items('department');
    },
    async createDepartment(input: { code: string; name: string }) {
      return svc.tx((t) => t.dimensions.create({ ...input, type: 'department' }));
    },
    async batches(filter: { id?: number; period?: number; categoryId?: number }) {
      let q = db
        .selectFrom('payroll_batch')
        .select(['id', 'period', 'category_id', 'revision', 'calculated', 'closed'])
        .orderBy('period', 'desc')
        .orderBy('id', 'desc');
      if (filter.id) q = q.where('id', '=', filter.id);
      if (filter.period) q = q.where('period', '=', filter.period);
      if (filter.categoryId) q = q.where('category_id', '=', filter.categoryId);
      return q.execute();
    },
    async batch(id: number): Promise<Batch> {
      const b = await batchRow(id);
      const rows = await db
        .selectFrom('payroll_row')
        .selectAll()
        .where('batch_id', '=', id)
        .orderBy('employee_id')
        .execute();
      const links = await db
        .selectFrom('payroll_voucher')
        .selectAll()
        .where('batch_id', '=', id)
        .execute();
      const sources = await svc.db
        .selectFrom('voucher')
        .select('id')
        .where('source_module', '=', 'payroll')
        .where('source_type', '=', 'batch')
        .where('source_id', '=', String(id))
        .execute();
      if (
        sources.length !== links.length ||
        new Set(links.map((link) => link.voucher_id)).size !== links.length ||
        sources.some((source) => !links.some((link) => link.voucher_id === source.id))
      )
        fail(
          'SOURCE',
          '工资凭证来源关联不一致，不能继续处理该批次',
          '请由管理员核对工资批次与来源凭证；保留原数据，不自动采纳或删除异常来源',
        );
      const quantities = await db
        .selectFrom('payroll_quantity')
        .selectAll()
        .where('batch_id', '=', id)
        .execute();
      const vouchers = await Promise.all(
        links.map(async (l) => {
          const v = await svc.vouchers.get(l.voucher_id);
          if (!v) fail('SOURCE', '工资凭证关联缺失', '请联系管理员检查账套');
          if (
            v.source?.module !== 'payroll' ||
            v.source.type !== 'batch' ||
            v.source.id !== String(id)
          )
            fail(
              'SOURCE',
              '工资凭证来源关联不一致，不能继续处理该批次',
              '请由管理员核对工资批次与来源凭证；保留原数据，不自动修补关联',
            );
          return { kind: l.kind, id: v.id, number: v.displayNo, status: v.status };
        }),
      );
      return {
        id: b.id,
        revision: b.revision,
        period: b.period,
        categoryId: b.category_id,
        category: decode<Category>(b.category_json),
        calculated: !!b.calculated,
        closed: !!b.closed,
        rows: rows.map((r) => {
          const row = decode<RowInput>(r.input_json);
          const own = quantities.filter((q) => q.employee_id === r.employee_id);
          return own.length
            ? {
                ...row,
                quantities: Object.fromEntries(
                  own.map((q) => [q.field_key, quantityFromE6(q.quantity_e6)]),
                ),
              }
            : row;
        }),
        previous: decodeSalaryRows(b.previous_json),
        snapshots: rows
          .filter((r) => r.snapshot_json)
          .map((r) => decodeSalaryRow(r.snapshot_json!)),
        vouchers,
      };
    },
    async saveBatch(raw: z.input<typeof BatchSaveSchema>) {
      const input = BatchSaveSchema.parse(raw);
      return svc.tx(async (t) => {
        const td = t.db.withTables<PayrollTables>(),
          s = payrollService(t);
        const c = await s.category(input.categoryId);
        requireRevision(c.revision, input.categoryRevision);
        if (c.disabled) fail('CATEGORY_DISABLED', '工资类别已停用');
        validateCategory(c);
        await assertPayrollStart(t, input.period);
        await t.periods.assertOpen(input.period, '保存工资');
        if (new Set(input.rows.map((r) => r.employeeId)).size !== input.rows.length)
          fail('DUPLICATE_ROW', '同一批次不能重复录入同一人员');
        const keys = new Set(
          c.fields.filter((f) => !f.disabled && f.kind === 'money').map((f) => f.key),
        );
        const quantityKeys = new Set(
          c.fields.filter((f) => !f.disabled && f.kind === 'quantity').map((f) => f.key),
        );
        for (const r of input.rows) {
          const e = await s.employee(r.employeeId);
          const department = await t.dimensions.get(e.departmentId);
          if (
            !department ||
            department.typeId !== 'department' ||
            department.disabled ||
            !department.isLeaf
          )
            fail(
              'DEPARTMENT',
              `${e.code} 的部门已停用或不是末级部门`,
              '先在人事档案选择启用的末级部门',
              '/m/payroll/employees',
            );
          if (e.disabled)
            fail(
              'EMPLOYEE_DISABLED',
              '停用人员不能录入新工资',
              '如需离职补发，保留离职日期并启用人员',
            );
          for (const k of Object.keys(r.values))
            if (!keys.has(k)) fail('FIELDS', `栏目 ${k} 不可录入`);
          for (const k of Object.keys(r.quantities ?? {}))
            if (!quantityKeys.has(k)) fail('FIELDS', `数量栏目 ${k} 不可录入`);
        }
        let id = input.id;
        if (id) {
          const old = await s.assertMutable(id, input.revision);
          if (old.period !== input.period || old.category_id !== input.categoryId)
            fail('BATCH_IDENTITY', '已有批次不能换期间或类别');
          const last = await s.batch(id);
          await td
            .updateTable('payroll_batch')
            .set({
              previous_json: encodeSalaryRows(last.calculated ? last.snapshots : last.previous),
              revision: old.revision + 1,
              category_json: JSON.stringify(c),
              calculated: 0,
            })
            .where('id', '=', id)
            .execute();
          await td.deleteFrom('payroll_row').where('batch_id', '=', id).execute();
        } else {
          const duplicate = await td
            .selectFrom('payroll_batch')
            .select('id')
            .where('period', '=', input.period)
            .where('category_id', '=', input.categoryId)
            .executeTakeFirst();
          if (duplicate)
            fail(
              'BATCH_DUPLICATE',
              '本期间类别已有工资批次',
              '打开已有批次编辑，避免重复录入',
              `/m/payroll?id=${duplicate.id}`,
            );
          id = (
            await td
              .insertInto('payroll_batch')
              .values({
                period: input.period,
                category_id: input.categoryId,
                revision: 1,
                category_json: JSON.stringify(c),
                calculated: 0,
                closed: 0,
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        }
        for (const r of input.rows) {
          const { quantities: quantityInput, ...moneyInput } = r;
          await td
            .insertInto('payroll_row')
            .values({
              batch_id: id,
              employee_id: r.employeeId,
              input_json: JSON.stringify(moneyInput),
              snapshot_json: null,
            })
            .execute();
          for (const [field, value] of Object.entries(quantityInput ?? {}))
            await td
              .insertInto('payroll_quantity')
              .values({
                batch_id: id,
                employee_id: r.employeeId,
                field_key: field,
                quantity_e6: quantityToE6(value),
              })
              .execute();
        }
        await t.log.write({
          action: 'payroll.salary.save',
          summary: `保存工资批次 ${id}`,
          targetType: 'payroll_batch',
          targetId: id,
        });
        return s.batch(id);
      });
    },
    assertMutable,
    async calculate(id: number, revision: number) {
      return svc.tx(async (t) => {
        const s = payrollService(t),
          td = t.db.withTables<PayrollTables>();
        const b = await s.assertMutable(id, revision);
        const batch = await s.batch(id);
        if (batch.category.taxMode !== 'custom')
          await assertTaxConfirmed(t, b.period, TAX_RULE.version);
        validateCategory(batch.category);
        const all = await td
          .selectFrom('payroll_batch as b')
          .innerJoin('payroll_row as r', 'r.batch_id', 'b.id')
          .select(['b.id', 'b.period', 'r.employee_id', 'r.snapshot_json'])
          .where('b.calculated', '=', 1)
          .where('b.id', '!=', id)
          .where('b.period', '>=', Math.trunc(b.period / 100) * 100 + 1)
          .where('b.period', '<=', b.period)
          .execute();
        // 不允许跳过先前尚未计算的同人批次，以免后续累计悄然变动。
        const pending = await td
          .selectFrom('payroll_batch as b')
          .innerJoin('payroll_row as r', 'r.batch_id', 'b.id')
          .select('b.id')
          .where('b.calculated', '=', 0)
          .where('b.id', '!=', id)
          .where('b.period', '>=', Math.trunc(b.period / 100) * 100 + 1)
          .where('b.period', '<=', b.period)
          .where((eb) => eb.or([eb('b.period', '<', b.period), eb('b.id', '<', id)]))
          .where(
            'r.employee_id',
            'in',
            batch.rows.map((r) => r.employeeId),
          )
          .executeTakeFirst();
        if (pending)
          fail('ORDER', '存在较早的未计算批次', '先计算较早批次', `/m/payroll?id=${pending.id}`);
        for (const r of batch.rows) {
          const employee = await s.employee(r.employeeId);
          const snapshot = calculateSalarySnapshot(
            batch.category,
            b.period,
            r,
            employee,
            all.map((x) => ({ period: x.period, row: decodeSalaryRow(x.snapshot_json!) })),
          );
          await td
            .updateTable('payroll_row')
            .set({ snapshot_json: encodeSalaryRow(snapshot) })
            .where('batch_id', '=', id)
            .where('employee_id', '=', r.employeeId)
            .execute();
        }
        await td
          .updateTable('payroll_batch')
          .set({ calculated: 1, revision: b.revision + 1 })
          .where('id', '=', id)
          .execute();
        await t.log.write({
          action: 'payroll.salary.calculate',
          summary: `计算工资批次 ${id}，税参数 ${
            batch.category.taxMode === 'custom'
              ? `custom-formula-${batch.category.id}-${batch.category.revision}`
              : b.period < 201901
                ? historicalTaxRule(b.period).version
                : TAX_RULE.version
          }`,
          targetType: 'payroll_batch',
          targetId: id,
        });
        return s.batch(id);
      });
    },
    async taxConfig() {
      return {
        rule: TAX_RULE,
        confirmed: (await svc.settings.get('taxVersion', '')) === TAX_RULE.version,
      };
    },
    async confirmTax() {
      await svc.settings.set('taxVersion', TAX_RULE.version);
      return self.taxConfig();
    },
    async mapping(categoryId: number) {
      const saved = await svc.settings.get<z.input<typeof VoucherMappingSchema> | null>(
        `mapping.${categoryId}`,
        null,
      );
      return saved ? VoucherMappingSchema.parse(saved) : null;
    },
    async saveMapping(categoryId: number, raw: z.input<typeof VoucherMappingSchema>) {
      const input = VoucherMappingSchema.parse(raw);
      if (input.amountField !== 'gross' || input.allocationField !== 'department')
        fail(
          'MAPPING_TYPE',
          '应付工资须使用应发金额，分配须使用基本项部门',
          '标准设置按应发结算；其它工资栏目请增加自定义规则',
        );
      return svc.tx(async (t) => {
        const category = await payrollService(t).category(categoryId);
        await validateVoucherAuxiliaries(t, input);
        const fields = new Set([
          'gross',
          'net',
          'deductions',
          'taxAmount',
          ...category.fields.filter((f) => !f.disabled && f.kind !== 'quantity').map((f) => f.key),
        ]);
        const seen = new Set<string>();
        for (const rule of input.rules ?? []) {
          if (!fields.has(rule.field))
            fail(
              'MAPPING_FIELD',
              `工资栏目 ${rule.field} 不存在或已停用`,
              '请选择启用的工资金额或计算栏目',
            );
          const key = `${rule.kind}:${rule.field}:${rule.departmentId ?? 'all'}`;
          if (seen.has(key))
            fail(
              'MAPPING_DUPLICATE',
              '同种凭证、同一工资栏目和部门不能重复映射',
              '每个栏目保留一条默认规则及每部门最多一条覆盖规则',
            );
          seen.add(key);
          if (rule.debitAccountId === rule.creditAccountId)
            fail('MAPPING_ACCOUNTS', '同一规则的借贷科目不能相同', '分别选择费用、应付或结算科目');
          if (rule.departmentId) {
            const department = await t.dimensions.get(rule.departmentId);
            if (
              !department ||
              department.typeId !== 'department' ||
              department.disabled ||
              !department.isLeaf
            )
              fail('MAPPING_DEPARTMENT', '部门映射须选择启用的末级部门', '刷新部门后重新选择');
          }
        }
        for (const id of new Set([
          input.payableAccountId,
          input.bankAccountId,
          input.taxAccountId,
          input.deductionAccountId,
          input.expenseAccountId,
          ...(input.rules ?? []).flatMap((r) => [r.debitAccountId, r.creditAccountId]),
        ])) {
          const a = await t.accounts.require(id);
          if (!a.isLeaf || a.disabled) fail('NOT_LEAF', '凭证科目须为启用的末级科目');
        }
        const previous = await payrollService(t).mapping(categoryId);
        requireRevision(previous?.revision ?? 0, input.revision);
        const saved = { ...input, revision: input.revision + 1 };
        await t.settings.set(`mapping.${categoryId}`, saved);
        await t.log.write({
          action: 'payroll.voucher.mapping',
          summary: `保存工资类别 ${category.name} 的凭证设置`,
          targetType: 'payroll_category',
          targetId: categoryId,
        });
        return saved;
      });
    },
    async preview(id: number, revision: number, kind: 'payment' | 'allocation', date: string) {
      const b = await self.batch(id);
      requireRevision(b.revision, revision);
      if (!b.calculated) fail('NOT_CALCULATED', '工资尚未计算', '保存并计算后再预览');
      if (b.vouchers.some((v) => v.kind === kind))
        fail(
          'VOUCHER_DUPLICATE',
          '该批次该种类已生成凭证',
          '查看已有凭证，未审核可确认撤销后重新预览',
        );
      if (periodOfDate(date) !== b.period) fail('VOUCHER_DATE', '凭证日期必须属于工资期间');
      await assertPayrollStart(svc, b.period);
      await svc.periods.assertWritable({ period: b.period, action: '生成工资凭证' });
      const mapping = await self.mapping(b.categoryId);
      if (!mapping) fail('MAPPING', '缺少工资凭证设置', '先选择应付、银行、个税、扣款及费用科目');
      if (mapping.amountField !== 'gross' || mapping.allocationField !== 'department')
        fail('MAPPING_TYPE', '工资凭证金额或分配栏目类型不正确');
      const types = await svc.reference.voucherTypes(),
        type = types.find((t) => !t.disabled);
      if (!type) fail('VOUCHER_TYPE', '没有可用凭证类型');
      const accounts = await svc.accounts.list();
      const auxiliaryItems = (
        await Promise.all(DIMENSION_TYPES.map((type) => svc.dimensions.items(type.id)))
      ).flat();
      const lines: VoucherLineInput[] = [];
      const problems: string[] = [];
      const rules = (mapping.rules ?? []).filter((rule) => rule.kind === kind);
      const fields = new Map(
        b.category.fields
          .filter((f) => !f.disabled && f.kind !== 'quantity')
          .map((f) => [f.key, f]),
      );
      for (const rule of rules)
        if (
          !['gross', 'net', 'deductions', 'taxAmount'].includes(rule.field) &&
          !fields.has(rule.field)
        )
          problems.push(`工资栏目 ${rule.field} 不在本批次启用栏目内`);
      for (const r of b.snapshots) {
        const line = (accountId: number, debit: number, credit: number, fieldName = '') => {
          if (!debit && !credit) return;
          if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) {
            problems.push(`${r.employee.code} 的工资金额格式或范围无效，请检查并重新计算`);
            return;
          }
          const a = accounts.find((a) => a.id === accountId);
          if (!a || !a.isLeaf || a.disabled) {
            problems.push('科目不存在、停用或非末级');
            return;
          }
          if (a.currency || a.quantityUnit)
            problems.push(`科目 ${a.code} 需要外币或数量，工资映射只提供本位币金额`);
          const auxiliary =
            mapping.auxiliaries.find(
              (x) => x.accountId === accountId && x.employeeId === r.employeeId,
            ) ??
            mapping.auxiliaries.find(
              (x) => x.accountId === accountId && x.employeeId === undefined,
            );
          const dimensions: DimensionValues = {};
          for (const type of DIMENSION_TYPES) {
            const config = a.dimensions.find((d) => d.type === type.id);
            const explicit = auxiliary?.values[type.id];
            const itemId =
              explicit ??
              (type.id === 'department' && config
                ? r.employee.departmentId
                : config?.defaultItemId) ??
              null;
            if (itemId != null && type.id !== 'cashflow' && !config)
              problems.push(`科目 ${a.code} 未启用${type.name}核算，请调整凭证设置`);
            if (itemId == null && config?.required)
              problems.push(`科目 ${a.code} 需要${type.name}，请补充辅助核算设置`);
            if (itemId != null) {
              const item = auxiliaryItems.find((d) => d.id === itemId);
              if (!item || item.typeId !== type.id || item.disabled || !item.isLeaf)
                problems.push(`${r.employee.code} 的${type.name}已停用、不存在或不是末级档案`);
            }
            dimensions[type.id] = itemId;
          }
          lines.push({
            summary: `${b.period}工资${kind === 'payment' ? '发放' : '分配'} ${r.employee.code}${fieldName ? ` ${fieldName}` : ''}`,
            accountId,
            debit,
            credit,
            dimensions,
          });
        };
        if (rules.length) {
          for (const field of new Set(rules.map((rule) => rule.field))) {
            // 指定部门的规则覆盖默认规则，避免同一工资项目被重复制证。
            const rule =
              rules.find((x) => x.field === field && x.departmentId === r.employee.departmentId) ??
              rules.find((x) => x.field === field && x.departmentId === undefined);
            if (!rule) continue;
            const builtins: Record<string, { name: string; value: number }> = {
              gross: { name: '应发合计', value: r.gross },
              net: { name: '实发合计', value: r.net },
              deductions: { name: '扣款合计', value: r.deductions },
              taxAmount: { name: '个人所得税', value: r.taxAmount },
            };
            const value = builtins[field]?.value ?? r.calculatedValues[field];
            const name = builtins[field]?.name ?? fields.get(field)?.name ?? field;
            if (value === undefined || !Number.isSafeInteger(value)) {
              problems.push(`${r.employee.code} 的${name}缺少有效金额，请检查工资并重新计算`);
              continue;
            }
            line(rule.debitAccountId, value, 0, name);
            line(rule.creditAccountId, 0, value, name);
          }
        } else if (kind === 'allocation') {
          line(mapping.expenseAccountId, r.gross, 0);
          line(mapping.payableAccountId, 0, r.gross);
        } else {
          line(mapping.payableAccountId, r.gross, 0);
          line(mapping.bankAccountId, 0, r.net);
          line(mapping.taxAccountId, 0, r.taxAmount);
          line(mapping.deductionAccountId, 0, r.deductions);
        }
      }
      const grouped = aggregatePayrollLines(
        lines,
        `${b.period}工资${kind === 'payment' ? '发放' : '分配'}汇总`,
      );
      const debit = sum(grouped.lines.map((l) => l.debit ?? 0)),
        credit = sum(grouped.lines.map((l) => l.credit ?? 0));
      if (debit !== credit) problems.push('借贷金额不平');
      if (!grouped.lines.length) problems.push('没有可制证的非零工资');
      if (grouped.lines.length > 999)
        problems.push('同科目及辅助核算汇总后仍超过999条，请按类别拆分工资范围');
      if (problems.length)
        fail('VOUCHER_PLAN', [...new Set(problems)].join('；'), '调整设置或工资后重新计算并预览');
      // 配置、科目属性、工资版本、日期、种类均绑定计划；设置变化后旧计划无法确认。
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            id,
            revision,
            kind,
            date,
            mapping,
            accounts,
            auxiliaryItems,
            types,
            lines,
          }),
        )
        .digest('hex');
      return { hash, ...grouped, debit, credit, voucherTypeId: type.id };
    },
    async generate(input: {
      id: number;
      revision: number;
      kind: 'payment' | 'allocation';
      date: string;
      hash: string;
    }) {
      return svc.tx(async (t) => {
        const s = payrollService(t),
          td = t.db.withTables<PayrollTables>();
        const p = await s.preview(input.id, input.revision, input.kind, input.date);
        if (p.hash !== input.hash)
          fail('PLAN_STALE', '凭证预览已失效', '科目或分配设置发生变化，请重新预览并确认');
        const voucher = await t.vouchers.create({
          date: input.date,
          voucherTypeId: p.voucherTypeId,
          lines: p.lines,
          source: { type: 'batch', id: String(input.id) },
        });
        await td
          .insertInto('payroll_voucher')
          .values({ batch_id: input.id, kind: input.kind, voucher_id: voucher.id })
          .execute();
        await td
          .updateTable('payroll_batch')
          .set({ revision: input.revision + 1 })
          .where('id', '=', input.id)
          .execute();
        await t.log.write({
          action: 'payroll.voucher.generate',
          summary: `批次 ${input.id} 生成${input.kind === 'payment' ? '发放' : '分配'}凭证 ${voucher.displayNo}`,
          targetType: 'payroll_batch',
          targetId: input.id,
        });
        return s.batch(input.id);
      });
    },
    async previewRevoke(id: number, revision: number, kind: 'payment' | 'allocation') {
      const b = await self.batch(id);
      requireRevision(b.revision, revision);
      const link = b.vouchers.find((v) => v.kind === kind);
      if (!link) fail('NOT_FOUND', '该种类尚未生成凭证');
      await assertPayrollStart(svc, b.period);
      await svc.periods.assertWritable({ period: b.period, action: '撤销工资凭证' });
      return svc.vouchers.previewDelete([link.id]);
    },
    async revoke(
      id: number,
      revision: number,
      kind: 'payment' | 'allocation',
      confirmed: boolean,
      deletionPlan?: { ids: number[]; expiresAt: number; fingerprint: string },
    ) {
      if (!confirmed) fail('CONFIRM', '撤销工资凭证须确认', '确认删除未审核凭证，再修改来源工资');
      return svc.tx(async (t) => {
        const s = payrollService(t),
          td = t.db.withTables<PayrollTables>(),
          b = await s.batch(id);
        requireRevision(b.revision, revision);
        const link = b.vouchers.find((v) => v.kind === kind);
        if (!link) fail('NOT_FOUND', '该种类尚未生成凭证');
        const v = await t.vouchers.get(link.id);
        if (!v) fail('SOURCE', '来源凭证缺失');
        await assertPayrollStart(t, b.period);
        await t.periods.assertWritable({ period: b.period, action: '撤销工资凭证' });
        if (deletionPlan && (deletionPlan.ids.length !== 1 || deletionPlan.ids[0] !== v.id))
          fail('PLAN_STALE', '撤销预览与当前工资凭证不一致', '重新预览删除及编号影响');
        // 先解除模块自身外键；core 删除失败会整笔回滚。
        await td
          .deleteFrom('payroll_voucher')
          .where('batch_id', '=', id)
          .where('kind', '=', kind)
          .execute();
        if (deletionPlan) await t.vouchers.deleteBatch(deletionPlan, true);
        else await t.vouchers.delete(v.id, { expectedRevision: v.revision });
        await td
          .updateTable('payroll_batch')
          .set({ revision: revision + 1 })
          .where('id', '=', id)
          .execute();
        await t.log.write({
          action: 'payroll.voucher.revoke',
          summary: `批次 ${id} 撤销未审核凭证`,
          targetType: 'payroll_batch',
          targetId: id,
        });
        return s.batch(id);
      });
    },
    async exportRows(id: number, employeeIds: number[]) {
      const b = await self.batch(id);
      if (!b.calculated) fail('NOT_CALCULATED', '工资尚未计算，不能输出工资条');
      if (!employeeIds.length)
        fail('EMPTY_SELECTION', '没有选中工资人员', '勾选本批次人员后再打印或导出');
      const selected = b.snapshots.filter((r) => employeeIds.includes(r.employeeId));
      if (selected.length !== new Set(employeeIds).size)
        fail('SELECTION', '选择含有不属于当前批次的人员', '刷新后重新选择');
      return { period: b.period, category: b.category, rows: selected };
    },
  };
  return self;
}
