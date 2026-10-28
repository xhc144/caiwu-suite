import { Alert, Table, Typography } from 'antd';
import { formatPeriod } from '@caiwu/core';
import type { BatchNumberingStep } from '../fx-batch-shared';

/** 展示逐步计划中的所有存续凭证，包括本批前面刚生成的凭证。 */
export default function BatchNumbering({ step }: { step: BatchNumberingStep }) {
  return (
    <>
      {step.deleted && (
        <Alert
          type="warning"
          showIcon
          title={`删除 ${formatPeriod(step.deleted.period)} ${step.deleted.label}，执行时字号 ${step.deleted.displayNo}`}
          description="本步删除后的完整编号映射如下；“本批新凭证”按来源单号识别，保存后才分配凭证 ID。"
        />
      )}
      {!!step.impacts.length && (
        <Table
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={step.impacts}
          columns={[
            { title: '凭证', dataIndex: 'label' },
            { title: '期间', render: (_, r) => formatPeriod(r.period) },
            { title: '本步删除前编号', dataIndex: 'oldNumber' },
            { title: '本步删除后编号', dataIndex: 'number' },
          ]}
        />
      )}
      <Typography.Paragraph>
        随后新增 {step.created.label}，期间 {formatPeriod(step.created.period)}，编号{' '}
        {step.created.number}。
      </Typography.Paragraph>
    </>
  );
}
