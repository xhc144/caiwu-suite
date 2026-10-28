import { describe, expect, it } from 'vitest';
import { assertSafePrintContent, renderPrintDocument } from '@caiwu/print';
import { assetLabelsPrint } from '../web/label-print';
const row = { code: 'A01', name: '服务器', department: '管理部', category: '01 设备' };

describe('w_zcgl_label：标签预览、打印与文件共用版面', () => {
  it('无记录拒绝打印和预览，纸张为88×51mm，一张资产一页', () => {
    expect(() => assetLabelsPrint([], 'monochrome')).toThrow('没有记录，无法打印及预览');
    const job = assetLabelsPrint([row, { ...row, code: 'A02' }], 'monochrome');
    expect(job.pageSize).toEqual({ widthMm: 88, heightMm: 51 });
    expect(job.marginMm).toBe(4);
    expect(job.html.match(/class="print-sheet"/g)).toHaveLength(2);
    expect(job.html.match(/class="cw-page-break"/g)).toHaveLength(1);
    expect(renderPrintDocument(job)).toContain('88mm 51mm');
    expect(job.css).toContain('#000000');
    assertSafePrintContent(job.html, job.css);
  });
  it('彩色采用固定颜色；所有档案文字转义，文件自包含且没有脚本或网络资源', () => {
    const job = assetLabelsPrint(
      [{ ...row, code: '<script>', name: '&"\'><img src="x">' }],
      'color',
    );
    const document = renderPrintDocument(job);
    expect(job.css).toContain('#164b82');
    expect(document).toContain('&lt;script&gt;');
    expect(document).toContain('&lt;img src=&quot;x&quot;&gt;');
    expect(document).not.toContain('<script>');
    expect(document).not.toContain('<img');
    assertSafePrintContent(job.html, job.css);
    expect(() => assetLabelsPrint([row], 'red' as never)).toThrow('请选择单色或彩色打印');
  });
});
