import { useMemo, useState } from 'react';
import { Button, Modal, Slider, Space, Typography } from 'antd';
import { renderPrintDocument, type PrintJob } from '@caiwu/print';
import { assertPayrollPrintFits, printPayrollJob } from './print-job';

export default function PayrollPrintPreview({
  output,
  onClose,
}: {
  output: { job: PrintJob; pages: number };
  onClose: () => void;
}) {
  const [scale, setScale] = useState(75),
    [printing, setPrinting] = useState(false),
    [error, setError] = useState('');
  const doc = useMemo(() => renderPrintDocument(output.job), [output.job]);
  return (
    <Modal
      open
      title={`${output.job.title}预览`}
      width="95vw"
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>重选人员及期间</Button>
          <Button
            type="primary"
            loading={printing}
            disabled={!!error}
            onClick={() => {
              setPrinting(true);
              setError('');
              void printPayrollJob(output.job)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setPrinting(false));
            }}
          >
            打印预览内容
          </Button>
        </Space>
      }
    >
      <Space>
        <span>屏幕缩放 {scale}%</span>
        <Slider
          ariaLabelForHandle="打印预览缩放"
          value={scale}
          min={25}
          max={150}
          step={5}
          style={{ width: 240 }}
          onChange={setScale}
        />
        <span>
          共 {output.pages} 页，A4{output.job.orientation === 'landscape' ? '横向' : '纵向'}
        </span>
      </Space>
      {error && <Typography.Paragraph type="danger">{error}</Typography.Paragraph>}
      <div style={{ height: '65vh', overflow: 'auto', background: '#ddd', padding: 16 }}>
        <iframe
          title="工资打印预览"
          sandbox="allow-same-origin"
          srcDoc={doc}
          onLoad={(event) => {
            try {
              const document = event.currentTarget.contentDocument;
              if (document) assertPayrollPrintFits(document);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
          style={{
            border: 0,
            background: '#fff',
            width: `${(output.job.orientation === 'landscape' ? 297 : 210) * 3.78}px`,
            height: `${(output.job.orientation === 'landscape' ? 210 : 297) * 3.78 * output.pages}px`,
            transform: `scale(${scale / 100})`,
            transformOrigin: 'top left',
          }}
        />
      </div>
    </Modal>
  );
}
