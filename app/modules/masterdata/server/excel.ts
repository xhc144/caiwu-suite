import ExcelJS from 'exceljs';
import { BusinessError, type DimensionTypeId } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  AccountInputSchema,
  DimensionInputSchema,
  ReferenceInputSchema,
  type ReferenceKind,
  type ReferenceRow,
  type ExcelInput,
  type ImportPreview,
  type Confirmation,
  type AccountInput,
} from '../shared';
import { fail, masterdataService, confirmRequired } from './service';
import { referenceService } from './reference';

const { Workbook } = ExcelJS;

const dimTypes = ['project', 'partner', 'department', 'person'] as const;
const labels = { project: '项目', partner: '客供', department: '部门', person: '个人' };
const accountHeaders = [
  '编码',
  '名称',
  '类别',
  '方向',
  '停用',
  '现金',
  '银行',
  '现金流量必填',
  '往来',
  '外币币种',
  '数量单位',
  '助记码',
  ...dimTypes.flatMap((d) => [`${labels[d]}启用`, `${labels[d]}必填`, `${labels[d]}默认编码`]),
];
const dimensionHeaders = ['编码', '名称', '上级编码', '停用', '属性JSON'];
const referenceColumns: Record<ReferenceKind, { key: keyof ReferenceRow; title: string }[]> = {
  voucherTypes: [
    { key: 'code', title: '编码' },
    { key: 'shortName', title: '简称' },
    { key: 'name', title: '全称' },
    { key: 'disabled', title: '停用' },
    { key: 'sort', title: '排序' },
  ],
  settlementMethods: [
    { key: 'code', title: '编码' },
    { key: 'name', title: '名称' },
    { key: 'disabled', title: '停用' },
    { key: 'sort', title: '排序' },
  ],
  currencies: [
    { key: 'code', title: '编码' },
    { key: 'name', title: '名称' },
    { key: 'symbol', title: '符号' },
    { key: 'disabled', title: '停用' },
    { key: 'sort', title: '排序' },
  ],
  summaries: [
    { key: 'code', title: '编码' },
    { key: 'name', title: '摘要短语' },
    { key: 'category', title: '类别' },
    { key: 'shortcut', title: '快捷检索词' },
    { key: 'sort', title: '排序' },
  ],
};
const referenceNames: Record<ReferenceKind, string> = {
  voucherTypes: '凭证类型',
  settlementMethods: '结算类别',
  currencies: '币种',
  summaries: '摘要',
};
function columnsFor(kind: ReferenceKind | undefined) {
  if (!kind) fail('REFERENCE_KIND', '请选择参考档案类型');
  return referenceColumns[kind];
}
type SheetRow = { row: number; data: Record<string, string> };
class PreviewRollback extends Error {
  constructor(readonly result: ImportPreview) {
    super('预览回滚');
  }
}
const flag = (s: string | undefined) => {
  if (!s || s === '0' || s === 'false') return false;
  if (s === '1' || s === 'true') return true;
  return fail('EXCEL_FLAG', `标志 ${s} 无法识别，请用0或1`);
};

async function read(input: ExcelInput): Promise<SheetRow[]> {
  if (!input.fileName || !input.content)
    fail('FILE_REQUIRED', '请选择要导入的Excel文件', '请先导出模板，再填写档案');
  const wb = new Workbook();
  try {
    await wb.xlsx.load(
      Buffer.from(input.content, 'base64') as unknown as Parameters<typeof wb.xlsx.load>[0],
    );
  } catch {
    fail('FILE_INVALID', '文件无法解析为Excel工作簿', '请使用本模块导出的.xlsx文件');
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) fail('FILE_EMPTY', '文件没有档案数据', '表头下面至少填写一行');
  if (ws.rowCount > 5001) fail('FILE_LARGE', '单次最多导入5000条档案', '请分批导入');
  const headers = (ws.getRow(1).values as unknown[]).slice(1).map(String);
  const required =
    input.kind === 'accounts'
      ? accountHeaders
      : input.kind === 'dimensions'
        ? dimensionHeaders
        : columnsFor(input.referenceKind).map((c) => c.title);
  if (new Set(headers).size !== headers.length)
    fail('FILE_HEADERS', '文件含重复表头', '请保留每个表头一次，避免覆盖同名列');
  if (required.some((h) => !headers.includes(h)))
    fail(
      'FILE_HEADERS',
      '文件缺少必要列',
      '请使用本模块导出的完整表头，核算标志与默认项均不可缺列',
    );
  const rows: SheetRow[] = [];
  ws.eachRow((r, index) => {
    if (index === 1) return;
    const data: Record<string, string> = {};
    headers.forEach((h, i) => {
      const cell = r.getCell(i + 1);
      if (cell.type === 6)
        fail('FILE_FORMULA', `第${index}行含公式，不能作为档案导入`, '请将公式粘贴为文本值');
      data[h] = cell.text.trim();
    });
    if (Object.values(data).some(Boolean)) rows.push({ row: index, data });
  });
  if (!rows.length) fail('FILE_EMPTY', '文件没有档案数据');
  return rows.sort(
    (a, b) =>
      a.data['编码']!.length - b.data['编码']!.length ||
      a.data['编码']!.localeCompare(b.data['编码']!),
  );
}

