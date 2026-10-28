import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space } from 'antd';
import { notify, usePermission } from '@caiwu/web-kit';
import { AssetPrintSettingsSchema, type AssetPrintSettings } from '../shared';
import { api } from './api';
import { Confirm, refresh } from './common';
import { useAssetDraft } from './useAssetDraft';

export function readAssetPrintFile(text: string): AssetPrintSettings {
  if (text.length > 64 * 1024) throw new Error('版式文件不能超过 64 KB');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('无法读取版式文件，请选择固定资产版式 JSON 文件');
  }
  const result = AssetPrintSettingsSchema.safeParse(parsed);
  if (!result.success)
    throw new Error(`版式文件格式不正确：${result.error.issues[0]?.message ?? '未知字段'}`);
  return result.data;
}
export function downloadAssetFile(
  text: string,
  filename: string,
  type = 'text/html;charset=utf-8',
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function PrintSettings() {
  const can = usePermission('fixed-assets.settings');
  const [open, setOpen] = useState(false);
  const q = useQuery(api.printSettings.queryOptions());
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!q.data}>
        标签及账册版式
      </Button>
      {open && q.data && <Editor initial={q.data} can={can} onClose={() => setOpen(false)} />}
    </>
  );
}
function Editor({
  initial,
  can,
  onClose,
}: {
  initial: AssetPrintSettings;
  can: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm<AssetPrintSettings>();
  const [error, setError] = useState('');
  const save = useMutation(api.savePrintSettings.mutationOptions());
  const draft = useAssetDraft({
    title: '标签及账册版式',
    discard: onClose,
    save: async () => {
      if (!can) return false;
      const parsed = AssetPrintSettingsSchema.parse(await form.validateFields());
      await save.mutateAsync(parsed);
      notify.success('标签及账册版式已保存');
      void refresh();
      onClose();
    },
  });
  return (
    <Modal
      open
      title="标签及账册版式"
      width={760}
      onCancel={() => draft.close(onClose)}
      okText="保存版式"
      onOk={() => void draft.save().catch(() => {})}
      confirmLoading={draft.saving}
      okButtonProps={{ disabled: !can }}
    >
      <Alert title="标签固定为 88×51 毫米；预览、打印及文件使用相同版式。账册按设备分页并显示承前页与过次页余额。" />
      {error && <Alert type="error" title={error} />}
      <Space wrap style={{ margin: '12px 0' }}>
        <Button
          onClick={() =>
            void form
              .validateFields()
              .then((v) =>
                downloadAssetFile(
                  JSON.stringify(AssetPrintSettingsSchema.parse(v), null, 2),
                  '固定资产.caiwu-label.json',
                  'application/json;charset=utf-8',
                ),
              )
              .catch(() => {})
          }
        >
          导出版式文件
        </Button>
        <label>
          导入版式文件{' '}
          <input
            type="file"
            aria-label="导入资产版式"
            accept=".json"
            disabled={!can || draft.saving}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (!file) return;
              if (file.size > 64 * 1024) {
                setError('版式文件不能超过 64 KB');
                return;
              }
              void file
                .text()
                .then((text) => {
                  const parsed = readAssetPrintFile(text);
                  form.setFieldsValue(parsed);
                  draft.changed();
                  setError('');
                })
                .catch((e) => setError(e instanceof Error ? e.message : '无法读取文件'));
            }}
          />
        </label>
        {can && (
          <Confirm
            title="确认恢复标准版式？保存后生效。"
            onConfirm={() => {
              form.setFieldsValue(AssetPrintSettingsSchema.parse({}));
              draft.changed();
            }}
          >
            恢复标准版式
          </Confirm>
        )}
      </Space>
      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        disabled={!can || draft.saving}
        onValuesChange={draft.changed}
      >
        <Form.Item name="version" hidden>
          <InputNumber />
        </Form.Item>
        <Form.Item name="labelTitle" label="标签标题" rules={[{ required: true, max: 40 }]}>
          <Input maxLength={40} />
        </Form.Item>
        <Form.Item
          name="labelFields"
          label="标签字段（按选择顺序，须含编号和名称）"
          rules={[{ required: true }]}
        >
          <Select
            mode="multiple"
            options={Object.entries({
              code: '编号',
              name: '名称',
              department: '部门',
              category: '类别',
              date: '使用日期',
              description: '规格型号',
              reference: '参考编号',
            }).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
        <Form.Item name="labelFont" label="标签最大字号">
          <InputNumber min={6} max={12} precision={0} />
        </Form.Item>
        <Form.Item name="labelBorder" valuePropName="checked">
          <Checkbox>打印标签外框</Checkbox>
        </Form.Item>
        <Form.Item name="pageSize" label="明细账及台账纸张">
          <Select
            options={[
              { value: 'A4', label: 'A4' },
              { value: 'B5', label: 'B5' },
            ]}
          />
        </Form.Item>
        <Form.Item name="rowsPerPage" label="账册每页最大文字行数">
          <InputNumber min={5} max={30} precision={0} />
        </Form.Item>
        <Form.Item name="scale" label="账册打印比例（%）">
          <InputNumber min={50} max={100} precision={0} />
        </Form.Item>
        <Form.Item name="color" label="账册打印颜色">
          <Select
            options={[
              { value: 'monochrome', label: '单色' },
              { value: 'color', label: '彩色' },
            ]}
          />
        </Form.Item>
        <Form.Item name="ruler" valuePropName="checked">
          <Checkbox>显示毫米标尺</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
}
