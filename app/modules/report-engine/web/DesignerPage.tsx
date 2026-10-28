import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { MoneyInput, FilterBar, PageContainer, useUrlFilters, downloadBlob } from '@caiwu/ui';
import {
  notify,
  queryClient,
  useHotkey,
  usePermission,
  useRequiredSession,
  useTab,
  useUnsavedChanges,
} from '@caiwu/web-kit';
import {
  CellSchema,
  FONT_FAMILIES,
  ReportTemplateSchema,
  UNIT_LABELS,
  columnName,
  coordinates,
  type Cell,
  type CellStyle,
  type Report,
  type ReportTemplate,
} from '../shared';
import {
  applyStyle,
  changeStructure,
  createHistory,
  pasteCells,
  rangeAddresses,
  recordEdit,
  redoEdit,
  undoEdit,
  structureDelta,
  type EditorHistory,
  type PasteMode,
  type StructureChange,
} from '../editor-operations';
import { ReportGrid } from './Grid';
import { FunctionWizard } from './FunctionWizard';
import { PrintSettingsEditor } from './PrintSettingsEditor';
import { readEditorDraft } from './editor-draft';
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
  const [localDraft] = useState(() => {
    try {
      return readEditorDraft(sessionStorage.getItem(draftKey), initial);
    } catch {
      return readEditorDraft(null, initial);
    }
  });
  const [history, setHistory] = useState<EditorHistory>(() =>
    createHistory(localDraft.template, localDraft.structureChanges),
  );
  const [recovery, setRecovery] = useState(localDraft.recovery);
  const [hasRecoveryCopies, setHasRecoveryCopies] = useState(() => {
    try {
      return Object.keys(sessionStorage).some(
        (key) => key === `${draftKey}.recovery` || key.startsWith(`${draftKey}.recovery.`),
      );
    } catch {
      return false;
    }
  });
  const historyRef = useRef(history);
  const savedChanges = useRef<StructureChange[]>([]);
  const draft = history.present;
  const [selected, setSelected] = useState('A1');
  const [wizard, setWizard] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const [mergeRange, setMergeRange] = useState('');
  const [structureCount, setStructureCount] = useState(1);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteMode, setPasteMode] = useState<PasteMode>('auto');
  const [printOpen, setPrintOpen] = useState(false);
  const [formatRange, setFormatRange] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const tab = useTab();
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const canEdit = usePermission('report-engine.edit') && !report.template.readOnly;
  const dirty = JSON.stringify(draft) !== JSON.stringify(report.template);
  const list = useQuery(api.list.queryOptions({}));
  const save = useMutation(api.save.mutationOptions());
  const canChange = canEdit && !isSaving && !recovery;
  // 同步锁保护尚未渲染 disabled 的事件轮次，以及异步向导回调。
  const editDraft = (next: SetStateAction<ReportTemplate>, change?: StructureChange) => {
    if (!canEdit || recovery || saveInFlight.current || !mounted.current) return;
    const current = historyRef.current;
    const present = typeof next === 'function' ? next(current.present) : next;
    const updated = recordEdit(current, present, change);
    historyRef.current = updated;
    setHistory(updated);
  };
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
  // 保存中的同步锁仍保护外部点击；未保存内容交给壳按标签统一处理。
  useUnsavedGuard(false, tab.active, root, isSaving);
  useEffect(() => {
    if (recovery) return;
    try {
      if (dirty)
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({
            revision: report.revision,
            template: draft,
            structureChanges: structureDelta(savedChanges.current, history.changes),
          }),
        );
      else sessionStorage.removeItem(draftKey);
    } catch {
      setError('本机草稿空间不足或存储被禁用；当前编辑仍在页面中，请先保存报表后离开。');
    }
  }, [dirty, draft, draftKey, report.revision, history.changes, recovery]);
  const leave = (to: string) => {
    if (saveInFlight.current) return;
    return confirmDiscard(
      dirty,
      () => window.confirm(discardQuestion),
      () => {
        try {
          if (!recovery) sessionStorage.removeItem(draftKey);
        } catch {
          /* 存储禁用时仍允许显式离开。 */
        }
        const reset = createHistory(report.template);
        historyRef.current = reset;
        savedChanges.current = [];
        setHistory(reset);
        void navigate(to);
      },
    );
  };
  const updateCell = (cell: Cell) => {
    if (!canEdit) return;
    editDraft((d) => ({
      ...d,
      cells: [
        ...d.cells.filter((c) => c.address !== cell.address),
        ...(cell.source === '' ? [] : [cell]),
      ],
    }));
  };
  const updateStyle = (patch: Partial<CellStyle>) =>
    act(() => editDraft((d) => applyStyle(d, rangeAddresses(d, formatRange || selected), patch)));
  const act = (action: () => void) => {
    try {
      action();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，编辑内容已保留');
    }
  };
  const moveHistory = (redo = false) => {
    if (!canEdit || recovery || saveInFlight.current) return;
    const next = (redo ? redoEdit : undoEdit)(historyRef.current);
    historyRef.current = next;
    setHistory(next);
    setSelected((address) => {
      const p = coordinates(address);
      return `${columnName(Math.min(p.col, next.present.cols))}${Math.min(p.row, next.present.rows)}`;
    });
    setError('');
  };
  const structure = (axis: StructureChange['axis'], kind: StructureChange['kind']) => {
    if (!canChange || saveInFlight.current) return;
    const index = point[axis];
    const label = axis === 'row' ? '行' : '列';
    if (
      kind === 'delete' &&
      !window.confirm(
        `删除从${selected}所在${label}开始的${structureCount}${label}？范围内内容和格式将删除，公式及合并范围会调整；保存前可撤销。`,
      )
    )
      return;
    act(() => {
      const change = { axis, kind, index, count: structureCount };
      const next = changeStructure(historyRef.current.present, change);
      editDraft(next, change);
      setSelected(`${columnName(Math.min(point.col, next.cols))}${Math.min(point.row, next.rows)}`);
    });
  };
  const paste = (address: string, text: string) => {
    if (!canChange || saveInFlight.current) return;
    act(() => {
      editDraft(pasteCells(historyRef.current.present, address, text, pasteMode));
      setPasteOpen(false);
      setPasteText('');
    });
  };
  const resize = (axis: StructureChange['axis'], value: number | null) => {
    if (!value || !canChange || saveInFlight.current) return;
    const current = historyRef.current.present;
    const oldSize = axis === 'row' ? current.rows : current.cols;
    if (value === oldSize) return;
    if (
      value < oldSize &&
      !window.confirm(
        `缩小${axis === 'row' ? '行' : '列'}数将删除末尾${oldSize - value}${axis === 'row' ? '行' : '列'}内容。确认继续？保存前可撤销。`,
      )
    )
      return;
    act(() => {
      const change: StructureChange = {
        axis,
        kind: value > oldSize ? 'insert' : 'delete',
        index: Math.min(value, oldSize) + 1,
        count: Math.abs(value - oldSize),
      };
      const next = changeStructure(current, change);
      editDraft(next, change);
      setSelected(`${columnName(Math.min(point.col, next.cols))}${Math.min(point.row, next.rows)}`);
    });
  };
  const submit = async () => {
    if (!canEdit || recovery || saveInFlight.current) return;
    const parsed = ReportTemplateSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((e) => e.message).join('；'));
      return;
    }
    const confirmShrink =
      parsed.data.rows < report.template.rows || parsed.data.cols < report.template.cols;
    if (
      confirmShrink &&
      !window.confirm(
        `报表尺寸将从${report.template.rows}行${report.template.cols}列改为${parsed.data.rows}行${parsed.data.cols}列。确认保存删除行列后的定义？取消会保留当前编辑。`,
      )
    )
      return;
    saveInFlight.current = true;
    setIsSaving(true);
    try {
      const saved = await save.mutateAsync({
        id: report.id,
        expectedRevision: report.revision,
        template: parsed.data,
        confirmShrink,
        structureChanges: structureDelta(savedChanges.current, historyRef.current.changes),
      });
      if (!mounted.current) return;
      setReport(saved);
      const clean = { ...historyRef.current, present: saved.template };
      savedChanges.current = clean.changes;
      historyRef.current = clean;
      setHistory(clean);
      setError('');
      queryClient.setQueryData(api.get.queryKey({ id: report.id }), (cached) =>
        cached && cached.revision > saved.revision ? cached : saved,
      );
      void queryClient.invalidateQueries({ queryKey: api.list.queryKey() });
      notify.success('报表定义已保存');
    } catch {
      // mutationCache 显示业务错误；保留当前定义和本机草稿以便继续编辑。
    } finally {
      saveInFlight.current = false;
      if (mounted.current) setIsSaving(false);
    }
  };
  useUnsavedChanges({
    title: `报表定义：${draft.name}`,
    dirty,
    version: JSON.stringify(draft),
    save: submit,
    discard: () => {
      if (saveInFlight.current) throw new Error('正在保存报表，请等待保存完成');
      const reset = createHistory(report.template);
      historyRef.current = reset;
      savedChanges.current = [];
      setHistory(reset);
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        // 存储不可用时仍保留已保存的页面定义。
      }
    },
  });
  useHotkey('F8', () => canChange && setWizard(true));
  useHotkey('Ctrl+S', () => {
    void submit();
  });
  useHotkey('Ctrl+Z', () => moveHistory());
  useHotkey('Ctrl+Y', () => moveHistory(true));
  useHotkey('Ctrl+Shift+Z', () => moveHistory(true));
  const merge = () => {
    if (!canEdit || saveInFlight.current) return;
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
    editDraft(parsed.data);
    setError('');
  };
  return (
    <div ref={root}>
      <PageContainer
        title={`报表定义：${report.template.name}`}
        subtitle="金额输入元；保存后参与报表生成。"
        extra={
          <Space>
            {hasRecoveryCopies && (
              <Button
                onClick={() => {
                  try {
                    const copies = Object.fromEntries(
                      Object.keys(sessionStorage)
                        .filter(
                          (key) =>
                            key === `${draftKey}.recovery` ||
                            key.startsWith(`${draftKey}.recovery.`),
                        )
                        .map((key) => [key, sessionStorage.getItem(key)]),
                    );
                    downloadBlob(
                      new Blob([JSON.stringify(copies, null, 2)], { type: 'application/json' }),
                      `报表${report.template.code}-草稿副本.json`,
                    );
                  } catch {
                    setError('无法读取本机草稿副本，请保留当前窗口后重试。');
                  }
                }}
              >
                导出保留副本
              </Button>
            )}
            <Button disabled={isSaving} onClick={() => leave('/m/report-engine')}>
              返回列表
            </Button>
            <Button
              disabled={isSaving}
              onClick={() => leave(`/m/report-engine/view?id=${report.id}`)}
            >
              生成/查看
            </Button>
            {canEdit && (
              <Button
                type="primary"
                disabled={!canChange}
                loading={isSaving}
                onClick={() => void submit()}
              >
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
              disabled={isSaving}
              style={{ width: 260 }}
              options={(list.data ?? []).map((r) => ({
                value: r.id,
                label: `${r.template.code} ${r.template.name}`,
              }))}
            />
          </Form.Item>
        </FilterBar>
        {isSaving && <Alert type="info" title="报表正在保存，完成前暂不能编辑或切换报表。" />}
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
        {recovery && (
          <Alert
            type="warning"
            title={recovery.message}
            action={
              <Space wrap>
                <Button
                  onClick={() =>
                    downloadBlob(
                      new Blob([recovery.raw], { type: 'application/json' }),
                      `报表${report.template.code}-保留草稿.json`,
                    )
                  }
                >
                  导出保留草稿
                </Button>
                <Button
                  onClick={() => {
                    try {
                      const recoveryKey = `${draftKey}.recovery`;
                      const previous = sessionStorage.getItem(recoveryKey);
                      if (previous && previous !== recovery.raw)
                        sessionStorage.setItem(`${recoveryKey}.${crypto.randomUUID()}`, previous);
                      sessionStorage.setItem(recoveryKey, recovery.raw);
                      setHasRecoveryCopies(true);
                      setRecovery(null);
                      setError('旧草稿副本已保留在本机；当前为服务器版本。');
                    } catch {
                      setError('无法保存草稿副本，请先导出保留草稿；原始内容仍在本机。');
                    }
                  }}
                >
                  保留副本并继续
                </Button>
              </Space>
            }
          />
        )}
        <Space wrap style={{ marginBlock: 12 }}>
          <label>
            编码{' '}
            <Input
              aria-label="定义编码"
              value={draft.code}
              disabled={!canChange}
              style={{ width: 80 }}
              onChange={(e) => editDraft({ ...draft, code: e.target.value })}
            />
          </label>
          <label>
            名称{' '}
            <Input
              aria-label="定义名称"
              value={draft.name}
              disabled={!canChange}
              style={{ width: 220 }}
              onChange={(e) => editDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            行数{' '}
            <InputNumber
              aria-label="定义行数"
              value={draft.rows}
              min={1}
              max={999}
              disabled={!canChange}
              onChange={(n) => resize('row', n)}
            />
          </label>
          <label>
            列数{' '}
            <InputNumber
              aria-label="定义列数"
              value={draft.cols}
              min={1}
              max={250}
              disabled={!canChange}
              onChange={(n) => resize('col', n)}
            />
          </label>
        </Space>
        <Space wrap>
          <Button disabled={!canChange || history.past.length === 0} onClick={() => moveHistory()}>
            撤销
          </Button>
          <Button
            disabled={!canChange || history.future.length === 0}
            onClick={() => moveHistory(true)}
          >
            重做
          </Button>
          <InputNumber
            aria-label="插删数量"
            min={1}
            max={999}
            value={structureCount}
            disabled={!canChange}
            onChange={(n) => setStructureCount(n ?? 1)}
          />
          <Button disabled={!canChange} onClick={() => structure('row', 'insert')}>
            插入行
          </Button>
          <Button disabled={!canChange} danger onClick={() => structure('row', 'delete')}>
            删除行
          </Button>
          <Button disabled={!canChange} onClick={() => structure('col', 'insert')}>
            插入列
          </Button>
          <Button disabled={!canChange} danger onClick={() => structure('col', 'delete')}>
            删除列
          </Button>
          <Button disabled={!canChange} onClick={() => setPasteOpen(true)}>
            批量粘贴
          </Button>
          <Button disabled={!canChange} onClick={() => setPrintOpen(true)}>
            打印设置
          </Button>
        </Space>
        <p style={{ color: '#666' }}>
          插入在当前单元格所在行列之前；删除会先确认。本表引用随行列移动，其他报表中的引用在保存时同步调整；被引用的内容不能直接删除。一次批量操作可整体撤销，最多保留100步。
        </p>
        <Space wrap>
          <strong>{selected}</strong>
          <Select
            aria-label="单元格类型"
            value={current.kind}
            disabled={!canChange}
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
            disabled={!canChange || current.kind === 'text'}
            style={{ width: 230 }}
            options={Object.entries(UNIT_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={(unit) => updateCell({ ...current, unit })}
          />
          {current.unit === 'foreignCents' && (
            <Input
              aria-label="单元格币种"
              style={{ width: 80 }}
              value={current.currency}
              disabled={!canChange}
              onChange={(e) => updateCell({ ...current, currency: e.target.value.toUpperCase() })}
            />
          )}
          {canEdit && (
            <>
              <Button disabled={!canChange} onClick={() => setWizard(true)}>
                函数向导（F8）
              </Button>
              <Button disabled={!canChange} onClick={() => setChecksOpen(true)}>
                审核公式
              </Button>
              <Button disabled={!canChange} onClick={() => updateCell({ ...current, source: '' })}>
                清空当前格
              </Button>
            </>
          )}
        </Space>
        {current.kind === 'money' ? (
          <MoneyInput
            aria-label="当前单元格内容"
            value={Number(current.source || 0)}
            disabled={!canChange}
            onChange={(cents) => updateCell({ ...current, source: String(cents ?? 0) })}
          />
        ) : (
          <Input.TextArea
            aria-label="当前单元格内容"
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{ marginTop: 8 }}
            value={current.source}
            disabled={!canChange}
            onChange={(e) => updateCell({ ...current, source: e.target.value })}
          />
        )}
        <Space wrap style={{ marginTop: 12 }}>
          <Input
            aria-label="格式范围"
            placeholder={`格式范围（默认${selected}）`}
            style={{ width: 190 }}
            value={formatRange}
            disabled={!canChange}
            onChange={(e) => setFormatRange(e.target.value)}
          />
          <Select
            aria-label="字体"
            value={currentStyle.fontFamily ?? '宋体'}
            disabled={!canChange}
            style={{ width: 110 }}
            options={FONT_FAMILIES.map((value) => ({ value, label: value }))}
            onChange={(fontFamily) => updateStyle({ fontFamily })}
          />
          <InputNumber
            aria-label="字号"
            value={currentStyle.fontSize ?? 11}
            min={6}
            max={72}
            disabled={!canChange}
            onChange={(fontSize) => fontSize && updateStyle({ fontSize })}
          />
          <Checkbox
            checked={currentStyle.italic ?? false}
            disabled={!canChange}
            onChange={(e) => updateStyle({ italic: e.target.checked })}
          >
            斜体
          </Checkbox>
          <Checkbox
            checked={currentStyle.underline ?? false}
            disabled={!canChange}
            onChange={(e) => updateStyle({ underline: e.target.checked })}
          >
            下划线
          </Checkbox>
          <label>
            字体颜色{' '}
            <input
              aria-label="字体颜色"
              type="color"
              value={currentStyle.color ?? '#000000'}
              disabled={!canChange}
              onChange={(e) => updateStyle({ color: e.target.value })}
            />
          </label>
          <Select
            aria-label="水平对齐"
            value={currentStyle.align}
            disabled={!canChange}
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
            disabled={!canChange}
            onChange={(e) => updateStyle({ wrap: e.target.checked })}
          >
            自动换行
          </Checkbox>
          <Checkbox
            checked={currentStyle.bold}
            disabled={!canChange}
            onChange={(e) => updateStyle({ bold: e.target.checked })}
          >
            粗体
          </Checkbox>
          <Select
            aria-label="数字格式"
            value={currentStyle.format}
            disabled={!canChange}
            style={{ width: 120 }}
            options={[
              { value: 'general', label: '常规' },
              { value: 'decimal2', label: '两位小数' },
              { value: 'percent', label: '百分比' },
            ]}
            onChange={(format) => updateStyle({ format })}
          />
          {(['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const).map((edge) => (
            <label key={edge}>
              {
                {
                  borderTop: '上边框',
                  borderRight: '右边框',
                  borderBottom: '下边框',
                  borderLeft: '左边框',
                }[edge]
              }{' '}
              <Select
                aria-label={
                  {
                    borderTop: '上边框',
                    borderRight: '右边框',
                    borderBottom: '下边框',
                    borderLeft: '左边框',
                  }[edge]
                }
                value={currentStyle[edge] ?? 'none'}
                disabled={!canChange}
                style={{ width: 110 }}
                placeholder="边框"
                options={[
                  { value: 'none', label: '无边框' },
                  { value: 'thin', label: '细实线' },
                  { value: 'medium', label: '粗实线' },
                  { value: 'dashed', label: '虚线' },
                  { value: 'double', label: '双线' },
                ]}
                onChange={(value: NonNullable<CellStyle[typeof edge]>) =>
                  updateStyle({ [edge]: value })
                }
              />
            </label>
          ))}
          <label>
            行高{' '}
            <InputNumber
              aria-label="行高"
              value={draft.rowHeights.find((r) => r.row === point.row)?.height ?? 36}
              min={20}
              max={200}
              disabled={!canChange}
              onChange={(height) =>
                height &&
                editDraft({
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
              disabled={!canChange}
              onChange={(width) =>
                width &&
                editDraft({
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
              disabled={!canChange}
              onChange={(e) => setMergeRange(e.target.value)}
            />
            <Button disabled={!canChange} onClick={merge}>
              合并
            </Button>
            <Button
              disabled={!canChange}
              onClick={() =>
                editDraft({
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
          onPaste={paste}
          disabled={!canChange}
        />
        <span style={{ color: '#666' }}>
          方向键/Enter 选择相邻单元格。当前列 {columnName(point.col)}
          ；列宽和行高随定义保存。公式支持 + − × ÷、SUM、REF、BALANCE，金额单元格按四舍五入落到分。
        </span>
        <Modal
          getContainer={false}
          open={pasteOpen}
          title={`从 ${selected} 开始批量粘贴`}
          okText="应用粘贴"
          cancelText="取消"
          onCancel={() => setPasteOpen(false)}
          onOk={() => paste(selected, pasteText)}
          okButtonProps={{ disabled: !canChange || pasteText.length === 0 }}
          destroyOnHidden
        >
          <p>
            从 Excel
            或其他表格复制矩形区域。空格会清空对应单元格；粘贴失败时整批保留原内容。金额按元输入，文本模式保留原样。
          </p>
          <Select
            aria-label="粘贴类型"
            value={pasteMode}
            disabled={!canChange}
            style={{ width: 250, marginBottom: 12 }}
            options={[
              { value: 'auto', label: '自动识别（保留目标金额单位）' },
              { value: 'money', label: '金额（元）' },
              { value: 'number', label: '数值' },
              { value: 'text', label: '纯文本' },
            ]}
            onChange={setPasteMode}
          />
          <Input.TextArea
            aria-label="批量粘贴内容"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            disabled={!canChange}
            autoSize={{ minRows: 5, maxRows: 14 }}
          />
        </Modal>
        {printOpen && (
          <PrintSettingsEditor
            value={draft.print}
            disabled={!canChange}
            onClose={() => setPrintOpen(false)}
            onApply={(print) =>
              act(() => {
                editDraft(ReportTemplateSchema.parse({ ...historyRef.current.present, print }));
                setPrintOpen(false);
              })
            }
          />
        )}
        {wizard && (
          <FunctionWizard
            disabled={isSaving}
            onClose={() => setWizard(false)}
            onInsert={(source, unit, currency) => {
              if (saveInFlight.current) return;
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
              title="可比较左右差额，也可组合多个审核条件"
              description="条件支持比较符、AND、OR、NOT 和括号；等于/不等于按阈值判断，大小比较使用精确值。左右必须同单位、同币种。金额按分四舍五入后比较，数量/比例保留10位小数；无法计算显示错误。引用与报表使用同一期间、口径和账套快照。"
            />
            {draft.checks.map((c, index) => (
              <Space key={index} orientation="vertical" style={{ display: 'flex', marginTop: 16 }}>
                <Checkbox
                  disabled={!canChange}
                  checked={c.condition !== undefined}
                  onChange={(event) =>
                    editDraft({
                      ...draft,
                      checks: draft.checks.map((value, at) => {
                        if (at !== index) return value;
                        if (event.target.checked)
                          return {
                            ...value,
                            condition: `${value.left} = ${value.right}`,
                            left: '0',
                            right: '0',
                          };
                        const difference = { ...value };
                        delete difference.condition;
                        return difference;
                      }),
                    })
                  }
                >
                  使用条件表达式
                </Checkbox>
                {c.condition !== undefined && (
                  <label>
                    审核条件
                    <Input
                      aria-label="审核条件"
                      disabled={!canChange}
                      value={c.condition}
                      onChange={(event) =>
                        editDraft({
                          ...draft,
                          checks: draft.checks.map((value, at) =>
                            at === index ? { ...value, condition: event.target.value } : value,
                          ),
                        })
                      }
                    />
                  </label>
                )}
                {(['name', 'left', 'right', 'tolerance'] as const)
                  .filter((key) => c.condition === undefined || !['left', 'right'].includes(key))
                  .map((key) => (
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
                        disabled={!canChange}
                        value={c[key]}
                        onChange={(e) =>
                          editDraft({
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
                  disabled={!canChange}
                  danger
                  onClick={() =>
                    editDraft({ ...draft, checks: draft.checks.filter((_, i) => i !== index) })
                  }
                >
                  移除此审核项
                </Button>
              </Space>
            ))}
            <Button
              disabled={!canChange}
              style={{ marginTop: 16 }}
              onClick={() =>
                editDraft({
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
