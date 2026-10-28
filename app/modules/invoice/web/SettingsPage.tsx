import { useInvoiceFilters } from './useInvoiceFilters';
import { Alert, Button, Card, Form, Select, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DIMENSION_TYPES } from '@caiwu/core';
import { queryClient, useAccounts, usePermission } from '@caiwu/web-kit';
import { AccountSelect, DimensionSelect, FilterBar, PageContainer } from '@caiwu/ui';
import type { Direction, Settings } from '../shared';
import { api } from './api';
import { Nav, QueryError } from './common';

function MappingFields({
  role,
  label,
}: {
  role: 'business' | 'tax' | 'settlement' | 'nonDeductible';
  label: string;
}) {
  const form = Form.useFormInstance<Settings>();
  const id = Form.useWatch([role, 'accountId'], form) as number | undefined;
  const settlementMode = Form.useWatch('settlementMode', form);
  const byName = role === 'settlement' && settlementMode === 'partnerName';
  const { byId } = useAccounts();
  const a = id ? byId.get(id) : null;
  return (
    <Card size="small" title={label} style={{ marginBottom: 12 }}>
      <Form.Item
        label={`${label}科目`}
        name={[role, 'accountId']}
        rules={[{ required: true, message: byName ? '请选择往来上级科目' : '请选择末级科目' }]}
      >
        <AccountSelect
          leafOnly={!byName}
          filter={(a) => !byName || !a.isLeaf}
          onChange={() => form.setFieldValue([role, 'dimensions'], {})}
        />
      </Form.Item>
      {DIMENSION_TYPES.filter(
        (dt) =>
          a?.dimensions.some((d) => d.type === dt.id) ||
          (dt.id === 'cashflow' && a?.cashflowRequired),
      ).map((dt) => (
        <Form.Item key={dt.id} label={`${label}${dt.name}`} name={[role, 'dimensions', dt.id]}>
          <DimensionSelect type={dt.id} allowClear />
        </Form.Item>
      ))}
    </Card>
  );
}
function SettingsForm({ direction, initial }: { direction: Direction; initial: Settings | null }) {
  const [form] = Form.useForm<Settings>();
  const save = useMutation(
    api.saveSettings.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: api.settings.queryKey() }),
    }),
  );
  const can = usePermission('invoice.settings');
  return (
    <Form
      name={`invoice-settings-${direction}`}
      form={form}
      layout="vertical"
      initialValues={
        initial ?? {
          direction,
          expectedRevision: 0,
          settlementMode: 'unified',
          business: { dimensions: {} },
          tax: { dimensions: {} },
          settlement: { dimensions: {} },
          nonDeductible: { dimensions: {} },
        }
      }
      onFinish={(v) =>
        save.mutate({ ...v, direction, expectedRevision: initial?.expectedRevision ?? 0 })
      }
    >
      <Form.Item
        label="纳税人口径（由使用者明确配置）"
        name="taxpayerBasis"
        rules={[{ required: true }]}
      >
        <Select
          options={[
            { value: 'general', label: '一般纳税人（用户声明）' },
            { value: 'small', label: '小规模纳税人（用户声明）' },
            { value: 'other', label: '其他口径（用户声明）' },
          ]}
        />
      </Form.Item>
      <Form.Item label="进项税额处理口径" name="inputTaxTreatment" rules={[{ required: true }]}>
        <Select
          options={[
            { value: 'separate', label: '税额单列进项税科目（使用者自行核实资格）' },
            { value: 'cost', label: '税额计入指定非抵扣成本/费用科目' },
          ]}
        />
      </Form.Item>
      <MappingFields role="business" label={direction === 'input' ? '材料/费用' : '收入'} />
      <MappingFields role="tax" label={direction === 'input' ? '进项税' : '销项税'} />
      <Form.Item name="settlementMode" label="往来科目匹配方式">
        <Select
          onChange={() => form.setFieldValue('settlement', { dimensions: {} })}
          options={[
            { value: 'unified', label: '全部使用统一末级结算科目' },
            { value: 'partnerName', label: '按客供名称精确匹配下级科目，缺少时确认新增' },
          ]}
        />
      </Form.Item>
      <MappingFields role="settlement" label={direction === 'input' ? '应付/结算' : '应收/结算'} />
      <MappingFields role="nonDeductible" label="非抵扣税额成本/费用" />
      <Button type="primary" htmlType="submit" loading={save.isPending} disabled={!can}>
        保存映射
      </Button>
    </Form>
  );
}
export default function SettingsPage() {
  const [filters, setFilters] = useInvoiceFilters({ direction: 'input' });
  const direction: Direction = filters.direction === 'output' ? 'output' : 'input';
  const query = useQuery(api.settings.queryOptions({ direction }));
  return (
    <PageContainer title="发票参数设置">
      <Nav />
      <FilterBar initialValues={{ direction }} onSearch={setFilters}>
        <Form.Item name="direction" label="方向">
          <Select
            style={{ width: 160 }}
            options={[
              { value: 'input', label: '进项' },
              { value: 'output', label: '销项' },
            ]}
          />
        </Form.Item>
      </FilterBar>
      <Alert
        type="info"
        showIcon
        title="红字使用原借贷方向的负数分录；往来科目可按名称匹配"
        description="按名称匹配须选择已有下级的结算上级科目，只匹配名称完全相同且唯一的下级，缺少时在制证预览中确认新增。外币科目在制证时逐票填写原币金额与汇率；数量科目按同单位商品汇总，也可逐票填写。修改映射不改历史来源凭证；比对读取当前税科目，变更后请核对历史差异。"
        style={{ marginBottom: 16 }}
      />
      <QueryError error={query.error} retry={query.refetch} />
      {query.isPending ? (
        <Space>正在加载参数…</Space>
      ) : (
        query.isSuccess && (
          <SettingsForm
            key={`${direction}-${query.data?.expectedRevision ?? 0}`}
            direction={direction}
            initial={query.data}
          />
        )
      )}
    </PageContainer>
  );
}
