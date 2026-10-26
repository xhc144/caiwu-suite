import { Alert, Button, Drawer, Form, Input, Select, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { coreApi, queryClient, useAccounts, useDimensionItems } from '@caiwu/web-kit';
import { AccountSelect, DimensionSelect } from '@caiwu/ui';
import {
  BalanceFunctionSchema,
  DimensionSchema,
  METRIC_LABELS,
  UNIT_LABELS,
  balanceFormula,
  coordinates,
  type Cell,
  type ReportTemplate,
  type Unit,
  type BalanceFunction,
} from '../shared';
import { api } from './api';

export function FunctionWizard({
  onClose,
  disabled = false,
  cell,
  template,
  onInsert,
}: {
  disabled?: boolean;
  cell?: Cell;
  template?: ReportTemplate;
  onClose(): void;
  onInsert(source: string, unit: Unit, currency: string): void;
}) {
  const [form] = Form.useForm<BalanceFunction>();
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState<number | undefined>(undefined);
  const [dimension, setDimension] = useState<BalanceFunction['dimension']>('none');
  const items = useDimensionItems(dimension === 'none' ? undefined : dimension);
  const [itemId, setItemId] = useState<number | undefined>(undefined);
  const currency = useQuery(coreApi.reference.currencies.queryOptions());
  const [message, setMessage] = useState<{ text: string; valid: boolean } | null>(null);
  const [source, setSource] = useState('');
  const [kind, setKind] = useState<'balance' | 'sum' | 'ref' | 'expression'>(
    cell?.kind === 'formula' ? 'expression' : 'balance',
  );
  const [expression, setExpression] = useState(cell?.kind === 'formula' ? cell.source : '');
  const [unit, setUnit] = useState<Unit>(cell?.kind === 'formula' ? cell.unit : 'cents');
  const [outputCurrency, setOutputCurrency] = useState(cell?.currency ?? 'CNY');
  const [range, setRange] = useState('A1:A1');
  const [referenceId, setReferenceId] = useState<number>();
  const [address, setAddress] = useState('A1');
  const reports = useQuery(api.list.queryOptions({}));
  const [checking, setChecking] = useState(false);
  const request = useRef(0);
  const locked = useRef(disabled);
  locked.current = disabled;
  useEffect(() => {
    if (disabled) request.current++;
  }, [disabled]);
  const active = useRef(true);
  const running = useRef(false);
  const editor = useRef<TextAreaRef>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const changed = () => {
    request.current++;
    setMessage(null);
    setSource('');
  };
  const makeBalance = async () => {
    const v = await form.validateFields();
    const candidate = {
      ...v,
      account: accounts.byId.get(accountId ?? 0)?.code ?? '',
      dimension,
      item: dimension === 'none' ? '' : (items.byId.get(itemId ?? 0)?.code ?? ''),
    };
    const parsed = BalanceFunctionSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((i) => i.message).join('；'));
    }
    return {
      source: balanceFormula(parsed.data),
      unit: parsed.data.unit,
      currency: parsed.data.currency,
    };
  };
  const build = async () => {
    if (kind === 'balance') return makeBalance();
    if (kind === 'sum') {
      const parts = range.trim().toUpperCase().split(':');
      const a = coordinates(parts[0] ?? ''),
        b = coordinates(parts[1] ?? '');
      if (parts.length !== 2 || !a.row || !b.row || a.row > b.row || a.col > b.col)
        throw new Error('求和区域须为正向矩形，例如 A1:B3');
      if (template && (b.row > template.rows || b.col > template.cols))
        throw new Error('求和区域超出当前报表行列范围');
      if ((b.row - a.row + 1) * (b.col - a.col + 1) > 5000)
        throw new Error('求和区域不能超过5000个单元格');
      return {
        source: `SUM(${parts.join(':')})`,
        unit,
        currency: unit === 'foreignCents' ? outputCurrency : 'CNY',
      };
    }
    if (kind === 'ref') {
      const target = reports.data?.find((r) => r.id === referenceId);
      if (!target) throw new Error('请选择当前账套中的来源报表');
      const normalized = address.trim().toUpperCase(),
        p = coordinates(normalized);
      if (!p.row || p.row > target.template.rows || p.col > target.template.cols)
        throw new Error('引用地址超出来源报表行列范围');
      const targetCell = target.template.cells.find((c) => c.address === normalized);
      if (targetCell?.kind === 'text') throw new Error('文本单元格不能用于数值表间运算');
      return {
        source: `REF(${JSON.stringify(target.template.code)},${JSON.stringify(normalized)})`,
        unit: targetCell?.unit ?? unit,
        currency: targetCell?.currency ?? (unit === 'foreignCents' ? outputCurrency : 'CNY'),
      };
    }
    if (!expression.trim()) throw new Error('请输入组合公式');
    return {
      source: expression.trim(),
      unit,
      currency: unit === 'foreignCents' ? outputCurrency : 'CNY',
    };
  };
  const run = async (action: 'validate' | 'insert' | 'compose') => {
    if (locked.current || running.current) return;
    running.current = true;
    setChecking(true);
    const ticket = ++request.current;
    try {
      const candidate = await build();
      const checked = await queryClient.fetchQuery(
        api.validateFormula.queryOptions({ source: candidate.source }),
      );
      if (!active.current || locked.current || ticket !== request.current) return;
      setSource(candidate.source);
      setMessage({ text: checked.message, valid: checked.valid });
      if (!checked.valid) return;
      if (action === 'insert') onInsert(candidate.source, candidate.unit, candidate.currency);
      if (action === 'compose') {
        setExpression((old) => (old ? `${old}+${candidate.source}` : candidate.source));
        setUnit(candidate.unit);
        setOutputCurrency(candidate.currency);
        setKind('expression');
        changed();
      }
    } catch (e) {
      if (active.current && !locked.current && ticket === request.current)
        setMessage({ text: e instanceof Error ? e.message : '请补全向导参数后校验', valid: false });
    } finally {
      running.current = false;
      if (active.current) setChecking(false);
    }
  };
  const insertToken = (token: string) => {
    if (disabled || checking) return;
    const input = editor.current?.resizableTextArea?.textArea;
    const start = input?.selectionStart ?? expression.length,
      end = input?.selectionEnd ?? start;
    setExpression(expression.slice(0, start) + token + expression.slice(end));
    changed();
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
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
        disabled={disabled || checking}
        form={form}
        layout="vertical"
        initialValues={{ metric: 'closing', unit: 'cents', currency: 'CNY', direction: 'signed' }}
        style={{ marginTop: 16 }}
        onValuesChange={changed}
      >
        <div hidden={kind !== 'balance'}>
          <Form.Item label="科目">
            <AccountSelect
              value={accountId}
              onChange={(id) => {
                setAccountId(id ?? undefined);
                changed();
              }}
            />
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
                changed();
              }}
            />
          </Form.Item>
          {dimension !== 'none' && (
            <Form.Item label="辅助项">
              <DimensionSelect
                type={dimension}
                value={itemId}
                onChange={(id) => {
                  setItemId(id ?? undefined);
                  changed();
                }}
              />
            </Form.Item>
          )}
        </div>
        <Form.Item label="函数类型">
          <Select
            aria-label="函数类型"
            value={kind}
            options={[
              { value: 'balance', label: '总账取数 BALANCE' },
              { value: 'sum', label: '表内求和 SUM' },
              { value: 'ref', label: '表间引用 REF' },
              { value: 'expression', label: '组合公式/四则运算' },
            ]}
            onChange={(value) => {
              setKind(value);
              changed();
            }}
          />
        </Form.Item>
        {kind === 'sum' && (
          <Form.Item label="求和区域">
            <Input
              aria-label="求和区域"
              value={range}
              onChange={(e) => {
                setRange(e.target.value);
                changed();
              }}
            />
          </Form.Item>
        )}
        {kind === 'ref' && (
          <>
            <Form.Item label="来源报表">
              <Select
                aria-label="来源报表"
                value={referenceId}
                loading={reports.isLoading}
                options={(reports.data ?? []).map((r) => ({
                  value: r.id,
                  label: `${r.template.code} ${r.template.name}`,
                }))}
                onChange={(id) => {
                  setReferenceId(id);
                  changed();
                }}
              />
            </Form.Item>
            <Form.Item label="来源单元格">
              <Input
                aria-label="来源单元格"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  changed();
                }}
              />
            </Form.Item>
            <p>从来源单元格带入单位和币种；生成时在同一账套、期间和过账口径重算来源表。</p>
          </>
        )}
        {kind === 'expression' && (
          <>
            <Form.Item label="组合公式">
              <Input.TextArea
                ref={editor}
                aria-label="组合公式"
                value={expression}
                autoSize={{ minRows: 3, maxRows: 8 }}
                onChange={(e) => {
                  setExpression(e.target.value);
                  changed();
                }}
              />
            </Form.Item>
            <Space wrap>
              {['+', '-', '*', '/', '(', ')', ','].map((token) => (
                <Button
                  key={token}
                  aria-label={`插入运算符 ${token}`}
                  onClick={() => insertToken(token)}
                >
                  {token}
                </Button>
              ))}
            </Space>
          </>
        )}
        {kind !== 'balance' && kind !== 'ref' && (
          <>
            <Form.Item label="结果单位">
              <Select
                aria-label="结果单位"
                value={unit}
                options={Object.entries(UNIT_LABELS).map(([value, label]) => ({ value, label }))}
                onChange={(value) => {
                  setUnit(value);
                  changed();
                }}
              />
            </Form.Item>
            {unit === 'foreignCents' && (
              <Form.Item label="结果币种">
                <Select
                  aria-label="结果币种"
                  value={outputCurrency}
                  options={(currency.data ?? []).map((c) => ({
                    value: c.code,
                    label: `${c.code} ${c.name}`,
                  }))}
                  onChange={(value) => {
                    setOutputCurrency(value);
                    changed();
                  }}
                />
              </Form.Item>
            )}
          </>
        )}
        <Space>
          <Button onClick={() => void run('validate')}>校验</Button>
          {kind !== 'expression' && (
            <Button onClick={() => void run('compose')}>加入组合公式</Button>
          )}
          <Button type="primary" onClick={() => void run('insert')}>
            插入到当前单元格
          </Button>
        </Space>
      </Form>
      {message && (
        <Alert
          style={{ marginTop: 12 }}
          title={message.text}
          type={message.valid ? 'success' : 'warning'}
        />
      )}
      {source && <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{source}</pre>}
      <p>
        插入会替换当前单元格的完整公式。校验只检查语法；单位、循环引用、缺失数据和除零须以实际生成为准。取消关闭不会修改单元格。
      </p>
      <p>
        已核实原版 S/W/F
        前缀说明，但资料缺少基本函数数据行，暂不提供猜测的旧函数别名。外币/数量本年累计、现金流量期初分配不支持。
      </p>
    </Drawer>
  );
}
