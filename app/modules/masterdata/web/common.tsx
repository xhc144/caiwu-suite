import { App, Button, Drawer, Modal, Space, Typography, Upload } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { DimensionTypeId } from '@caiwu/core';
import { downloadBlob, DataTable, type DataColumn } from '@caiwu/ui';
import { getBusinessError, notify, queryClient, usePermission, useTab } from '@caiwu/web-kit';
import type { Confirmation, ExcelInput, ImportPreview, ImportRow, ReferenceKind } from '../shared';
import { api } from './api';

export const refresh = () => queryClient.invalidateQueries();
// Mutation errors are displayed by web-kit's global error bridge; retain the editor on failure.
export function run(work: Promise<unknown>) {
  void work.catch(() => undefined);
}
export function useConfirm() {
  const { modal } = App.useApp();
  return (message: string) =>
    new Promise<boolean>((resolve) => {
      modal.confirm({
        title: message,
        okText: '确认',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
}
export async function collectConfirmations(
  warnings: Confirmation[],
  ask: (s: string) => Promise<boolean>,
) {
  const keys: string[] = [];
  for (const w of warnings) {
    if (!(await ask(w.message))) return null;
    keys.push(w.key);
  }
  return keys;
}

/** 页内取消/刷新可保存、放弃或继续。浏览器关闭/重载由 beforeunload 保留原生保护。 */
export function useUnsaved(dirty: boolean, save: () => Promise<void>, discard?: () => void) {
  const [leave, setLeave] = useState<null | (() => void)>(null);
  const tab = useTab();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (!dirtyRef.current || !tab.active || e.altKey || e.shiftKey) return;
      const close = e.ctrlKey && e.key === 'F4';
      const reload = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r');
      if (close || reload) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setLeave(() => (close ? () => tab.close() : () => window.location.reload()));
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [tab]);
  return {
    guard: (action: () => void) => (dirty ? setLeave(() => action) : action()),
    dialog: (
      <Modal
        open={leave != null}
        title="有未保存的修改"
        onCancel={() => setLeave(null)}
        footer={
          <Space>
            <Button onClick={() => setLeave(null)}>继续编辑</Button>
            <Button
              danger
              onClick={() => {
                const next = leave;
                dirtyRef.current = false;
                discard?.();
                setLeave(null);
                next?.();
              }}
            >
              放弃修改
            </Button>
            <Button
              type="primary"
              onClick={() =>
                run(
                  save().then(() => {
                    const next = leave;
                    setLeave(null);
                    next?.();
                  }),
                )
              }
            >
              保存后继续
            </Button>
          </Space>
        }
      >
        请选择保存、放弃修改，或继续编辑。保存失败时会保留当前内容。
      </Modal>
    ),
  };
}

export function ExcelActions({
  kind,
  type,
  referenceKind,
}: {
  kind: ExcelInput['kind'];
  type?: DimensionTypeId;
  referenceKind?: ReferenceKind;
}) {
  const canImport = usePermission('masterdata.import');
  const canEdit = usePermission(
    kind === 'accounts'
      ? 'masterdata.accounts.edit'
      : kind === 'dimensions'
        ? 'masterdata.dimensions.edit'
        : 'masterdata.reference.edit',
  );
  const ask = useConfirm();
  const [input, setInput] = useState<ExcelInput | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const apply = useMutation(api.excel.commit.mutationOptions());
  const previewFile = useMutation(api.excel.preview.mutationOptions());
  const columns: DataColumn<ImportRow>[] = [
    { key: 'row', title: '原行号', dataIndex: 'row', width: 80 },
    { key: 'code', title: '编码', dataIndex: 'code', width: 130 },
    { key: 'name', title: '名称', dataIndex: 'name', width: 180 },
    { key: 'action', title: '计划', dataIndex: 'action', width: 110 },
    { key: 'error', title: '错误原因', dataIndex: 'error', width: 450 },
  ];
  const readFile = async (file: File) => {
    apply.reset();
    setInput(null);
    setPreview(null);
    if (file.size > 675_000) {
      notify.warning('单次文件不能超过675KB，请分批导入');
      return;
    }
    setBusy(true);
    try {
      const content = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const next = { kind, type, referenceKind, fileName: file.name, content };
      const result = await previewFile.mutateAsync(next);
      setInput({ ...next, previewToken: result.previewToken });
      setPreview(result);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Space>
      <Button
        onClick={() =>
          run(
            (async () => {
              const out = await queryClient.fetchQuery(
                api.excel.export.queryOptions({ kind, type, referenceKind }),
              );
              const bytes = Uint8Array.from(atob(out.content), (c) => c.charCodeAt(0));
              downloadBlob(
                new Blob([bytes], {
                  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                }),
                out.fileName,
              );
            })(),
          )
        }
      >
        导出 Excel
      </Button>
      {canImport && canEdit && (
        <Upload
          accept=".xlsx"
          showUploadList={false}
          beforeUpload={(file) => {
            run(readFile(file));
            return false;
          }}
        >
          <Button loading={busy}>导入 Excel</Button>
        </Upload>
      )}
      <Drawer
        open={preview != null}
        title="Excel 导入预览"
        size={950}
        onClose={() => {
          setPreview(null);
          setInput(null);
        }}
        footer={
          <Space>
            <Button
              onClick={() => {
                setPreview(null);
                setInput(null);
              }}
            >
              取消
            </Button>
            <Button
              type="primary"
              disabled={!preview?.valid}
              loading={apply.isPending}
              onClick={() =>
                run(
                  (async () => {
                    if (!preview || !input) return;
                    const confirmations = await collectConfirmations(
                      [
                        ...preview.confirmations,
                        {
                          key: 'import',
                          message: '确认按预览顺序导入全部档案？任一错误将整批撤销。',
                        },
                      ],
                      ask,
                    );
                    if (!confirmations) return;
                    try {
                      await apply.mutateAsync({ ...input, confirmations });
                    } catch (error) {
                      if (getBusinessError(error)?.code === 'MASTERDATA_IMPORT_STALE') {
                        setPreview(null);
                        setInput(null);
                      }
                      throw error;
                    }
                    await refresh();
                    notify.success('导入完成');
                    setPreview(null);
                    setInput(null);
                  })(),
                )
              }
            >
              确认导入
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph>
          已有编号更新原记录，保留 ID；科目与辅助档案按父级在前排序。
          所有引用和停用限制会在确认时重新检查。预览不保存档案，摘要使用次数保持原值。
          同账套的其他写入或导入预览也可能使当前预览失效，届时需重新上传确认。
        </Typography.Paragraph>
        {preview && !preview.valid && (
          <Typography.Paragraph type="danger">
            含错误行，整批不能导入。请更正后重新上传。
          </Typography.Paragraph>
        )}
        <DataTable
          tableId="masterdata.import"
          rowKey="row"
          columns={columns}
          dataSource={preview?.rows ?? []}
        />
      </Drawer>
    </Space>
  );
}
