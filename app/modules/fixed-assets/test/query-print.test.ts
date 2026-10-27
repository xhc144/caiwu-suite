import { describe, expect, it } from 'vitest';
import { depreciationPrint } from '../web/query-print';
import type { Outputs } from '../web/api';

const range = { from: 202601, to: 202602, departmentLevel: 'top', categoryLevel: 'detail' };
const result: Outputs['query'] = {
  rows: [
    {
      id: 1,
      period: 202602,
      batchId: 1,
      voucher_id: null,
      assetId: 1,
      code: '0001',
      name: '<script>历史设备</script>',
      use_date: '2026-01-01',
      amount: 2,
      work_e6: 100000,
      issue: '<img src=x>',
      department_id: 1,
      category_id: 1,
      purpose_id: 1,
      department: '行政 & 财务',
      category: '设备',
      purpose: '管理',
      work: '0.1',
    },
  ],
  distribution: [{ group: '行政 & 财务 / 设备', amount: 2 }],
  total: 2,
};

describe('w_zjgl / w_zjgl_fb：打印实际查询结果', () => {
  it.each(['detail', 'distribution'] as const)(
    '%s 保留查询期间、分组口径、整数分合计并转义用户内容',
    (kind) => {
      const output = depreciationPrint(result, range, kind);
      expect(output.orientation).toBe('landscape');
      expect(output.html).toContain('202601 至 202602');
      expect(output.html).toContain('部门大类 / 资产细类');
      expect(output.html).toContain('合计：0.02 元；共 1 条');
      expect(output.html).toContain('行政 &amp; 财务');
      expect(output.html).not.toContain('<script>');
      if (kind === 'detail') {
        expect(output.html).toContain('&lt;script&gt;历史设备&lt;/script&gt;');
        expect(output.html).toContain('&lt;img src=x&gt;');
        expect(output.html).toContain('<td>0.1</td>');
      }
    },
  );
  it.each(['detail', 'distribution'] as const)('%s 空结果不产生空白打印作业', (kind) => {
    expect(() => depreciationPrint({ rows: [], distribution: [], total: 0 }, range, kind)).toThrow(
      /没有记录/,
    );
  });
});
