import { z } from 'zod';

// Fixed projections from json/datawindows.json, qingsong/dw_pz_saveas (not physical DDL).
export const NATIVE_KEYS = ['nf', 'yf', 'pzlx', 'pzbh'] as const;
export const NATIVE_PZ = [
  ...NATIVE_KEYS,
  'pz_xh',
  'kmbm',
  'pz_zy',
  'pz_jf',
  'pz_df',
  'pz_wb',
  'pz_hl',
  'pz_sl',
  'pz_dj',
  'jslb',
  'pz_ph',
  'jzbz',
  'xmbm',
  'dwbm',
  'bmbm',
  'grbm',
  'bz',
  'dw',
  'dd',
  'bz1',
  'xjbm',
] as const;
export const NATIVE_HEAD = [
  ...NATIVE_KEYS,
  'pzdj_fds',
  'pzdj_bz',
  'pzdj_zdr',
  'pzdj_shr',
  'pzdj_jzr',
  'pzdj_rq',
  'pzdj_shrq',
  'pzdj_jzrq',
] as const;
export const NATIVE_SAVEAS = [
  ...NATIVE_PZ.slice(0, 22),
  ...NATIVE_HEAD.slice(4).map((f) => `pzdj_${f}`),
  'pz_dd',
  'pz_bz1',
  'xjbm',
];
export const NATIVE_SAVEAS0 = [
  'pz_nf',
  'pz_yf',
  'pz_pzlx',
  'pz_pzbh',
  'pz_dd',
  'pzdj_pzdj_fds',
  'pzdj_pzdj_zdr',
  'pzdj_pzdj_shr',
  'pzdj_pzdj_jzr',
  'pz_pz_xh',
  'pz_kmbm',
  'pz_pz_zy',
  'pz_pz_jf',
  'pz_pz_df',
  'pz_pz_wb',
  'pz_bz',
  'pz_pz_hl',
  'pz_pz_sl',
  'pz_pz_dj',
  'pz_jslb',
  'pz_pz_ph',
  'pz_jzbz',
  'pz_xmbm',
  'pz_dwbm',
  'pz_bmbm',
  'pz_grbm',
  'pz_xjbm',
  'pz_htbh',
];
export const NATIVE_TYPES = ['pzlx', 'pzlx_jc', 'pzlx_qc'];
export const NATIVE_NOTICE =
  '原生数据尚未完成迁移；所有目标账务零变化。本入口仅作结构预检，不提供正式写账。';
export const NATIVE_GAPS = [
  '物理读取：缺经授权的 SQL Anywhere 8/9 原库及配对日志/备份样本、确切引擎/补丁版本、加密及访问条件、合法可运行的匹配读取器/驱动和恢复验证环境。静态 dbunload.exe / ODBC8/9 清单不证明已安装或获准运行。',
  '字节格式：缺原 SaveAs 的格式编号、编码、BOM、分隔/引号/换行、NULL、日期区域及字节转义规范与成对原字节/解码行样本；本入口只接受已明确解码的 JSON 表行，不声称兼容原导出字节。',
  '金额：缺 double 原值与十进制导出逐笔比对、货币及金额单位来源证明、原版精度/舍入规则、汇率/数量/单价语义；只能验证收到的文本是否精确落分，不证明原 double 保真。',
  '状态与身份：缺 pzdj_bz 全部取值及草稿/未审核/审核/过账/作废的版本化语义、pzdj_zdr/shr/jzr 人员档案关联、pzdj_rq/shrq/jzrq 的 NULL 与时序规则。原规则只证明 1/2 禁止转入，不把 0 或空值解释为未审核。',
  '全账：缺同一真实版本的完整 DDL/键约束、kmbm/nc 与辅助期初、期间/结账/累计、所有业务表和期末试算对照。tables.md 四个展示模板交集为空，不能把展示变体拼成真实账套版本。',
];

export const NativeRequestSchema = z.strictObject({
  name: z.string().min(1).max(120),
  text: z.string().min(1).max(262_144),
});
export const NativeDocumentSchema = z.strictObject({
  format: z.literal('caiwu-native-rows-v1'),
  source: z.strictObject({
    decoding: z.enum(['explicit-json-rows', 'unknown-original-bytes']),
    amountUnit: z.enum(['yuan', 'fen', 'unknown']),
    amountEncoding: z.enum(['decimal-text', 'unverified-double']),
    currency: z.string().max(20),
  }),
  tables: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(80),
        columns: z.array(z.string().min(1).max(80)).min(1).max(80),
        rows: z.array(z.array(z.string().max(2000).nullable()).max(80)).max(5000),
      }),
    )
    .min(1)
    .max(5),
});
export type NativeDocument = z.infer<typeof NativeDocumentSchema>;
export type NativeTable = NativeDocument['tables'][number];
export type NativeIssue = {
  code: string;
  area: 'structure' | 'fidelity' | 'migration';
  table: string;
  row: number | null;
  field: string;
  message: string;
};
export type NativeRowRef = { table: string; row: number; values: Record<string, string | null> };
export type NativeReport = {
  source: { name: string; sha256: string; bytes: number };
  profile: string;
  structurePassed: boolean;
  textAmountsPassed: boolean;
  migrationAllowed: false;
  targetChanges: 0;
  notice: string;
  issues: NativeIssue[];
  issueCount: number;
  document: NativeDocument | null;
  coverage: { table: string; field: string; present: boolean; handling: string }[];
  records: NativeRowRef[];
  vouchers: {
    key: string;
    head: NativeRowRef;
    lines: NativeRowRef[];
    typeName: string | null;
    debitCents: string | null;
    creditCents: string | null;
    amounts: {
      row: number;
      debitText: string | null;
      creditText: string | null;
      debitCents: string | null;
      creditCents: string | null;
    }[];
  }[];
  gaps: string[];
};
