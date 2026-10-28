import { useState } from 'react';
import { Alert, Button, Checkbox, Input, Select, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { PageContainer, type DataColumn } from '@caiwu/ui';
import { formatMoney } from '@caiwu/core';
import {
  defaultQueryColumns,
  InventoryQuerySchema,
  operatorsFor,
  queryFieldKeys,
  queryFields,
  queryOperators,
  type InventoryQuery,
  type QueryField,
  type QueryGroup,
  type QueryNode,
  type QueryOperator,
  type QueryRow,
} from '../query';
import { api } from './api';
import { Grid, InventoryNavigation, useInventoryNavigate } from './common';

const fieldOptions = queryFieldKeys.map((value) => ({ value, label: queryFields[value].label }));
const emptyGroup = (): QueryGroup => ({ type: 'group', logic: 'and', children: [] });
const newCondition = (): QueryNode => ({
  type: 'condition',
  field: 'number',
  operator: 'contains',
  value: '',
});
function GroupEditor({
  group,
  onChange,
  path = '1',
  depth = 0,
}: {
  group: QueryGroup;
  onChange: (value: QueryGroup) => void;
  path?: string;
  depth?: number;
}) {
  const replace = (index: number, value: QueryNode) =>
    onChange({
      ...group,
      children: group.children.map((item, i) => (i === index ? value : item)),
    });
  return (
    <fieldset
      style={{
        border: '1px solid #d9d9d9',
        borderRadius: 6,
        padding: 12,
        marginBlock: 8,
        minWidth: 0,
      }}
    >
      <legend style={{ width: 'auto', fontSize: 14 }}>
        {depth ? `括号组 ${path}` : '查询条件（外层）'}
      </legend>
      <Space wrap style={{ marginBottom: 8 }}>
        <Typography.Text>本组条件</Typography.Text>
        <Select
          aria-label={`第${path}组逻辑`}
          value={group.logic}
          onChange={(logic) => onChange({ ...group, logic })}
          style={{ width: 160 }}
          options={[
            { value: 'and', label: '同时满足（且）' },
            { value: 'or', label: '任意满足（或）' },
          ]}
        />
        <Button
          disabled={group.children.length >= 64}
          onClick={() => onChange({ ...group, children: [...group.children, newCondition()] })}
        >
          {depth ? `组${path}增加条件` : '增加条件'}
        </Button>
        <Button
          disabled={depth >= 7 || group.children.length >= 64}
          onClick={() =>
            onChange({
              ...group,
              children: [...group.children, { ...emptyGroup(), children: [newCondition()] }],
            })
          }
        >
          {depth ? `组${path}增加括号组` : '增加括号组'}
        </Button>
      </Space>
      {group.children.map((node, index) => {
        const key = `${path}.${index + 1}`;
        return (
          <div key={key} style={{ marginBottom: 8 }}>
            {node.type === 'group' ? (
              <GroupEditor
                group={node}
                path={key}
                depth={depth + 1}
                onChange={(value) => replace(index, value)}
              />
            ) : (
              <Space wrap>
                <Select
                  aria-label={`条件${key}字段`}
                  style={{ width: 190 }}
                  value={node.field}
                  options={fieldOptions}
                  showSearch={{ optionFilterProp: 'label' }}
                  onChange={(field: QueryField) =>
                    replace(index, {
                      ...node,
                      field,
                      value: '',
                      operator: operatorsFor(field).includes(node.operator) ? node.operator : 'eq',
                    })
                  }
                />
                <Select
                  aria-label={`条件${key}运算符`}
                  style={{ width: 130 }}
                  value={node.operator}
                  options={operatorsFor(node.field).map((value) => ({
                    value,
                    label: queryOperators[value],
                  }))}
                  onChange={(operator: QueryOperator) =>
                    replace(index, {
                      ...node,
                      operator,
                      value: operator === 'empty' || operator === 'notEmpty' ? '' : node.value,
                    })
                  }
                />
                <Input
                  aria-label={`条件${key}值`}
                  style={{ width: 220 }}
                  type={queryFields[node.field].type === 'date' ? 'date' : 'text'}
                  placeholder={
                    queryFields[node.field].type === 'money'
                      ? '按元输入，例如 123.45'
                      : queryFields[node.field].type === 'quantity'
                        ? '最多六位小数'
                        : '请输入比较值'
                  }
                  disabled={node.operator === 'empty' || node.operator === 'notEmpty'}
                  value={node.value}
                  onChange={(e) => replace(index, { ...node, value: e.target.value })}
                />
              </Space>
            )}
            <Button
              size="small"
              danger
              style={{ marginInlineStart: 8 }}
              onClick={() =>
                onChange({ ...group, children: group.children.filter((_, i) => i !== index) })
              }
            >
              删除{node.type === 'group' ? '括号组' : '条件'}
              {key}
            </Button>
          </div>
        );
      })}
      {!group.children.length && (
        <Typography.Text type="secondary">未设置条件时查询全部单据。</Typography.Text>
      )}
    </fieldset>
  );
}
export default function QueryPage() {
  const [where, setWhere] = useState<QueryGroup>(emptyGroup);
  const [columns, setColumns] = useState<QueryField[]>(defaultQueryColumns);
  const [sort, setSort] = useState<InventoryQuery['sort']>([]);
  const [hideRepeatedHeaders, setHideRepeatedHeaders] = useState(false);
  const [submitted, setSubmitted] = useState<InventoryQuery>(() => InventoryQuerySchema.parse({}));
  const [error, setError] = useState('');
  const result = useQuery(api.queryDocuments.queryOptions(submitted));
  const navigate = useInventoryNavigate();
  const execute = () => {
    const parsed = InventoryQuerySchema.safeParse({ where, columns, sort, hideRepeatedHeaders });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? '';
      setError(/[\u4e00-\u9fff]/.test(message) ? message : '查询条件字段、类型或格式不正确');
      return;
    }
    setError('');
    if (JSON.stringify(parsed.data) === JSON.stringify(submitted)) void result.refetch();
    else setSubmitted(parsed.data);
  };
  const visibleColumns: DataColumn<QueryRow>[] = (result.data?.columns ?? submitted.columns).map(
    (field) => {
      const meta = queryFields[field];
      const value = (row: QueryRow) => (row.repeatedHeader && meta.header ? '' : row[field]);
      return {
        key: field,
        title: meta.label,
        dataIndex: field,
        width: meta.type === 'text' ? 160 : 150,
        money: meta.type === 'money',
        exportValue: value,
        render: (_, row) => {
          const v = value(row);
          return v == null || v === ''
            ? ''
            : meta.type === 'money'
              ? formatMoney(Number(v))
              : String(v);
        },
      };
    },
  );
  visibleColumns.push({
    key: 'open',
    title: '操作',
    width: 110,
    noExport: true,
    render: (_, row) => (
      <Button
        type="link"
        onClick={() =>
          void navigate(
            `/m/inventory/${row.kind === 'receipt' ? 'receipts' : 'issues'}?id=${row.documentId}`,
          )
        }
      >
        查看原单
      </Button>
    ),
  });
  return (
    <PageContainer
      title="单据综合查询"
      subtitle="按单据、产品和明细字段组合查询；金额条件按元填写。"
    >
      <InventoryNavigation />
      <GroupEditor group={where} onChange={setWhere} />
      <Space orientation="vertical" style={{ width: '100%', marginBlock: 12 }}>
        <Space wrap style={{ width: '100%' }}>
          <Typography.Text>显示列（按选择顺序）</Typography.Text>
          <Select
            aria-label="查询显示列"
            mode="multiple"
            style={{ minWidth: 280, maxWidth: '100%', width: 720 }}
            value={columns}
            options={fieldOptions}
            onChange={setColumns}
            showSearch={{ optionFilterProp: 'label' }}
          />
          <Checkbox
            checked={hideRepeatedHeaders}
            onChange={(e) => setHideRepeatedHeaders(e.target.checked)}
          >
            重复单据头不显示
          </Checkbox>
        </Space>
        {sort.map((item, index) => (
          <Space wrap key={index}>
            <Typography.Text>排序 {index + 1}</Typography.Text>
            <Select
              aria-label={`排序${index + 1}字段`}
              style={{ width: 190 }}
              value={item.field}
              options={fieldOptions}
              showSearch={{ optionFilterProp: 'label' }}
              onChange={(field: QueryField) =>
                setSort(sort.map((s, i) => (i === index ? { ...s, field } : s)))
              }
            />
            <Select
              aria-label={`排序${index + 1}方向`}
              style={{ width: 100 }}
              value={item.direction}
              options={[
                { value: 'asc', label: '升序' },
                { value: 'desc', label: '降序' },
              ]}
              onChange={(direction: 'asc' | 'desc') =>
                setSort(sort.map((s, i) => (i === index ? { ...s, direction } : s)))
              }
            />
            <Button
              disabled={index === 0}
              onClick={() =>
                setSort((items) => {
                  const next = [...items];
                  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                  return next;
                })
              }
            >
              上移排序{index + 1}
            </Button>
            <Button danger onClick={() => setSort(sort.filter((_, i) => i !== index))}>
              删除排序{index + 1}
            </Button>
          </Space>
        ))}
        <Space wrap>
          <Button
            disabled={sort.length >= 8}
            onClick={() => {
              const field = queryFieldKeys.find((key) => !sort.some((s) => s.field === key));
              if (field) setSort([...sort, { field, direction: 'asc' }]);
            }}
          >
            增加排序
          </Button>
          <Button type="primary" loading={result.isFetching} onClick={execute}>
            执行综合查询
          </Button>
          <Button
            onClick={() => {
              setWhere(emptyGroup());
              setColumns(defaultQueryColumns);
              setSort([]);
              setHideRepeatedHeaders(false);
              setError('');
            }}
          >
            清空查询条件
          </Button>
        </Space>
      </Space>
      {(error || result.error) && (
        <Alert
          type="error"
          title={error || result.error?.message}
          description="请修改条件后重新执行，错误条件不会被忽略。"
        />
      )}
      <Typography.Paragraph role="status">
        {result.isFetching ? '正在查询…' : `共查询到 ${result.data?.rows.length ?? 0} 条明细`}
      </Typography.Paragraph>
      <Grid
        id="query"
        height={(result.data?.rows.length ?? 0) > 200 ? 480 : undefined}
        title="单据综合查询"
        rows={result.data?.rows ?? []}
        columns={visibleColumns}
      />
    </PageContainer>
  );
}
