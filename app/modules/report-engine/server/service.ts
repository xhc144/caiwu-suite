import { BusinessError, periodYear, type BalanceRow, type DimensionTypeId } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import {
  emptyTemplate,
  CodeSchema,
  HeaderSchema,
  ReportTemplateSchema,
  coordinates,
  type BalanceFunction,
  type GenerateSchema,
  type Report,
  type ReportSnapshot,
  type ReportTemplate,
} from '../shared';
import type { ReportTables } from './migrations';
import {
  calculate,
  evaluate,
  finalize,
  FormulaError,
  parseFormula,
  value,
  type Value,
} from './formula';

function fail(
  code: string,
  message: string,
  hint = '请修正后重试；未成功的操作不会覆盖已保存的数据。',
): never {
  throw new BusinessError({
    code: `REPORT_${code}`,
    message,
    hint,
    actions: [{ label: '报表管理', to: '/m/report-engine' }],
  });
}
function validate(raw: ReportTemplate): ReportTemplate {
  const parsed = ReportTemplateSchema.safeParse(raw);
  if (!parsed.success)
    fail('TEMPLATE_INVALID', parsed.error.issues.map((i) => i.message).join('；'));
  const t = parsed.data;
  for (const c of t.cells)
    if (c.kind === 'formula') {
      try {
        parseFormula(c.source);
      } catch (e) {
        fail('FORMULA', `${c.address}：${e instanceof Error ? e.message : '公式不正确'}`);
      }
    }
  for (const check of t.checks)
    for (const f of [check.left, check.right]) {
      try {
        parseFormula(f);
      } catch (e) {
        fail(
          'FORMULA',
          `审核公式「${check.name}」：${e instanceof Error ? e.message : '公式不正确'}`,
        );
      }
    }
  return t;
}
const decode = (row: { id: number; revision: number; definition_json: string }): Report => ({
  id: row.id,
  revision: row.revision,
  template: ReportTemplateSchema.parse(JSON.parse(row.definition_json)),
});
export function reportService(svc: CoreServices) {
  const db = svc.db.withTables<ReportTables>();
  const get = async (id: number): Promise<Report> => {
    const r = await db
      .selectFrom('report_engine_template')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) fail('NOT_FOUND', '所选报表不存在，可能已被删除', '请返回列表重新选择存在的报表。');
    return decode(r);
  };
  const editable = async (id: number, expectedRevision: number) => {
    const r = await get(id);
    if (r.revision !== expectedRevision)
      fail(
        'CONFLICT',
        '报表已被其他操作修改，不能覆盖较新版本',
        '请保留当前编辑内容，刷新读取最新定义后重新编辑。',
      );
    if (r.template.readOnly)
      fail('READ_ONLY', '这张报表是只读模板，不能修改或删除', '请复制为新的可编辑报表。');
    return r;
  };
  const uniqueCode = async (code: string, id = 0) => {
    if (
      await db
        .selectFrom('report_engine_template')
        .select('id')
        .where('code', '=', code)
        .where('id', '!=', id)
        .executeTakeFirst()
    )
      fail('DUPLICATE', `报表编码 ${code} 已存在`, '请输入不同的最多三位数字编码。');
  };
  const insert = async (t: ReportTemplate) => {
    await uniqueCode(t.code);
    const row = await db
      .insertInto('report_engine_template')
      .values({ code: t.code, name: t.name, revision: 1, definition_json: JSON.stringify(t) })
      .returning('id')
      .executeTakeFirstOrThrow();
    return get(row.id);
  };
  const self = {
    get,
    async list(keyword = '') {
      let q = db.selectFrom('report_engine_template').selectAll().orderBy('code');
      if (keyword)
        q = q.where((e) =>
          e.or([e('name', 'like', `%${keyword}%`), e('code', 'like', `%${keyword}%`)]),
        );
      return (await q.execute()).map(decode);
    },
    async create(raw: z.input<typeof HeaderSchema>) {
      const t = emptyTemplate(raw);
      return svc.tx((tsvc) => reportService(tsvc).insertValidated(t));
    },
    // 内部方法只接收通过严格合同校验的模板，不提供独立路由。
    async insertValidated(raw: ReportTemplate) {
      return insert(validate(raw));
    },
    async importTemplate(raw: ReportTemplate) {
      const t = validate(raw);
      return svc.tx((tsvc) => reportService(tsvc).insertValidated(t));
    },
    async copy(sourceId: number, raw: { code: string; name: string }) {
      return svc.tx(async (tsvc) => {
        const service = reportService(tsvc);
        const r = await service.get(sourceId);
        return service.insertValidated({
          ...r.template,
          ...HeaderSchema.pick({ code: true, name: true }).parse(raw),
          readOnly: false,
        });
      });
    },
    async save(id: number, expectedRevision: number, raw: ReportTemplate) {
      const template = validate(raw);
      return svc.tx(async (tsvc) => {
        const service = reportService(tsvc);
        const old = await service.assertEditable(id, expectedRevision);
        // 即使调用者主动移除越界内容，也拒绝通过缩小尺寸悄悄删掉原定义。
        if (
          old.template.cells.some((c) => {
            const p = coordinates(c.address);
            return p.row > template.rows || p.col > template.cols;
          })
        )
          fail('SHRINK', '缩小尺寸会删除已有单元格，请先在原尺寸下清空并保存这些单元格');
        if (template.readOnly !== old.template.readOnly)
          fail('READ_ONLY', '编辑时不能更改模板只读属性');
        const tdb = tsvc.db.withTables<ReportTables>();
        const duplicate = await tdb
          .selectFrom('report_engine_template')
          .select('id')
          .where('code', '=', template.code)
          .where('id', '!=', id)
          .executeTakeFirst();
        if (duplicate) fail('DUPLICATE', '报表编码重复，请换一个编码');
        const done = await tdb
          .updateTable('report_engine_template')
          .set({
            code: template.code,
            name: template.name,
            definition_json: JSON.stringify(template),
            revision: expectedRevision + 1,
          })
          .where('id', '=', id)
          .where('revision', '=', expectedRevision)
          .executeTakeFirst();
        if (done.numUpdatedRows !== 1n) fail('CONFLICT', '报表已更改，不能覆盖新版本');
        return service.get(id);
      });
    },
    assertEditable: editable,
    async remove(id: number, expectedRevision: number, confirmed: boolean) {
      if (!confirmed)
        fail('CONFIRM_DELETE', '删除报表前需要明确确认', '确认报表名称后，再执行删除。');
      return svc.tx(async (tsvc) => {
        await reportService(tsvc).assertEditable(id, expectedRevision);
        await tsvc.db
          .withTables<ReportTables>()
          .deleteFrom('report_engine_template')
          .where('id', '=', id)
          .where('revision', '=', expectedRevision)
          .execute();
      });
    },
    async snapshot(
      id: number,
      period: number,
      includeUnposted: boolean,
    ): Promise<ReportSnapshot | null> {
      await get(id);
      const r = await db
        .selectFrom('report_engine_snapshot')
        .select(['id', 'result_json'])
        .where('report_id', '=', id)
        .where('period', '=', period)
        .where('include_unposted', '=', Number(includeUnposted))
        .orderBy('id', 'desc')
        .executeTakeFirst();
      return r ? { ...(JSON.parse(r.result_json) as ReportSnapshot), id: r.id } : null;
    },
    async generate(input: z.infer<typeof GenerateSchema>) {
      return svc.tx(async (tsvc) => {
        const tdb = tsvc.db.withTables<ReportTables>();
        const requestJson = JSON.stringify({
          id: input.id,
          revision: input.expectedRevision,
          period: input.period,
          includeUnposted: input.includeUnposted,
        });
        const replay = await tdb
          .selectFrom('report_engine_snapshot')
          .selectAll()
          .where('request_id', '=', input.requestId)
          .executeTakeFirst();
        if (replay) {
          if (replay.request_json !== requestJson)
            fail('REQUEST_REUSED', '本次请求编号已用于不同的生成操作，请重新生成');
          return {
            kind: 'generated' as const,
            snapshot: { ...(JSON.parse(replay.result_json) as ReportSnapshot), id: replay.id },
          };
        }
        const report = await reportService(tsvc).get(input.id);
        if (report.revision !== input.expectedRevision)
          fail('CONFLICT', '报表定义已更改，请刷新后再生成');
        await tsvc.periods.require(input.period);
        const unposted = await tsvc.vouchers.list({
          periodTo: input.period,
          statuses: ['draft', 'pending', 'audited'],
          limit: 1,
        });
        if (unposted.total > 0 && !input.confirmUnposted)
          return {
            kind: 'confirmation' as const,
            count: unposted.total,
            links: [
              { label: '待审核凭证', to: `/m/voucher-book?period=${input.period}&status=pending` },
              { label: '已审核凭证', to: `/m/voucher-book?period=${input.period}&status=audited` },
            ],
          };
        if (!report.template.cells.some((c) => c.source.trim() !== ''))
          fail('EMPTY', '报表没有可生成的内容', '请先定义文本或取数公式并保存。');
        const engine = await createEngine(tsvc, input.period, input.includeUnposted);
        const cells: ReportSnapshot['cells'] = [];
        for (const c of report.template.cells) {
          if (c.kind === 'text') {
            cells.push({ address: c.address, value: c.source, unit: 'text', currency: 'CNY' });
            continue;
          }
          try {
            const v = await engine.cell(report.template.code, c.address);
            cells.push({
              address: c.address,
              value: v.amount.toFixed(),
              unit: v.unit,
              currency: v.currency,
            });
          } catch (e) {
            fail(
              'FORMULA',
              `${c.address}：${e instanceof Error ? e.message : '无法计算'}`,
              '请返回报表定义修正该单元格，再重算；上次成功结果仍保留。',
            );
          }
        }
        const checks: ReportSnapshot['checks'] = [];
        for (const check of report.template.checks) {
          try {
            const a = await engine.expression(report.template.code, check.left);
            const b = await engine.expression(report.template.code, check.right);
            const difference = finalize(calculate('-', a, b)).amount;
            checks.push({
              name: check.name,
              status: difference.abs().lte(check.tolerance) ? 'pass' : 'fail',
              difference: difference.toFixed(),
              tolerance: check.tolerance,
            });
          } catch (e) {
            checks.push({
              name: check.name,
              status: 'error',
              difference: null,
              tolerance: check.tolerance,
              reason: e instanceof Error ? e.message : '无法计算',
            });
          }
        }
        const snapshot: ReportSnapshot = {
          id: 0,
          reportId: report.id,
          revision: report.revision,
          period: input.period,
          includeUnposted: input.includeUnposted,
          unpostedCount: unposted.total,
          generatedAt: tsvc.ctx.now().toISOString(),
          template: report.template,
          cells,
          checks,
          dependencies: engine.dependencies(),
        };
        const saved = await tdb
          .insertInto('report_engine_snapshot')
          .values({
            report_id: report.id,
            request_id: input.requestId,
            request_json: requestJson,
            period: input.period,
            include_unposted: Number(input.includeUnposted),
            result_json: JSON.stringify(snapshot),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return { kind: 'generated' as const, snapshot: { ...snapshot, id: saved.id } };
      });
    },
  };
  return self;
}

/** 所有定义、取数和依赖都使用调用方传入的同一个事务；不读取旧生成快照。 */
async function createEngine(svc: CoreServices, period: number, includeUnposted: boolean) {
  const reports = await reportService(svc).list();
  const byCode = new Map(reports.map((r) => [r.template.code, r]));
  const used = new Map<number, Report>();
  const cache = new Map<string, Value>();
  const balances = new Map<string, Value>();
  const visiting = new Set<string>();
  let steps = 0;
  const tick = () => {
    if (++steps > 100_000) throw new FormulaError('本次生成超过100000步，请减少引用或拆分报表');
  };
  const balance = async (input: BalanceFunction): Promise<Value> => {
    const key = JSON.stringify(input);
    const old = balances.get(key);
    if (old) return old;
    const account = await svc.accounts.require(input.account);
    const dimensions: Partial<Record<DimensionTypeId, number>> = {};
    if (input.dimension !== 'none') {
      const item = await svc.dimensions.getByCode(input.dimension, input.item);
      if (!item) throw new FormulaError(`辅助项 ${input.dimension}:${input.item} 不存在`);
      dimensions[input.dimension] = item.id;
    }
    if (
      input.unit === 'foreignCents' &&
      !(await svc.reference.currencies()).some((c) => c.code === input.currency)
    )
      throw new FormulaError(`币种 ${input.currency} 不存在`);
    let total = value(0, input.unit, input.currency);
    if (input.dimension === 'cashflow') {
      const from = ['ytdDebit', 'ytdCredit'].includes(input.metric)
        ? Math.max((await svc.book.info()).startPeriod, periodYear(period) * 100 + 1)
        : period;
      const entries = await svc.ledger.entries({
        periodFrom: from,
        periodTo: period,
        accountCode: input.account,
        dimensions,
        currency: input.unit === 'foreignCents' ? input.currency : undefined,
        includeUnposted,
        limit: 200_000,
      });
      if (entries.length >= 200_000)
        throw new FormulaError('现金流量明细达到查询上限，无法保证完整取数');
      const debit = ['debit', 'ytdDebit'].includes(input.metric);
      for (const e of entries)
        if ((debit ? e.debit : e.credit) !== 0) {
          const n =
            input.unit === 'quantity'
              ? (e.quantity ?? '0')
              : input.unit === 'foreignCents'
                ? (e.fcAmount ?? 0)
                : debit
                  ? e.debit
                  : e.credit;
          if (typeof n === 'number' && !Number.isSafeInteger(n))
            throw new FormulaError('总账金额超出安全整数范围');
          total.amount = total.amount.plus(n);
        }
    } else {
      const rows = await svc.ledger.balances({
        periodFrom: period,
        periodTo: period,
        accountCodes: [input.account],
        dimensions,
        currency: input.unit === 'foreignCents' ? input.currency : undefined,
        includeUnposted,
        rollup: false,
        includeZero: true,
      });
      const suffix: Record<string, string> = {
        opening: 'Opening',
        closing: 'Closing',
        debit: 'Debit',
        credit: 'Credit',
      };
      for (const r of rows) {
        const amounts = [
          r.opening,
          r.closing,
          r.debit,
          r.credit,
          r.ytdDebit,
          r.ytdCredit,
          r.fcOpening,
          r.fcClosing,
          r.fcDebit,
          r.fcCredit,
        ];
        if (amounts.some((n) => !Number.isSafeInteger(n)))
          throw new FormulaError('总账汇总金额超出安全整数范围，不能使用可能丢失精度的结果');
        if (
          [r.qtyOpening, r.qtyClosing, r.qtyDebit, r.qtyCredit].some((n) =>
            value(n).amount.times(1_000_000).abs().gt(Number.MAX_SAFE_INTEGER),
          )
        )
          throw new FormulaError('总账数量超出安全e6范围，不能使用可能丢失精度的结果');
        const field =
          input.unit === 'cents'
            ? input.metric
            : `${input.unit === 'foreignCents' ? 'fc' : 'qty'}${suffix[input.metric]}`;
        const n = r[field as keyof BalanceRow];
        if (typeof n !== 'number' && typeof n !== 'string')
          throw new FormulaError('core不提供所选取数指标');
        if (typeof n === 'number' && !Number.isSafeInteger(n))
          throw new FormulaError('总账金额超出安全整数范围');
        total.amount = total.amount.plus(n);
      }
    }
    if (
      input.direction === 'normal' &&
      account.direction === 'credit' &&
      ['opening', 'closing'].includes(input.metric)
    )
      total.amount = total.amount.negated();
    total = finalize(total);
    balances.set(key, total);
    return total;
  };
  const requireReport = (code: string) => {
    const r = byCode.get(code);
    if (!r) throw new FormulaError(`引用的报表 ${code} 不存在`);
    used.set(r.id, r);
    return r;
  };
  const context = (code: string) => ({
    cell: (address: string) => cell(code, address),
    reference: cell,
    balance,
    tick,
  });
  const cell = async (code: string, address: string): Promise<Value> => {
    tick();
    const parsedCode = CodeSchema.safeParse(code);
    if (!parsedCode.success) throw new FormulaError(`报表编码 ${code} 不是最多三位数字`);
    code = parsedCode.data;
    address = address.toUpperCase();
    const report = requireReport(code);
    const p = coordinates(address);
    if (p.row < 1 || p.col < 1 || p.row > report.template.rows || p.col > report.template.cols)
      throw new FormulaError(`报表${code}引用的单元格 ${address} 不存在`);
    const key = `${code}!${address}`;
    const cached = cache.get(key);
    if (cached) return cached;
    if (visiting.has(key)) throw new FormulaError(`循环依赖：${[...visiting, key].join(' → ')}`);
    if (visiting.size >= 64) throw new FormulaError('跨单元格引用超过64层');
    visiting.add(key);
    try {
      const c = report.template.cells.find((c) => c.address === address);
      if (!c) return { ...value(0), empty: true };
      if (c.kind === 'text') throw new FormulaError(`引用的 ${key} 是文本，不能作为数值`);
      let v = finalize(
        c.kind === 'formula'
          ? await evaluate(parseFormula(c.source), context(code))
          : value(c.source, c.unit, c.currency),
      );
      if (v.empty) v = { ...v, unit: c.unit, currency: c.currency };
      if (v.unit !== c.unit || (v.unit === 'foreignCents' && v.currency !== c.currency))
        throw new FormulaError(`${key} 的结果单位与单元格声明不一致，请调整单位`);
      cache.set(key, v);
      return v;
    } finally {
      visiting.delete(key);
    }
  };
  return {
    cell,
    expression: (code: string, source: string) =>
      evaluate(parseFormula(source), context(code)).then(finalize),
    dependencies: () =>
      [...used.values()].map((r) => ({ id: r.id, code: r.template.code, revision: r.revision })),
  };
}
