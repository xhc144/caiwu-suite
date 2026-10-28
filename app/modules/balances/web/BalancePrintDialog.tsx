import { useState } from 'react';
import { Button, Checkbox, InputNumber, Modal, Radio, Space } from 'antd';
import { printHtml, renderPrintDocument, type PrintJob } from '@caiwu/print';
import { showError } from '@caiwu/web-kit';
import { outputRows, type Report } from '../shared';
import { buildBalancePrintJob, defaultBalancePrintOptions } from './book-print';

export default function BalancePrintDialog({
  report,
  level,
  expanded,
  onClose,
}: {
  report: Report;
  level: number;
  expanded: number[];
  onClose: () => void;
}) {
  const accounts = [
    ...new Map<number, { id: number; code: string; name: string }>(
      report.groups.flatMap((g) =>
        outputRows(g, level, expanded)
          .filter((r) => r.source)
          .map(
            (r) =>
              [
                r.source!.accountId,
                { id: r.source!.accountId, code: r.code, name: r.name },
              ] as const,
          ),
      ),
    ).values(),
  ];
  const [mode, setMode] = useState<'all' | 'selected'>('all');
  const [selected, setSelected] = useState<number[]>(accounts.map((a) => a.id));
  const [preview, setPreview] = useState<PrintJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState(defaultBalancePrintOptions);
  const valid = mode === 'all' || selected.length > 0;
  const run = async (kind: 'preview' | 'print') => {
    if (!valid) return;
    setBusy(true);
    try {
      const job = buildBalancePrintJob(
        report,
        level,
        expanded,
        mode === 'selected' ? selected : undefined,
        options,
      );
      if (kind === 'preview') setPreview(job);
      else await printHtml(job);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Modal
        title="选择打印科目"
        open
        onCancel={() => !busy && onClose()}
        width={740}
        footer={
          <Space>
            <Button disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button disabled={!valid || busy} onClick={() => void run('preview')}>
              预览所选科目
            </Button>
            <Button
              type="primary"
              disabled={!valid}
              loading={busy}
              onClick={() => void run('print')}
            >
              开始打印
            </Button>
          </Space>
        }
      >
        <p>
          按当前显示级次和展开方式打印，币种、辅助项和数量单位分别成册。期初、本期、累计和期末分栏分页，逐页重印表头，承前页和过次页只累计已列末级科目。打印数据在打开本对话框时读取。
        </p>
        <Space wrap style={{ marginBottom: 12 }}>
          <label>
            每页行数{' '}
            <InputNumber
              aria-label="余额打印每页行数"
              min={5}
              max={30}
              precision={0}
              value={options.rowsPerPage}
              onChange={(value) => setOptions({ ...options, rowsPerPage: value ?? 20 })}
            />
          </label>
          <label>
            起始页码{' '}
            <InputNumber
              aria-label="余额打印起始页码"
              min={1}
              max={999999}
              precision={0}
              value={options.startPage}
              onChange={(value) => setOptions({ ...options, startPage: value ?? 1 })}
            />
          </label>
          <label>
            水平偏移（毫米）{' '}
            <InputNumber
              aria-label="余额打印水平偏移"
              min={-8}
              max={8}
              value={options.offsetX}
              onChange={(value) => setOptions({ ...options, offsetX: value ?? 0 })}
            />
          </label>
          <label>
            垂直偏移（毫米）{' '}
            <InputNumber
              aria-label="余额打印垂直偏移"
              min={-8}
              max={8}
              value={options.offsetY}
              onChange={(value) => setOptions({ ...options, offsetY: value ?? 0 })}
            />
          </label>
        </Space>
        <Radio.Group value={mode} onChange={(e) => setMode(e.target.value as 'all' | 'selected')}>
          <Radio value="all">全部显示科目（含范围合计）</Radio>
          <Radio value="selected">指定显示科目</Radio>
        </Radio.Group>
        {mode === 'selected' && (
          <>
            <p>指定科目不另列选中合计，避免父子科目重复；如需下级科目，先关闭并展开后再打印。</p>
            <Space>
              <Button onClick={() => setSelected(accounts.map((a) => a.id))}>全选科目</Button>
              <Button onClick={() => setSelected([])}>清空选择</Button>
              <span>已选 {selected.length} 个科目</span>
            </Space>
            <div style={{ maxHeight: 340, overflow: 'auto', marginTop: 12 }}>
              <Checkbox.Group
                value={selected}
                onChange={setSelected}
                options={accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))}
              />
            </div>
            {!selected.length && <p role="alert">请至少选择一个打印科目。</p>}
          </>
        )}
      </Modal>
      <Modal
        title="余额表打印预览"
        open={!!preview}
        onCancel={() => setPreview(null)}
        width="95vw"
        footer={
          <Button
            loading={busy}
            onClick={() => {
              if (!preview) return;
              setBusy(true);
              void printHtml(preview)
                .catch(showError)
                .finally(() => setBusy(false));
            }}
          >
            打印此预览
          </Button>
        }
      >
        {preview && (
          <iframe
            title="余额表打印预览"
            srcDoc={renderPrintDocument(preview)}
            sandbox=""
            style={{ width: '100%', height: '65vh', border: 0 }}
          />
        )}
      </Modal>
    </>
  );
}
