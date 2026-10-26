import { Alert, Input, Modal, Select, Space, Table } from 'antd';
import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { VoucherLineInput } from '@caiwu/core';
import { pasteFields, pasteLabels, type PasteField } from '../shared';
import { api } from './api';
export default function PasteDialog({
  onCancel,
  onApply,
}: {
  onCancel: () => void;
  onApply: (lines: VoucherLineInput[]) => void;
}) {
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<(PasteField | '')[]>([...pasteFields]);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof getPreview>> | null>(null);
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const parse = useMutation(api.paste.mutationOptions());
  const columns = Math.min(
    50,
    text.split('\n').reduce((max, line) => Math.max(max, line.split('\t').length), 4),
  );
  const getPreview = () => parse.mutateAsync({ text, mapping });
  return (
    <Modal
      title="Excel 粘贴：映射与预览"
      open
      width={1000}
      onCancel={onCancel}
      okText="确认替换分录"
      okButtonProps={{
        disabled:
          !preview || preview.rows.length === 0 || preview.rows.some((r) => r.errors.length > 0),
      }}
      onOk={() => {
        if (preview) onApply(preview.lines);
      }}
    >
      <Alert
        type="info"
        title="只按编码解析科目和辅助项；确认前不会改动凭证。金额按十进制文本转为整数分，保存时继续完整校验。"
      />
      <Input.TextArea
        aria-label="Excel粘贴文本"
        rows={6}
        maxLength={500000}
        value={text}
        onChange={(e) => {
          revision.current += 1;
          setText(e.target.value);
          setPreview(null);
        }}
        placeholder="从 Excel 复制无标题行的分录，粘贴到这里"
      />
      <Space wrap style={{ marginTop: 12 }}>
        {Array.from({ length: Math.min(columns, 50) }, (_, i) => (
          <label key={i}>
            第{i + 1}列
            <Select
              aria-label={`第${i + 1}列映射`}
              style={{ width: 120 }}
              value={mapping[i] ?? ''}
              options={[
                { value: '', label: '忽略' },
                ...pasteFields.map((f) => ({ value: f, label: pasteLabels[f] })),
              ]}
              onChange={(value) => {
                revision.current += 1;
                setMapping((old) => {
                  const next = [...old];
                  next[i] = value;
                  return next;
                });
                setPreview(null);
              }}
            />
          </label>
        ))}
      </Space>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          const requestedRevision = revision.current;
          void getPreview()
            .then(
              (value) => {
                if (revision.current === requestedRevision) setPreview(value);
              },
              () => setPreview(null),
            )
            .finally(() => setBusy(false));
        }}
      >
        解析预览
      </button>
      <Table
        size="small"
        rowKey="line"
        pagination={false}
        dataSource={preview?.rows ?? []}
        columns={[
          { title: '行', dataIndex: 'line' },
          { title: '摘要', render: (_, r) => r.values.summary },
          { title: '科目编码', render: (_, r) => r.values.account },
          { title: '借方（分）', render: (_, r) => r.amounts.debit },
          { title: '贷方（分）', render: (_, r) => r.amounts.credit },
          {
            title: '逐行错误',
            render: (_, r) =>
              r.errors.join('；') ||
              r.warnings.join('；') ||
              '引用校验通过，正式保存仍走 core 校验',
          },
        ]}
      />
    </Modal>
  );
}
