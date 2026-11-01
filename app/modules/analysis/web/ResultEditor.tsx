import { useRef, useState } from 'react';
import { Alert, App, Button, Checkbox, Input, Modal, Space, Table } from 'antd';
import { useMutation } from '@tanstack/react-query';
import {
  queryClient,
  showError,
  useHotkey,
  usePermission,
  useSubmission,
  useUnsavedChanges,
} from '@caiwu/web-kit';
import { UNIT_NAMES, AnalysisSheetSchema, type AnalysisSheet } from '../custom';
import { z } from 'zod';
import { api } from './api';
import {
  applyResultValues,
  formatAnalysisValue,
  parseAnalysisValue,
  resultChartData,
} from '../result-values';
import AnalysisChart from './AnalysisChart';
import { downloadWorkbook, printTable } from './common';
import { useLocalDraft } from './local-draft';

export type ResultDraft = { id?: number; revision: number; name: string; sheet: AnalysisSheet };
export default function ResultEditor({
  initial,
  onClose,
}: {
  initial: ResultDraft;
  onClose: () => void;
}) {
  const { modal } = App.useApp();
  const canEdit = usePermission('analysis.definition.edit');
  const canExport = usePermission('analysis.export');
  const chartHost = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [values, setValues] = useState(() =>
    initial.sheet.rows.map((r) =>
      r.values.map((v) => (v === null ? null : formatAnalysisValue(v, r.decimalPlaces))),
    ),
  );
  const [showOriginal, setShowOriginal] = useState(false);
  const [error, setError] = useState('');
  const { submit, isSubmitting } = useSubmission();
  const mutation = useMutation(api.results.save.mutationOptions({ meta: { silent: true } }));
  const exportMutation = useMutation(api.results.export.mutationOptions());
  const baseline = JSON.stringify({
    name: saved.name,
    values: saved.sheet.rows.map((r) =>
      r.values.map((v) => (v === null ? null : formatAnalysisValue(v, r.decimalPlaces))),
    ),
  });
  const version = JSON.stringify({ name, values });
  const dirty = version !== baseline;
  const chartData = resultChartData(saved.sheet, values);
  const recovery = useLocalDraft({
    kind: 'result',
    identity: String(saved.id ?? JSON.stringify(saved.sheet.source)),
    baseVersion: `${saved.revision}:${saved.sheet.sourceHash}`,
    value: { name, values, sheet: saved.sheet },
    dirty,
    busy: isSubmitting,
    parse: (v) => {
      const parsed = z
        .object({
          name: z.string().max(100),
          values: z.array(z.array(z.string().max(100).nullable()).max(36)).max(2000),
          sheet: AnalysisSheetSchema,
        })
        .safeParse(v);
      if (!parsed.success) return;
      return parsed.data;
    },
    restore: (v) => {
      setName(v.name);
      setValues(v.values);
    },
  });
  const latest = useRef(version);
  latest.current = version;
  useHotkey('Ctrl+P', () => {
    if (isSubmitting || recovery.blocked) return;
    const choice = chartHost.current?.querySelector<HTMLInputElement>('[aria-label="图形"]');
    choice?.scrollIntoView({ block: 'center' });
    choice?.focus();
  });
  function editedSheet(): AnalysisSheet {
    return applyResultValues(
      saved.sheet,
      saved.sheet.rows.map((r, i) =>
        values[i]!.map((value, j) => {
          if (value === null) return null;
          const amount = parseAnalysisValue(value, r.decimalPlaces);
          if (amount === null)
            throw new Error(
              `${r.name} ${saved.sheet.periods[j]}：请输入最多${r.decimalPlaces ?? 2}位小数的有效数值`,
            );
          return amount;
        }),
      ),
    );
  }
  let preview: AnalysisSheet | undefined;
  try {
    preview = editedSheet();
  } catch {
    /* 不完整输入留在单元格，保存时给出明确位置。 */
  }
  const save = (saveAs = false) =>
    submit(async () => {
      if (!canEdit || recovery.blocked) return false;
      const snapshotVersion = version;
      try {
        const response = await mutation.mutateAsync({
          id: saved.id,
          saveAs,
          expectedRevision: saved.revision,
          name: saveAs && name === saved.name ? `${name}副本`.slice(0, 100) : name,
          sheet: editedSheet(),
        });
        recovery.clear();
        setSaved(response);
        // 保存期间输入会禁用，仍检查版本，避免将新输入误标成已保存。
        if (latest.current === snapshotVersion) {
          setName(response.name);
          setValues(
            response.sheet.rows.map((r) =>
              r.values.map((v) => (v === null ? null : formatAnalysisValue(v, r.decimalPlaces))),
            ),
          );
        }
        setError('');
        void queryClient.invalidateQueries({ queryKey: api.results.list.queryKey() });
        return latest.current === snapshotVersion;
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败，请检查后重试；输入仍保留');
        showError(e);
        return false;
      }
    });
  useUnsavedChanges({
    title: `分析结果：${name || '未命名'}`,
    dirty,
    version,
    save: () => save(),
    discard: () => {
      recovery.clear();
      setName(saved.name);
      setValues(
        saved.sheet.rows.map((r) =>
          r.values.map((v) => (v === null ? null : formatAnalysisValue(v, r.decimalPlaces))),
        ),
      );
    },
  });
  useHotkey(
    'Ctrl+S',
    () => {
      void save();
    },
    { enabled: canEdit },
  );
  const close = () => {
    if (isSubmitting) return;
    if (!dirty) return onClose();
    const dialog = modal.confirm({
      title: '分析结果尚未保存',
      content: '保存后关闭，或放弃本次修改。保存失败会保留当前输入。',
      okText: '保存后关闭',
      cancelText: '继续编辑',
      onOk: async () => {
        if (await save()) onClose();
        else throw new Error('保存未完成');
      },
      footer: (_, { OkBtn, CancelBtn }) => (
        <>
          <Button
            onClick={() => {
              dialog.destroy();
              recovery.clear();
              onClose();
            }}
          >
            放弃修改
          </Button>
          <CancelBtn />
          <OkBtn />
        </>
      ),
    });
  };
  const exportSheet = async () => {
    const response = await exportMutation.mutateAsync({ name, sheet: editedSheet() });
    downloadWorkbook(response.base64, name);
  };
  const print = async () => {
    await queryClient.fetchQuery({ ...api.printAllowed.queryOptions('trend'), staleTime: 0 });
    const sheet = editedSheet();
    await printTable(
      name,
      `${sheet.note}；取数时间 ${sheet.generatedAt}`,
      ['项目', '单位', ...sheet.periods.map(String)],
      sheet.rows.map((r) => [
        r.name,
        UNIT_NAMES[r.unit],
        ...r.values.map((v) =>
          v === null ? '早于启用期间' : formatAnalysisValue(v, r.decimalPlaces),
        ),
      ]),
    );
  };
  return (
    <Modal
      open
      title="分析结果编辑与保存"
      width="95vw"
      onCancel={close}
      maskClosable={false}
      footer={
        <Space wrap>
          <Button disabled={isSubmitting} onClick={close}>
            关闭结果
          </Button>
          {canExport && (
            <>
              <Button
                loading={exportMutation.isPending}
                onClick={() => void exportSheet().catch(showError)}
              >
                导出当前稿 Excel
              </Button>
              <Button onClick={() => void print().catch(showError)}>打印当前稿</Button>
            </>
          )}
          {canEdit && (
            <>
              {saved.id && (
                <Button
                  disabled={recovery.blocked}
                  loading={isSubmitting}
                  onClick={() => void save(true)}
                >
                  另存分析结果
                </Button>
              )}
              <Button
                type="primary"
                disabled={recovery.blocked}
                loading={isSubmitting}
                onClick={() => void save()}
              >
                保存分析结果
              </Button>
            </>
          )}
        </Space>
      }
    >
      <Space wrap>
        <label htmlFor="result-name">结果名称</label>
        <Input
          id="result-name"
          aria-label="结果名称"
          value={name}
          disabled={!canEdit || isSubmitting || recovery.blocked}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          style={{ width: 320 }}
        />
        <span>
          {saved.id ? `已保存版本 ${saved.revision}` : '尚未保存'}；
          {dirty ? '有未保存修改' : '当前内容无修改'}
        </span>
        <Checkbox checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)}>
          显示取数原值
        </Checkbox>
      </Space>
      {recovery.notice}
      <Alert
        type="info"
        showIcon
        title={saved.sheet.title}
        description={`${saved.sheet.note} 手工调整以所在列单位输入；累计、月均、比例随单元格修改自动重算。`}
      />
      {error && <Alert type="error" title="保存未完成，当前输入仍保留" description={error} />}
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        scroll={{ x: 'max-content', y: 420 }}
        dataSource={(preview ?? saved.sheet).rows.map((r, index) => ({ ...r, index }))}
        columns={[
          { title: '项目编号', dataIndex: 'key', width: 90, fixed: 'left' },
          {
            title: '项目',
            dataIndex: 'name',
            width: 180,
            fixed: 'left',
            render: (v, r) => (r.subtotal ? <strong>{v}</strong> : v),
          },
          { title: '单位', width: 70, render: (_, r) => UNIT_NAMES[r.unit] },
          ...saved.sheet.periods.map((p, j) => ({
            title: String(p),
            key: String(p),
            width: 165,
            render: (_: unknown, r: AnalysisSheet['rows'][number] & { index: number }) =>
              values[r.index]![j] === null ? (
                '早于启用期间'
              ) : (
                <>
                  <Input
                    aria-label={`${r.key}-${p}`}
                    value={values[r.index]![j] ?? ''}
                    disabled={!canEdit || isSubmitting || recovery.blocked}
                    onChange={(e) =>
                      setValues((current) =>
                        current.map((row, i) =>
                          i === r.index ? row.map((v, k) => (k === j ? e.target.value : v)) : row,
                        ),
                      )
                    }
                  />
                  {showOriginal && (
                    <small>原值：{formatAnalysisValue(r.originalValues[j], r.decimalPlaces)}</small>
                  )}
                </>
              ),
          })),
          {
            title: saved.sheet.source.kind === 'custom' ? '末期数' : '累计 / 末月余额',
            width: 150,
            render: (_, r) => formatAnalysisValue(r.total, r.decimalPlaces),
          },
          {
            title: '月均',
            width: 120,
            render: (_, r) => formatAnalysisValue(r.average, r.decimalPlaces),
          },
          ...(saved.sheet.source.kind === 'trend'
            ? [
                {
                  title: '占比',
                  width: 130,
                  render: (_: unknown, r: AnalysisSheet['rows'][number]) =>
                    r.ratio === null ? '无法计算：基数为零' : `${r.ratio}%`,
                },
              ]
            : []),
        ]}
      />
      <div ref={chartHost}>
        <AnalysisChart
          title={`${name} 图形分析`}
          description={`${saved.sheet.note}；取数时间 ${saved.sheet.generatedAt}`}
          labels={chartData.labels}
          values={chartData.values}
        />
      </div>
      <p>
        图形显示第一个金额项目的有效期间，启用前及未完成输入不绘制；完整数据及取数原值可导出。当前稿导出、打印只使用当前各月单元格。
      </p>
    </Modal>
  );
}
