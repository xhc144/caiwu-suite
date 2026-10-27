import { Button, Modal } from 'antd';
import { useState } from 'react';
import { getBusinessError, notify } from '@caiwu/web-kit';
import { printHtml, renderPrintDocument, type PrintJob } from '@caiwu/print';

export default function OpeningPrint({
  job,
  onClose,
}: {
  job: PrintJob | null;
  onClose: () => void;
}) {
  const [printing, setPrinting] = useState(false);
  return (
    <Modal
      title="期初余额打印预览"
      open={job != null}
      width={1100}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭预览
        </Button>,
        <Button
          key="print"
          type="primary"
          loading={printing}
          onClick={() => {
            if (!job) return;
            setPrinting(true);
            void printHtml(job)
              .catch((error: unknown) => {
                notify.error(
                  getBusinessError(error)?.message ??
                    (error instanceof Error ? error.message : '打印失败，请重新预览'),
                );
              })
              .finally(() => setPrinting(false));
          }}
        >
          打印
        </Button>,
      ]}
    >
      {job && (
        <iframe
          title="期初余额打印内容"
          sandbox="allow-same-origin"
          srcDoc={renderPrintDocument(job)}
          style={{ width: '100%', height: '65vh', border: '1px solid #ddd' }}
        />
      )}
    </Modal>
  );
}
