import { createHash } from 'node:crypto';
import { periodOfDate, type VoucherLineInput } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  BatchSaveSchema,
  CategorySchema,
  EmployeeSchema,
  MappingSchema,
  TAX_RULE,
  type Batch,
  type Category,
  type Employee,
  type Mapping,
  type RowInput,
  type SalaryRow,
} from '../shared';
import type { z } from 'zod';
import type { PayrollTables } from './migrations';
import { calculateTax, computeValues, fail, sum, validateCategory } from './engine';
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
    return {
      ...decode<Employee>(row.data),
      id: row.id,
      revision: row.revision,
      departmentName: dept?.name ?? '部门已停用',
    };
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
    // 后续已计算批次引用本批累计，必须从最近批次逐笔撤回；首版不提供隐式级联重算。
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
        '首版不支持前期更正，请先核对最近批次',
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
        const dept = await t.dimensions.get(e.departmentId);
        if (!dept || dept.typeId !== 'department' || dept.disabled || !dept.isLeaf)
          fail('DEPARTMENT', '请选择启用的末级 core 部门');
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
              '前期更正尚不支持；保留历史起日，离职日期不能改到已计算期间以前',
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
      const vouchers = await Promise.all(
        links.map(async (l) => {
          const v = await svc.vouchers.get(l.voucher_id);
          if (!v) fail('SOURCE', '工资凭证关联缺失', '请联系管理员检查账套');
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
        rows: rows.map((r) => decode<RowInput>(r.input_json)),
        snapshots: rows
          .filter((r) => r.snapshot_json)
          .map((r) => decode<SalaryRow>(r.snapshot_json!)),
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
        const book = await t.book.info();
        if (input.period < book.startPeriod) fail('START_PERIOD', '工资期间早于启用期间');
        await t.periods.assertOpen(input.period, '保存工资');
        if (new Set(input.rows.map((r) => r.employeeId)).size !== input.rows.length)
          fail('DUPLICATE_ROW', '同一批次不能重复录入同一人员');
        const keys = new Set(
          c.fields.filter((f) => !f.disabled && f.kind === 'money').map((f) => f.key),
        );
        for (const r of input.rows) {
          const e = await s.employee(r.employeeId);
          if (e.disabled)
            fail(
              'EMPLOYEE_DISABLED',
              '停用人员不能录入新工资',
              '如需离职补发，保留离职日期并启用人员',
            );
          for (const k of Object.keys(r.values))
            if (!keys.has(k)) fail('FIELDS', `栏目 ${k} 不可录入`);
        }
        let id = input.id;
        if (id) {
          const old = await s.assertMutable(id, input.revision);
          if (old.period !== input.period || old.category_id !== input.categoryId)
            fail('BATCH_IDENTITY', '已有批次不能换期间或类别');
          await td
            .updateTable('payroll_batch')
            .set({ revision: old.revision + 1, category_json: JSON.stringify(c), calculated: 0 })
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
        for (const r of input.rows)
          await td
            .insertInto('payroll_row')
            .values({
              batch_id: id,
              employee_id: r.employeeId,
              input_json: JSON.stringify(r),
              snapshot_json: null,
            })
            .execute();
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
        if ((await t.settings.get('taxVersion', '')) !== TAX_RULE.version)
          fail(
            'UNVERIFIED_TAX',
            '尚未确认本账套计税范围与参数',
            '由计税参数权限人员核对来源并确认',
            '/m/payroll/tax',
          );
        const batch = await s.batch(id);
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
          const prior = all
            .filter((x) => x.employee_id === r.employeeId)
            .map((x) => ({ period: x.period, row: decode<SalaryRow>(x.snapshot_json!) }));
          for (const p of prior) {
            if (
              p.row.tax.openingIncome !== r.tax.openingIncome ||
              p.row.tax.openingTax !== r.tax.openingTax
            )
              fail(
                'OPENING_CHANGED',
                '同年本单位期初收入或已扣税与历史不一致',
                '前期更正尚不支持，请保留原期初数',
              );
            if (
              p.period === b.period &&
              (['special', 'additional', 'other', 'relief', 'confirmed'] as const).some(
                (k) => p.row.tax[k] !== r.tax[k],
              )
            )
              fail(
                'MONTH_DEDUCTION',
                '同人同月跨类别的累计扣除必须一致',
                '复用本月已确认的累计扣除，不能重复享受',
              );
            if (
              p.row.employee.policy !== employee.policy ||
              p.row.employee.qualificationYear !== employee.qualificationYear
            )
              fail('POLICY_CHANGED', '同年计税方式已被历史批次使用', '前期计税方式更正尚不支持');
          }
          const computed = computeValues(batch.category, r.values);
          const income = sum([
            r.tax.openingIncome,
            computed.gross,
            ...prior.map((p) => p.row.gross),
          ]);
          const exempt = sum([r.tax.exempt, ...prior.map((p) => p.row.tax.exempt)]);
          if (income < 0 || exempt > income)
            fail('TAX_BASE', '累计收入不能为负且累计免税收入不能超过收入');
          const detail = calculateTax(
            employee,
            b.period,
            r.tax,
            income,
            exempt,
            sum(prior.map((p) => p.row.taxAmount)),
          );
          const snapshot: SalaryRow = {
            ...r,
            employee,
            calculatedValues: computed.values,
            formulaDetails: computed.details,
            gross: computed.gross,
            deductions: computed.deductions,
            taxAmount: detail.currentTax,
            net: sum([computed.gross, -computed.deductions, -detail.currentTax]),
            detail,
          };
          await td
            .updateTable('payroll_row')
            .set({ snapshot_json: JSON.stringify(snapshot) })
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
          summary: `计算工资批次 ${id}，税参数 ${TAX_RULE.version}`,
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
      return svc.settings.get<Mapping | null>(`mapping.${categoryId}`, null);
    },
    async saveMapping(categoryId: number, raw: Mapping) {
      const input = MappingSchema.parse(raw);
      await loadCategory(categoryId);
      if (input.amountField !== 'gross' || input.allocationField !== 'department')
        fail(
          'MAPPING_TYPE',
          '应付工资须使用应发金额，分配须使用基本项部门',
          '应发金额结算到银行、个税和个人扣款科目',
        );
      return svc.tx(async (t) => {
        for (const id of [
          input.payableAccountId,
          input.bankAccountId,
          input.taxAccountId,
          input.deductionAccountId,
          input.expenseAccountId,
        ]) {
          const a = await t.accounts.require(id);
          if (!a.isLeaf || a.disabled) fail('NOT_LEAF', '凭证科目须为启用的末级科目');
        }
        const previous = await payrollService(t).mapping(categoryId);
        requireRevision(previous?.revision ?? 0, input.revision);
        const saved = { ...input, revision: input.revision + 1 };
        await t.settings.set(`mapping.${categoryId}`, saved);
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
      await svc.periods.assertOpen(b.period, '生成工资凭证');
      const mapping = await self.mapping(b.categoryId);
      if (!mapping) fail('MAPPING', '缺少工资凭证设置', '先选择应付、银行、个税、扣款及费用科目');
      if (mapping.amountField !== 'gross' || mapping.allocationField !== 'department')
        fail('MAPPING_TYPE', '工资凭证金额或分配栏目类型不正确');
      const types = await svc.reference.voucherTypes(),
        type = types.find((t) => !t.disabled);
      if (!type) fail('VOUCHER_TYPE', '没有可用凭证类型');
      const accounts = await svc.accounts.list();
      const lines: VoucherLineInput[] = [];
      const problems: string[] = [];
      for (const r of b.snapshots) {
        if (r.gross < 0 || r.deductions < 0 || r.net < 0)
          problems.push(`${r.employee.code} 实发、应发或扣款为负，首版凭证不支持负额调整`);
        const line = (accountId: number, debit: number, credit: number) => {
          if (!debit && !credit) return;
          const a = accounts.find((a) => a.id === accountId);
          if (!a || !a.isLeaf || a.disabled) {
            problems.push('科目不存在、停用或非末级');
            return;
          }
          if (a.dimensions.some((d) => d.required && d.type !== 'department'))
            problems.push(`科目 ${a.code} 需要部门以外的辅助维度，首版映射尚不支持`);
          const department = a.dimensions.some((d) => d.type === 'department')
            ? r.employee.departmentId
            : null;
          lines.push({
            summary: `${b.period}工资${kind === 'payment' ? '发放' : '分配'} ${r.employee.code}`,
            accountId,
            debit,
            credit,
            dimensions: { department },
          });
        };
        if (kind === 'allocation') {
          line(mapping.expenseAccountId, r.gross, 0);
          line(mapping.payableAccountId, 0, r.gross);
        } else {
          line(mapping.payableAccountId, r.gross, 0);
          line(mapping.bankAccountId, 0, r.net);
          line(mapping.taxAccountId, 0, r.taxAmount);
          line(mapping.deductionAccountId, 0, r.deductions);
        }
      }
      const debit = sum(lines.map((l) => l.debit ?? 0)),
        credit = sum(lines.map((l) => l.credit ?? 0));
      if (debit !== credit) problems.push('借贷金额不平');
      if (!debit) problems.push('没有可制证的非零工资');
      if (lines.length > 999) problems.push('分录超过999条，请按类别拆分工资范围');
      if (problems.length)
        fail('VOUCHER_PLAN', [...new Set(problems)].join('；'), '调整设置或工资后重新计算并预览');
      // 配置、科目属性、工资版本、日期、种类均绑定计划；设置变化后旧计划无法确认。
      const hash = createHash('sha256')
        .update(JSON.stringify({ id, revision, kind, date, mapping, accounts, types, lines }))
        .digest('hex');
      return { hash, lines, debit, credit, voucherTypeId: type.id };
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
    async revoke(id: number, revision: number, kind: 'payment' | 'allocation', confirmed: boolean) {
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
        // 先解除模块自身外键；core 删除失败会整笔回滚。
        await td
          .deleteFrom('payroll_voucher')
          .where('batch_id', '=', id)
          .where('kind', '=', kind)
          .execute();
        await t.vouchers.delete(v.id, { expectedRevision: v.revision });
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
