import {
  NATIVE_HEAD,
  NATIVE_KEYS,
  NATIVE_PZ,
  NATIVE_SAVEAS,
  NATIVE_SAVEAS0,
  NATIVE_TYPES,
  type NativeDocument,
  type NativeTable,
} from './native';

/** Entirely invented records; no original account data or resources. */
export function syntheticNative(mode: 'tables' | 'saveas' | 'saveas0' = 'tables'): NativeDocument {
  const head: Record<string, string | null> = {
    nf: '2026',
    yf: '1',
    pzlx: '3',
    pzbh: '7',
    pzdj_fds: '2',
    pzdj_bz: '1',
    pzdj_zdr: null,
    pzdj_shr: null,
    pzdj_jzr: null,
    pzdj_rq: '2026-01-05',
    pzdj_shrq: '2026-01-06',
    pzdj_jzrq: null,
  };
  const lines: Record<string, string | null>[] = [
    { pz_xh: '1', kmbm: '1001', pz_jf: '123.45', pz_df: '0' },
    { pz_xh: '2', kmbm: '4001', pz_jf: '0', pz_df: '123.45' },
  ].map((line) => ({
    ...Object.fromEntries(NATIVE_PZ.map((f) => [f, null])),
    ...Object.fromEntries(NATIVE_KEYS.map((f) => [f, head[f] ?? null])),
    pz_zy: '虚构原结构预检',
    dd: '5',
    ...line,
  }));
  const dict: NativeTable = {
    name: 'pzlx',
    columns: [...NATIVE_TYPES],
    rows: [['3', '记', '记账凭证']],
  };
  const tables: NativeTable[] =
    mode === 'tables'
      ? [
          {
            name: 'pz',
            columns: [...NATIVE_PZ],
            rows: lines.map((r) => NATIVE_PZ.map((f) => r[f] ?? null)),
          },
          {
            name: 'pzdj',
            columns: [...NATIVE_HEAD],
            rows: [NATIVE_HEAD.map((f) => head[f] ?? null)],
          },
        ]
      : [
          {
            name: mode === 'saveas' ? 'dw_pz_saveas' : 'dw_pz_saveas0',
            columns: [...(mode === 'saveas' ? NATIVE_SAVEAS : NATIVE_SAVEAS0)],
            rows: lines.map((r) =>
              (mode === 'saveas' ? NATIVE_SAVEAS : NATIVE_SAVEAS0).map((f) => {
                if (f.startsWith('pzdj_')) return head[f.slice(5)] ?? null;
                return (
                  r[
                    f.startsWith('pz_') && (mode === 'saveas0' || f === 'pz_dd' || f === 'pz_bz1')
                      ? f.slice(3)
                      : f
                  ] ?? null
                );
              }),
            ),
          },
        ];
  return {
    format: 'caiwu-native-rows-v1',
    source: {
      decoding: 'explicit-json-rows',
      amountUnit: 'yuan',
      amountEncoding: 'decimal-text',
      currency: 'CNY',
    },
    tables: [...tables, dict],
  };
}
