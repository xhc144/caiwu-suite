import { Alert, Button, Drawer, Form, Select, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { coreApi, queryClient, useAccounts, useDimensionItems } from '@caiwu/web-kit';
import { AccountSelect, DimensionSelect } from '@caiwu/ui';
import {
  BalanceFunctionSchema,
  DimensionSchema,
  METRIC_LABELS,
  UNIT_LABELS,
  balanceFormula,
  type BalanceFunction,
} from '../shared';
import { api } from './api';

export function FunctionWizard({
  onClose,
  onInsert,
}: {
  onClose(): void;
  onInsert(source: string, unit: BalanceFunction['unit'], currency: string): void;
}) {
  const [form] = Form.useForm<BalanceFunction>();
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState<number | undefined>(undefined);
  const [dimension, setDimension] = useState<BalanceFunction['dimension']>('none');
  const items = useDimensionItems(dimension === 'none' ? undefined : dimension);
  const [itemId, setItemId] = useState<number | undefined>(undefined);
  const currency = useQuery(coreApi.reference.currencies.queryOptions());
  const [message, setMessage] = useState('');
  const [source, setSource] = useState('');
  const make = async () => {
    const v = await form.validateFields();
    const candidate = {
      ...v,
      account: accounts.byId.get(accountId ?? 0)?.code ?? '',
      dimension,
      item: dimension === 'none' ? '' : (items.byId.get(itemId ?? 0)?.code ?? ''),
    };
    const parsed = BalanceFunctionSchema.safeParse(candidate);
    if (!parsed.success) {
      setMessage(parsed.error.issues.map((i) => i.message).join('；'));
      return null;
    }
    const source = balanceFormula(parsed.data);
    const checked = await queryClient.fetchQuery(api.validateFormula.queryOptions({ source }));
    setSource(source);
    setMessage(checked.message);
    return checked.valid ? { source, input: parsed.data } : null;
  };
  return (
    <Drawer
      getContainer={false}
      open
      title="报表函数向导（F8）"
      size={600}
      onClose={onClose}
      destroyOnHidden
    >
      <Alert
        type="info"
        title="BALANCE(科目,指标,单位,币种,方向,辅助类型,辅助编码)"
        description={
          '参数均为字符串；使用当前生成期间。科目含下级且不重复累计。金额返回分，显示元；数量为精确十进制。SUM(A1:A3) 为表内求和，REF("101","A1") 为同期间表间引用。'
        }
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{ metric: 'closing', unit: 'cents', currency: 'CNY', direction: 'signed' }}
        style={{ marginTop: 16 }}
      >
        <Form.Item label="科目">
          <AccountSelect value={accountId} onChange={(id) => setAccountId(id ?? undefined)} />
        </Form.Item>
        <Form.Item name="metric" label="期间口径" rules={[{ required: true }]}>
          <Select
            options={Object.entries(METRIC_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
        <Form.Item name="unit" label="返回单位" rules={[{ required: true }]}>
          <Select
            options={['cents', 'foreignCents', 'quantity'].map((value) => ({
              value,
              label: UNIT_LABELS[value as BalanceFunction['unit']],
            }))}
          />
        </Form.Item>
        <Form.Item name="currency" label="币种" rules={[{ required: true }]}>
          <Select
            options={(currency.data ?? []).map((c) => ({
              value: c.code,
              label: `${c.code} ${c.name}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="direction" label="余额方向" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'signed', label: '有符号净额（借正贷负）' },
              { value: 'normal', label: '按科目正常方向（反方向余额仍为负）' },
            ]}
          />
        </Form.Item>
        <Form.Item label="辅助类型">
          <Select
            value={dimension}
            options={DimensionSchema.options.map((value) => ({
              value,
              label: {
                none: '无',
                project: '项目',
                partner: '客户/供应商',
                department: '部门',
                person: '个人',
                cashflow: '现金流量项目',
              }[value],
            }))}
            onChange={(value) => {
              setDimension(value);
              setItemId(undefined);
            }}
          />
        </Form.Item>
        {dimension !== 'none' && (
          <Form.Item label="辅助项">
            <DimensionSelect
              type={dimension}
              value={itemId}
              onChange={(id) => setItemId(id ?? undefined)}
            />
          </Form.Item>
        )}
        <Space>
          <Button onClick={() => void make()}>校验</Button>
          <Button
            type="primary"
            onClick={() =>
              void make().then((v) => {
                if (v) onInsert(v.source, v.input.unit, v.input.currency);
              })
            }
          >
            插入到当前单元格
          </Button>
        </Space>
      </Form>
      {message && (
        <Alert
          style={{ marginTop: 12 }}
          title={message}
          type={message.includes('通过') ? 'success' : 'warning'}
        />
      )}
      {source && <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{source}</pre>}
      <p>
        已核实原版 S/W/F
        前缀说明，但资料缺少基本函数数据行，暂不提供猜测的旧函数别名。外币/数量本年累计、现金流量期初分配不支持。
      </p>
    </Drawer>
  );
}
