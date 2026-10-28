import { Alert, Table } from 'antd';

/** 展示服务端签名计划中的完整编号映射，确认后原样交回服务端复核。 */
export default function DeletionImpact({
  plan,
}: {
  plan: {
    ids: number[];
    renumber: boolean;
    impacts: { id: number; oldNumber: number | null; number: number }[];
  } | null;
}) {
  if (!plan) return <Alert type="info" title="没有需要删除的成本凭证。" />;
  return (
    <>
      <Alert
        type="warning"
        showIcon
        title={`将删除 ${plan.ids.length} 张凭证`}
        description={
          plan.renumber
            ? '删除后将按以下映射重新排列凭证编号。请核对完整影响后确认。'
            : '删除后保留其他凭证编号。'
        }
      />
      {!!plan.impacts.length && (
        <Table
          rowKey="id"
          pagination={false}
          size="small"
          dataSource={plan.impacts}
          columns={[
            { title: '凭证', dataIndex: 'id' },
            { title: '原编号', dataIndex: 'oldNumber' },
            { title: '删除后编号', dataIndex: 'number' },
          ]}
        />
      )}
    </>
  );
}
