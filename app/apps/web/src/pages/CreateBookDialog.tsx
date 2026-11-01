import { Alert, Form, Input, InputNumber, Modal, Radio, Select, Space, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { PRODUCTS, type CreateBookInput, type ProductId } from '@caiwu/core';
import { coreApi, notify, showError } from '@caiwu/web-kit';
import { templateCreation } from '../template-creation';

interface FormValues {
  name: string;
  orgName: string;
  templateId: string;
  product: ProductId;
  startYear: number;
  startMonth: number;
  codeScheme: string;
  adminPassword?: string;
  facts?: CreateBookInput['facts'];
}

/** 新建账套（简易版）。账套管理模块会提供完整的向导。 */
export function CreateBookDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const templates = useQuery({ ...coreApi.books.templates.queryOptions(), enabled: open });
  const create = useMutation(coreApi.books.create.mutationOptions());
  const templateId = Form.useWatch('templateId', form);
  const startYear = Form.useWatch('startYear', form);
  const startMonth = Form.useWatch('startMonth', form);
  const template = templates.data?.find((t) => t.id === templateId);

  useEffect(() => {
    if (template) form.setFieldValue('codeScheme', template.codeScheme);
  }, [template, form]);
  useEffect(() => {
    if (open && templates.data?.length && !form.getFieldValue('templateId'))
      form.setFieldValue('templateId', templates.data[0]!.id);
  }, [open, templates.data, form]);

  const now = new Date();
  return (
    <Modal
      open={open}
      title="新建账套"
      okText="创建"
      confirmLoading={create.isPending}
      onCancel={onClose}
      destroyOnHidden
      onOk={() =>
        void form
          .validateFields()
          .then(async (v) => {
            const input: CreateBookInput = { ...v, adminPassword: v.adminPassword ?? '' };
            templateCreation.validate(input);
            const book = await create.mutateAsync(input);
            notify.success(`账套「${book.name}」已创建，管理员编号 admin`);
            onCreated(book.id);
          })
          .catch(showError)
      }
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={{ product: 'chengben', startYear: now.getFullYear(), startMonth: 1 }}
        requiredMark="optional"
      >
        <Form.Item
          name="name"
          label="账套名称"
          rules={[{ required: true, message: '请输入账套名称' }]}
        >
          <Input placeholder="例如：2026 年账" autoFocus maxLength={60} />
        </Form.Item>
        <Form.Item
          name="orgName"
          label="单位名称"
          rules={[{ required: true, message: '请输入单位名称' }]}
        >
          <Input placeholder="营业执照上的名称" maxLength={100} />
        </Form.Item>
        <Form.Item
          name="templateId"
          label="会计制度"
          rules={[{ required: true }]}
          extra={template?.description}
        >
          <Select
            onChange={() => form.setFieldValue('facts', undefined)}
            loading={templates.isLoading}
            options={(templates.data ?? []).map((t) => ({
              value: t.id,
              label: `${t.name}${t.status === 'deprecated' ? '（已停用）' : ''}（${t.accountCount} 个科目）`,
            }))}
          />
        </Form.Item>
        {templates.data && templates.data.every((t) => t.devOnly) && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title="当前只有开发测试用的演示科目表"
            description="正式的会计制度模板由账套管理、制度模板模块提供。"
          />
        )}
        <Form.Item
          name="product"
          label="产品形态"
          extra="决定显示哪些功能模块，以后可以在设置里改。"
        >
          <Radio.Group
            optionType="button"
            options={PRODUCTS.map((p) => ({ value: p.id, label: p.name, title: p.description }))}
          />
        </Form.Item>
        <Form.Item label="启用期间" required>
          <Space.Compact>
            <Form.Item name="startYear" noStyle rules={[{ required: true }]}>
              <InputNumber min={2000} max={2100} suffix="年" style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="startMonth" noStyle rules={[{ required: true }]}>
              <Select
                style={{ width: 100 }}
                options={Array.from({ length: 12 }, (_, i) => ({
                  value: i + 1,
                  label: `${i + 1} 月`,
                }))}
              />
            </Form.Item>
          </Space.Compact>
        </Form.Item>
        <Form.Item name="facts" label="制度适用条件">
          <templateCreation.Fields
            templateId={templateId ?? ''}
            startYear={startYear ?? Number.NaN}
            startMonth={startMonth ?? Number.NaN}
          />
        </Form.Item>
        <Form.Item
          name="codeScheme"
          label="科目级次"
          rules={[{ required: true, pattern: /^\d(-\d){0,7}$/, message: '格式如 4-2-2' }]}
        >
          <Input placeholder="4-2-2" style={{ width: 160 }} />
        </Form.Item>
        <Form.Item
          name="adminPassword"
          label="管理员密码"
          extra={
            <Typography.Text type="secondary">
              管理员编号为 admin。可以留空，以后再设。
            </Typography.Text>
          }
        >
          <Input.Password maxLength={64} autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
