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
  type BalanceTrace,
  type GenerateSchema,
  type Report,
  type ReportSnapshot,
  type ReportTemplate,
} from '../shared';
import type { ReportTables } from './migrations';
import { evaluateAudit, parseAudit } from './audit-formula';
import { hasReportReference, rewriteReportReferences } from '../editor-references';
import type { StructureChange } from '../editor-operations';
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
  for (const check of t.checks) {
    if (check.condition !== undefined) {
      try {
        parseAudit(check.condition);
      } catch (error) {
        fail(
          'FORMULA',
          `审核条件「${check.name}」：${error instanceof Error ? error.message : '条件不正确'}`,
        );
      }
    }
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
    async save(
      id: number,
      expectedRevision: number,
      raw: ReportTemplate,
      confirmShrink = false,
      structureChanges: StructureChange[] = [],
    ) {
      const template = validate(raw);
      return svc.tx(async (tsvc) => {
        const service = reportService(tsvc);
        const old = await service.assertEditable(id, expectedRevision);
        // 删除行列允许缩小定义，但必须明确确认，普通改尺寸不能静默丢失原内容。
        if (
          !confirmShrink &&
          old.template.cells.some((c) => {
            const p = coordinates(c.address);
            return p.row > template.rows || p.col > template.cols;
          })
        )
          fail('SHRINK', '缩小尺寸会删除已有单元格，请先确认删除行列后再保存');
        if (template.readOnly !== old.template.readOnly)
          fail('READ_ONLY', '编辑时不能更改模板只读属性');
        const tdb = tsvc.db.withTables<ReportTables>();
        if (template.code !== old.template.code) {
          for (const referring of await service.list()) {
            const candidate = referring.id === id ? template : referring.template;
            if (
              candidate.cells.some(
                (c) => c.kind === 'formula' && hasReportReference(c.source, old.template.code),
              ) ||
              candidate.checks.some(
                (c) =>
                  (c.condition !== undefined &&
                    hasReportReference(c.condition, old.template.code)) ||
                  hasReportReference(c.left, old.template.code) ||
                  hasReportReference(c.right, old.template.code),
              )
            )
              fail(
                'REFERENCED_CODE',
                `报表「${candidate.name}」仍引用编码${old.template.code}，暂不能修改该编码`,
                '请先调整引用公式，或保留原编码后保存；当前编辑内容仍保留。',
              );
          }
        }
        const changes = [...structureChanges];
        // 未指定插删步骤的旧客户端仅支持尾部改尺寸，不能推测内部行列的移动。
        if (changes.length === 0) {
          for (const axis of ['row', 'col'] as const) {
            const key = axis === 'row' ? 'rows' : 'cols';
            const difference = template[key] - old.template[key];
            if (difference !== 0)
              changes.push({
                axis,
                kind: difference > 0 ? 'insert' : 'delete',
                index: Math.min(template[key], old.template[key]) + 1,
                count: Math.abs(difference),
              });
          }
        }
        const size = { row: old.template.rows, col: old.template.cols };
        for (const change of changes) {
          const before = size[change.axis];
          if (
            change.index > before + (change.kind === 'insert' ? 1 : 0) ||
            (change.kind === 'delete' && change.index + change.count - 1 > before)
          )
            fail('STRUCTURE', '插删步骤与已保存定义不一致，请保留草稿并重新读取报表');
          size[change.axis] += change.kind === 'insert' ? change.count : -change.count;
          if (size[change.axis] < 1 || size[change.axis] > (change.axis === 'row' ? 999 : 250))
            fail('STRUCTURE', '插删步骤超出报表行列范围');
        }
        if (size.row !== template.rows || size.col !== template.cols)
          fail('STRUCTURE', '插删步骤与报表尺寸不一致，请保留草稿并重新读取报表');
        // 入向引用与当前定义同事务更新；任一受阻时全部保留，历史期间快照不改。
        if (changes.length > 0) {
          for (const referenced of await service.list()) {
            if (referenced.id === id) continue;
            const rewrite = (source: string) => {
              try {
                return changes.reduce(
                  (source, change) => rewriteReportReferences(source, change, old.template.code),
                  source,
                );
              } catch (error) {
                fail(
                  'REFERENCED',
                  `报表「${referenced.template.name}」仍引用被删除的单元格：${error instanceof Error ? error.message : '请先修改引用公式'}`,
                  '请先修改该报表中的引用公式，再删除行列；当前编辑和已保存定义均已保留。',
                );
              }
            };
            const next = {
              ...referenced.template,
              cells: referenced.template.cells.map((c) =>
                c.kind === 'formula' ? { ...c, source: rewrite(c.source) } : c,
              ),
              checks: referenced.template.checks.map((c) => ({
                ...c,
                left: rewrite(c.left),
                right: rewrite(c.right),
                ...(c.condition !== undefined ? { condition: rewrite(c.condition) } : {}),
              })),
            };
            if (JSON.stringify(next) === JSON.stringify(referenced.template)) continue;
            if (referenced.template.readOnly)
              fail(
                'REFERENCED_READ_ONLY',
                `只读报表「${referenced.template.name}」引用了本次移动的单元格，不能自动修改`,
                '请保留当前草稿，改用其他插删位置，或复制本报表后编辑。',
              );
            const valid = validate(next);
            await tdb
              .updateTable('report_engine_template')
              .set({ definition_json: JSON.stringify(valid), revision: referenced.revision + 1 })
              .where('id', '=', referenced.id)
              .where('revision', '=', referenced.revision)
              .execute();
          }
        }
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
            if (check.condition !== undefined) {
              const passed = await engine.condition(
                report.template.code,
                check.condition,
                check.tolerance,
              );
              checks.push({
                name: check.name,
                status: passed ? 'pass' : 'fail',
                difference: null,
                tolerance: check.tolerance,
                condition: check.condition,
                reason: passed ? '条件成立' : '条件不成立',
              });
              continue;
            }
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
              ...(check.condition !== undefined ? { condition: check.condition } : {}),
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
          sources: engine.sources(),
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
  const sources: BalanceTrace[] = [];
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
    const ytd = ['ytdDebit', 'ytdCredit'].includes(input.metric);
    if (ytd && input.unit !== 'cents') {
      const book = await svc.book.info();
      if (book.startPeriod % 100 !== 1 && periodYear(period) === periodYear(book.startPeriod))
        throw new FormulaError('启用前外币或数量累计没有独立来源，请选择本期发生额或后续完整年度');
    }
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
        if (
          (e.entrySide ?? (e.debit !== 0 ? 'debit' : 'credit')) === (debit ? 'debit' : 'credit')
        ) {
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
        ytdDebit: 'YtdDebit',
        ytdCredit: 'YtdCredit',
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
          throw new FormulaError(
            r.dimensionYtdMissing ?? '所选币种或数量指标缺少独立来源，请核实取数条件',
          );
        if (typeof n === 'number' && !Number.isSafeInteger(n))
          throw new FormulaError('总账金额超出安全整数范围');
        if (
          input.unit === 'quantity' &&
          value(n).amount.times(1_000_000).abs().gt(Number.MAX_SAFE_INTEGER)
        )
          throw new FormulaError('总账数量超出安全e6范围，不能使用可能丢失精度的结果');
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
  const context = (code: string, address = '审核表达式') => ({
    cell: (address: string) => cell(code, address),
    reference: cell,
    balance: async (input: BalanceFunction) => {
      const result = await balance(input);
      const dimensions: BalanceTrace['dimensions'] = {};
      if (input.dimension !== 'none') {
        const item = await svc.dimensions.getByCode(input.dimension, input.item);
        if (item) dimensions[input.dimension] = item.id;
      }
      sources.push({
        reportCode: code,
        address,
        input,
        periodFrom: ['ytdDebit', 'ytdCredit'].includes(input.metric)
          ? Math.max((await svc.book.info()).startPeriod, periodYear(period) * 100 + 1)
          : period,
        periodTo: period,
        dimensions,
        value: result.amount.toFixed(),
      });
      return result;
    },
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
          ? await evaluate(parseFormula(c.source), context(code, address))
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
    condition: (code: string, source: string, tolerance: string) =>
      evaluateAudit(parseAudit(source), context(code, '审核条件'), tolerance),
    sources: () => sources,
    dependencies: () =>
      [...used.values()].map((r) => ({ id: r.id, code: r.template.code, revision: r.revision })),
  };
}