export function excelService(svc: CoreServices) {
  const self = {
    async export(kind: ExcelInput['kind'], type?: DimensionTypeId, referenceKind?: ReferenceKind) {
      const wb = new Workbook();
      const ws = wb.addWorksheet('基础档案');
      const columns = kind === 'reference' ? columnsFor(referenceKind) : [];
      const headers =
        kind === 'accounts'
          ? accountHeaders
          : kind === 'dimensions'
            ? dimensionHeaders
            : columns.map((c) => c.title);
      ws.addRow(headers);
      if (kind === 'accounts') {
        for (const a of await svc.accounts.list()) {
          const dims: (string | number)[] = [];
          for (const t of dimTypes) {
            const d = a.dimensions.find((d) => d.type === t);
            dims.push(
              d ? 1 : 0,
              d?.required ? 1 : 0,
              d?.defaultItemId ? ((await svc.dimensions.get(d.defaultItemId))?.code ?? '') : '',
            );
          }
          ws.addRow([
            a.code,
            a.name,
            a.categoryId,
            a.direction,
            +a.disabled,
            +a.isCash,
            +a.isBank,
            +a.cashflowRequired,
            +a.isPartner,
            a.currency ?? '',
            a.quantityUnit ?? '',
            a.mnemonic ?? '',
            ...dims,
          ]);
        }
      } else if (kind === 'dimensions') {
        if (!type) fail('DIMENSION_TYPE', '请指定辅助档案类型');
        const items = await svc.dimensions.items(type);
        for (const a of items)
          ws.addRow([
            a.code,
            a.name,
            items.find((x) => x.id === a.parentId)?.code ?? '',
            +a.disabled,
            JSON.stringify(a.attrs),
          ]);
      } else {
        for (const row of await referenceService(svc).list(referenceKind!))
          ws.addRow(
            columns.map(({ key }) =>
              typeof row[key] === 'boolean' ? +row[key] : (row[key] ?? ''),
            ),
          );
      }
      ws.columns.forEach((c) => {
        c.width = 22;
        c.numFmt = '@';
      });
      return {
        fileName: `${kind === 'accounts' ? '科目' : kind === 'dimensions' ? '辅助档案' : referenceNames[referenceKind!]}.xlsx`,
        content: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      };
    },
    async process(input: ExcelInput, commit: boolean): Promise<ImportPreview> {
      const rows = await read(input);
      try {
        return await svc.tx(async (tsvc) => {
          const service = masterdataService(tsvc);
          const result: ImportPreview = { rows: [], confirmations: [], valid: true };
          const seen = new Set<string>();
          for (const { row, data: r } of rows) {
            const code = r['编码'] ?? '';
            const name = r['名称'] ?? r['全称'] ?? r['摘要短语'] ?? '';
            try {
              if (seen.has(code)) fail('EXCEL_DUPLICATE', `文件内编号 ${code} 重复`);
              seen.add(code);
              let warnings: Confirmation[] = [];
              let action = '新增';
              if (input.kind === 'accounts') {
                const existing = await tsvc.accounts.getByCode(code);
                action = existing ? '更新/保持' : '新增';
                const dimensions = [];
                for (const t of dimTypes)
                  if (flag(r[`${labels[t]}启用`])) {
                    const defaultCode = r[`${labels[t]}默认编码`];
                    const item = defaultCode
                      ? await tsvc.dimensions.getByCode(t, defaultCode)
                      : null;
                    if (defaultCode && !item)
                      fail('DEFAULT_ITEM', `默认${labels[t]} ${defaultCode} 不存在`);
                    dimensions.push({
                      type: t,
                      required: flag(r[`${labels[t]}必填`]),
                      defaultItemId: item?.id ?? null,
                    });
                  }
                const data: AccountInput = AccountInputSchema.parse({
                  id: existing?.id,
                  code,
                  name,
                  categoryId: r['类别'],
                  direction: r['方向'],
                  disabled: flag(r['停用']),
                  isCash: flag(r['现金']),
                  isBank: flag(r['银行']),
                  cashflowRequired: flag(r['现金流量必填']),
                  isPartner: flag(r['往来']),
                  currency: r['外币币种'] || null,
                  quantityUnit: r['数量单位'] || null,
                  mnemonic: r['助记码'] || null,
                  dimensions,
                });
                warnings = (await service.prepareAccount(data)).warnings;
                // 预览只在会被整体回滚的事务中模拟；确认时重新验证所有历史保护。
                await service.writeAccount({
                  ...data,
                  confirmations: commit ? input.confirmations : warnings.map((w) => w.key),
                });
              } else if (input.kind === 'dimensions') {
                if (!input.type) fail('DIMENSION_TYPE', '请指定辅助档案类型');
                const existing = await tsvc.dimensions.getByCode(input.type, code);
                action = existing ? '更新/保持' : '新增';
                const parent = r['上级编码']
                  ? await tsvc.dimensions.getByCode(input.type, r['上级编码'])
                  : null;
                if (r['上级编码'] && !parent)
                  fail('DIMENSION_PARENT', `上级 ${r['上级编码']} 不存在`);
                const attrs: unknown = JSON.parse(r['属性JSON'] || '{}');
                const data = DimensionInputSchema.parse({
                  id: existing?.id,
                  type: input.type,
                  code,
                  name,
                  parentId: parent?.id ?? null,
                  disabled: flag(r['停用']),
                  attrs,
                });
                await service.writeDimension(data);
              } else {
                if (!input.referenceKind) fail('REFERENCE_KIND', '请选择参考档案类型');
                const refs = referenceService(tsvc);
                const existing = (await refs.list(input.referenceKind)).find(
                  (r) => r.code === code,
                );
                action = existing ? '更新/保持' : '新增';
                const sort = r['排序'] ?? '';
                if (!/^\d+$/.test(sort)) fail('REFERENCE_SORT', '排序须为0至100000的整数');
                const data = ReferenceInputSchema.parse({
                  ...existing,
                  kind: input.referenceKind,
                  id: existing?.id,
                  code,
                  name,
                  shortName: r['简称'] ?? '',
                  disabled: flag(r['停用']),
                  sort: Number(sort),
                  symbol: r['符号'] || null,
                  category: r['类别'] ?? '',
                  shortcut: r['快捷检索词'] ?? '',
                });
                await refs.save(data);
              }
              result.rows.push({ row, code, name, action, error: '' });
              result.confirmations.push(...warnings);
            } catch (error) {
              if (commit) throw error;
              result.valid = false;
              const message =
                error instanceof BusinessError
                  ? error.data.message
                  : error instanceof Error
                    ? error.message
                    : '数据错误';
              result.rows.push({ row, code, name, action: '拒绝', error: message });
            }
          }
          result.confirmations = [...new Map(result.confirmations.map((w) => [w.key, w])).values()];
          if (!commit) throw new PreviewRollback(result);
          confirmRequired(
            [{ key: 'import', message: '确认导入预览中的全部档案？' }],
            input.confirmations ?? [],
          );
          await tsvc.log.write({
            action: 'masterdata.import',
            summary: `导入${rows.length}条${input.kind === 'accounts' ? '科目' : input.kind === 'dimensions' ? '辅助档案' : referenceNames[input.referenceKind!]}`,
          });
          return result;
        });
      } catch (error) {
        if (error instanceof PreviewRollback) return error.result;
        throw error;
      }
    },
  };
  return self;
}
