import { z } from 'zod';
import type { CoreServices } from '@caiwu/core/server';
import { BusinessError } from '@caiwu/core';
import {
  StatutorySaveSchema,
  StatutoryImportSchema,
  StatutoryGenerateSchema,
  type StatutoryProfile,
  type StatutorySnapshot,
} from '../shared';
import type { ReportTables } from './migrations';
import { requireStatutory, statutoryProblem, statutoryRegistry } from './statutory-registry';

const profileTable = 'report_engine_statutory_profile';
const snapshotTable = 'report_engine_statutory_snapshot';
async function domain<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    if (error instanceof z.ZodError) {
      const details = error.issues
        .filter((issue) => issue.code === 'custom')
        .map((issue) => issue.message);
      statutoryProblem(
        details.length ? details.join('；') : '报表配置格式不正确，请检查日期、金额和必填依据',
      );
    }
    statutoryProblem(error instanceof Error ? error.message : '报表资料处理失败');
  }
}
function decodeProfile(row: {
  id: number;
  revision: number;
  profile_json: string;
}): StatutoryProfile {
  return {
    ...(JSON.parse(row.profile_json) as StatutoryProfile),
    id: row.id,
    revision: row.revision,
  };
}
async function load(svc: CoreServices, id: number) {
  const row = await svc.db
    .withTables<ReportTables>()
    .selectFrom(profileTable)
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) statutoryProblem('所选法定报表不存在，可能已被删除');
  const profile = decodeProfile(row);
  const { book } = await requireStatutory(svc, profile);
  if (profile.bookId !== book.id) statutoryProblem('报表分类资料属于另一账套，请重新配置科目');
  return profile;
}
function revision(profile: StatutoryProfile, expected: number) {
  if (profile.revision !== expected) statutoryProblem('报表配置已修改，请刷新后再操作');
}
function assertPeriod(configuration: StatutoryProfile['configuration'], annualOnly: boolean) {
  // 制度仍须在 prepare/verify 中完整校验，公共层只执行描述器的年度限制。
  if (
    annualOnly &&
    (!configuration ||
      typeof configuration !== 'object' ||
      Array.isArray(configuration) ||
      configuration.scope !== 'annual')
  )
    statutoryProblem('所选报表须选择年报口径和十二月报告日');
}
async function persist(
  svc: CoreServices,
  input: z.infer<typeof StatutorySaveSchema>,
  sourceDigest: string,
) {
  const db = svc.db.withTables<ReportTables>();
  const duplicate = await db
    .selectFrom(profileTable)
    .select('id')
    .where('code', '=', input.code)
    .where('id', '!=', input.id ?? 0)
    .executeTakeFirst();
  if (duplicate) statutoryProblem('法定报表编码重复，请换一个编码');
  const profile: StatutoryProfile = {
    id: input.id ?? 0,
    revision: (input.expectedRevision ?? 0) + 1,
    code: input.code,
    name: input.name,
    definitionId: input.definitionId,
    definitionRevision: input.definitionRevision,
    reportKey: input.reportKey,
    bookId: (await svc.book.info()).id,
    configuration: input.configuration,
    sourceDigest,
  };
  const values = {
    code: profile.code,
    name: profile.name,
    revision: profile.revision,
    profile_json: JSON.stringify(profile),
  };
  if (input.id) {
    const saved = await db
      .updateTable(profileTable)
      .set(values)
      .where('id', '=', input.id)
      .where('revision', '=', input.expectedRevision!)
      .executeTakeFirst();
    if (saved.numUpdatedRows !== 1n) statutoryProblem('报表配置已修改，请刷新后再操作');
    return load(svc, input.id);
  }
  const saved = await db
    .insertInto(profileTable)
    .values(values)
    .returning('id')
    .executeTakeFirstOrThrow();
  return load(svc, saved.id);
}
export function statutoryService(svc: CoreServices) {
  return {
    async catalog() {
      await svc.permissions.require('report-engine.view');
      const book = await svc.book.info();
      return statutoryRegistry
        .filter(
          (a) =>
            a.regime === book.regime &&
            a.products.includes(book.product) &&
            (!a.applicable || a.applicable(book)),
        )
        .map((a) => ({
          definitionId: a.definitionId,
          definitionRevision: a.definitionRevision,
          name: a.name,
          regime: a.regime,
          descriptors: a.descriptors,
        }));
    },
    async list() {
      await svc.permissions.require('report-engine.view');
      return (
        await svc.db
          .withTables<ReportTables>()
          .selectFrom(profileTable)
          .selectAll()
          .orderBy('code')
          .execute()
      ).map(decodeProfile);
    },
    async get(id: number) {
      await svc.permissions.require('report-engine.view');
      return load(svc, id);
    },
    async editor(input: {
      id?: number;
      definitionId: string;
      definitionRevision: number;
      reportKey: string;
      period: number;
      scope: 'month' | 'yearToDate' | 'annual';
      options?: unknown;
    }) {
      await svc.permissions.require('report-engine.view');
      return svc.tx(async (tsvc) => {
        const p = input.id ? await load(tsvc, input.id) : undefined;
        if (
          p &&
          (p.definitionId !== input.definitionId ||
            p.definitionRevision !== input.definitionRevision ||
            p.reportKey !== input.reportKey)
        )
          statutoryProblem('报表定义与所选配置不一致，请刷新后重试');
        const { adapter } = await requireStatutory(tsvc, input);
        return domain(() =>
          adapter.editor(
            tsvc,
            input.period,
            input.scope,
            p?.configuration,
            input.reportKey,
            input.options,
          ),
        );
      });
    },
    async save(raw: z.infer<typeof StatutorySaveSchema>) {
      await svc.permissions.require('report-engine.edit');
      const input = StatutorySaveSchema.parse(raw);
      return svc.tx(async (tsvc) => {
        const { adapter, descriptor } = await requireStatutory(tsvc, input);
        if (input.id) {
          const old = await load(tsvc, input.id);
          revision(old, input.expectedRevision!);
          if (
            old.definitionId !== input.definitionId ||
            old.definitionRevision !== input.definitionRevision ||
            old.reportKey !== input.reportKey
          )
            statutoryProblem('已有报表不能改为另一法定定义，请新增报表');
        }
        assertPeriod(input.configuration, descriptor.annualOnly);
        const prepared = await domain(() =>
          adapter.prepare(tsvc, input.configuration, input.reportKey),
        );
        return persist(
          tsvc,
          { ...input, configuration: prepared.configuration },
          prepared.sourceDigest,
        );
      });
    },
    async copy(id: number, expectedRevision: number, header: { code: string; name: string }) {
      await svc.permissions.require('report-engine.edit');
      return svc.tx(async (tsvc) => {
        const p = await load(tsvc, id);
        revision(p, expectedRevision);
        const { adapter } = await requireStatutory(tsvc, p);
        // 复制保留定义身份和已确认资料，不能借复制绕过来源变化检查。
        const period = (p.configuration as { period: number }).period;
        await domain(() => adapter.verify(tsvc, p, period));
        return persist(
          tsvc,
          StatutorySaveSchema.parse({
            code: header.code,
            name: header.name,
            definitionId: p.definitionId,
            definitionRevision: p.definitionRevision,
            reportKey: p.reportKey,
            configuration: p.configuration,
          }),
          p.sourceDigest,
        );
      });
    },
    async exportTemplate(id: number) {
      await svc.permissions.require('report-engine.export');
      const p = await load(svc, id);
      return StatutoryImportSchema.parse({
        schemaVersion: 1,
        kind: 'statutory-report',
        bookId: p.bookId,
        code: p.code,
        name: p.name,
        definitionId: p.definitionId,
        definitionRevision: p.definitionRevision,
        reportKey: p.reportKey,
        configuration: p.configuration,
      });
    },
    async importTemplate(raw: z.infer<typeof StatutoryImportSchema>) {
      await svc.permissions.require('report-engine.edit');
      const envelope = StatutoryImportSchema.parse(raw);
      return svc.tx(async (tsvc) => {
        if ((await tsvc.book.info()).id !== envelope.bookId)
          statutoryProblem('引入文件属于另一账套，科目编号不能直接沿用，请在当前账套重新配置');
        const { bookId: _bookId, kind: _kind, schemaVersion: _schemaVersion, ...input } = envelope;
        return statutoryService(tsvc).save(input);
      });
    },
    async generate(raw: z.infer<typeof StatutoryGenerateSchema>) {
      await svc.permissions.require('report-engine.generate');
      const input = StatutoryGenerateSchema.parse(raw);
      return svc.tx(async (tsvc) => {
        const p = await load(tsvc, input.id);
        revision(p, input.expectedRevision);
        const { adapter, descriptor } = await requireStatutory(tsvc, p);
        assertPeriod(p.configuration, descriptor.annualOnly);
        await tsvc.periods.require(input.period);
        // 必须先核对当前来源，再处理幂等命中；旧请求不能绕过核源。
        await domain(() => adapter.verify(tsvc, p, input.period));
        const db = tsvc.db.withTables<ReportTables>();
        const requestJson = JSON.stringify({
          profileId: p.id,
          revision: p.revision,
          definitionId: p.definitionId,
          definitionRevision: p.definitionRevision,
          reportKey: p.reportKey,
          sourceDigest: p.sourceDigest,
          period: input.period,
          userId: tsvc.user.id,
        });
        const replay = await db
          .selectFrom(snapshotTable)
          .selectAll()
          .where('request_id', '=', input.requestId)
          .executeTakeFirst();
        if (replay) {
          if (replay.request_json !== requestJson)
            statutoryProblem('请求编号已用于另一生成操作，请重新生成');
          return {
            kind: 'generated' as const,
            snapshot: { ...(JSON.parse(replay.result_json) as StatutorySnapshot), id: replay.id },
          };
        }
        const generated = await domain(() =>
          adapter.generate(tsvc, p, input.period, input.confirmUnposted),
        );
        if (generated.kind === 'confirmation') return generated;
        const snapshot: StatutorySnapshot = {
          id: 0,
          profile: p,
          period: input.period,
          generatedAt: tsvc.ctx.now().toISOString(),
          unpostedCount: generated.unpostedCount,
          result: generated.result,
        };
        const row = await db
          .insertInto(snapshotTable)
          .values({
            profile_id: p.id,
            request_id: input.requestId,
            request_json: requestJson,
            period: input.period,
            result_json: JSON.stringify(snapshot),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return { kind: 'generated' as const, snapshot: { ...snapshot, id: row.id } };
      });
    },
    async snapshot(id: number, period: number) {
      await svc.permissions.require('report-engine.view');
      await load(svc, id);
      const row = await svc.db
        .withTables<ReportTables>()
        .selectFrom(snapshotTable)
        .selectAll()
        .where('profile_id', '=', id)
        .where('period', '=', period)
        .orderBy('id', 'desc')
        .executeTakeFirst();
      return row ? { ...(JSON.parse(row.result_json) as StatutorySnapshot), id: row.id } : null;
    },
    async output(id: number, period: number, format: 'xlsx' | 'print') {
      await svc.permissions.require('report-engine.export');
      return svc.tx(async (tsvc) => {
        const p = await load(tsvc, id);
        const row = await tsvc.db
          .withTables<ReportTables>()
          .selectFrom(snapshotTable)
          .selectAll()
          .where('profile_id', '=', id)
          .where('period', '=', period)
          .orderBy('id', 'desc')
          .executeTakeFirst();
        if (!row) statutoryProblem('所选期间还没有成功生成的结果，请先生成报表');
        const snapshot = { ...(JSON.parse(row.result_json) as StatutorySnapshot), id: row.id };
        // 导出保存的同一个结果，仍需当前配置及来源有效；拒绝静默导出过期资料。
        if (snapshot.profile.revision !== p.revision)
          statutoryProblem('配置已更新，请重新生成后再导出或打印');
        const { adapter } = await requireStatutory(tsvc, snapshot.profile);
        await domain(() => adapter.verify(tsvc, snapshot.profile, period, snapshot.result));
        const printJob = format === 'print' ? adapter.print(snapshot.result, p.reportKey) : null;
        return {
          snapshotId: snapshot.id,
          name: p.name,
          period,
          printJob,
          data: printJob
            ? printJob.html
            : await domain(() => adapter.workbook(snapshot.result, p.reportKey)),
        };
      });
    },
  };
}
