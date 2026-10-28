import { useAssetFilters as useUrlFilters } from './common';
import { useEffect, useMemo, useState } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Form, Input, InputNumber, Select, Space } from 'antd';
import {
  DataTable,
  DimensionSelect,
  MoneyInput,
  PageContainer,
  type MoneyInputProps,
} from '@caiwu/ui';
import { formatMoney } from '@caiwu/core';
import { getBusinessError, notify, useRequiredSession } from '@caiwu/web-kit';
import { printHtml } from '@caiwu/print';
import { depreciationPrint } from './query-print';
import { api } from './api';
import { Confirm, MasterSelect } from './common';
import { MAX_QUERY_CONDITIONS, queryFields, queryOperators, type QueryCondition } from '../shared';
import {
  queryDefaults,
  queryUrlDefaults,
  queryToFilters,
  readQueryFilters,
  validateQuery,
  type QueryDraft,
} from './query-filters';
export function QueryAmountInput({
  value,
  onChange,
  ...props
}: Omit<MoneyInputProps, 'value' | 'onChange'> & {
  value?: string;
  onChange?: (value: string) => void;
}) {
  const cents =
    value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  return (
    <MoneyInput
      {...props}
      allowNegative={false}
      value={cents}
      onChange={(next) => onChange?.(next == null ? '' : String(next))}
    />
  );
}

