import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { BusinessError } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  AnalysisSheetSchema,
  CustomFilterSchema,
  DefinitionInputSchema,
  DefinitionRowSchema,
  SaveResultSchema,
  type AnalysisSheet,
  type CustomFilter,
  type DefinitionInput,
  type SaveResult,
} from '../custom';
import type { TrendFilter, TrendReport } from '../shared';
import type { AnalysisTables } from './migrations';
import { analysisService } from './service';
import { sum, cents } from './fifo';
import { applyResultValues } from '../result-values';
import {
  evaluateFormula,
  inspectFormula,
  parseFormula,
  scaleResultValue,
  formulaError,
  type FormulaAccountRequest,
  formulaRequestKey,
} from './formula';
import { resolveFormulaAccounts, validateFormulaAccounts } from './formula-accounts';

function fail(
  code: string,
  message: string,
  hint = '请保留当前输入，刷新列表后重新打开，避免覆盖其他窗口的修改',
): never {
  throw new BusinessError({ code: `ANALYSIS_${code}`, message, hint });
}
function hash(sheet: Omit<AnalysisSheet, 'sourceHash'>): AnalysisSheet {
  const { generatedAt: _generatedAt, ...data } = sheet;
  return { ...sheet, sourceHash: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
}
function rowFromDb(row: Omit<AnalysisTables['analysis_definition'], 'id'> & { id: number }) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    revision: row.revision,
    expectedRevision: row.revision,
    rows: DefinitionRowSchema.array().parse(JSON.parse(row.rows_json)),
  };
}
async function getDefinition(svc: CoreServices, id: number) {
  const row = await svc.db
    .withTables<AnalysisTables>()
    .selectFrom('analysis_definition')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) fail('NOT_FOUND', '自定义分析表已不存在', '请刷新列表，选择其他分析表');
  return rowFromDb(row);
}
async function validateRows(
  svc: CoreServices,
  rows: ReturnType<typeof DefinitionRowSchema.array>['_output'],
) {
  const nodes = new Map(rows.map((r) => [r.key, parseFormula(r.formula)]));
  const accounts = new Set((await svc.accounts.list()).map((a) => a.code));
  const requests = new Map<string, FormulaAccountRequest>();
  const active = new Set<number>(),
    complete = new Set<number>();
  function visit(key: number): void {
    if (complete.has(key)) return;
    if (active.has(key)) formulaError(`项目${key}存在循环引用`);
    const node = nodes.get(key);
    if (!node) formulaError(`引用的项目${key}不存在`);
    active.add(key);
    inspectFormula(
      node,
      (_, code, request) => {
        if (!accounts.has(code)) formulaError(`科目 ${code} 不存在`);
        requests.set(formulaRequestKey(request), request);
      },
      visit,
    );
    active.delete(key);
    complete.add(key);
  }
  rows.forEach((r) => visit(r.key));
  await validateFormulaAccounts(svc, requests.values());
  return nodes;
}
export function definitionService(svc: CoreServices) {
  return {
    list: () =>
      svc.db
        .withTables<AnalysisTables>()
        .selectFrom('analysis_definition')
        .select(['id', 'code', 'name', 'revision'])
        .orderBy('code')
        .execute(),
    get: (id: number) => getDefinition(svc, id),
    async save(raw: DefinitionInput) {
      svc.permissions.require('analysis.definition.edit');
      svc.permissions.require('analysis.view');
      const input = DefinitionInputSchema.parse(raw);
      return svc.tx(async (t) => {
        await validateRows(t, input.rows);
        const db = t.db.withTables<AnalysisTables>();
        if (input.id) {
          const current = await getDefinition(t, input.id);
          if (current.revision !== input.expectedRevision)
            fail('CONFLICT', '分析定义已被另一窗口修改');
        } else if (input.expectedRevision !== 0) fail('CONFLICT', '新分析表的版本不正确');
        const duplicate = await db
          .selectFrom('analysis_definition')
          .select('id')
          .where('code', '=', input.code)
          .executeTakeFirst();
        if (duplicate && duplicate.id !== input.id)
          fail('DUPLICATE', '财务分析编号重复', '请使用其他1至3位数字编号');
        const value = {
          code: input.code,
          name: input.name,
          rows_json: JSON.stringify(input.rows),
          revision: input.expectedRevision + 1,
        };
        const saved = input.id
          ? await db
              .updateTable('analysis_definition')
              .set(value)
              .where('id', '=', input.id)
              .returning('id')
              .executeTakeFirstOrThrow()
          : await db
              .insertInto('analysis_definition')
              .values(value)
              .returning('id')
              .executeTakeFirstOrThrow();
        await t.log.write({
          action: 'analysis.definition.save',
          summary: `保存自定义分析 ${input.code} ${input.name}`,
        });
        return getDefinition(t, saved.id);
      });
    },
    async remove(input: { id: number; expectedRevision: number; confirmed: boolean }) {
      svc.permissions.require('analysis.definition.edit');
      svc.permissions.require('analysis.view');
      if (!input.confirmed)
        fail('CONFIRM', '删除分析表需要确认', '请确认删除；已保存的结果须先在结果列表中删除');
      return svc.tx(async (t) => {
        const current = await getDefinition(t, input.id);
        if (current.revision !== input.expectedRevision)
          fail('CONFLICT', '分析定义已被另一窗口修改');
        const db = t.db.withTables<AnalysisTables>();
        const used = await db
          .selectFrom('analysis_result')
          .select('id')
          .where('definition_id', '=', input.id)
          .executeTakeFirst();
        if (used)
          fail(
            'IN_USE',
            '该分析表已有保存结果，不能删除',
            '请先在已保存分析结果中删除对应结果，再删除定义',
          );
        await db.deleteFrom('analysis_definition').where('id', '=', input.id).execute();
        await t.log.write({
          action: 'analysis.definition.delete',
          summary: `删除自定义分析 ${current.code} ${current.name}`,
        });
        return { removed: true };
      });
    },
    async calculate(raw: CustomFilter): Promise<AnalysisSheet> {
      const f = CustomFilterSchema.parse(raw);
      return svc.tx(async (t) => {
        const definition = await getDefinition(t, f.definitionId);
        const nodes = await validateRows(t, definition.rows);
        const book = await t.book.info();
        if (f.periodFrom < book.startPeriod)
          fail('BEFORE_START', '分析开始期间早于账套启用期间', `请从 ${book.startPeriod} 起查询`);
        const periods: number[] = [];
        for (
          let p = f.periodFrom;
          p <= f.periodTo;
          p = p % 100 === 12 ? (Math.trunc(p / 100) + 1) * 100 + 1 : p + 1
        ) {
          await t.periods.require(p);
          periods.push(p);
        }
        const resultRows = definition.rows.map((r) => ({
          ...r,
          key: String(r.key),
          values: [] as number[],
          originalValues: [] as number[],
          total: 0,
          average: 0,
          averageNumerator: 0,
          averageDivisor: periods.length,
          ratio: null as string | null,
        }));
        for (const period of periods) {
          const requests = new Map<string, FormulaAccountRequest>();
          for (const node of nodes.values())
            inspectFormula(
              node,
              (_, _code, request) => requests.set(formulaRequestKey(request), request),
              () => {},
            );
          const values = await resolveFormulaAccounts(t, requests.values(), {
            period,
            scope: f.scope,
            includeUnposted: f.includeUnposted,
          });
          const memo = new Map<number, Decimal>();
          const evaluate = (key: number): Decimal => {
            let value = memo.get(key);
            if (!value) {
              value = evaluateFormula(
                nodes.get(key)!,
                (_, _code, request) => values.get(formulaRequestKey(request))!,
                evaluate,
              );
              memo.set(key, value);
            }
            return value;
          };
          resultRows.forEach((r) => {
            const value = scaleResultValue(evaluate(Number(r.key)), r.decimalPlaces ?? 2);
            r.values.push(value);
            r.originalValues.push(value);
          });
        }
        resultRows.forEach((r) => {
          r.total = r.values.at(-1)!;
          r.averageNumerator = sum(r.values);
          r.average = cents(
            new Decimal(sum(r.values))
              .div(r.values.length)
              .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
              .toNumber(),
          );
        });
        return hash({
          source: { kind: 'custom', filter: f },
          title: `${definition.code} ${definition.name}`,
          definitionRevision: definition.revision,
          generatedAt: t.ctx.now().toISOString(),
          periods,
          rows: resultRows,
          note: '函数按各月取数；科目包含下级。金额以元计算并保留两位小数，数量或数值按项目设置保留两位或六位。累计发生额含期初本年累计；余额借正贷负。小计仅为展示标志，金额由公式明确计算，避免重复汇总。末期数取最后一月，不累加余额。手工调整不重算其他项目的公式，小计请一并调整。',
        });
      });
    },
  };
}
export function sheetFromTrend(report: TrendReport): AnalysisSheet {
  const annual = report.filter.mode === 'annual';
  const year = Math.trunc(report.filter.period / 100);
  return hash({
    source: { kind: 'trend', filter: report.filter },
    generatedAt: report.generatedAt,
    title: `${year}年${annual ? '年度' : '月度'}科目分析`,
    periods: annual
      ? Array.from({ length: 12 }, (_, i) => year * 100 + i + 1)
      : [report.filter.period],
    note: `科目 ${report.filter.accountCode}；${report.filter.metric === 'debit' ? '借方发生额' : report.filter.metric === 'credit' ? '贷方发生额' : '期末余额'}；${report.filter.scope === 'operating' ? '经营口径，排除本年度损益结转' : '原始总账'}；${report.filter.includeUnposted ? '包含未过账' : '仅已过账'}。分析稿可手工调整，不回写凭证或总账。原数保留供核对；累计、月均与比例按调整差额重新计算。`,
    rows: report.rows.map((r) => ({
      key: r.accountCode,
      name: r.accountName,
      formula: '',
      subtotal: false,
      unit: 'money',
      values: annual ? [...r.months] : [r.current],
      originalValues: annual ? [...r.months] : [r.current],
      total: r.ytd,
      average: r.average,
      averageNumerator:
        report.filter.metric === 'balance' ? sum(r.months.map((v) => v ?? 0)) : r.ytd,
      averageDivisor:
        report.filter.metric === 'balance'
          ? report.activeMonths
          : annual
            ? 12
            : report.filter.period % 100,
      ratio: r.ratio,
    })),
  });
}
async function result(svc: CoreServices, id: number) {
  const row = await svc.db
    .withTables<AnalysisTables>()
    .selectFrom('analysis_result')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) fail('NOT_FOUND', '已保存分析结果不存在', '请刷新列表重新选择');
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    updatedAt: row.updated_at,
    sheet: AnalysisSheetSchema.parse(JSON.parse(row.sheet_json)),
  };
}
export function resultService(svc: CoreServices) {
  return {
    list: () =>
      svc.db
        .withTables<AnalysisTables>()
        .selectFrom('analysis_result')
        .select(['id', 'name', 'kind', 'period_from', 'period_to', 'revision', 'updated_at'])
        .orderBy('updated_at', 'desc')
        .orderBy('id', 'desc')
        .execute(),
    get: (id: number) => result(svc, id),
    async trend(filter: TrendFilter) {
      return sheetFromTrend(await analysisService(svc).trend(filter));
    },
    async save(raw: SaveResult) {
      svc.permissions.require('analysis.definition.edit');
      svc.permissions.require('analysis.view');
      const input = SaveResultSchema.parse(raw);
      return svc.tx(async (t) => {
        let base: AnalysisSheet;
        if (input.id) {
          const current = await result(t, input.id);
          if (current.revision !== input.expectedRevision)
            fail('CONFLICT', '分析结果已被另一窗口修改');
          base = current.sheet;
        } else {
          if (input.expectedRevision !== 0) fail('CONFLICT', '新分析结果的版本不正确');
          base =
            input.sheet.source.kind === 'trend'
              ? await resultService(t).trend(input.sheet.source.filter)
              : await definitionService(t).calculate(input.sheet.source.filter);
          // 原数及来源指纹同时核对；手工值与衍生累计可以编辑。
          const stable = (sheet: AnalysisSheet) =>
            JSON.stringify({
              source: sheet.source,
              periods: sheet.periods,
              rows: sheet.rows.map((r) => ({
                key: r.key,
                name: r.name,
                formula: r.formula,
                unit: r.unit,
                decimalPlaces: r.decimalPlaces ?? 2,
                subtotal: r.subtotal,
                originalValues: r.originalValues,
              })),
              definitionRevision: sheet.definitionRevision,
            });
          if (base.sourceHash !== input.sheet.sourceHash || stable(base) !== stable(input.sheet))
            fail(
              'SOURCE_CHANGED',
              '账务数据或分析定义已变化，不能覆盖当前分析稿',
              '请先导出保留手工调整，再重新取数；当前输入仍保留',
            );
        }
        if (
          JSON.stringify(base.source) !== JSON.stringify(input.sheet.source) ||
          JSON.stringify(base.periods) !== JSON.stringify(input.sheet.periods) ||
          base.rows.length !== input.sheet.rows.length
        )
          fail('INVALID_RESULT', '分析结果与来源不一致', '请重新打开结果后编辑');
        for (const p of base.periods)
          if (p >= (await t.book.info()).startPeriod)
            await t.periods.assertWritable({ period: p, mode: 'business', action: '保存分析结果' });
        base.rows.forEach((r, i) => {
          const edit = input.sheet.rows[i]!;
          if (
            edit.key !== r.key ||
            edit.values.length !== r.values.length ||
            edit.values.some((v, j) => (v === null) !== (r.values[j] === null))
          )
            fail('INVALID_RESULT', '分析项目或启用前期间被修改', '仅可修改有原数的结果单元格');
        });
        const sheet = applyResultValues(
          base,
          input.sheet.rows.map((r) => r.values),
        );
        const db = t.db.withTables<AnalysisTables>();
        const value = {
          definition_id: sheet.source.kind === 'custom' ? sheet.source.filter.definitionId : null,
          kind: sheet.source.kind,
          name: input.name,
          sheet_json: JSON.stringify(sheet),
          period_from: sheet.periods[0]!,
          period_to: sheet.periods.at(-1)!,
          revision: input.id && !input.saveAs ? input.expectedRevision + 1 : 1,
          updated_by: t.user.id,
          updated_at: t.ctx.now().toISOString(),
        };
        const saved =
          input.id && !input.saveAs
            ? await db
                .updateTable('analysis_result')
                .set(value)
                .where('id', '=', input.id)
                .returning('id')
                .executeTakeFirstOrThrow()
            : await db
                .insertInto('analysis_result')
                .values(value)
                .returning('id')
                .executeTakeFirstOrThrow();
        await t.log.write({
          action: 'analysis.result.save',
          summary: `保存分析结果 ${input.name}`,
        });
        return result(t, saved.id);
      });
    },
    async remove(input: { id: number; expectedRevision: number; confirmed: boolean }) {
      svc.permissions.require('analysis.definition.edit');
      svc.permissions.require('analysis.view');
      if (!input.confirmed) fail('CONFIRM', '删除分析结果需要确认', '请确认后再删除');
      return svc.tx(async (t) => {
        const current = await result(t, input.id);
        if (current.revision !== input.expectedRevision)
          fail('CONFLICT', '分析结果已被另一窗口修改');
        for (const p of current.sheet.periods)
          if (p >= (await t.book.info()).startPeriod)
            await t.periods.assertWritable({ period: p, mode: 'business', action: '删除分析结果' });
        await t.db
          .withTables<AnalysisTables>()
          .deleteFrom('analysis_result')
          .where('id', '=', input.id)
          .execute();
        await t.log.write({
          action: 'analysis.result.delete',
          summary: `删除分析结果 ${current.name}`,
        });
        return { removed: true };
      });
    },
  };
}
