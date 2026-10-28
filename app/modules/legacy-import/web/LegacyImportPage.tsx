import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  notify,
  queryClient,
  usePermission,
  useSubmission,
  useUnsavedChanges,
} from '@caiwu/web-kit';
import { PageContainer, useUrlFilters } from '@caiwu/ui';
import {
  IMPORT_KINDS,
  KIND_LABELS,
  type ImportBatch,
  type ImportKind,
  type ImportOptions,
  type ImportSummary,
  type PrepareInput,
} from '../shared';
import { api } from './api';

type DraftFile = {
  id: string;
  name: string;
  contentBase64: string;
  kind?: ImportKind;
  encoding: 'utf-8' | 'gb18030' | 'utf-16le' | 'utf-16be';
  mapping: string;
  valueMapping: string;
};
type ConfirmationTarget = {
  id: string;
  revision: number;
  routeId: string;
  locationKey: string;
  checked: boolean;
};
type Draft = {
  name: string;
  files: DraftFile[];
  options: ImportOptions;
  paste: string;
  pasteKind: ImportKind;
  version: number;
};
const statusLabels: Record<ImportBatch['status'], string> = {
  prepared: '待预检',
  checked: '预检通过',
  failed: '需要处理',
  completed: '已导入',
};
const kindOptions = IMPORT_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }));
const initialDraft = (): Draft => ({
  name: '原账迁移',
  files: [],
  options: { numbering: 'automatic', openingMode: 'reject-existing' },
  paste: '',
  pasteKind: 'vouchers',
  version: 0,
});
function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('无法读取文件，请重新选择'));
    reader.readAsDataURL(blob);
  });
}
function saveDownload(file: { name: string; contentBase64: string }) {
  const bytes = Uint8Array.from(atob(file.contentBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function columnMapping(text: string): Record<string, string> {
  const result = Object.create(null) as Record<string, string>;
  for (const line of text.split(/\r?\n/).filter((s) => s.trim())) {
    const index = line.indexOf('=');
    const from = line.slice(0, index).trim(),
      to = line.slice(index + 1).trim();
    if (index < 1 || !from || !to || Object.hasOwn(result, from))
      throw new Error('列名对应填写有误，请每行填写一组“原列名=模板列名”，原列名不能重复');
    result[from] = to;
  }
  return result;
}
function valueMapping(text: string): Record<string, Record<string, string>> {
  const result = Object.create(null) as Record<string, Record<string, string>>;
  for (const line of text.split(/\r?\n/).filter((s) => s.trim())) {
    const match = /^([^:：]+)[:：]([^=]+)=(.*)$/.exec(line);
    const column = match?.[1]?.trim(),
      from = match?.[2]?.trim(),
      to = match?.[3]?.trim();
    if (!column || !from || to == null)
      throw new Error('数值对应填写有误，请每行填写“列名:原值=新值”，例如“凭证字:3=记”');
    const values =
      result[column] ?? (result[column] = Object.create(null) as Record<string, string>);
    if (Object.hasOwn(values, from))
      throw new Error(`“${column}”的原值“${from}”重复，请保留一组对应`);
    values[from] = to;
  }
  return result;
}
function Summary({ summary }: { summary: ImportSummary }) {
  return (
    <Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 4 }}>
      <Descriptions.Item label="新增科目">{summary.accounts}</Descriptions.Item>
      <Descriptions.Item label="沿用科目">{summary.reusedAccounts}</Descriptions.Item>
      <Descriptions.Item label="新增辅助档案">{summary.dimensions}</Descriptions.Item>
      <Descriptions.Item label="沿用辅助档案">{summary.reusedDimensions}</Descriptions.Item>
      <Descriptions.Item label="期初记录">{summary.opening}</Descriptions.Item>
      <Descriptions.Item label="凭证张数">{summary.vouchers}</Descriptions.Item>
      <Descriptions.Item label="凭证分录">{summary.lines}</Descriptions.Item>
    </Descriptions>
  );
}

export default function LegacyImportPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const canPrepare = usePermission('legacy-import.prepare');
  const canExecute = usePermission('legacy-import.execute');
  const [filters, setFilters] = useUrlFilters({ id: '' });
  const batches = useQuery(api.list.queryOptions({}));
  const selected = useQuery({
    ...api.get.queryOptions({ id: filters.id || '00000000-0000-4000-8000-000000000000' }),
    enabled: !!filters.id,
  });
  const batch = selected.data;
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const [savedVersion, setSavedVersion] = useState(0);
  const [confirmation, setConfirmation] = useState<ConfirmationTarget | null>(null);
  const latestConfirmation = useRef(confirmation);
  latestConfirmation.current = confirmation;
  const latestSelection = useRef({
    batch,
    routeId: filters.id,
    locationKey: location.key,
    canExecute,
  });
  latestSelection.current = { batch, routeId: filters.id, locationKey: location.key, canExecute };
  useEffect(() => {
    latestConfirmation.current = null;
    setConfirmation(null);
  }, [filters.id, batch?.id, batch?.revision, location.key]);
  useEffect(() => {
    const clear = () => {
      latestConfirmation.current = null;
      setConfirmation(null);
    };
    window.addEventListener('popstate', clear);
    return () => window.removeEventListener('popstate', clear);
  }, []);
  const [localError, setLocalError] = useState('');
  const [reading, setReading] = useState(false);
  const { submit, isSubmitting } = useSubmission();
  const prepare = useMutation(api.prepare.mutationOptions());
  const preflight = useMutation(api.preflight.mutationOptions());
  const commit = useMutation(api.commit.mutationOptions());
  const edit = (change: (v: Draft) => Draft) => {
    setDraft((v) => ({ ...change(v), version: v.version + 1 }));
    setLocalError('');
  };
  const acceptBatch = (value: ImportBatch) => {
    queryClient.setQueryData(api.get.queryKey({ id: value.id }), value);
    setFilters({ id: value.id });
    void queryClient.invalidateQueries({ queryKey: api.list.queryKey() });
  };
  const addPaste = async () => {
    if (!draft.paste.trim()) return;
    const snapshot = draft;
    const contentBase64 = await base64(new Blob([snapshot.paste], { type: 'text/plain' }));
    edit((v) => ({
      ...v,
      files: [
        ...v.files,
        {
          id: crypto.randomUUID(),
          name: `粘贴-${KIND_LABELS[snapshot.pasteKind]}-${v.files.length + 1}.txt`,
          contentBase64,
          kind: snapshot.pasteKind,
          encoding: 'utf-8',
          mapping: '',
          valueMapping: '',
        },
      ],
      paste: v.paste === snapshot.paste ? '' : v.paste,
    }));
  };
  const readFiles = async (files: File[]) => {
    if (!files.length) return;
    setReading(true);
    try {
      if (files.some((f) => f.size > 8 * 1024 * 1024))
        throw new Error('单个文件不能超过 8 MB，请分批导出后重试');
      const loaded = await Promise.all(
        files.map(async (f): Promise<DraftFile> => ({
          id: crypto.randomUUID(),
          name: f.name,
          contentBase64: await base64(f),
          encoding: 'utf-8',
          mapping: '',
          valueMapping: '',
        })),
      );
      edit((v) => ({ ...v, files: [...v.files, ...loaded] }));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '无法读取文件，请重新选择');
    } finally {
      setReading(false);
    }
  };
  const saveDraft = () =>
    submit(async () => {
      const snapshot = latestDraft.current;
      let files: NonNullable<PrepareInput['files']>;
      try {
        if (snapshot.paste.trim())
          throw new Error('粘贴区还有未加入的内容，请先点击“加入待导入文件”');
        if (!snapshot.files.length) throw new Error('请先选择文件或加入粘贴数据');
        if (snapshot.files.length > 20)
          throw new Error('每批最多 20 个文件，请移除部分文件后分批导入');
        files = snapshot.files.map((f) => ({
          name: f.name,
          contentBase64: f.contentBase64,
          kind: f.kind,
          encoding: f.encoding,
          columnMap: columnMapping(f.mapping),
          valueMap: valueMapping(f.valueMapping),
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : '请检查待导入内容';
        setLocalError(message);
        notify.error(message);
        return false;
      }
      const value = await prepare.mutateAsync({
        name: snapshot.name,
        files,
        options: snapshot.options,
      });
      acceptBatch(value);
      setSavedVersion(snapshot.version);
      notify.success('迁移文件已暂存，请预检后核对结果');
      return true;
    });
  useUnsavedChanges({
    title: '原账迁移',
    dirty: draft.version !== savedVersion,
    version: draft.version,
    save: saveDraft,
    discard: () => {
      setDraft(initialDraft());
      setSavedVersion(0);
    },
  });
  const runPreflight = () =>
    submit(async () => {
      if (!batch) return;
      const value = await preflight.mutateAsync({ id: batch.id });
      acceptBatch(value);
      if (value.status === 'checked') notify.success('预检通过，请核对数量后正式导入');
    });
  const runCommit = (target: ConfirmationTarget | null) =>
    submit(async () => {
      const latest = latestConfirmation.current;
      const current = latestSelection.current;
      if (
        !target?.checked ||
        !latest?.checked ||
        latest.id !== target.id ||
        latest.revision !== target.revision ||
        latest.routeId !== target.routeId ||
        latest.locationKey !== target.locationKey ||
        !current.batch ||
        !current.canExecute ||
        target.id !== current.batch.id ||
        target.revision !== current.batch.revision ||
        target.routeId !== current.routeId ||
        target.id !== current.routeId ||
        target.locationKey !== current.locationKey ||
        new URL(window.location.href).searchParams.get('id') !== target.routeId ||
        current.batch.status !== 'checked' ||
        current.batch.issues.some((i) => i.severity === 'error')
      ) {
        setConfirmation(null);
        notify.warning('迁移批次或预检结果已变化，请重新核对后确认导入');
        return;
      }
      try {
        const value = await commit.mutateAsync({
          id: target.id,
          revision: target.revision,
          confirmed: true,
        });
        acceptBatch(value);
        setConfirmation(null);
        if (value.status === 'completed') notify.success('原账数据已导入');
      } finally {
        void queryClient.invalidateQueries({ queryKey: api.get.queryKey({ id: target.id }) });
        void queryClient.invalidateQueries({ queryKey: api.list.queryKey() });
      }
    });
  const safely = (work: Promise<unknown>) => {
    void work.catch(() => undefined);
  };
  const updateFile = (id: string, fields: Partial<DraftFile>) =>
    edit((v) => ({
      ...v,
      files: v.files.map((f) => (f.id === id ? { ...f, ...fields } : f)),
    }));
  const errors = batch?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const warnings = batch?.issues.filter((i) => i.severity === 'warning').length ?? 0;
  const busy = isSubmitting || reading;
  const confirmationCurrent =
    !!confirmation &&
    !!batch &&
    batch.status === 'checked' &&
    confirmation.id === batch.id &&
    confirmation.revision === batch.revision &&
    confirmation.routeId === filters.id &&
    confirmation.id === filters.id &&
    confirmation.locationKey === location.key;

  return (
    <PageContainer
      title="原账迁移"
      subtitle="导入科目、辅助档案、期初和凭证；先预检，再核对并导入。"
      extra={
        <Button
          onClick={() =>
            safely(queryClient.fetchQuery(api.template.queryOptions({})).then(saveDownload))
          }
        >
          下载 Excel 模板
        </Button>
      }
    >
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Collapse
          items={[
            {
              key: 'help',
              label: '原版如何导出，以及导入前的准备',
              children: (
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    在新版新建对应制度、编码级次和启用期间的账套，核对科目类别、币种与凭证字后操作。
                    原版 SQL Anywhere 的 .bak
                    是物理备份，本页不能直接读取；请提供原版导出的表格或文本。 旧版 .xls
                    请用表格软件另存为 .xlsx、CSV 或制表符文本。
                  </Typography.Paragraph>
                  <ol style={{ paddingLeft: 22, margin: 0 }}>
                    <li>
                      原版科目与各辅助档案列表：使用“数据导出”窗口的“操作 →
                      另存”；期初按末级科目及辅助明细导出，避免重复包含汇总行。
                    </li>
                    <li>
                      凭证序时簿：选择完整日期范围，使用“凭证导出”，保留每条分录的原凭证字号、日期与辅助编码。
                    </li>
                    <li>
                      原版也提供“系统管理 →
                      审计接口”：填写会计年度、选择导出文件夹后“导出”。取得的科目、期初、凭证表按本页模板列名对应；不同版本的导出布局需先核对。
                    </li>
                    <li>
                      下载模板，将四类数据分别放在“科目”“辅助档案”“期初”“凭证”工作表，或上传多个文本文件。表头不一致时填写“列名对应”。编码列保留为文本，避免丢失开头的
                      0。
                    </li>
                    <li>
                      金额均按元填写。“期初方向”留空时，期初余额、外币余额及期初数量以借方为正、贷方为负；填写借或贷时，三项都填非负数，系统按方向记账。新凭证统一为待审核，原状态与制单等信息保留在迁移来源数据中，可下载核对。
                    </li>
                  </ol>
                </Space>
              ),
            },
          ]}
        />

        {canPrepare && (
          <Card title="1. 选择迁移数据" size="small">
            <Form layout="vertical">
              <Form.Item label="本批名称">
                <Input
                  aria-label="本批名称"
                  maxLength={100}
                  value={draft.name}
                  onChange={(e) => edit((v) => ({ ...v, name: e.target.value }))}
                />
              </Form.Item>
              <Form.Item
                label="选择文件"
                extra="支持多个 .xlsx、.csv、.tsv、.txt 文件，单个文件最多 8 MB，每批最多 20 个。表格按工作表名称识别，文本请选择数据类型；带字节顺序标记的文本可自动识别编码。"
              >
                <input
                  aria-label="选择迁移文件"
                  type="file"
                  multiple
                  accept=".xlsx,.csv,.tsv,.txt"
                  disabled={busy}
                  onChange={(e) => {
                    safely(readFiles(Array.from(e.target.files ?? [])));
                    e.target.value = '';
                  }}
                />
              </Form.Item>
              {draft.files.map((f) => (
                <Card
                  key={f.id}
                  size="small"
                  style={{ marginBottom: 12 }}
                  title={f.name}
                  extra={
                    <Button
                      size="small"
                      danger
                      disabled={busy}
                      onClick={() =>
                        edit((v) => ({ ...v, files: v.files.filter((x) => x.id !== f.id) }))
                      }
                    >
                      移除
                    </Button>
                  }
                >
                  <Space wrap align="start">
                    <Form.Item label="数据类型" style={{ marginBottom: 8 }}>
                      <Select
                        aria-label={`${f.name}数据类型`}
                        style={{ width: 180 }}
                        value={f.kind ?? ''}
                        options={[{ value: '', label: '按工作表名识别' }, ...kindOptions]}
                        onChange={(value) =>
                          updateFile(f.id, { kind: value ? (value as ImportKind) : undefined })
                        }
                      />
                    </Form.Item>
                    <Form.Item label="文本编码" style={{ marginBottom: 8 }}>
                      <Select
                        aria-label={`${f.name}文本编码`}
                        style={{ width: 160 }}
                        value={f.encoding}
                        options={[
                          { value: 'utf-8', label: 'UTF-8' },
                          { value: 'gb18030', label: 'GB18030（简体中文）' },
                          { value: 'utf-16le', label: 'UTF-16 LE（Unicode 文本）' },
                          { value: 'utf-16be', label: 'UTF-16 BE' },
                        ]}
                        onChange={(encoding) => updateFile(f.id, { encoding })}
                      />
                    </Form.Item>
                  </Space>
                  <Collapse
                    size="small"
                    items={[
                      {
                        key: 'map',
                        label: '列名对应（表头与模板不同时填写）',
                        children: (
                          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                            <Input.TextArea
                              aria-label={`${f.name}列名对应`}
                              rows={3}
                              value={f.mapping}
                              placeholder={
                                '每行：原列名=模板列名，例如\n科目代码=科目编码\n客户编号=客供编码'
                              }
                              onChange={(e) => updateFile(f.id, { mapping: e.target.value })}
                            />
                            <Typography.Text type="secondary">
                              数值对应：先核对原版凭证类型等字典，再填写“列名:原值=新值”。仅转换明确填写的值，原始内容仍保留。
                            </Typography.Text>
                            <Input.TextArea
                              aria-label={`${f.name}数值对应`}
                              rows={3}
                              value={f.valueMapping}
                              placeholder={'例如\n凭证字:3=记\n余额方向:1=借'}
                              onChange={(e) => updateFile(f.id, { valueMapping: e.target.value })}
                            />
                          </Space>
                        ),
                      },
                    ]}
                  />
                </Card>
              ))}
              <Collapse
                items={[
                  {
                    key: 'paste',
                    label: '直接粘贴表格或文本',
                    children: (
                      <Space orientation="vertical" style={{ width: '100%' }}>
                        <Select
                          aria-label="粘贴数据类型"
                          style={{ width: 180 }}
                          value={draft.pasteKind}
                          options={kindOptions}
                          onChange={(pasteKind) => edit((v) => ({ ...v, pasteKind }))}
                        />
                        <Input.TextArea
                          aria-label="粘贴迁移数据"
                          rows={7}
                          value={draft.paste}
                          placeholder="第一行填写列名；可从 Excel 复制完整表格，也可粘贴 CSV 或制表符文本。"
                          onChange={(e) => edit((v) => ({ ...v, paste: e.target.value }))}
                        />
                        <Button
                          disabled={busy || !draft.paste.trim() || draft.files.length >= 20}
                          onClick={() => safely(addPaste())}
                        >
                          加入待导入文件
                        </Button>
                      </Space>
                    ),
                  },
                ]}
                style={{ marginBottom: 16 }}
              />
              <Space wrap align="start">
                <Form.Item label="凭证编号">
                  <Select
                    aria-label="凭证编号"
                    style={{ width: 240 }}
                    value={draft.options.numbering}
                    options={[
                      { value: 'automatic', label: '使用新版自动编号（保留原号对照）' },
                      { value: 'preserve', label: '保留原凭证号' },
                    ]}
                    onChange={(numbering) =>
                      edit((v) => ({ ...v, options: { ...v.options, numbering } }))
                    }
                  />
                </Form.Item>
                <Form.Item label="遇到已有期初">
                  <Select
                    aria-label="遇到已有期初"
                    style={{ width: 240 }}
                    value={draft.options.openingMode}
                    options={[
                      { value: 'reject-existing', label: '提示冲突，停止本批导入' },
                      { value: 'replace-matching', label: '覆盖同年度、科目及辅助组合' },
                    ]}
                    onChange={(openingMode) =>
                      edit((v) => ({ ...v, options: { ...v.options, openingMode } }))
                    }
                  />
                </Form.Item>
              </Space>
              {draft.options.numbering === 'preserve' && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  title="保留原号需要账套已经采用手工编号；本页不会改变全账套编号设置。"
                />
              )}
              {draft.options.openingMode === 'replace-matching' && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  title="正式导入将覆盖相同期初记录。请先备份账套，并核对预检中列出的覆盖内容。"
                />
              )}
              {localError && (
                <Alert type="error" showIcon title={localError} style={{ marginBottom: 12 }} />
              )}
              <Button
                aria-label="保存迁移文件"
                type="primary"
                loading={prepare.isPending || reading}
                disabled={busy || !draft.name.trim()}
                onClick={() => safely(saveDraft())}
              >
                保存迁移文件
              </Button>
            </Form>
          </Card>
        )}

        <Card title="迁移批次" size="small">
          <Table<ImportBatch>
            size="small"
            rowKey="id"
            loading={batches.isLoading}
            dataSource={batches.data ?? []}
            pagination={{ pageSize: 5, showSizeChanger: false }}
            scroll={{ x: 650 }}
            columns={[
              { title: '名称', dataIndex: 'name' },
              {
                title: '状态',
                render: (_, value) => (
                  <Tag
                    color={
                      value.status === 'completed'
                        ? 'success'
                        : value.status === 'failed'
                          ? 'error'
                          : 'default'
                    }
                  >
                    {statusLabels[value.status]}
                  </Tag>
                ),
              },
              {
                title: '保存时间',
                render: (_, value) => new Date(value.updatedAt).toLocaleString('zh-CN'),
              },
              {
                title: '操作',
                render: (_, value) => (
                  <Button size="small" type="link" onClick={() => setFilters({ id: value.id })}>
                    查看批次
                  </Button>
                ),
              },
            ]}
          />
        </Card>

        {filters.id && (
          <Card
            title={batch ? `2. 核对批次：${batch.name}` : '读取迁移批次'}
            size="small"
            loading={selected.isLoading}
          >
            {selected.isError && (
              <Alert
                type="error"
                title="迁移批次未能读取，请重试"
                action={<Button onClick={() => safely(selected.refetch())}>重试</Button>}
              />
            )}
            {batch && (
              <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                <Space wrap>
                  <Tag>{statusLabels[batch.status]}</Tag>
                  <Typography.Text>
                    错误 {errors} 处，提醒 {warnings} 处
                  </Typography.Text>
                </Space>
                <Summary summary={batch.summary} />
                <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                  {batch.files.map((file, index) => (
                    <Space key={`${index}-${file.name}`} wrap>
                      <Button
                        style={{ maxWidth: '100%', height: 'auto', whiteSpace: 'normal' }}
                        onClick={() =>
                          safely(
                            queryClient
                              .fetchQuery(api.originalExport.queryOptions({ id: batch.id, index }))
                              .then(saveDownload),
                          )
                        }
                      >
                        取回原文件：{file.name}
                      </Button>
                      {!file.sheets.length && (
                        <Typography.Text type="secondary">
                          尚无可预览的数据表，可取回原文件整理后重试
                        </Typography.Text>
                      )}
                    </Space>
                  ))}
                </Space>
                <Table
                  size="small"
                  pagination={false}
                  scroll={{ x: 650 }}
                  dataSource={batch.files.flatMap((file, f) =>
                    file.sheets.map((sheet, s) => ({
                      key: `${f}-${s}`,
                      file: file.name,
                      ...sheet,
                    })),
                  )}
                  columns={[
                    { title: '文件', dataIndex: 'file' },
                    { title: '工作表', dataIndex: 'name' },
                    { title: '数据类型', render: (_, value) => KIND_LABELS[value.kind] },
                    { title: '数据行数', dataIndex: 'rowCount' },
                    {
                      title: '原始列名',
                      render: (_, value) => value.headers.join('、'),
                      ellipsis: true,
                    },
                  ]}
                />
                {batch.status === 'failed' && (
                  <Alert
                    showIcon
                    type="error"
                    title="本批未导入，请处理问题后重新预检"
                    description="暂存文件仍然保留。若需修改源文件或列名对应，请在上方修正并另存一个迁移批次；期间和档案问题处理后可以直接重新预检。"
                  />
                )}
                {batch.status === 'checked' && (
                  <Alert
                    showIcon
                    type="success"
                    title="预检通过，尚未写入账务数据"
                    description="请核对本批数量、提醒与期初覆盖内容。正式导入还会复检期间、权限及数据变化；任何一项失败，本批账务写入全部回滚。"
                  />
                )}
                {batch.issues.length > 0 && (
                  <Table
                    size="small"
                    rowKey={(_, index) => String(index)}
                    dataSource={batch.issues}
                    pagination={{ pageSize: 20 }}
                    scroll={{ x: 850 }}
                    columns={[
                      {
                        title: '级别',
                        width: 70,
                        render: (_, issue) => (
                          <Tag color={issue.severity === 'error' ? 'error' : 'warning'}>
                            {issue.severity === 'error' ? '错误' : '提醒'}
                          </Tag>
                        ),
                      },
                      { title: '文件', dataIndex: 'file', width: 150 },
                      { title: '工作表', dataIndex: 'sheet', width: 100 },
                      {
                        title: '原始行号',
                        dataIndex: 'row',
                        width: 90,
                        render: (row: number) => (row > 0 ? row : '—'),
                      },
                      { title: '列', dataIndex: 'column', width: 100 },
                      { title: '原因及处理方法', dataIndex: 'message' },
                    ]}
                  />
                )}
                <Space wrap>
                  <Button
                    onClick={() =>
                      safely(
                        queryClient
                          .fetchQuery(api.sourceExport.queryOptions({ id: batch.id }))
                          .then(saveDownload),
                      )
                    }
                  >
                    下载迁移来源
                  </Button>
                  {canPrepare && batch.status !== 'completed' && (
                    <Button
                      aria-label="重新预检"
                      loading={preflight.isPending}
                      disabled={busy}
                      onClick={() => safely(runPreflight())}
                    >
                      重新预检
                    </Button>
                  )}
                  {batch.issues.length > 0 && (
                    <Button
                      onClick={() =>
                        safely(
                          queryClient
                            .fetchQuery(api.issuesExport.queryOptions({ id: batch.id }))
                            .then(saveDownload),
                        )
                      }
                    >
                      下载问题清单
                    </Button>
                  )}
                  {canExecute && batch.status === 'checked' && errors === 0 && (
                    <Button
                      type="primary"
                      disabled={busy}
                      onClick={() =>
                        setConfirmation({
                          id: batch.id,
                          revision: batch.revision,
                          routeId: filters.id,
                          locationKey: location.key,
                          checked: false,
                        })
                      }
                    >
                      正式导入
                    </Button>
                  )}
                </Space>
                {batch.receipt && (
                  <>
                    <Alert
                      showIcon
                      type="success"
                      title="本批已完整导入"
                      description={`完成时间：${new Date(batch.receipt.completedAt).toLocaleString('zh-CN')}。导入凭证为待审核，请按日常流程复核、审核和过账。`}
                    />
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={batch.receipt.vouchers}
                      pagination={{ pageSize: 20 }}
                      columns={[
                        { title: '原凭证', dataIndex: 'original' },
                        {
                          title: '新版凭证',
                          render: (_, value) => (
                            <Typography.Link
                              onClick={() => void navigate(`/m/voucher-entry/edit?id=${value.id}`)}
                            >
                              {value.displayNo}
                            </Typography.Link>
                          ),
                        },
                        {
                          title: '原始位置',
                          render: (_, value) =>
                            `${value.location.file} / ${value.location.sheet} / 第 ${value.location.row} 行`,
                        },
                      ]}
                    />
                  </>
                )}
              </Space>
            )}
          </Card>
        )}
      </Space>
      <Modal
        open={confirmationCurrent}
        title="确认导入原账数据"
        okText="确认导入"
        cancelText="返回核对"
        confirmLoading={commit.isPending}
        okButtonProps={{
          'aria-label': '确认导入',
          disabled: !confirmationCurrent || !confirmation?.checked || busy,
        }}
        onCancel={() => {
          if (!commit.isPending) setConfirmation(null);
        }}
        onOk={() => safely(runCommit(confirmation))}
      >
        {batch && (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              将把“{batch.name}”导入当前账套；同编码且内容一致的科目、辅助档案沿用，冲突时停止。
              导入凭证统一为待审核。
            </Typography.Paragraph>
            <Summary summary={batch.summary} />
            {warnings > 0 && (
              <Alert type="warning" title={`本批有 ${warnings} 处提醒，请先核对问题清单。`} />
            )}
            {batch.options.openingMode === 'replace-matching' && (
              <Alert
                type="warning"
                title="本批将覆盖相同组合的已有期初，请确认已备份并核对覆盖内容。"
              />
            )}
            <Checkbox
              checked={confirmationCurrent && confirmation?.checked}
              onChange={(e) =>
                setConfirmation((target) =>
                  target && confirmationCurrent ? { ...target, checked: e.target.checked } : null,
                )
              }
            >
              我已核对数量、提醒及原账对应关系
            </Checkbox>
          </Space>
        )}
      </Modal>
    </PageContainer>
  );
}