export default function QueriesPage() {
  const year = Math.trunc(useRequiredSession().book.startPeriod / 100);
  const [f, setF] = useUrlFilters(queryUrlDefaults(year));
  const parsed = useMemo(() => readQueryFilters(f), [f]);
  const [form] = Form.useForm<QueryDraft>();
  const [dirty, setDirty] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [cleared, setCleared] = useState<QueryDraft | null>(null);
  useEffect(() => {
    form.resetFields();
    form.setFieldsValue(parsed.input ?? queryDefaults(year));
    setDirty(false);
    setFormError(null);
  }, [parsed, year, form]);
  const [version, setVersion] = useState(0);
  const [draftId] = useState(() => {
    const id = `fixed-assets-query-draft-${crypto.randomUUID()}`;
    for (const name of ['query', 'distribution'])
      localStorage.setItem(
        `caiwu.table.${id}-${name}.widths`,
        localStorage.getItem(`caiwu.fixed-assets.${name}.confirmed-widths`) ?? '{}',
      );
    return id;
  });
  useEffect(
    () => () => {
      for (const name of ['query', 'distribution'])
        localStorage.removeItem(`caiwu.table.${draftId}-${name}.widths`);
    },
    [draftId],
  );
  const q = useQuery(api.query.queryOptions(parsed.input ?? skipToken, { meta: { silent: true } }));
  const cards = useQuery(api.list.queryOptions({ includeDisposed: true }));
  const queryError = q.error ? getBusinessError(q.error) : null;
  const rawError =
    formError ??
    parsed.error ??
    (q.error
      ? queryError && queryError.code !== 'UNKNOWN'
        ? queryError.message
        : '查询失败，请重试'
      : null);
  const error = rawError?.replace('金额条件必须为整数分', '金额条件不正确，请按元重新输入');
  const result = !dirty && !error && !q.isFetching ? q.data : undefined;
  const conditionError = /^(第 \d+ 条条件：)(.*)$/.exec(error ?? '');
  const submit = (draft: QueryDraft) => {
    const checked = validateQuery(draft);
    setFormError(checked.error);
    if (!checked.input) {
      setDirty(true);
      return;
    }
    setDirty(false);
    if (
      parsed.input &&
      JSON.stringify(checked.input) === JSON.stringify(parsed.input) &&
      !q.isFetching
    )
      void q.refetch();
    setF(queryToFilters(checked.input));
  };
  const print = async (kind: 'detail' | 'distribution') => {
    if (!result || !parsed.input) return;
    try {
      await printHtml(depreciationPrint(result, parsed.input, kind));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '打印失败，请重试');
    }
  };
  return (
    <PageContainer title="折旧查询与分布">
      <Form<QueryDraft>
        form={form}
        layout="inline"
        initialValues={parsed.input ?? queryDefaults(year)}
        onValuesChange={() => {
          setDirty(true);
          setFormError(null);
        }}
        onFinish={submit}
        style={{ rowGap: 8, marginBottom: 16 }}
      >
        <Form.Item name="from" label="起始月份">
          <InputNumber controls={false} />
        </Form.Item>
        <Form.Item name="to" label="截止月份">
          <InputNumber controls={false} />
        </Form.Item>
        <Form.Item name="showZero" valuePropName="checked">
          <Checkbox>显示零折旧</Checkbox>
        </Form.Item>
        <Form.Item name="assetId" label="资产">
          <Select
            allowClear
            style={{ minWidth: 200 }}
            showSearch={{ optionFilterProp: 'label' }}
            options={(cards.data ?? []).map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))}
          />
        </Form.Item>
        <Form.Item name="departmentId" label="部门">
          <DimensionSelect type="department" />
        </Form.Item>
        <Form.Item name="categoryId" label="类别">
          <MasterSelect kind="category" />
        </Form.Item>
        <Form.Item name="purposeId" label="用途">
          <MasterSelect kind="purpose" />
        </Form.Item>
        <Form.Item name="departmentLevel" label="部门聚合">
          <Select
            options={[
              { value: 'detail', label: '明细部门' },
              { value: 'top', label: '部门大类' },
            ]}
          />
        </Form.Item>
        <Form.Item name="categoryLevel" label="类别聚合">
          <Select
            options={[
              { value: 'detail', label: '资产细类' },
              { value: 'top', label: '资产大类' },
            ]}
          />
        </Form.Item>
        <div style={{ width: '100%' }}>
          <p>综合条件：全部同时满足（并且），最多 {MAX_QUERY_CONDITIONS} 条。</p>
          <Form.List name="conditions">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name }, index) => (
                  <Space key={key} wrap align="start" style={{ display: 'flex', marginBottom: 8 }}>
                    <span>条件 {index + 1}</span>
                    <Form.Item name={[name, 'field']}>
                      <Select
                        aria-label={`条件 ${index + 1} 字段`}
                        style={{ width: 180 }}
                        options={Object.entries(queryFields).map(([value, f]) => ({
                          value,
                          label: f.label,
                        }))}
                        onChange={(field: QueryCondition['field']) => {
                          if (
                            queryFields[field].type !== 'text' &&
                            form.getFieldValue(['conditions', name, 'op']) === 'contains'
                          )
                            form.setFieldValue(['conditions', name, 'op'], 'eq');
                        }}
                      />
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate>
                      {() => {
                        const field = (form.getFieldValue(['conditions', name, 'field']) ??
                          'code') as QueryCondition['field'];
                        const type = queryFields[field].type;
                        return (
                          <Space wrap align="start">
                            <Form.Item name={[name, 'op']}>
                              <Select
                                aria-label={`条件 ${index + 1} 操作符`}
                                style={{ width: 160 }}
                                options={Object.entries(queryOperators)
                                  .filter(([op]) => type === 'text' || op !== 'contains')
                                  .map(([value, label]) => ({
                                    value,
                                    label:
                                      type === 'text' && ['gt', 'lt'].includes(value)
                                        ? `${label}（文字排序）`
                                        : label,
                                  }))}
                              />
                            </Form.Item>
                            <Form.Item name={[name, 'value']}>
                              {type === 'number' ? (
                                <QueryAmountInput
                                  aria-label={`条件 ${index + 1} 值`}
                                  placeholder="请输入金额（元）"
                                  style={{ width: 240 }}
                                />
                              ) : (
                                <Input
                                  aria-label={`条件 ${index + 1} 值`}
                                  placeholder={type === 'date' ? 'YYYY-MM-DD' : '请输入文字'}
                                  style={{ width: 240 }}
                                />
                              )}
                            </Form.Item>
                          </Space>
                        );
                      }}
                    </Form.Item>
                    <Button
                      aria-label={`删除条件 ${index + 1}`}
                      onClick={() => {
                        remove(name);
                        setDirty(true);
                      }}
                    >
                      删除条件
                    </Button>
                  </Space>
                ))}
                <Button
                  disabled={fields.length >= MAX_QUERY_CONDITIONS}
                  onClick={() => {
                    add({ field: 'code', op: 'eq', value: '' });
                    setDirty(true);
                  }}
                >
                  增加条件
                </Button>
              </>
            )}
          </Form.List>
        </div>
        <Button htmlType="submit" type="primary">
          查询
        </Button>
        <Button
          onClick={() => {
            setCleared(structuredClone(form.getFieldsValue(true)));
            const defaults = queryDefaults(year);
            form.resetFields();
            form.setFieldsValue(defaults);
            submit(defaults);
          }}
        >
          清除筛选
        </Button>
        <Button
          disabled={!cleared}
          onClick={() => {
            if (!cleared) return;
            form.resetFields();
            form.setFieldsValue(cleared);
            submit(cleared);
            setCleared(null);
          }}
        >
          恢复清除前筛选
        </Button>
      </Form>
      {error && (
        <Alert
          type="error"
          showIcon
          title={
            conditionError ? (
              <>
                <span>{conditionError[1]}</span>
                <span>{conditionError[2]}</span>
              </>
            ) : (
              error
            )
          }
          description="查询未执行成功，未忽略任何条件。请修正条件或清除筛选后重试。"
          style={{ marginBottom: 16 }}
        />
      )}
      {dirty && !error && (
        <Alert type="info" title="筛选已修改，请点击查询更新结果" style={{ marginBottom: 16 }} />
      )}
      <Space>
        <Button disabled={!result?.rows.length} onClick={() => void print('detail')}>
          打印折旧明细
        </Button>
        <Button disabled={!result?.distribution.length} onClick={() => void print('distribution')}>
          打印折旧分布表
        </Button>
        <Confirm
          title="确认将当前列宽格式保存在本机？"
          onConfirm={() => {
            for (const name of ['query', 'distribution'])
              localStorage.setItem(
                `caiwu.fixed-assets.${name}.confirmed-widths`,
                localStorage.getItem(`caiwu.table.${draftId}-${name}.widths`) ?? '{}',
              );
          }}
        >
          记录列宽
        </Confirm>
        <Confirm
          title="确认恢复标准列宽？"
          onConfirm={() => {
            for (const name of ['query', 'distribution']) {
              localStorage.removeItem(`caiwu.fixed-assets.${name}.confirmed-widths`);
              localStorage.removeItem(`caiwu.table.${draftId}-${name}.widths`);
            }
            setVersion((v) => v + 1);
          }}
        >
          恢复默认列宽
        </Confirm>
      </Space>
      <DataTable
        key={version}
        tableId={`${draftId}-query`}
        rowKey="id"
        dataSource={result?.rows ?? []}
        loading={q.isFetching}
        locale={{
          emptyText: error
            ? '查询失败，请修正筛选条件'
            : dirty
              ? '筛选尚未查询'
              : q.isFetching
                ? '正在查询'
                : '没有符合筛选条件的折旧记录',
        }}
        exportName={result?.rows.length ? '折旧查询' : undefined}
        columns={[
          { key: 'period', title: '月份', dataIndex: 'period', width: 100 },
          { key: 'code', title: '编号', dataIndex: 'code', width: 120 },
          { key: 'name', title: '设备', dataIndex: 'name', width: 170 },
          { key: 'department', title: '部门', dataIndex: 'department', width: 130 },
          { key: 'category', title: '类别', dataIndex: 'category', width: 150 },
          { key: 'purpose', title: '用途', dataIndex: 'purpose', width: 130 },
          { key: 'work', title: '月工作量', dataIndex: 'work', width: 120 },
          { key: 'amount', title: '折旧额', dataIndex: 'amount', money: true },
          { key: 'issue', title: '跳过或说明', dataIndex: 'issue', width: 220 },
        ]}
      />
      <p>明细合计：{result ? formatMoney(result.total) : '—'} 元</p>
      <DataTable
        key={`distribution-${version}`}
        tableId={`${draftId}-distribution`}
        rowKey="group"
        dataSource={result?.distribution ?? []}
        loading={q.isFetching}
        locale={{
          emptyText: error
            ? '查询失败，请修正筛选条件'
            : dirty
              ? '筛选尚未查询'
              : q.isFetching
                ? '正在查询'
                : '没有符合筛选条件的折旧分布',
        }}
        columns={[
          { key: 'group', title: '部门 / 资产类别', dataIndex: 'group', width: 350 },
          { key: 'amount', title: '折旧额', dataIndex: 'amount', money: true },
        ]}
        exportName={result?.distribution.length ? '折旧分布表' : undefined}
      />
    </PageContainer>
  );
}
