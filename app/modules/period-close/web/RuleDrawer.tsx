import {
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
} from 'antd';
import { useMutation } from '@tanstack/react-query';
import { DIMENSION_TYPES } from '@caiwu/core';
import { useAccounts, useVoucherTypes } from '@caiwu/web-kit';
import { AccountSelect, DimensionSelect } from '@caiwu/ui';
import type { RuleInput, TransferRule } from '../shared';
import { api } from './api';

export default function RuleDrawer({
  rule,
  onClose,
  onSaved,
}: {
  rule: TransferRule | 'new';
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<RuleInput>();
  const types = useVoucherTypes();
  const { byId } = useAccounts();
  const kind = Form.useWatch('kind', form);
  const target = byId.get(Form.useWatch('targetAccountId', form));
  const save = useMutation(
    api.saveRule.mutationOptions({
      onSuccess: () => {
        onSaved();
        onClose();
      },
    }),
  );
  return (
    <Drawer
      open
      title={rule === 'new' ? '新增结转类型' : '编辑结转类型'}
      size={640}
      onClose={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            保存设置
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          rule === 'new'
            ? {
                code: 'PNL',
                name: '损益结转',
                kind: 'pnl',
                summary: '结转本期损益',
                order: 1,
                enabled: true,
                sources: [],
                targetDimensions: {},
              }
            : rule
        }
        onFinish={(data) =>
          save.mutate({
            data: {
              ...data,
              sources: data.kind === 'pnl' ? [] : (data.sources ?? []),
              targetDimensions: data.targetDimensions ?? {},
            },
            id: rule === 'new' ? undefined : rule.id,
            revision: rule === 'new' ? undefined : rule.revision,
          })
        }
      >
        <Form.Item name="code" label="代码" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="name" label="说明" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="kind" label="结转内容" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'pnl', label: '损益（按本账套损益类别）' },
              { value: 'custom', label: '自定义科目余额比例' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="voucherTypeId"
          label="凭证类型"
          rules={[{ required: true, message: '凭证类型不得为空' }]}
        >
          <Select
            options={types
              .filter((t) => !t.disabled)
              .map((t) => ({ value: t.id, label: `${t.code} ${t.name}` }))}
          />
        </Form.Item>
        <Form.Item name="summary" label="摘要" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="order" label="执行顺序" rules={[{ required: true }]}>
          <InputNumber min={1} max={9999} />
        </Form.Item>
        <Form.Item name="targetAccountId" label="唯一转入末级科目" rules={[{ required: true }]}>
          <AccountSelect />
        </Form.Item>
        <Typography.Paragraph type="secondary">
          按当前会计制度选择利润或结余科目。转入辅助项须明确填写；外币或数量转入换算尚未开放。
        </Typography.Paragraph>
        {DIMENSION_TYPES.filter((d) => target?.dimensions.some((c) => c.type === d.id)).map((d) => (
          <Form.Item key={d.id} name={['targetDimensions', d.id]} label={`转入${d.name}`}>
            <DimensionSelect type={d.id} />
          </Form.Item>
        ))}
        {kind === 'custom' && (
          <Form.List name="sources">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="start">
                    <Form.Item
                      name={[field.name, 'accountId']}
                      label="转出科目"
                      rules={[{ required: true }]}
                    >
                      <AccountSelect leafOnly={false} style={{ width: 280 }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'ratio']}
                      label="比例（%）"
                      rules={[{ required: true }]}
                    >
                      <Input style={{ width: 110 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'mode']} hidden initialValue="balance">
                      <Input />
                    </Form.Item>
                    <Button onClick={() => remove(field.name)}>移除</Button>
                  </Space>
                ))}
                <Button onClick={() => add({ mode: 'balance', ratio: '100' })}>增加转出科目</Button>
                <Typography.Paragraph type="secondary">
                  仅实现“科目期末余额 × 比例”，按顺序更新基数并舍入到分；原版未知转出类型不作推测。
                </Typography.Paragraph>
              </>
            )}
          </Form.List>
        )}
        <Form.Item name="enabled" valuePropName="checked">
          <Checkbox>启用</Checkbox>
        </Form.Item>
      </Form>
    </Drawer>
  );
}
