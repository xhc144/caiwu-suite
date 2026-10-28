import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  ConfigProvider,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
} from 'antd';
import { queryClient, useUnsavedChanges } from '@caiwu/web-kit';
import type { Category } from '../shared';
import {
  PrintLayoutSaveSchema,
  type PayrollPrintLayout,
  type PayrollPrintMode,
} from '../shared-print';
import { api } from './api';

export default function PrintLayoutEditor({
  category,
  mode,
  onClose,
}: {
  category: Category;
  mode: PayrollPrintMode;
  onClose: () => void;
}) {
  const query = useQuery({
    ...api.printLayouts.queryOptions({ categoryId: category.id }),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  if (query.error && !query.data)
    return (
      <Modal open title="工资打印格式" onCancel={onClose} footer={null}>
        <Alert type="error" title={query.error.message} />
      </Modal>
    );
  if (!query.data)
    return (
      <Modal open title="工资打印格式" onCancel={onClose} footer={null}>
        <Spin />
      </Modal>
    );
  return (
    <LayoutDraft
      key={`${category.id}.${mode}`}
      category={query.data.category}
      categoryRevision={query.data.categoryRevision}
      layout={query.data.layouts[mode]}
      refreshError={query.error?.message}
      readLatest={async () => {
        const result = await query.refetch({ throwOnError: true });
        if (!result.data) throw new Error('无法读取最新打印格式，请重试');
        return { category: result.data.category, layout: result.data.layouts[mode] };
      }}
      onClose={onClose}
    />
  );
}
function LayoutDraft({
  category,
  categoryRevision,
  layout,
  refreshError,
  readLatest,
  onClose,
}: {
  category: Category;
  categoryRevision: number;
  layout: PayrollPrintLayout;
  refreshError?: string;
  readLatest: () => Promise<{ category: Category; layout: PayrollPrintLayout }>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(layout),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(''),
    [working, setWorking] = useState(false);
  const [editingCategory, setEditingCategory] = useState(category);
  const [editingCategoryRevision, setEditingCategoryRevision] = useState(categoryRevision);
  const inFlight = useRef<Promise<void> | null>(null);
  const save = useMutation(api.savePrintLayout.mutationOptions());
  const options = [
    { key: 'gross', name: '应发' },
    { key: 'deductions', name: '扣款' },
    { key: 'taxAmount', name: '个税' },
    { key: 'net', name: '实发' },
    ...editingCategory.fields.filter((field) => !field.disabled),
  ];
  const change = (value: Partial<PayrollPrintLayout>) => {
    if (inFlight.current) return;
    setDraft((previous) => ({ ...previous, ...value }));
    setDirty(true);
    setError('');
  };
  const submit = () => {
    if (inFlight.current) return inFlight.current;
    const parsed = PrintLayoutSaveSchema.safeParse({
      categoryId: category.id,
      categoryRevision: editingCategoryRevision,
      layout: draft,
    });
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join('；');
      setError(message);
      return Promise.reject(new Error(message));
    }
    setWorking(true);
    const running = save
      .mutateAsync(parsed.data)
      .then(async (result) => {
        setDraft(result);
        setDirty(false);
        await queryClient.invalidateQueries({
          queryKey: api.printLayouts.queryKey({ categoryId: category.id }),
        });
      })
      .finally(() => {
        inFlight.current = null;
        setWorking(false);
      });
    inFlight.current = running;
    return running;
  };
  useUnsavedChanges({
    title: `${layout.title}打印格式`,
    dirty: dirty || working,
    version: JSON.stringify(draft),
    save: submit,
    discard: () => {
      if (inFlight.current) throw new Error('打印格式正在保存，请等待完成后再关闭');
      setDraft(layout);
      setEditingCategory(category);
      setEditingCategoryRevision(categoryRevision);
      setDirty(false);
    },
  });
  const close = () => {
    if (inFlight.current) return;
    if (!dirty) onClose();
    else
      Modal.confirm({
        title: '放弃未保存的打印格式？',
        content: '当前修改尚未保存，原打印格式仍保留。',
        okText: '放弃修改',
        cancelText: '继续编辑',
        onOk: onClose,
      });
  };
  const reload = () => {
    if (inFlight.current) return;
    const apply = () => {
      if (inFlight.current) return inFlight.current;
      setWorking(true);
      const running = readLatest()
        .then((fresh) => {
          setDraft(fresh.layout);
          setDirty(false);
          setError('');
          save.reset();
          setEditingCategory(fresh.category);
          setEditingCategoryRevision(fresh.category.revision);
        })
        .catch((error: unknown) => {
          setError(error instanceof Error ? error.message : String(error));
          throw error;
        })
        .finally(() => {
          inFlight.current = null;
          setWorking(false);
        });
      inFlight.current = running;
      return running;
    };
    if (dirty)
      Modal.confirm({
        title: '放弃当前修改并重新载入已保存格式？',
        okText: '重新载入',
        cancelText: '继续编辑',
        onOk: apply,
      });
    else
      void apply().catch((error: unknown) =>
        setError(error instanceof Error ? error.message : String(error)),
      );
  };
  const move = (index: number, offset: number) => {
    const columns = [...draft.columns],
      target = index + offset;
    if (target < 0 || target >= columns.length) return;
    [columns[index], columns[target]] = [columns[target]!, columns[index]!];
    change({ columns });
  };
  const editColumn = (index: number, value: Partial<PayrollPrintLayout['columns'][number]>) =>
    change({
      columns: draft.columns.map((column, i) => (i === index ? { ...column, ...value } : column)),
    });
  return (
    <ConfigProvider componentDisabled={working}>
      <Modal
        open
        closable={!working}
        keyboard={!working}
        maskClosable={!working}
        title={`${{ table: '工资表', slips: '工资条', summary: '工资汇总表' }[layout.mode]}独立打印格式`}
        width={920}
        onCancel={close}
        footer={
          <Space>
            <Button
              disabled={working}
              onClick={() => {
                void readLatest().catch((error: unknown) =>
                  setError(error instanceof Error ? error.message : String(error)),
                );
              }}
            >
              检查最新格式
            </Button>
            <Button disabled={working} onClick={reload}>
              重新载入已保存格式
            </Button>
            <Button disabled={working} onClick={close}>
              关闭
            </Button>
            <Button
              aria-label="保存打印格式"
              aria-busy={working}
              type="primary"
              disabled={working}
              loading={working}
              onClick={() => {
                void submit().catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : String(e)),
                );
              }}
            >
              保存打印格式
            </Button>
          </Space>
        }
      >
        <p>
          此设置只用于当前工资类别的{layout.title}，与工资表、工资条和汇总表的其它格式分别保存。
        </p>
        {(error || save.error) && <Alert type="error" title={error || save.error?.message} />}
        {refreshError && (
          <Alert type="error" title={`读取最新格式失败，当前草稿已保留：${refreshError}`} />
        )}
        {(layout.revision !== draft.revision || categoryRevision !== editingCategoryRevision) && (
          <Alert
            type="warning"
            title="已保存的格式或工资结构发生变化，当前草稿已保留；请核对后重新载入。"
          />
        )}
        <Space wrap>
          <label>
            打印标题{' '}
            <Input
              aria-label="打印标题"
              value={draft.title}
              onChange={(event) => change({ title: event.target.value })}
              style={{ width: 180 }}
            />
          </label>
          <label>
            单位名称{' '}
            <Input
              aria-label="打印单位名称"
              value={draft.unitName}
              onChange={(event) => change({ unitName: event.target.value })}
              style={{ width: 180 }}
            />
          </label>
          <Checkbox
            checked={draft.landscape}
            onChange={(event) => change({ landscape: event.target.checked })}
          >
            横向纸张
          </Checkbox>
          <label>
            字号{' '}
            <InputNumber
              aria-label="打印字号"
              value={draft.fontSize}
              min={8}
              max={14}
              onChange={(value) => change({ fontSize: value ?? 0 })}
            />
          </label>
          {layout.mode === 'slips' ? (
            <label>
              每页工资条{' '}
              <InputNumber
                aria-label="每页工资条"
                value={draft.slipsPerPage}
                min={1}
                max={6}
                onChange={(value) => change({ slipsPerPage: value ?? 0 })}
              />
            </label>
          ) : (
            <label>
              每页行数{' '}
              <InputNumber
                aria-label="每页行数"
                value={draft.rowsPerPage}
                min={1}
                max={40}
                onChange={(value) => change({ rowsPerPage: value ?? 0 })}
              />
            </label>
          )}
        </Space>
        <p>
          <Space wrap>
            {(['top', 'right', 'bottom', 'left'] as const).map((side, index) => (
              <label key={side}>
                {['上', '右', '下', '左'][index]}边距（毫米）{' '}
                <InputNumber
                  aria-label={`${['上', '右', '下', '左'][index]}边距`}
                  value={draft.margins[side]}
                  min={0}
                  max={50}
                  onChange={(value) =>
                    change({ margins: { ...draft.margins, [side]: value ?? -1 } })
                  }
                />
              </label>
            ))}
          </Space>
        </p>
        <label>
          打印栏目{' '}
          <Select
            aria-label="独立打印栏目"
            mode="multiple"
            value={draft.columns.map((column) => column.key)}
            style={{ width: '100%' }}
            options={options.map((field) => ({ value: field.key, label: field.name }))}
            onChange={(keys: string[]) =>
              change({
                columns: keys.map(
                  (key) =>
                    draft.columns.find((column) => column.key === key) ?? {
                      key,
                      widthMm: 32,
                      integerDigits: 10,
                      decimals: 2,
                    },
                ),
              })
            }
          />
        </label>
        <Table
          rowKey="key"
          pagination={false}
          size="small"
          dataSource={draft.columns}
          columns={[
            {
              title: '栏目',
              key: 'name',
              render: (_, column) =>
                options.find((field) => field.key === column.key)?.name ?? column.key,
            },
            {
              title: '宽度（毫米）',
              key: 'width',
              render: (_, column, index) => (
                <InputNumber
                  aria-label={`${column.key}打印宽度`}
                  min={12}
                  max={80}
                  value={column.widthMm}
                  onChange={(value) => editColumn(index, { widthMm: value ?? 0 })}
                />
              ),
            },
            {
              title: '整数宽',
              key: 'integer',
              render: (_, column, index) => (
                <InputNumber
                  aria-label={`${column.key}整数宽`}
                  min={1}
                  max={14}
                  value={column.integerDigits}
                  onChange={(value) => editColumn(index, { integerDigits: value ?? 0 })}
                />
              ),
            },
            {
              title: '小数位',
              key: 'decimals',
              render: (_, column, index) => (
                <InputNumber
                  aria-label={`${column.key}小数位`}
                  min={0}
                  max={6}
                  value={column.decimals}
                  onChange={(value) => editColumn(index, { decimals: value ?? -1 })}
                />
              ),
            },
            {
              title: '顺序',
              key: 'order',
              render: (_, column, index) => (
                <Space>
                  <Button
                    aria-label={`${column.key}上移`}
                    disabled={working || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    上移
                  </Button>
                  <Button
                    aria-label={`${column.key}下移`}
                    disabled={working || index === draft.columns.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    下移
                  </Button>
                </Space>
              ),
            },
          ]}
        />
        <p>
          <label>
            页脚 / 签字栏{' '}
            <Input.TextArea
              aria-label="打印页脚"
              value={draft.footer}
              maxLength={200}
              rows={2}
              onChange={(event) => change({ footer: event.target.value })}
            />
          </label>
        </p>
        <p>
          金额按元显示，小数位只影响打印，不改变保存金额。整数宽度不足时会阻止输出，避免截断数字；预览缩放只改变屏幕显示。
        </p>
      </Modal>
    </ConfigProvider>
  );
}
