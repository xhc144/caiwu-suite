import { escapeHtml, type PrintJob } from '@caiwu/print';

export type LabelRow = {
  code: string;
  name: string;
  department: string;
  category: string;
};
export type LabelColor = 'monochrome' | 'color';

/** 预览、打印及 HTML 文件共用同一标签内容与纸张尺寸。 */
export function assetLabelsPrint(rows: readonly LabelRow[], color: LabelColor): PrintJob {
  if (!rows.length) throw new Error('没有记录，无法打印及预览');
  if (color !== 'monochrome' && color !== 'color') throw new Error('请选择单色或彩色打印');
  const ink = color === 'color' ? '#164b82' : '#000000';
  return {
    title: '资产标签',
    pageSize: { widthMm: 88, heightMm: 51 },
    marginMm: 4,
    css: `.print-sheet{width:80mm;height:43mm;box-sizing:border-box;color:${ink};print-color-adjust:exact;-webkit-print-color-adjust:exact}.scaled{width:100%;overflow-wrap:anywhere}.scaled h2{font-size:1.35em;margin:0 0 2mm;border-bottom:1px solid ${ink};padding-bottom:1mm}.scaled p{line-height:1.3;margin:1mm 0}.scaled b{font-weight:bold}@media screen{body{box-sizing:border-box;padding:4mm;width:88mm}}`,
    html: rows
      .map((r, i) => {
        // 超长档案名称以较小字体容纳；打印驱动仍会检查浏览器实际排版。
        const chars = [r.code, r.name, r.department, r.category].reduce(
          (n, v) =>
            n + Array.from(v).reduce((m, c) => m + ((c.codePointAt(0) ?? 0) > 255 ? 1 : 0.55), 0),
          0,
        );
        const fontSize = chars > 350 ? 6 : chars > 240 ? 7 : chars > 150 ? 8 : 9;
        return `<section${i < rows.length - 1 ? ' class="cw-page-break"' : ''}><div class="print-sheet"><div class="scaled" style="font-size:${fontSize}px"><h2>固定资产标签</h2><p><b>编号：</b>${escapeHtml(r.code)}</p><p><b>名称：</b>${escapeHtml(r.name)}</p><p><b>部门：</b>${escapeHtml(r.department)}</p><p><b>类别：</b>${escapeHtml(r.category)}</p></div></div></section>`;
      })
      .join(''),
  };
}
