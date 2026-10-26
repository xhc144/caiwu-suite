import { Button, Form, Space, type FormInstance } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

export interface FilterBarProps<V extends object> {
  initialValues?: Partial<V>;
  onSearch: (values: V) => void;
  onReset?: () => void;
  children: ReactNode;
  /** 查询按钮右侧的额外按钮 */
  extra?: ReactNode;
  form?: FormInstance<V>;
}

/**
 * 页面顶部的筛选栏（替代原版先弹"查询条件"对话框的做法）。在任意输入框按 Enter 即查询。
 *   <FilterBar onSearch={setFilter}>
 *     <Form.Item name="period" label="期间"><PeriodPicker /></Form.Item>
 *   </FilterBar>
 */
export function FilterBar<V extends object>({
  initialValues,
  onSearch,
  onReset,
  children,
  extra,
  form,
}: FilterBarProps<V>) {
  const [own] = Form.useForm<V>();
  const f = form ?? own;
  return (
    <Form<V>
      form={f}
      layout="inline"
      className="cw-filter-bar"
      initialValues={initialValues}
      onFinish={(v) => onSearch(v)}
    >
      {children}
      <Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
            查询
          </Button>
          <Button
            onClick={() => {
              f.resetFields();
              onReset?.();
              onSearch(f.getFieldsValue(true) as V);
            }}
          >
            重置
          </Button>
          {extra}
        </Space>
      </Form.Item>
    </Form>
  );
}

/**
 * 把筛选条件放在地址栏（?period=202601&status=pending）。这样工作台、提示里的按钮可以直接带条件跳过来，
 * 同一个标签页刷新也不丢条件。只支持字符串、数字、布尔。
 */
export function useUrlFilters<V extends Record<string, string | number | boolean | undefined>>(
  defaults: V,
): [V, (next: Partial<V>) => void] {
  const [params, setParams] = useSearchParams();
  const values = useMemo(() => {
    const out: Record<string, unknown> = { ...defaults };
    for (const [k, d] of Object.entries(defaults)) {
      const raw = params.get(k);
      if (raw == null) continue;
      out[k] =
        typeof d === 'number'
          ? Number(raw)
          : typeof d === 'boolean'
            ? raw === '1' || raw === 'true'
            : raw;
    }
    for (const [k, raw] of params) if (!(k in out)) out[k] = raw;
    return out as V;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const set = (next: Partial<V>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === '' || v === null) p.delete(k);
      else p.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    }
    setParams(p, { replace: true });
  };
  return [values, set];
}
