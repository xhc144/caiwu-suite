import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Input,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import { PageContainer } from '@caiwu/ui';
import { usePermission } from '@caiwu/web-kit';
import { NATIVE_GAPS, NATIVE_NOTICE, type NativeReport } from '../native';
import { syntheticNative } from '../native-sample';
import { api } from './api';

export default function NativePage() {
  const canPrepare = usePermission('legacy-import.prepare');
  const [text, setText] = useState('');
  const [name, setName] = useState('明确表行.json');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'tables' | 'saveas' | 'saveas0'>('tables');
  const [report, setReport] = useState<NativeReport | null>(null);
  const current = useRef({ text, name });
  const change = (value: string, filename = name) => {
    current.current = { text: value, name: filename };
    setText(value);
    setName(filename);
    setReport(null);
    setError('');
  };
  const inspect = useMutation(
    api.nativePreflight.mutationOptions({
      onMutate: () => setReport(null),
      onSuccess: (result, input) => {
        if (input.text === current.current.text && input.name === current.current.name)
          setReport(result);
      },
    }),
  );
  const fileVersion = useRef(0);
  const readFile = async (file: File | undefined) => {
    const version = ++fileVersion.current;
    change('');
    if (!file) return;
    if (file.size > 262_144) {
      setError('文件超过 256 KiB。');
      return;
    }
    try {
      // Preserve UTF-8 bytes (including BOM); do not silently decode legacy byte formats.
      const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        await file.arrayBuffer(),
      );
      if (version === fileVersion.current) change(decoded, file.name);
    } catch {
      if (version === fileVersion.current)
        setError('文件不是有效 UTF-8 明确表行；原编码或转义未知，不能声称兼容。');
    }
  };
  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = '原生凭证结构预检.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <PageContainer title="原生凭证结构预检">
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          title={NATIVE_NOTICE}
          description="只分析已明确解码的原字段表行。不会创建导入批次、写入科目/期初/凭证或替换历史状态。标准化账务导入仍在原入口。"
        />
        <Card title="提交明确表行">
          <Typography.Paragraph>
            接受 caiwu-native-rows-v1 JSON：source 明示编码来源、金额单位（yuan 元 / fen
            分）及精度表示；tables 含原字段名 columns 与字符串或 null 的 rows。固定识别
            qingsong/dw_pz_saveas、saveas0 或同一 saveas 投影的 pz + pzdj，并须提供 pzlx
            字典。这里的格式是明确表行交换结构，不是原 SaveAs 字节格式。
          </Typography.Paragraph>
          <Space wrap>
            <Select
              aria-label="虚构示例结构"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'tables', label: '同一 saveas 的 pz/pzdj 投影' },
                { value: 'saveas', label: 'dw_pz_saveas 联表行' },
                { value: 'saveas0', label: 'dw_pz_saveas0 缺状态示例' },
              ]}
            />
            <Button
              onClick={() => {
                ++fileVersion.current;
                change(JSON.stringify(syntheticNative(mode), null, 2), `虚构-${mode}.json`);
              }}
            >
              填入虚构示例
            </Button>
            <label>
              明确表行文件{' '}
              <input
                aria-label="明确表行文件"
                type="file"
                accept=".json,.txt"
                disabled={!canPrepare}
                onChange={(e) => {
                  void readFile(e.target.files?.[0]);
                }}
              />
            </label>
          </Space>
          <Input.TextArea
            aria-label="原字段表行文本"
            rows={10}
            value={text}
            disabled={!canPrepare}
            onChange={(e) => {
              ++fileVersion.current;
              change(e.target.value);
            }}
            style={{ marginTop: 12 }}
          />
          <Typography.Paragraph type="secondary">
            来源：{name}；最多 256 KiB、合计 5000 数据行。表内数据行号从 1
            起，不是文件物理行号。所有声明列均核对，未知/缺失列阻断，报告保留输入结构和原值。
          </Typography.Paragraph>
          {error && <Alert type="error" title={error} />}
          <Button
            type="primary"
            aria-label="执行原生结构预检"
            aria-busy={inspect.isPending}
            disabled={!canPrepare || !text || !!error}
            loading={inspect.isPending}
            onClick={() => inspect.mutate({ name, text })}
          >
            执行原生结构预检
          </Button>
        </Card>
        {report && (
          <>
            <Alert
              type={report.structurePassed ? 'warning' : 'error'}
              showIcon
              title={
                report.structurePassed ? '结构检查通过；迁移仍被阻断' : '结构检查未通过；迁移被阻断'
              }
              description={report.notice}
            />
            <Card title="阻断报告" extra={<Button onClick={download}>下载完整预检报告</Button>}>
              <Descriptions
                column={1}
                items={[
                  { key: 'profile', label: '固定字段识别', children: report.profile },
                  { key: 'hash', label: '提交文本 SHA-256', children: report.source.sha256 },
                  {
                    key: 'source',
                    label: '来源及大小',
                    children: `${report.source.name}；${report.source.bytes} 字节`,
                  },
                  {
                    key: 'units',
                    label: '声明单位',
                    children: `${report.document?.source.currency ?? '未知'} / ${report.document?.source.amountUnit ?? '未知'} / ${report.document?.source.amountEncoding ?? '未知'}`,
                  },
                  {
                    key: 'textAmounts',
                    label: '收到的金额文本',
                    children: report.textAmountsPassed
                      ? '明确单位、精确落分检查通过；原 double 保真尚未核验'
                      : '单位或精度检查未通过，或因结构缺失未完成校验',
                  },
                  {
                    key: 'counts',
                    label: '结构计数',
                    children: `${report.records.length} 来源行；${report.vouchers.length} 个四键头组；${report.issueCount} 项阻断（页面最多列出 250 项）`,
                  },
                  {
                    key: 'writes',
                    label: '目标账务变化',
                    children: '0；没有可提交批次或正式写账操作',
                  },
                ]}
              />
              <Table
                rowKey={(_, i) => String(i)}
                size="small"
                dataSource={report.issues.slice(0, 250)}
                pagination={{ pageSize: 8 }}
                columns={[
                  {
                    title: '来源位置',
                    render: (_, r) =>
                      `${r.table || '全局'}${r.row == null ? '' : ` 数据行 ${r.row}`} ${r.field}`,
                  },
                  { title: '阻断原因', dataIndex: 'message' },
                ]}
              />
            </Card>
            <Collapse
              items={[
                {
                  key: 'vouchers',
                  label: '四键连接与精确金额（整数分）',
                  children: (
                    <Table
                      rowKey="key"
                      dataSource={report.vouchers}
                      size="small"
                      pagination={{ pageSize: 10 }}
                      columns={[
                        { title: '年/月/类型/编号', dataIndex: 'key' },
                        { title: '字典简称', dataIndex: 'typeName' },
                        {
                          title: '来源数据行',
                          render: (_, r) =>
                            `${r.head.table}:${r.head.row} → ${r.lines.map((l) => `${l.table}:${l.row}`).join('、')}`,
                        },
                        { title: '借方分', render: (_, r) => r.debitCents ?? '无法证明' },
                        { title: '贷方分', render: (_, r) => r.creditCents ?? '无法证明' },
                      ]}
                    />
                  ),
                },
                {
                  key: 'coverage',
                  label: '逐字段覆盖清单',
                  children: (
                    <Table
                      rowKey={(_, i) => String(i)}
                      size="small"
                      dataSource={report.coverage}
                      pagination={{ pageSize: 12 }}
                      columns={[
                        { title: '表', dataIndex: 'table' },
                        { title: '原字段', dataIndex: 'field' },
                        { title: '来源存在', render: (_, r) => (r.present ? '是' : '否') },
                        { title: '处理', dataIndex: 'handling' },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
        <Card title="物理读取与全账迁移仍缺的条件">
          {NATIVE_GAPS.map((gap) => (
            <Typography.Paragraph key={gap}>{gap}</Typography.Paragraph>
          ))}
        </Card>
      </Space>
    </PageContainer>
  );
}
