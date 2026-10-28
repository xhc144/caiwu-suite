import { escapeHtml, type PrintJob } from '@caiwu/print';
import { AssetPrintSettingsSchema, type AssetPrintSettings } from '../shared';

export type LabelRow = {
  code: string;
  name: string;
  department: string;
  category: string;
  date?: string;
  description?: string;
  reference?: string;
};
export type LabelColor = 'monochrome' | 'color';

/** 预览、打印及 HTML 文件共用同一标签内容与纸张尺寸。 */
export function assetLabelsPrint(
  rows: readonly LabelRow[],
  color: LabelColor,
  settings?: AssetPrintSettings,
): PrintJob {
  if (!rows.length) throw new Error('没有记录，无法打印及预览');
  if (color !== 'monochrome' && color !== 'color') throw new Error('请选择单色或彩色打印');
  const ink = color === 'color' ? '#164b82' : '#000000';
  const layout = AssetPrintSettingsSchema.parse(settings ?? {});
  const fieldNames = {
    code: '编号',
    name: '名称',
    department: '部门',
    category: '类别',
    date: '使用日期',
    description: '规格型号',
    reference: '参考编号',
  };
  return {
    title: '资产标签',
    pageSize: { widthMm: 88, heightMm: 51 },
    marginMm: 4,
    css: `.print-sheet{width:80mm;height:43mm;box-sizing:border-box;color:${ink};print-color-adjust:exact;-webkit-print-color-adjust:exact}.scaled{width:100%;overflow-wrap:anywhere}.scaled h2{font-size:1.35em;margin:0 0 2mm;border-bottom:1px solid ${ink};padding-bottom:1mm}.scaled p{line-height:1.3;margin:1mm 0}.scaled b{font-weight:bold}@media screen{body{box-sizing:border-box;padding:4mm;width:88mm}}`,
    html: rows
      .map((r, i) => {
        // 超长档案名称以较小字体容纳；打印驱动仍会检查浏览器实际排版。
        const chars = layout.labelFields
          .map((f) => r[f] ?? '')
          .reduce(
            (n, v) =>
              n + Array.from(v).reduce((m, c) => m + ((c.codePointAt(0) ?? 0) > 255 ? 1 : 0.55), 0),
            0,
          );
        const fontSize = Math.min(
          layout.labelFont,
          chars > 350 ? 6 : chars > 240 ? 7 : chars > 150 ? 8 : 12,
        );
        return `<section${i < rows.length - 1 ? ' class="cw-page-break"' : ''}><div class="print-sheet"${layout.labelBorder ? ' style="border:1px solid currentColor;padding:1mm"' : ''}><div class="scaled" style="font-size:${fontSize}px"><h2>${escapeHtml(layout.labelTitle)}</h2>${layout.labelFields.map((f) => `<p><b>${fieldNames[f]}：</b>${escapeHtml(r[f])}</p>`).join('')}</div></div></section>`;
      })
      .join(''),
  };
}
