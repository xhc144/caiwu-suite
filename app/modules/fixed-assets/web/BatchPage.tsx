import { useAssetFilters as useUrlFilters } from './common';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Select } from 'antd';
import { DataTable, PageContainer } from '@caiwu/ui';
import { notify } from '@caiwu/web-kit';
import { api } from './api';
import { Confirm, refresh } from './common';
export default function BatchPage() {
  const [f, setF] = useUrlFilters({ keyword: '', field: 'model', value: '' });
  const [show, setShow] = useState(false);
  const input = {
    filter: { keyword: f.keyword },
    field: f.field as 'model' | 'unit' | 'lifeMonths' | 'acquired' | 'padCode',
    value: f.value,
  };
  const preview = useQuery({ ...api.batchPreview.queryOptions(input), enabled: show && !!f.value });
  const apply = useMutation(
    api.batchApply.mutationOptions({
      onSuccess: (r) => {
        notify.success(`已修改 ${r.changed} 张，跳过 ${r.skipped.length} 张`);
        setShow(false);
        void refresh();
      },
    }),
  );
  return (
    <PageContainer title="统一置数">
      <Alert title="先筛选并预览待改卡片，再确认字段和值。已锁资产跳过；编号补零遇重复编号跳过并列明原因。" />
      <Form
        layout="inline"
        initialValues={f}
        onFinish={(v) => {
          setF(v);
          setShow(true);
        }}
        style={{ margin: '16px 0' }}
      >
        <Form.Item name="keyword" label="编码/名称">
          <Input />
        </Form.Item>
        <Form.Item name="field" label="修改字段">
          <Select
            style={{ width: 180 }}
            options={[
              { value: 'model', label: '规格型号' },
              { value: 'unit', label: '单位' },
              { value: 'lifeMonths', label: '使用年限（月）' },
              { value: 'acquired', label: '购置日期' },
              { value: 'padCode', label: '编号补零长度' },
            ]}
          />
        </Form.Item>
        <Form.Item name="value" label="新值" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Button htmlType="submit" type="primary">
          筛选并预览
        </Button>
      </Form>
      {preview.data && show && (
        <>
          <p>
            确认字段：
            {f.field === 'padCode'
              ? '编号补零长度'
              : f.field === 'lifeMonths'
                ? '使用年限（月）'
                : f.field === 'acquired'
                  ? '购置日期'
                  : f.field === 'unit'
                    ? '单位'
                    : '规格型号'}
            ；输入值：{f.value}
          </p>
          <DataTable
            tableId="fixed-assets-batch-preview"
            rowKey="id"
            dataSource={preview.data.rows}
            columns={[
              { key: 'code', title: '设备编号', dataIndex: 'code' },
              { key: 'name', title: '设备名称', dataIndex: 'name' },
              { key: 'value', title: '修改后值', dataIndex: 'value' },
              { key: 'error', title: '跳过原因', dataIndex: 'error', width: 400 },
            ]}
          />
          <Confirm
            title="确认对以上可修改记录统一置数？"
            onConfirm={() =>
              apply.mutate({ data: input, token: preview.data!.token, confirm: true })
            }
          >
            确认统一置数
          </Confirm>
        </>
      )}
      <Alert
        type="info"
        title="未实现按使用日期覆盖历史累计折旧：缺少安全备份和历史重建原语，不提供改写历史按钮。"
      />
    </PageContainer>
  );
}
