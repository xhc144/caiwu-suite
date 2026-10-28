import { useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Space, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTab } from '@caiwu/web-kit';
import { api } from './api';

export default function StockPicker({
  warehouseId,
  onSelect,
  label,
}: {
  warehouseId: number;
  onSelect: (code: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false),
    [keyword, setKeyword] = useState(''),
    [hideZero, setHideZero] = useState(false);
  const { active } = useTab();
  const q = useQuery({
    ...api.stock.queryOptions({ warehouseId, keyword, hideZero }),
    enabled: open,
  });
  const products = useQuery({ ...api.products.queryOptions({ keyword }), enabled: open });
  const disabled = new Set(products.data?.filter((p) => p.disabled).map((p) => p.code));
  return (
    <>
      <Button aria-label={label} onClick={() => setOpen(true)}>
        库存速查
      </Button>
      <Modal
        title="库存产品速查"
        mask={false}
        width={850}
        open={active && open}
        onCancel={() => setOpen(false)}
        footer={null}
      >
        <Space>
          <Input
            aria-label="库存速查条件"
            placeholder="产品编码、名称或拼音"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Checkbox checked={hideZero} onChange={(e) => setHideZero(e.target.checked)}>
            隐藏零库存
          </Checkbox>
        </Space>
        <p>库存按当前仓库已保存业务汇总，选择产品后仍需填写数量与单价；保存时重新检查库存。</p>
        {q.error && <Alert type="error" title={q.error.message} />}
        <Table
          rowKey="productCode"
          loading={q.isFetching || products.isFetching}
          dataSource={q.data ?? []}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '产品编号', dataIndex: 'productCode' },
            { title: '产品名称', dataIndex: 'productName' },
            { title: '当前库存', dataIndex: 'balance' },
            { title: '单位', dataIndex: 'unit' },
            {
              title: '操作',
              render: (_, r) => (
                <Button
                  disabled={disabled.has(r.productCode) || products.isFetching}
                  onClick={() => {
                    onSelect(r.productCode);
                    setOpen(false);
                  }}
                >
                  {disabled.has(r.productCode) ? '产品已停用' : `选用${r.productCode}`}
                </Button>
              ),
            },
          ]}
        />
      </Modal>
    </>
  );
}
