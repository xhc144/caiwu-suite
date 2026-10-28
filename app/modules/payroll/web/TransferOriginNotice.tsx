import { useQuery } from '@tanstack/react-query';
import { Alert } from 'antd';
import { api } from './api';
export default function TransferOriginNotice({ batchId }: { batchId: number }) {
  const origin = useQuery(api.transferOrigin.queryOptions({ id: batchId }));
  if (!origin.data) return null;
  return (
    <Alert
      type="info"
      title={`导入历史：${origin.data.source_book_name}，原批次 ${origin.data.source_batch_id}`}
      description="转入时保留来源工资快照和税额，未重新计税；后续修改以当前工资记录为准。来源凭证未转入目标账套。"
    />
  );
}
