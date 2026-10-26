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
import { useMutation, useQuery } from '@tanstack/react-query';
import { DIMENSION_TYPES } from '@caiwu/core';
import { coreApi, useAccounts, useVoucherTypes, useDimensionItems } from '@caiwu/web-kit';
import { AccountSelect, DimensionSelect } from '@caiwu/ui';
import {
  CashflowDirectionSchema,
  requiresCashflow,
  type RuleInput,
  type TransferRule,
} from '../shared';
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
  const { byId, accounts } = useAccounts();
  const kind = Form.useWatch('kind', form);
  const categories = useQuery(coreApi.accounts.categories.queryOptions()).data ?? [];
  const pnlCategories = new Set(categories.filter((c) => c.isPnl).map((c) => c.id));
  const cashPnl = accounts.some(
    (a) => a.isLeaf && pnlCategories.has(a.categoryId) && requiresCashflow(a),
  );
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
              sources: data.sources ?? [],
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
            onChange={() => form.setFieldValue('sources', [])}
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
          <AccountSelect
            onChange={() => {
              form.setFieldValue('targetCashflows', undefined);
              form.setFieldValue('targetDimensions', {});
            }}
          />
        </Form.Item>
        <Typography.Paragraph type="secondary">
          按当前会计制度选择利润或结余科目。转入辅助项须明确填写；外币或数量转入换算尚未开放。
        </Typography.Paragraph>
        {DIMENSION_TYPES.filter(
          (d) => d.id !== 'cashflow' && target?.dimensions.some((c) => c.type === d.id),
        ).map((d) => (
          <Form.Item key={d.id} name={['targetDimensions', d.id]} label={`转入${d.name}`}>
            <DimensionSelect type={d.id} />
          </Form.Item>
        ))}
        {target &&
          (requiresCashflow(target) || target.dimensions.some((d) => d.type === 'cashflow')) && (
            <>
              <p>
                此转入科目启用现金流量核算。项目方向以基础档案为准，缺失或未知方向会阻止生成；内部转移项目须在同一张凭证内配平。
              </p>
              <Form.Item name={['targetCashflows', 'in']} label="转入流入现金流量项目">
                <CashflowSelect />
              </Form.Item>
              <Form.Item name={['targetCashflows', 'out']} label="转入流出现金流量项目">
                <CashflowSelect />
              </Form.Item>
            </>
          )}
        {(kind === 'custom' || cashPnl) && (
          <Form.List name="sources">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <div key={field.key}>
                    <Space align="start">
                      <Form.Item
                        name={[field.name, 'accountId']}
                        label={kind === 'pnl' ? '损益现金流设置科目' : '转出科目'}
                        rules={[{ required: true }]}
                      >
                        <AccountSelect
                          leafOnly={kind === 'pnl'}
                          filter={
                            kind === 'pnl'
                              ? (a) => pnlCategories.has(a.categoryId) && requiresCashflow(a)
                              : undefined
                          }
                          onChange={() =>
                            form.setFieldValue(['sources', field.name, 'cashflows'], undefined)
                          }
                          style={{ width: 280 }}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'ratio']}
                        label="比例（%）"
                        hidden={kind === 'pnl'}
                        initialValue="100"
                        rules={[{ required: true }]}
                      >
                        <Input style={{ width: 110 }} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'mode']} hidden initialValue="balance">
                        <Input />
                      </Form.Item>
                      <Button onClick={() => remove(field.name)}>移除</Button>
                    </Space>
                    <SourceCashflowFields index={field.name} />
                  </div>
                ))}
                <Button onClick={() => add({ mode: 'balance', ratio: '100' })}>
                  {kind === 'pnl' ? '增加损益现金流设置' : '增加转出科目'}
                </Button>
                <Typography.Paragraph type="secondary">
                  自定义按“科目期末余额 ×
                  比例”结转；损益范围仍由类别识别，此处只设置现金流项目。现金流项目按本次现金增减重新选择，不沿用历史流向。
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

function SourceCashflowFields({ index }: { index: number }) {
  const form = Form.useFormInstance<RuleInput>();
  const id = Form.useWatch(['sources', index, 'accountId'], form);
  const { byId, accounts } = useAccounts();
  const selected = byId.get(id);
  if (
    !selected ||
    !accounts.some(
      (a) =>
        a.isLeaf &&
        (a.id === selected.id || a.code.startsWith(selected.code)) &&
        requiresCashflow(a),
    )
  )
    return null;
  return (
    <>
      <p>
        此转出范围含现金流量科目。请选择方向明确的项目；手选流入/流出位置不能覆盖档案方向，内部转移须在同一张凭证内配平。
      </p>
      <Space align="start">
        <Form.Item name={[index, 'cashflows', 'in']} label="转出流入现金流量项目">
          <CashflowSelect />
        </Form.Item>
        <Form.Item name={[index, 'cashflows', 'out']} label="转出流出现金流量项目">
          <CashflowSelect />
        </Form.Item>
      </Space>
    </>
  );
}

function CashflowSelect(props: {
  value?: number | null;
  onChange?: (value: number | undefined) => void;
  id?: string;
}) {
  const { items, loading } = useDimensionItems('cashflow');
  const labels = { inflow: '流入', outflow: '流出', internal: '内部转移' };
  const options = items
    .filter((item) => item.isLeaf && !item.disabled)
    .map((item) => {
      const direction = CashflowDirectionSchema.safeParse(item.attrs.cashflowDirection);
      return {
        value: item.id,
        label: `${item.code} ${item.name}（${direction.success ? labels[direction.data] : '方向未配置/未知'}）`,
        search: `${item.code} ${item.name} ${item.pinyin}`.toLowerCase(),
      };
    });
  return (
    <Select<number>
      {...props}
      allowClear
      loading={loading}
      placeholder="选择方向明确的现金流量项目"
      options={options}
      style={{ minWidth: 240 }}
      showSearch={{
        filterOption: (value, option) => !!option?.search.includes(value.toLowerCase()),
      }}
    />
  );
}
