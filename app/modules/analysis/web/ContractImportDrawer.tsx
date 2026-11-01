import { useRef, useState } from 'react';
import { Alert, Button, Checkbox, Drawer, Input, Space, Table } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { showError } from '@caiwu/web-kit';
import { api } from './api';
import { CONTRACT_ARCHIVE_HEADERS } from '../contract-transfer';

export default function ContractImportDrawer({
  close,
  imported,
}: {
  close: () => void;
  imported: () => Promise<void>;
}) {
  const [fileBase64, setFileBase64] = useState('');
  const readVersion = useRef(0);
  const [overwrite, setOverwrite] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [fileName, setFileName] = useState('');
  const preview = useMutation(api.contracts.previewImport.mutationOptions());
  const commit = useMutation(api.contracts.importArchive.mutationOptions());
  const busy = preview.isPending || commit.isPending;
  const invalidate = () => {
    preview.reset();
    commit.reset();
    setConfirmed(false);
  };
  return (
    <Drawer
      open
      title="导入合同档案"
      size={1000}
      onClose={() => {
        if (!busy) close();
      }}
      maskClosable={!busy}
    >
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Alert
          type="info"
          title="先导出合同档案，保留表头填写后以Excel导入。金额单位为元；新合同不会带入原审核状态及凭证关联。"
          description={`列顺序：${CONTRACT_ARCHIVE_HEADERS.join('、')}。每行独立保存，错误行可修正后再次导入。`}
        />
        <Input
          type="file"
          aria-label="合同档案Excel文件"
          accept=".xlsx"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            const selectedVersion = ++readVersion.current;
            invalidate();
            setFileBase64('');
            setFileName(file?.name ?? '');
            if (!file) return;
            if (file.size > 4_000_000) {
              showError('文件不能超过4MB');
              return;
            }
            void file
              .arrayBuffer()
              .then((bytes) => {
                let binary = '';
                for (const value of new Uint8Array(bytes)) binary += String.fromCharCode(value);
                if (selectedVersion === readVersion.current) setFileBase64(btoa(binary));
              })
              .catch(showError);
          }}
        />
        <span>{fileName}</span>
        <Checkbox
          checked={overwrite}
          disabled={busy}
          onChange={(e) => {
            setOverwrite(e.target.checked);
            invalidate();
          }}
        >
          允许覆盖同合同号的未审核、未使用合同
        </Checkbox>
        <Button
          loading={preview.isPending}
          disabled={!fileBase64 || commit.isPending}
          onClick={() => {
            setConfirmed(false);
            commit.reset();
            preview.mutate({ fileBase64, overwrite });
          }}
        >
          预览导入
        </Button>
        {preview.data && (
          <>
            <Alert
              type={preview.data.invalid ? 'warning' : 'success'}
              title={`可导入 ${preview.data.valid} 条；错误 ${preview.data.invalid} 条`}
            />
            <Table
              rowKey="row"
              size="small"
              dataSource={preview.data.rows}
              columns={[
                { title: 'Excel行号', dataIndex: 'row', width: 110 },
                { title: '合同号', dataIndex: 'code' },
                { title: '处理', dataIndex: 'action', width: 90 },
                {
                  title: '错误原因',
                  dataIndex: 'error',
                  render: (v: string | null) => v ?? '可以导入',
                },
              ]}
            />
            <Checkbox
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            >
              已核对新增、覆盖和错误行，确认导入可用行
            </Checkbox>
            <Button
              type="primary"
              loading={commit.isPending}
              disabled={!confirmed || preview.data.valid === 0 || !!commit.data}
              onClick={() =>
                commit.mutate(
                  {
                    fileBase64,
                    overwrite,
                    previewHash: preview.data!.previewHash,
                    confirmed: true,
                  },
                  {
                    onSuccess: () => {
                      void imported();
                    },
                  },
                )
              }
            >
              确认导入合同
            </Button>
          </>
        )}
        {(preview.isError || commit.isError) && (
          <Alert
            type="error"
            title="导入未完成，文件仍保留"
            description="请检查提示并重新预览；已显示成功的行无需重复导入。"
          />
        )}
        {commit.data && (
          <>
            <Alert
              type={commit.data.failed ? 'warning' : 'success'}
              title={`导入完成：成功 ${commit.data.succeeded} 条；失败 ${commit.data.failed} 条`}
            />
            <Table
              rowKey="row"
              size="small"
              dataSource={commit.data.results}
              columns={[
                { title: 'Excel行号', dataIndex: 'row' },
                { title: '合同号', dataIndex: 'code' },
                { title: '结果', render: (_, r) => (r.success ? '成功' : r.error) },
              ]}
            />
          </>
        )}
      </Space>
    </Drawer>
  );
}
