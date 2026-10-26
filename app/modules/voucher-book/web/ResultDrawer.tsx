import { Alert, Button, Drawer, Space, Table, Tag } from 'antd';
import { usePermission } from '@caiwu/web-kit';
import { exportToExcel } from '@caiwu/ui';
import type { ActionResult } from '../shared';

export function ResultDrawer({
  result,
  open,
  onClose,
  onInspect,
}: {
  result: ActionResult | null;
  open: boolean;
  onClose: () => void;
  onInspect: (id: number) => void;
}) {
  const canExport = usePermission('voucher-book.export');
  return (
    <Drawer title="凭证处理清单" open={open && !!result} size={900} onClose={onClose}>
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Alert
          title={result?.message}
          description="状态为执行完成时的快照；跳过项未被本次操作修改。查看凭证可核对最新状态。"
          type="info"
        />
        {canExport && (
          <Button
            onClick={() =>
              void exportToExcel({
                fileName: '凭证处理清单',
                title: result?.message,
                columns: [
                  { title: '原凭证 / 文件凭证', value: (r) => r.label },
                  { title: '结果', value: (r) => (r.outcome === 'success' ? '成功' : '跳过') },
                  { title: '执行后凭证', value: (r) => r.voucherLabel },
                  { title: '执行后状态', value: (r) => r.status },
                  { title: '跳过原因', value: (r) => r.reasons.join('；') },
                ],
                rows: result?.rows ?? [],
              })
            }
          >
            导出处理清单 Excel
          </Button>
        )}
        <Table
          rowKey="key"
          pagination={{ pageSize: 15 }}
          dataSource={result?.rows ?? []}
          columns={[
            { title: '原凭证 / 文件凭证', dataIndex: 'label' },
            {
              title: '结果',
              render: (_, r) => (
                <Tag color={r.outcome === 'success' ? 'green' : 'orange'}>
                  {r.outcome === 'success' ? '成功' : '跳过'}
                </Tag>
              ),
            },
            {
              title: '执行后凭证',
              render: (_, r) =>
                r.voucherId == null ? (
                  '—'
                ) : (
                  <Button type="link" onClick={() => onInspect(r.voucherId!)}>
                    {r.voucherLabel}
                  </Button>
                ),
            },
            { title: '执行后状态', dataIndex: 'status' },
            { title: '跳过原因', render: (_, r) => r.reasons.join('；') || '—' },
          ]}
        />
      </Space>
    </Drawer>
  );
}
