export type PrintLayout = {
  paper: 'A4' | 'A5' | 'B5' | 'custom';
  widthMm: number;
  heightMm: number;
  landscape: boolean;
  margins: { top: number; right: number; bottom: number; left: number };
  offsetX: number;
  offsetY: number;
  perPage: 1 | 2 | 3;
  rows: number;
  fontSize: number;
  font: 'serif' | 'sans-serif';
  scale: number;
  copies: number;
  unitName: string;
  showUnit: boolean;
  supervisor: string;
  showAccountCode: boolean;
  showAuxiliary: boolean;
  deduplicateSummary: boolean;
  startPage: number;
  continuousPage: boolean;
  quantityDecimals: number;
  color: boolean;
  /** 合并凭证槽位的间距，旧调用方缺省为零。 */
  voucherGapMm?: number;
};

export const defaultLayout: PrintLayout = {
  paper: 'A4',
  widthMm: 210,
  heightMm: 297,
  landscape: false,
  margins: { top: 10, right: 10, bottom: 10, left: 10 },
  offsetX: 0,
  offsetY: 0,
  perPage: 1,
  rows: 20,
  fontSize: 10,
  font: 'serif',
  scale: 100,
  copies: 1,
  unitName: '',
  showUnit: true,
  supervisor: '',
  showAccountCode: true,
  showAuxiliary: true,
  deduplicateSummary: false,
  startPage: 1,
  continuousPage: true,
  quantityDecimals: 2,
  color: false,
  voucherGapMm: 0,
};

export function layoutGeometry(s: PrintLayout) {
  if (!['A4', 'A5', 'B5', 'custom'].includes(s.paper) || !['serif', 'sans-serif'].includes(s.font))
    throw new Error('纸张或字体类型无效');
  const range = (v: number, min: number, max: number, name: string, integer = false) => {
    if (!Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v)))
      throw new Error(`${name}必须为 ${min} 至 ${max}${integer ? ' 的整数' : ''}`);
  };
  range(s.widthMm, 80, 600, '纸张宽度');
  range(s.heightMm, 80, 600, '纸张高度');
  Object.values(s.margins).forEach((v) => range(v, 0, 100, '页边距'));
  range(s.offsetX, -100, 100, '水平偏移');
  range(s.offsetY, -100, 100, '垂直偏移');
  range(s.rows, 1, 100, '每页行数', true);
  range(s.perPage, 1, 3, '每页张数', true);
  range(s.fontSize, 6, 24, '字体大小');
  range(s.scale, 25, 100, '实际打印比例');
  range(s.copies, 1, 99, '份数', true);
  range(s.startPage, 1, 999999, '开始页码', true);
  range(s.quantityDecimals, 0, 6, '数量小数位', true);
  range(s.voucherGapMm ?? 0, 0, 50, '合并凭证间距');
  const base =
    s.paper === 'A4'
      ? [210, 297]
      : s.paper === 'A5'
        ? [148, 210]
        : s.paper === 'B5'
          ? [176, 250]
          : [s.widthMm, s.heightMm];
  const width = base[s.landscape ? 1 : 0]!;
  const height = base[s.landscape ? 0 : 1]!;
  const contentWidth = width - s.margins.left - s.margins.right;
  const contentHeight = height - s.margins.top - s.margins.bottom - 1;
  if (
    contentWidth < 60 ||
    (contentHeight - (s.voucherGapMm ?? 0) * (s.perPage - 1)) / s.perPage < 45
  )
    throw new Error('可打印区域过小，请减少边距或每页张数');
  if (
    s.offsetX < -s.margins.left ||
    s.offsetX > s.margins.right ||
    s.offsetY < -s.margins.top ||
    s.offsetY > s.margins.bottom
  )
    throw new Error('套打偏移超出纸张，会截断内容；请减小偏移');
  return {
    width,
    height,
    contentWidth,
    contentHeight,
    // 1mm 单元格上下内边距 + 1px 合并边框 + 像素取整余量。
    lineMm: s.fontSize * 0.352778 * 1.45 + 1.4,
    warning: s.offsetX || s.offsetY ? '已使用套打偏移，请核对纸张边缘后打印' : '',
  };
}

export function parsePageRange(text: string, total: number): number[] {
  if (!Number.isInteger(total) || total < 1) throw new Error('无记录，无法预览/打印');
  if (!text.trim()) throw new Error('打印范围不能为空，例如 1,3,5-12');
  const pages = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^\s*([1-9]\d*)(?:\s*-\s*([1-9]\d*))?\s*$/.exec(part);
    if (!m) throw new Error('打印范围无效，请输入页码或正向区间');
    const from = Number(m[1]),
      to = Number(m[2] ?? m[1]);
    if (from > to || to > total) throw new Error(`打印范围超出 1 至 ${total} 页或区间反向`);
    for (let p = from; p <= to; p++) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}
