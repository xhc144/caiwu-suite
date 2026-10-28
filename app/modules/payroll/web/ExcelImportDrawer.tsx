import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Drawer, Popconfirm, Select, Space, Typography } from 'antd';
import { formatMoney } from '@caiwu/core';
import { queryClient, useUnsavedChanges } from '@caiwu/web-kit';
import { DataTable } from '@caiwu/ui';
import { IMPORT_MAX_BYTES, type ImportColumn, type ImportChange } from '../shared-import';
import type { Batch } from '../shared';
import { api } from './api';

type Inspection = {
  sheets: string[];
  sheet: string;
  headers: { index: number; title: string; field: string | null }[];
  fields: { key: string; name: string; kind: string }[];
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== 'string' || !value.includes(',')) reject(new Error('读取文件失败'));
      else resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('读取文件失败，请重新选择'));
    reader.readAsDataURL(file);
  });
}
export default function ExcelImportDrawer({
  batch,
  onClose,
  onSaved,
}: {
  batch: Batch;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [editingBatch] = useState(batch);
  const [file, setFile] = useState('');
  const [fileName, setFileName] = useState('');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [columns, setColumns] = useState<ImportColumn[]>([]);
  const [sheet, setSheet] = useState<string>();
  const [plan, setPlan] = useState<{
    hash: string;
    preview: ImportChange[];
    addedPeople: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'read' | 'preview' | 'apply' | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const inspectMutation = useMutation(api.inspectImport.mutationOptions());
  const previewMutation = useMutation(api.previewImport.mutationOptions());
  const applyMutation = useMutation(api.applyImport.mutationOptions());
  const locked = phase !== null;
  const baseInput = { id: editingBatch.id, revision: editingBatch.revision, file, sheet };
  const input = { ...baseInput, columns };
  const discard = () => {
    if (inFlight.current) return;
    setFile('');
    setFileName('');
    setInspection(null);
    setColumns([]);
    setPlan(null);
    setError('');
    onClose();
  };
  useUnsavedChanges({
    title: `${batch.period} Excel 工资转入`,
    dirty: !!file,
    version: JSON.stringify({ file, sheet, columns }),
    save: async () => false,
    discard,
  });
  const begin = (value: 'read' | 'preview' | 'apply') => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPhase(value);
    setError('');
    return true;
  };
  const finish = () => {
    inFlight.current = false;
    if (mounted.current) setPhase(null);
  };
  const read = async (selectedFile: File) => {
    if (!begin('read')) return;
    setPlan(null);
    setInspection(null);
    setColumns([]);
    setFile('');
    setSheet(undefined);
    setFileName(selectedFile.name);
    try {
      if (
        !selectedFile.name.toLowerCase().endsWith('.xlsx') ||
        selectedFile.size > IMPORT_MAX_BYTES
      )
        throw new Error('请选择不超过512KB的 .xlsx 文件；旧版 .xls 请先另存为 .xlsx。');
      const encoded = await fileBase64(selectedFile);
      setFile(encoded);
      const result = await inspectMutation.mutateAsync({
        id: editingBatch.id,
        revision: editingBatch.revision,
        file: encoded,
      });
      if (!mounted.current) return;
      setFile(encoded);
      setInspection(result);
      setSheet(result.sheet);
      setColumns(result.headers.map(({ index, field }) => ({ index, field })));
    } catch (e) {
      if (mounted.current) setError(message(e));
    } finally {
      finish();
    }
  };
  const chooseSheet = async (name: string) => {
    if (!begin('read')) return;
    setPlan(null);
    try {
      const result = await inspectMutation.mutateAsync({ ...baseInput, sheet: name });
      if (!mounted.current) return;
      setInspection(result);
      setSheet(result.sheet);
      setColumns(result.headers.map(({ index, field }) => ({ index, field })));
    } catch (e) {
      if (mounted.current) setError(message(e));
    } finally {
      finish();
    }
  };
  const preview = async () => {
    if (!file || !begin('preview')) return;
    setPlan(null);
    try {
      const result = await previewMutation.mutateAsync(input);
      if (mounted.current) setPlan(result);
    } catch (e) {
      if (mounted.current) setError(message(e));
    } finally {
      finish();
    }
  };
  const apply = async () => {
    if (!plan || !begin('apply')) return;
    try {
      await applyMutation.mutateAsync({ ...input, hash: plan.hash, confirmed: true });
      void queryClient.invalidateQueries({ queryKey: api.pathKey() });
      if (mounted.current) {
        setFile('');
        onSaved();
        onClose();
      }
    } catch (e) {
      if (mounted.current) setError(`Excel 转入未完成，文件和栏目选择已保留：${message(e)}`);
    } finally {
      finish();
    }
  };
  return (
    <Drawer
      open
      size="large"
      title="Excel 工资转入"
      closable={!locked}
      keyboard={!locked}
      onClose={() => {
        if (inFlight.current) return;
        if (!file || window.confirm('Excel 工资尚未转入，确认放弃文件和栏目选择？')) discard();
      }}
    >
      <Alert
        type="info"
        title="第一行为栏目标题，每人一行；编号须已在人事档案中。空单元格保留原工资，转入后须重新计算。"
        description="可选择金额和数量录入项，计算栏目不可覆盖。新增到本批次的人员须在编辑工资中确认计税扣除信息。"
      />
      <p>
        <input
          type="file"
          accept=".xlsx"
          aria-label="Excel 工资文件"
          disabled={locked}
          onChange={(e) => {
            const selectedFile = e.target.files?.[0];
            if (selectedFile) void read(selectedFile);
            e.target.value = '';
          }}
        />
      </p>
      {fileName && <Typography.Text>文件：{fileName}</Typography.Text>}
      {batch.revision !== editingBatch.revision && (
        <Alert
          type="warning"
          title="工资批次已被其他操作修改，所选文件和映射已保留；请重新打开转入窗口核对最新工资。"
        />
      )}
      {file && !inspection && (
        <Button
          disabled={locked}
          onClick={() => {
            if (!begin('read')) return;
            void inspectMutation
              .mutateAsync({ id: editingBatch.id, revision: editingBatch.revision, file })
              .then((result) => {
                if (mounted.current) {
                  setInspection(result);
                  setSheet(result.sheet);
                  setColumns(result.headers.map(({ index, field }) => ({ index, field })));
                }
              })
              .catch((e: unknown) => {
                if (mounted.current) setError(message(e));
              })
              .finally(finish);
          }}
        >
          重新读取所选 Excel
        </Button>
      )}
      {inspection && (
        <>
          <p>
            <Select
              aria-label="Excel 工作表"
              value={sheet}
              disabled={locked}
              options={inspection.sheets.map((name) => ({ value: name, label: name }))}
              onChange={(name) => void chooseSheet(name)}
            />
          </p>
          <DataTable
            tableId="payroll.import.mapping"
            rowKey="index"
            pagination={false}
            dataSource={inspection.headers}
            columns={[
              { key: 'index', title: '列', dataIndex: 'index', width: 60 },
              { key: 'title', title: 'Excel 表头', dataIndex: 'title', width: 140 },
              {
                key: 'field',
                title: '转入栏目',
                width: 220,
                render: (_, row) => (
                  <Select
                    aria-label={`转入栏目-${row.index}`}
                    style={{ width: '100%' }}
                    disabled={locked}
                    value={columns.find((c) => c.index === row.index)?.field ?? ''}
                    options={[
                      { value: '', label: '不转入此列' },
                      { value: '$code', label: '人员编号' },
                      ...inspection.fields.map((f) => ({
                        value: f.key,
                        label: `${f.name}（${f.kind === 'quantity' ? '数量' : '金额'}）`,
                      })),
                    ]}
                    onChange={(field) => {
                      setColumns((current) =>
                        current.map((c) =>
                          c.index === row.index ? { ...c, field: field || null } : c,
                        ),
                      );
                      setPlan(null);
                    }}
                  />
                ),
              },
            ]}
          />
        </>
      )}
      <p>
        <Space>
          <Button
            disabled={locked || !file || !inspection}
            loading={phase === 'preview'}
            onClick={() => void preview()}
          >
            预览 Excel 转入
          </Button>
          {file && (
            <Popconfirm
              title="确认放弃所选 Excel 文件和栏目设置？"
              disabled={locked}
              onConfirm={discard}
            >
              <Button disabled={locked}>放弃 Excel 转入</Button>
            </Popconfirm>
          )}
        </Space>
      </p>
      {error && <Alert type="error" title={error} />}
      {plan && (
        <>
          <p>
            将修改 {plan.preview.length} 格，新增到本批次 {plan.addedPeople} 人；取消不改变工资。
          </p>
          <DataTable
            tableId="payroll.import.preview"
            rowKey={(r) => `${r.employeeId}.${r.field}`}
            dataSource={plan.preview}
            columns={[
              { key: 'code', title: '编号', dataIndex: 'code', width: 100 },
              { key: 'name', title: '姓名', dataIndex: 'name', width: 100 },
              { key: 'title', title: '栏目', dataIndex: 'title', width: 120 },
              {
                key: 'state',
                title: '人员范围',
                width: 100,
                render: (_, r) => (r.added ? '新增到本批次' : '已有人员'),
              },
              {
                key: 'before',
                title: '原值',
                width: 130,
                render: (_, r) =>
                  r.before == null
                    ? '空白'
                    : r.kind === 'money'
                      ? formatMoney(r.before as number)
                      : String(r.before),
              },
              {
                key: 'after',
                title: '转入值',
                width: 130,
                render: (_, r) =>
                  r.kind === 'money' ? formatMoney(r.after as number) : String(r.after),
              },
            ]}
          />
          <Popconfirm
            title="确认按预览转入并将工资标记为待计算？"
            disabled={locked}
            onConfirm={() => void apply()}
          >
            <Button type="primary" disabled={locked} loading={phase === 'apply'}>
              确认 Excel 转入
            </Button>
          </Popconfirm>
        </>
      )}
    </Drawer>
  );
}
