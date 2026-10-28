import { useAssetFilters as useUrlFilters } from './common';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Select } from 'antd';
import { DataTable, PageContainer } from '@caiwu/ui';
import { notify } from '@caiwu/web-kit';
import { api } from './api';
import { Confirm, refresh } from './common';
import { useAssetDraft } from './useAssetDraft';
export default function BatchPage() {
  const [initial] = useUrlFilters({ keyword: '', field: 'model', value: '' });
  const [f, setF] = useState(initial);
  const [form] = Form.useForm<typeof initial>();
  const [show, setShow] = useState(false);
  const input = {
    filter: { keyword: f.keyword },
    field: f.field as 'model' | 'unit' | 'lifeMonths' | 'acquired' | 'padCode',
    value: f.value,
  };
  const preview = useQuery({ ...api.batchPreview.queryOptions(input), enabled: show && !!f.value });
  const apply = useMutation(api.batchApply.mutationOptions());
  const draft = useAssetDraft({
    title: '统一置数',
    save: async () => {
      if (!show || !preview.data || preview.isFetching || preview.error) {
        notify.error('请先筛选并预览本次修改');
        return false;
      }
      const r = await apply.mutateAsync({ data: input, token: preview.data.token, confirm: true });
      notify.success(`已修改 ${r.changed} 张，跳过 ${r.skipped.length} 张`);
      setShow(false);
      await refresh();
    },
    discard: () => {
      form.resetFields();
      setShow(false);
    },
  });
  return (
    <PageContainer title="统一置数">
      <Alert title="先筛选并预览待改卡片，再确认字段和值。已锁资产跳过；编号补零遇重复编号跳过并列明原因。" />
      <Form
        form={form}
        disabled={draft.saving}
        layout="inline"
        initialValues={initial}
        onValuesChange={() => {
          setShow(false);
          draft.changed();
        }}
        onFinish={(v) => {
          setF(v);
          setShow(true);
          draft.changed();
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
      {preview.error && show && <Alert type="error" title={preview.error.message} />}
      {preview.data && show && !preview.isFetching && !preview.error && (
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
            onConfirm={() => void draft.save().catch(() => {})}
          >
            确认统一置数
          </Confirm>
        </>
      )}
      <Alert
        type="info"
        title="按使用日期重算累计折旧尚未开放。请通过期初导入填写已核对的累计数；已有历史记录不能批量覆盖。"
      />
    </PageContainer>
  );
}
