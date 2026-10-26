import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import { centsToYuan, sumCents } from '@caiwu/core';
import { coreApi, usePermission, useSession } from '@caiwu/web-kit';
import { PageContainer, useUrlFilters } from '@caiwu/ui';
import {
  FIELDS,
  TABLES,
  TABLE_NAMES,
  REQUIRED_FIELDS,
  type Inspection,
  type PrepareInput,
  type SourceCounts,
  type SourceFile,
} from '../shared';
import { api } from './api';

const COUNT_NAMES: Record<keyof SourceCounts, string> = {
  accounts: '科目行数',
  opening: '期初行数',
  vouchers: '凭证张数',
  lines: '分录行数',
  balances: '余额行数',
};
export default function ImportPage() {
  const [filters, setFilters] = useUrlFilters({ id: '' });
  const book = useSession()?.book;
  const canPrepare = usePermission('legacy-import.prepare');
  const canExecute = usePermission('legacy-import.execute');
  const batches = useQuery(api.list.queryOptions());
  const selected = useQuery(api.get.queryOptions({ id: filters.id }, { enabled: !!filters.id }));
  const template = useQuery(api.template.queryOptions(undefined, { enabled: false }));
  const categories = useQuery(coreApi.accounts.categories.queryOptions());
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [mappings, setMappings] = useState<PrepareInput['mappings']>({
    accounts: {},
    opening: {},
    vouchers: {},
    balances: {},
  });
  const [expected, setExpected] = useState<Partial<SourceCounts>>({});
  const [prepared, setPrepared] = useState<{ id: string; counts: SourceCounts } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [localError, setLocalError] = useState('');
  const inspect = useMutation(
    api.inspect.mutationOptions({
      onMutate: () => {
        setPrepared(null);
        setConfirmation('');
      },
      onSuccess: (value) => {
        setInspection(value);
        setMappings(value.mappings);
        setPrepared(null);
      },
    }),
  );
  const prepare = useMutation(
    api.prepare.mutationOptions({
      onMutate: () => {
        setPrepared(null);
        setConfirmation('');
      },
      onSuccess: (value) => {
        setPrepared(value);
        setFilters({ id: value.id });
        void batches.refetch();
      },
    }),
  );
  const execute = useMutation(
    api.execute.mutationOptions({
      onSuccess: () => {
        setPrepared(null);
        setConfirmation('');
        void batches.refetch();
        void selected.refetch();
      },
    }),
  );
  const busy = inspect.isPending || prepare.isPending || execute.isPending;
  // 地址栏、前进/后退也会切换批次；历史批次不能恢复旧的提交资格。
  useEffect(() => {
    setPrepared((current) => (current?.id === filters.id ? current : null));
    setConfirmation('');
  }, [filters.id]);
  const matchesSelection =
    prepared != null &&
    prepared.id === filters.id &&
    selected.data?.id === prepared.id &&
    selected.data.status === 'prepared' &&
    !selected.isFetching &&
    !selected.isError;
  const submit = () => {
    // 提交事件再检查三方身份，不能只依赖确认卡片/按钮的显示条件。
    if (
      busy ||
      !matchesSelection ||
      !prepared ||
      selected.data?.id !== prepared.id ||
      filters.id !== prepared.id ||
      confirmation !== `导入 ${book?.name}`
    ) {
      setPrepared(null);
      setConfirmation('');
      return;
    }
    execute.mutate({ id: selected.data.id, confirmation });
  };
  const invalidate = () => {
    setInspection(null);
    setPrepared(null);
    setConfirmation('');
  };

  const readFiles = async (list: FileList | null) => {
    invalidate();
    setFiles([]);
    setLocalError('');
    if (!list) return;
    const picked = [...list];
    if (picked.length > 4 || picked.reduce((sum, f) => sum + f.size, 0) > 256 * 1024) {
      setLocalError('最多选择四个文本文件或一个 xlsx，文件合计最多 256 KiB。');
      return;
    }
    try {
      const values = await Promise.all(
        picked.map(async (f): Promise<SourceFile> => {
          const kind = /\.xlsx$/i.test(f.name)
            ? 'workbook'
            : (TABLES.find((k) => f.name.replace(/\.[^.]+$/, '') === TABLE_NAMES[k]) ?? 'accounts');
          const bytes = new Uint8Array(await f.arrayBuffer());
          let text = '';
          for (const b of bytes) text += String.fromCharCode(b);
          return { name: f.name, kind, encoding: 'utf-8', base64: btoa(text) };
        }),
      );
      setFiles(values);
    } catch {
      setLocalError('文件读取失败，请重新选择本机文件。');
    }
  };
  const download = async () => {
    const result = await template.refetch();
    if (!result.data) return;
    const bytes = Uint8Array.from(atob(result.data.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(
      new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = '标准化导入-虚构示例.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  };
  const data = selected.data;
  const report = data?.reconciliation;
  return (
    <PageContainer title="标准化账务导入" subtitle="Excel / CSV / TSV；仅向新空账导入待审核凭证">
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          title="试用限制：后续凭证编号整理仍可能改变导入原编号，编号来源保护尚待修复。请保留来源文件。"
        />
        <Alert
          type="warning"
          showIcon
          title="不支持原版 .bak / .db / .acd"
          description="请先在有合法读取条件的环境中导出并核对数据。本页不会运行原程序，也不会修改来源文件。历史审核/过账、作废、制单人、辅助核算、外币、数量、合同、附件内容等未支持字段一律阻止导入。"
        />
        <Typography.Paragraph>
          请通过账套管理另建一个 1 月启用、24
          小时内创建的空账套并登录。预检会在真实事务中演练后回滚；提交时再次核对目标及来源。
          金额使用最多两位小数的元文本，余额借正贷负；Excel
          所有单元格须为文本。余额表须与本次待审核凭证口径一致。
          模板既有但来源未列出的科目保留，核对结果单独显示数量。
        </Typography.Paragraph>
        <Typography.Text>
          当前目标：{book?.name ?? '未登录'}；科目类别：
          {categories.data?.map((c) => `${c.id}（${c.name}）`).join('、')}
        </Typography.Text>
        {canPrepare && (
          <Card
            title="1. 选择来源并检查格式"
            extra={<Button onClick={() => void download()}>下载虚构示例 Excel</Button>}
          >
            <Space orientation="vertical" style={{ width: '100%' }}>
              <input
                aria-label="来源文件"
                type="file"
                accept=".xlsx,.csv,.tsv,.txt"
                multiple
                disabled={busy}
                onChange={(e) => void readFiles(e.target.files)}
              />
              {files.map((f, index) => (
                <Space key={`${f.name}-${index}`}>
                  <Typography.Text>{f.name}</Typography.Text>
                  <Select
                    aria-label={`${f.name}表类型`}
                    value={f.kind}
                    style={{ width: 120 }}
                    disabled={busy}
                    options={[
                      { value: 'workbook', label: 'Excel 四表' },
                      ...TABLES.map((k) => ({ value: k, label: TABLE_NAMES[k] })),
                    ]}
                    onChange={(kind: SourceFile['kind']) => {
                      invalidate();
                      setFiles(files.map((v, i) => (i === index ? { ...v, kind } : v)));
                    }}
                  />
                  {f.kind !== 'workbook' && (
                    <Select
                      aria-label={`${f.name}编码`}
                      value={f.encoding}
                      disabled={busy}
                      options={[
                        { value: 'utf-8', label: 'UTF-8' },
                        { value: 'gb18030', label: 'GB18030' },
                      ]}
                      onChange={(encoding: SourceFile['encoding']) => {
                        invalidate();
                        setFiles(files.map((v, i) => (i === index ? { ...v, encoding } : v)));
                      }}
                    />
                  )}
                </Space>
              ))}
              {localError && <Alert type="error" title={localError} />}
              <Button
                disabled={!files.length || busy}
                loading={inspect.isPending}
                onClick={() => inspect.mutate({ files })}
              >
                读取与映射
              </Button>
              {inspect.error && <Alert type="error" title={inspect.error.message} />}
            </Space>
          </Card>
        )}
        {inspection && (
          <Card title="2. 核对字段映射和来源计数">
            <Space orientation="vertical" style={{ width: '100%' }}>
              {inspection.files.map((f) => (
                <Typography.Text key={f.name} code>
                  {f.name}：SHA-256 {f.sha256}（{f.bytes} 字节）
                </Typography.Text>
              ))}
              {TABLES.map((kind) => (
                <Card
                  key={kind}
                  size="small"
                  title={`${TABLE_NAMES[kind]}：${inspection.tables[kind].rows} 行`}
                >
                  <Space wrap>
                    {Object.entries(FIELDS[kind]).map(([field, label]) => (
                      <label key={field}>
                        {label}
                        {REQUIRED_FIELDS[kind].includes(field) ? ' *' : ''}：
                        <Select
                          aria-label={`${TABLE_NAMES[kind]}-${label}`}
                          allowClear
                          style={{ width: 150 }}
                          value={mappings[kind][field]}
                          disabled={busy}
                          options={inspection.tables[kind].headers.map((h) => ({
                            value: h,
                            label: h,
                          }))}
                          onChange={(value: string | undefined) => {
                            setPrepared(null);
                            setConfirmation('');
                            const next = { ...mappings[kind] };
                            if (value) next[field] = value;
                            else delete next[field];
                            setMappings({ ...mappings, [kind]: next });
                          }}
                        />
                      </label>
                    ))}
                  </Space>
                  <Table
                    size="small"
                    pagination={false}
                    scroll={{ x: 'max-content' }}
                    rowKey="index"
                    columns={inspection.tables[kind].headers.map((h, i) => ({
                      title: h,
                      dataIndex: String(i),
                      key: h,
                    }))}
                    dataSource={inspection.tables[kind].sample.map((r, i) => ({
                      index: i,
                      ...Object.fromEntries(r.map((v, c) => [String(c), v])),
                    }))}
                  />
                </Card>
              ))}
              <Typography.Text>
                请根据来源系统或导出清单独立填写总数；不要用预览行数替代核对。
              </Typography.Text>
              <Space wrap>
                {(Object.keys(COUNT_NAMES) as (keyof SourceCounts)[]).map((key) => (
                  <label key={key}>
                    {COUNT_NAMES[key]}：
                    <InputNumber
                      aria-label={COUNT_NAMES[key]}
                      min={1}
                      precision={0}
                      value={expected[key]}
                      disabled={busy}
                      onChange={(value) => {
                        setPrepared(null);
                        setConfirmation('');
                        setExpected({ ...expected, [key]: value ?? undefined });
                      }}
                    />
                  </label>
                ))}
              </Space>
              <Button
                type="primary"
                disabled={
                  busy || Object.keys(COUNT_NAMES).some((k) => !expected[k as keyof SourceCounts])
                }
                loading={prepare.isPending}
                onClick={() =>
                  prepare.mutate({ files, mappings, expected: expected as SourceCounts })
                }
              >
                全量事务预检
              </Button>
              {prepare.error && <Alert type="error" title={prepare.error.message} />}
            </Space>
          </Card>
        )}
        {prepared && data && matchesSelection && canExecute && (
          <Card title="3. 确认导入">
            <Space orientation="vertical">
              <Alert
                type="info"
                title="全量演练及回读通过，演练写入已回滚。预检 30 分钟内有效；全部凭证按来源待审核状态导入。"
              />
              <Typography.Text>待提交批次：{prepared.id}</Typography.Text>
              <Typography.Text>
                来源凭证：{data.plan.vouchers.map((v) => v.sourceId).join('、')}；借方合计：
                {centsToYuan(
                  sumCents(data.plan.vouchers.flatMap((v) => v.lines.map((l) => l.debit))),
                )}
              </Typography.Text>
              <label>
                请输入「导入 {book?.name}」
                <Input
                  aria-label="导入确认文字"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              <Button
                type="primary"
                disabled={busy || !matchesSelection || confirmation !== `导入 ${book?.name}`}
                loading={execute.isPending}
                onClick={submit}
              >
                确认导入新空账
              </Button>
              {execute.error && <Alert type="error" title={execute.error.message} />}
            </Space>
          </Card>
        )}
        <Card title="导入批次与来源核对">
          <Space wrap>
            {batches.data?.map((b) => (
              <Button
                key={b.id}
                aria-label={`查看导入批次 ${b.id}`}
                aria-pressed={filters.id === b.id}
                disabled={busy}
                onClick={() => {
                  setPrepared(null);
                  setConfirmation('');
                  setFilters({ id: b.id });
                }}
              >
                {b.status === 'completed' ? '已导入' : '已预检'} {b.createdAt}（{b.counts.vouchers}{' '}
                张）
              </Button>
            ))}
          </Space>
          {data && (
            <>
              <Descriptions
                column={1}
                items={[
                  { key: 'id', label: '批次', children: data.id },
                  {
                    key: 'status',
                    label: '状态',
                    children:
                      data.status === 'completed'
                        ? '导入完成，来源与目标核对一致'
                        : '已预检，尚未导入',
                  },
                  { key: 'hash', label: '标准化内容 SHA-256', children: data.contentHash },
                  {
                    key: 'counts',
                    label: '来源总数',
                    children: Object.entries(data.counts)
                      .map(([k, v]) => `${COUNT_NAMES[k as keyof SourceCounts]} ${v}`)
                      .join('；'),
                  },
                  ...data.files.map((f) => ({ key: f.name, label: f.name, children: f.sha256 })),
                ]}
              />
              {report && (
                <>
                  <Alert
                    type="success"
                    title={`凭证、科目、期初和余额全部核对一致；保留目标模板额外科目 ${report.templateAccounts} 个。余额包含本次待审核凭证，正式过账余额尚未变动。`}
                  />
                  <Table
                    rowKey="code"
                    size="small"
                    pagination={false}
                    dataSource={report.balances}
                    columns={[
                      { title: '科目编码', dataIndex: 'code' },
                      ...(
                        ['opening', 'debit', 'credit', 'closing', 'ytdDebit', 'ytdCredit'] as const
                      ).map((k, i) => ({
                        title: ['期初', '借方', '贷方', '期末', '累计借方', '累计贷方'][i],
                        dataIndex: k,
                        render: (v: number) => centsToYuan(v),
                      })),
                    ]}
                  />
                  {data.plan.vouchers.map((v, i) => (
                    <Typography.Paragraph key={v.sourceId}>
                      来源 {v.sourceId} → {v.type}-{v.number}，{v.lines.length} 行，目标凭证 ID{' '}
                      {report.voucherIds[i]}
                    </Typography.Paragraph>
                  ))}
                </>
              )}
            </>
          )}
        </Card>
      </Space>
    </PageContainer>
  );
}
