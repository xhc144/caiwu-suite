import { Alert } from 'antd';
import { DataTable } from '@caiwu/ui';
import type { Outputs } from './api';

type Preview = NonNullable<Outputs['voucherDeletePreview']['voucherDeletion']>;
export function VoucherDeletionPreview({ preview }: { preview: Preview | null | undefined }) {
  if (!preview) return null;
  return (
    <section aria-label="凭证删除及编号影响">
      <Alert
        type="warning"
        title={`将删除：${preview.targets.map((v) => `${v.date} ${v.displayNo}`).join('、')}`}
        description={
          preview.renumber
            ? '账套已启用删除后重排。请核对以下所有受影响的凭证，确认后同时删除并调整编号。'
            : '删除后其他凭证编号保持不变。'
        }
      />
      {preview.renumber && (
        <DataTable
          tableId="fixed-assets-voucher-deletion-impact"
          rowKey="id"
          dataSource={preview.impacts}
          columns={[
            { key: 'date', title: '日期', dataIndex: 'date', width: 120 },
            { key: 'displayNo', title: '当前凭证号', dataIndex: 'displayNo', width: 140 },
            { key: 'oldNumber', title: '原序号', dataIndex: 'oldNumber', width: 100 },
            { key: 'number', title: '删除后序号', dataIndex: 'number', width: 120 },
          ]}
          locale={{ emptyText: '没有其他凭证需要调整编号' }}
        />
      )}
    </section>
  );
}
