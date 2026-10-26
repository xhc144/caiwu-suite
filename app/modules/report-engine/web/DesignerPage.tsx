import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { MoneyInput, FilterBar, PageContainer, useUrlFilters } from '@caiwu/ui';
import {
  notify,
  queryClient,
  useHotkey,
  usePermission,
  useRequiredSession,
  useTab,
} from '@caiwu/web-kit';
import {
  CellSchema,
  ReportTemplateSchema,
  UNIT_LABELS,
  columnName,
  coordinates,
  type Cell,
  type CellStyle,
  type Report,
  type ReportTemplate,
} from '../shared';
import { ReportGrid } from './Grid';
import { FunctionWizard } from './FunctionWizard';
import { api } from './api';
import { confirmDiscard, discardQuestion, useUnsavedGuard } from './unsaved';

export default function DesignerPage() {
  const [filters] = useUrlFilters({ id: 0 });
  const report = useQuery({
    ...api.get.queryOptions({ id: filters.id }),
    enabled: Number.isSafeInteger(filters.id) && filters.id > 0,
  });
  if (report.isLoading) return <Spin />;
  if (!report.data)
    return <Alert type="error" title="报表不存在或无法读取，请从报表管理重新选择" />;
  return <Editor key={report.data.id} initial={report.data} />;
}
function Editor({ initial }: { initial: Report }) {
  const session = useRequiredSession();
  const draftKey = `report-engine.draft.${session.bookId}.${session.user.id}.${initial.id}`;
  const [report, setReport] = useState(initial);
  const [draft, setDraft] = useState<ReportTemplate>(() => {
    try {
      const raw = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null') as {
        revision?: number;
        template?: unknown;
      } | null;
      const parsed = ReportTemplateSchema.safeParse(raw?.template);
      return raw?.revision === initial.revision && parsed.success ? parsed.data : initial.template;
    } catch {
      return initial.template;
    }
  });
  const [selected, setSelected] = useState('A1');
  const [wizard, setWizard] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const [mergeRange, setMergeRange] = useState('');
  const [error, setError] = useState('');
  const tab = useTab();
  const root = useRef<HTMLDivElement>(null);
  const canEdit = usePermission('report-engine.edit') && !report.template.readOnly;
  const dirty = JSON.stringify(draft) !== JSON.stringify(report.template);
  const list = useQuery(api.list.queryOptions({}));
  const save = useMutation(api.save.mutationOptions());
  const current: Cell = draft.cells.find((c) => c.address === selected) ?? {
    address: selected,
    kind: 'text',
    source: '',
    unit: 'number',
    currency: 'CNY',
  };
  const currentStyle = draft.styles.find((s) => s.address === selected) ?? {
    address: selected,
    align: 'left' as const,
    wrap: false,
    bold: false,
    format: 'general' as const,
  };
  const point = coordinates(selected);
  const bypassGuard = useUnsavedGuard(dirty, tab.active, root);
  useEffect(() => {
    try {
      if (dirty)
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({ revision: report.revision, template: draft }),
        );
      else sessionStorage.removeItem(draftKey);
    } catch {
      setError('本机草稿空间不足或存储被禁用；当前编辑仍在页面中，请先保存报表后离开。');
    }
  }, [dirty, draft, draftKey, report.revision]);
  const leave = (to: string) =>
    confirmDiscard(
      dirty,
      () => window.confirm(discardQuestion),
      () => {
        try {
          sessionStorage.removeItem(draftKey);
        } catch {
          /* 存储禁用时仍允许显式离开。 */
        }
        setDraft(report.template);
        bypassGuard();
        window.location.assign(to);
      },
    );
  const updateCell = (cell: Cell) => {
    if (!canEdit) return;
    setDraft((d) => ({
      ...d,
      cells: [
        ...d.cells.filter((c) => c.address !== cell.address),
        ...(cell.source === '' ? [] : [cell]),
      ],
    }));
  };
  const updateStyle = (patch: Partial<CellStyle>) =>
    setDraft((d) => ({
      ...d,
      styles: [...d.styles.filter((s) => s.address !== selected), { ...currentStyle, ...patch }],
    }));
  const submit = async () => {
    const parsed = ReportTemplateSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((e) => e.message).join('；'));
      return;
    }
    const saved = await save.mutateAsync({
      id: report.id,
      expectedRevision: report.revision,
      template: parsed.data,
    });
    setReport(saved);
    setDraft(saved.template);
    setError('');
    queryClient.setQueryData(api.get.queryKey({ id: report.id }), saved);
    void queryClient.invalidateQueries({ queryKey: api.list.queryKey() });
    notify.success('报表定义已保存');
  };
  useHotkey('F8', () => canEdit && setWizard(true));
  useHotkey('Ctrl+S', () => {
    if (canEdit && !save.isPending) void submit();
  });
  const merge = () => {
    const m = /^([A-Z]{1,2}[1-9]\d{0,2}):([A-Z]{1,2}[1-9]\d{0,2})$/.exec(mergeRange.toUpperCase());
    if (!m) {
      setError('合并范围格式为 A1:B2');
      return;
    }
    const a = coordinates(m[1]!),
      b = coordinates(m[2]!);
    const candidate = {
      ...draft,
      merges: [
        ...draft.merges,
        { row: a.row, col: a.col, rows: b.row - a.row + 1, cols: b.col - a.col + 1 },
      ],
    };
    const parsed = ReportTemplateSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('；'));
      return;
    }
    setDraft(parsed.data);
    setError('');
  };
  return (
    <div ref={root}>
      <PageContainer
        title={`报表定义：${report.template.name}`}
        subtitle="金额输入元；保存后参与报表生成。"
        extra={
          <Space>
            <Button onClick={() => leave('/m/report-engine')}>返回列表</Button>
            <Button onClick={() => leave(`/m/report-engine/view?id=${report.id}`)}>
              生成/查看
            </Button>
            {canEdit && (
              <Button type="primary" loading={save.isPending} onClick={() => void submit()}>
                保存（Ctrl+S）
              </Button>
            )}
          </Space>
        }
      >
        <p>
          版本 {report.revision} · {dirty ? '有未保存修改' : '已保存'} ·
          公式返回单位必须与单元格声明一致。
        </p>
        <FilterBar<{ id: number }>
          initialValues={{ id: report.id }}
          onSearch={(v) => {
            if (v.id && v.id !== report.id) leave(`/m/report-engine/designer?id=${v.id}`);
          }}
        >
          <Form.Item name="id" label="切换报表">
            <Select
              style={{ width: 260 }}
              options={(list.data ?? []).map((r) => ({
                value: r.id,
                label: `${r.template.code} ${r.template.name}`,
              }))}
            />
          </Form.Item>
        </FilterBar>
        {!canEdit && (
          <Alert
            type="info"
            title={
              report.template.readOnly ? '只读模板；请在列表复制后编辑' : '当前操作员只有查看权限'
            }
          />
        )}
        {(error || save.isError) && (
          <Alert
            type="error"
            showIcon
            title={error || save.error?.message || '保存失败，编辑内容已保留'}
          />
        )}
        <Space wrap style={{ marginBlock: 12 }}>
          <label>
            编码{' '}
            <Input
              aria-label="定义编码"
              value={draft.code}
              disabled={!canEdit}
              style={{ width: 80 }}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            />
          </label>
          <label>
            名称{' '}
            <Input
              aria-label="定义名称"
              value={draft.name}
              disabled={!canEdit}
              style={{ width: 220 }}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            行数{' '}
            <InputNumber
              aria-label="定义行数"
              value={draft.rows}
              min={1}
              max={999}
              disabled={!canEdit}
              onChange={(n) => {
                if (n) setDraft({ ...draft, rows: n });
              }}
            />
          </label>
          <label>
            列数{' '}
            <InputNumber
              aria-label="定义列数"
              value={draft.cols}
              min={1}
              max={250}
              disabled={!canEdit}
              onChange={(n) => {
                if (n) setDraft({ ...draft, cols: n });
              }}
            />
          </label>
        </Space>
        <Space wrap>
          <strong>{selected}</strong>
          <Select
            aria-label="单元格类型"
            value={current.kind}
            disabled={!canEdit}
            style={{ width: 110 }}
            options={CellSchema.shape.kind.options.map((value) => ({
              value,
              label: { text: '文本', number: '数值', money: '金额', formula: '公式' }[value],
            }))}
            onChange={(kind) =>
              updateCell({
                ...current,
                kind,
                source: kind === 'money' || kind === 'number' ? '0' : current.source || ' ',
                unit: kind === 'money' || kind === 'formula' ? 'cents' : 'number',
              })
            }
          />
          <Select
            aria-label="单元格单位"
            value={current.unit}
            disabled={!canEdit || current.kind === 'text'}
            style={{ width: 230 }}
            options={Object.entries(UNIT_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={(unit) => updateCell({ ...current, unit })}
          />
          {current.unit === 'foreignCents' && (
            <Input
              aria-label="单元格币种"
              style={{ width: 80 }}
              value={current.currency}
              disabled={!canEdit}
              onChange={(e) => updateCell({ ...current, currency: e.target.value.toUpperCase() })}
            />
          )}
          {canEdit && (
            <>
              <Button onClick={() => setWizard(true)}>函数向导（F8）</Button>
              <Button onClick={() => setChecksOpen(true)}>审核公式</Button>
              <Button onClick={() => updateCell({ ...current, source: '' })}>清空当前格</Button>
            </>
          )}
        </Space>
        {current.kind === 'money' ? (
          <MoneyInput
            aria-label="当前单元格内容"
            value={Number(current.source || 0)}
            disabled={!canEdit}
            onChange={(cents) => updateCell({ ...current, source: String(cents ?? 0) })}
          />
        ) : (
          <Input.TextArea
            aria-label="当前单元格内容"
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{ marginTop: 8 }}
            value={current.source}
            disabled={!canEdit}
            onChange={(e) => updateCell({ ...current, source: e.target.value })}
          />
        )}
        <Space wrap style={{ marginTop: 12 }}>
          <Select
            aria-label="水平对齐"
            value={currentStyle.align}
            disabled={!canEdit}
            style={{ width: 100 }}
            options={[
              { value: 'left', label: '左对齐' },
              { value: 'center', label: '居中' },
              { value: 'right', label: '右对齐' },
            ]}
            onChange={(align) => updateStyle({ align })}
          />
          <Checkbox
            checked={currentStyle.wrap}
            disabled={!canEdit}
            onChange={(e) => updateStyle({ wrap: e.target.checked })}
          >
            自动换行
          </Checkbox>
          <Checkbox
            checked={currentStyle.bold}
            disabled={!canEdit}
            onChange={(e) => updateStyle({ bold: e.target.checked })}
          >
            粗体
          </Checkbox>
          <Select
            aria-label="数字格式"
            value={currentStyle.format}
            disabled={!canEdit}
            style={{ width: 120 }}
            options={[
              { value: 'general', label: '常规' },
              { value: 'decimal2', label: '两位小数' },
              { value: 'percent', label: '百分比' },
            ]}
            onChange={(format) => updateStyle({ format })}
          />
          <label>
            行高{' '}
            <InputNumber
              aria-label="行高"
              value={draft.rowHeights.find((r) => r.row === point.row)?.height ?? 36}
              min={20}
              max={200}
              disabled={!canEdit}
              onChange={(height) =>
                height &&
                setDraft({
                  ...draft,
                  rowHeights: [
                    ...draft.rowHeights.filter((r) => r.row !== point.row),
                    { row: point.row, height },
                  ],
                })
              }
            />
          </label>
          <label>
            列宽{' '}
            <InputNumber
              aria-label="列宽"
              value={draft.colWidths.find((r) => r.col === point.col)?.width ?? 160}
              min={60}
              max={600}
              disabled={!canEdit}
              onChange={(width) =>
                width &&
                setDraft({
                  ...draft,
                  colWidths: [
                    ...draft.colWidths.filter((c) => c.col !== point.col),
                    { col: point.col, width },
                  ],
                })
              }
            />
          </label>
        </Space>
        {canEdit && (
          <Space style={{ marginTop: 12 }}>
            <Input
              aria-label="合并范围"
              placeholder="A1:B2"
              value={mergeRange}
              onChange={(e) => setMergeRange(e.target.value)}
            />
            <Button onClick={merge}>合并</Button>
            <Button
              onClick={() =>
                setDraft({
                  ...draft,
                  merges: draft.merges.filter(
                    (m) =>
                      !(
                        point.row >= m.row &&
                        point.row < m.row + m.rows &&
                        point.col >= m.col &&
                        point.col < m.col + m.cols
                      ),
                  ),
                })
              }
            >
              拆分当前合并
            </Button>
          </Space>
        )}
        <ReportGrid
          template={draft}
          selected={selected}
          onSelect={setSelected}
          onChange={updateCell}
          disabled={!canEdit}
        />
        <span style={{ color: '#666' }}>
          方向键/Enter 选择相邻单元格。当前列 {columnName(point.col)}
          ；列宽和行高随定义保存。公式支持 + − × ÷、SUM、REF、BALANCE，金额单元格按四舍五入落到分。
        </span>
        {wizard && (
          <FunctionWizard
            onClose={() => setWizard(false)}
            onInsert={(source, unit, currency) => {
              updateCell({ address: selected, kind: 'formula', source, unit, currency });
              setWizard(false);
            }}
          />
        )}
        {checksOpen && (
          <Drawer
            getContainer={false}
            open
            title="审核公式（勾稽）"
            size={680}
            onClose={() => setChecksOpen(false)}
          >
            <Alert
              type="info"
              title="逐项比较左右表达式；差额绝对值不超过阈值才通过"
              description="左右必须同单位、同币种。金额按分四舍五入后比较，数量/比例保留10位小数；无法计算显示错误。引用与报表使用同一期间、口径和账套快照。"
            />
            {draft.checks.map((c, index) => (
              <Space key={index} orientation="vertical" style={{ display: 'flex', marginTop: 16 }}>
                {(['name', 'left', 'right', 'tolerance'] as const).map((key) => (
                  <label key={key}>
                    {
                      {
                        name: '名称',
                        left: '左表达式',
                        right: '右表达式',
                        tolerance: '阈值（金额为分）',
                      }[key]
                    }
                    <Input
                      value={c[key]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          checks: draft.checks.map((v, i) =>
                            i === index ? { ...v, [key]: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <Button
                  danger
                  onClick={() =>
                    setDraft({ ...draft, checks: draft.checks.filter((_, i) => i !== index) })
                  }
                >
                  移除此审核项
                </Button>
              </Space>
            ))}
            <Button
              style={{ marginTop: 16 }}
              onClick={() =>
                setDraft({
                  ...draft,
                  checks: [
                    ...draft.checks,
                    {
                      name: `审核${draft.checks.length + 1}`,
                      left: 'A1',
                      right: 'A1',
                      tolerance: '0',
                    },
                  ],
                })
              }
            >
              增加审核项
            </Button>
            <p>关闭抽屉保留修改；使用报表的保存按钮持久化。</p>
          </Drawer>
        )}
      </PageContainer>
    </div>
  );
}
