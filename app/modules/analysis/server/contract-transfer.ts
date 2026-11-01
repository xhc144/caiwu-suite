import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { BusinessError, centsToYuan } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { ContractInputSchema, type ContractInput } from '../contracts';
import {
  CONTRACT_ARCHIVE_HEADERS,
  ContractImportCommitSchema,
  ContractImportPreviewSchema,
  type ContractImportCommitInput,
  type ContractImportPreviewInput,
} from '../contract-transfer';
import type { AnalysisTables } from './migrations';
import { contractService } from './contracts';
import { parseContractEditorMoney } from '../contract-editor-values';

function fail(message: string, hint = '请保留文件并修改出错行后重新预览'): never {
  throw new BusinessError({ code: 'ANALYSIS_CONTRACT_IMPORT', message, hint });
}
function errorMessage(error: unknown) {
  if (error instanceof BusinessError) return error.data.message;
  return '保存失败，本行未导入，请检查后重试';
}
function text(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  fail('请将导入单元格保存为文本或数值，不能包含公式、链接或合并内容');
}
type PreviewRow = {
  row: number;
  code: string;
  action: '新增' | '覆盖' | '错误';
  error: string | null;
  input: ContractInput | null;
};
async function prepare(svc: CoreServices, raw: ContractImportPreviewInput) {
  const input = ContractImportPreviewSchema.parse(raw);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.fileBase64)) fail('文件内容不是有效的Excel文件');
  const bytes = Buffer.from(input.fileBase64, 'base64');
  if (bytes.length > 4_000_000) fail('文件不能超过4MB');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Uint8Array.from(bytes).buffer);
  } catch {
    fail('不能读取Excel文件', '请使用本页导出的合同档案Excel，保留表头并重新保存为xlsx格式');
  }
  const sheet = wb.getWorksheet('合同档案') ?? wb.worksheets[0];
  if (!sheet || sheet.rowCount < 2) fail('文件没有合同数据');
  if (sheet.rowCount > 1001) fail('一次最多导入1000条合同，请拆分文件');
  const headers = CONTRACT_ARCHIVE_HEADERS.map((_, i) => text(sheet.getCell(1, i + 1)));
  if (headers.some((v, i) => v !== CONTRACT_ARCHIVE_HEADERS[i]))
    fail(
      '合同档案表头不匹配',
      '请先导出合同档案，用同一列顺序填写；金额单位为元，日期为YYYY-MM-DD',
    );
  const existing = await svc.db
    .withTables<AnalysisTables>()
    .selectFrom('analysis_contract')
    .select(['id', 'code', 'revision', 'reviewed_by'])
    .execute();
  const linked = new Set(
    (
      await svc.db
        .withTables<AnalysisTables>()
        .selectFrom('analysis_contract_line')
        .select('contract_id')
        .execute()
    ).map((r) => r.contract_id),
  );
  const accounts = new Map((await svc.accounts.list()).map((a) => [a.code, a]));
  const partners = new Map((await svc.dimensions.items('partner')).map((p) => [p.code, p]));
  const rows: PreviewRow[] = [];
  const codes = new Set<string>();
  for (let row = 2; row <= sheet.rowCount; row++) {
    const cells = CONTRACT_ARCHIVE_HEADERS.map((_, col) => {
      try {
        return text(sheet.getCell(row, col + 1));
      } catch {
        return null;
      }
    });
    if (cells.every((v) => v === '')) continue;
    const code = cells[0] ?? '';
    try {
      for (const column of [7, 8]) {
        const value = sheet.getCell(row, column).value;
        if (typeof value === 'number' && Math.abs(value) > 9_999_999_999_999.99)
          fail('大额数值单元格可能已丢失精度，请将合同金额和期初收付款改为精确文本后重新导入');
      }
      if (cells.includes(null)) fail('本行包含公式、链接或不支持的单元格内容');
      if (codes.has(code)) fail('文件内合同号重复');
      codes.add(code);
      const current = existing.find((r) => r.code === code);
      if (current && !input.overwrite) fail('合同号已存在；需要选择允许覆盖并重新预览');
      if (current && (current.reviewed_by || linked.has(current.id)))
        fail('已审核或已使用的合同不能覆盖');
      const partner = partners.get(cells[2]!);
      if (!partner || partner.disabled || !partner.isLeaf)
        fail('客供编码不存在或不是启用的末级客供');
      const account = accounts.get(cells[3]!);
      if (
        !account ||
        account.disabled ||
        !account.isLeaf ||
        !(account.isCash || account.isBank) ||
        !account.dimensions.some((d) => d.type === 'partner')
      )
        fail('科目编码须为启用客供核算的末级现金或银行科目');
      let amount: number | null = null,
        opening: number | null = null;
      try {
        amount = parseContractEditorMoney(cells[6]!, '合同金额');
        opening = parseContractEditorMoney(cells[7]!, '期初收付款');
      } catch (error) {
        fail(error instanceof Error ? error.message : '金额不是有效金额');
      }
      if (amount === null || opening === null) fail('合同金额或期初收付款不是有效金额');
      if (cells[5] !== '收款' && cells[5] !== '付款') fail('收付款类型只能填写收款或付款');
      const parsed = ContractInputSchema.safeParse({
        id: current?.id,
        expectedRevision: current?.revision ?? 0,
        code,
        name: cells[1],
        partnerId: partner.id,
        accountId: account.id,
        signedDate: cells[4],
        kind: cells[5] === '收款' ? 'receipt' : 'payment',
        amount,
        opening,
        description: cells[8],
        remark: cells[9],
        remark2: cells[10],
      });
      if (!parsed.success) fail(parsed.error.issues.map((i) => i.message).join('；'));
      rows.push({ row, code, action: current ? '覆盖' : '新增', error: null, input: parsed.data });
    } catch (error) {
      rows.push({ row, code, action: '错误', error: errorMessage(error), input: null });
    }
  }
  if (!rows.length) fail('文件没有合同数据');
  const previewHash = createHash('sha256').update(JSON.stringify({ input, rows })).digest('hex');
  return { previewHash, rows };
}
export function contractTransferService(svc: CoreServices) {
  return {
    async previewImport(raw: ContractImportPreviewInput) {
      svc.permissions.require('analysis.contract.view');
      svc.permissions.require('analysis.contract.edit');
      return svc.tx(async (s) => {
        const plan = await prepare(s, raw);
        return {
          ...plan,
          valid: plan.rows.filter((r) => !r.error).length,
          invalid: plan.rows.filter((r) => r.error).length,
        };
      });
    },
    async importArchive(raw: ContractImportCommitInput) {
      svc.permissions.require('analysis.contract.view');
      svc.permissions.require('analysis.contract.edit');
      const input = ContractImportCommitSchema.parse(raw);
      if (!input.confirmed)
        fail('导入合同需要明确确认', '请检查预览中的新增、覆盖及错误行，再确认导入');
      const plan = await svc.tx((s) => prepare(s, input));
      if (plan.previewHash !== input.previewHash)
        fail('合同或档案已变化，原导入预览已失效', '请重新预览，确认变化后再导入');
      const results = [];
      for (const row of plan.rows) {
        if (!row.input) {
          results.push({ row: row.row, code: row.code, success: false, error: row.error });
          continue;
        }
        try {
          const saved = await contractService(svc).save(row.input);
          results.push({ row: row.row, code: row.code, success: true, error: null, id: saved.id });
        } catch (error) {
          results.push({
            row: row.row,
            code: row.code,
            success: false,
            error: errorMessage(error),
          });
        }
      }
      return {
        results,
        succeeded: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      };
    },
    async archive() {
      svc.permissions.require('analysis.contract.view');
      return svc.tx(async (s) => {
        const rows = await s.db
          .withTables<AnalysisTables>()
          .selectFrom('analysis_contract as c')
          .innerJoin('dimension_item as p', 'p.id', 'c.partner_id')
          .innerJoin('account as a', 'a.id', 'c.account_id')
          .innerJoin('app_user as u', 'u.id', 'c.created_by')
          .leftJoin('app_user as r', 'r.id', 'c.reviewed_by')
          .selectAll('c')
          .select([
            'p.code as partnerCode',
            'p.name as partnerName',
            'a.code as accountCode',
            'u.name as creatorName',
            'r.name as reviewerName',
          ])
          .orderBy('c.code')
          .limit(1001)
          .execute();
        if (rows.length > 1000) fail('合同超过1000条，不能输出截断档案');
        return {
          rows,
          generatedAt: s.ctx.now().toISOString(),
          baseCurrency: (await s.book.info()).baseCurrency,
        };
      });
    },
    async exportLines(id: number) {
      svc.permissions.require('analysis.export');
      svc.permissions.require('analysis.contract.view');
      const contract = await contractService(svc).get(id);
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('合同收付明细');
      sheet.addRow([
        `合同 ${contract.code} ${contract.name}；${contract.partnerName}；仅明确关联分录`,
      ]);
      sheet.addRow([
        '日期',
        '凭证',
        '科目',
        '摘要',
        '借方金额（元）',
        '贷方金额（元）',
        '收付款金额（元）',
        '交易币种',
        '状态',
      ]);
      contract.lines.forEach((r) =>
        sheet.addRow([
          r.date,
          r.displayNo,
          r.accountCode,
          r.summary,
          centsToYuan(r.debit),
          centsToYuan(r.credit),
          centsToYuan(r.amount),
          r.currency,
          r.status === 'posted' && !r.voided ? '已过账' : '已失效，请处理',
        ]),
      );
      sheet.columns.forEach((col) => {
        col.width = 22;
        col.numFmt = '@';
      });
      sheet.views = [{ state: 'frozen', ySplit: 2 }];
      return { contract, base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64') };
    },
    async exportArchive() {
      svc.permissions.require('analysis.export');
      const archive = await contractTransferService(svc).archive();
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('合同档案');
      sheet.addRow([...CONTRACT_ARCHIVE_HEADERS, '录入人', '审核人']);
      archive.rows.forEach((r) =>
        sheet.addRow([
          r.code,
          r.name,
          r.partnerCode,
          r.accountCode,
          r.signed_date,
          r.kind === 'receipt' ? '收款' : '付款',
          centsToYuan(r.amount),
          centsToYuan(r.opening),
          r.description,
          r.remark,
          r.remark2,
          r.creatorName,
          r.reviewerName ?? '',
        ]),
      );
      sheet.columns.forEach((col) => {
        col.width = 22;
        col.numFmt = '@';
      });
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.getRow(1).font = { bold: true };
      const help = wb.addWorksheet('填写说明');
      help.addRow([
        '金额以元填写；最多1000行；保留合同档案表的前11列表头及顺序；客供和科目按编码匹配。',
      ]);
      help.addRow([
        '每条合同独立保存，错误行不影响其他行；覆盖需明确选择；已审核、已使用合同不能覆盖。',
      ]);
      help.addRow(['录入人与审核人为展示信息，导入后新合同为未审核状态；到期日未提供时不推算。']);
      return { archive, base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64') };
    },
  };
}
