import { useMemo } from 'react';
import { Alert, Table, Tooltip, Typography } from 'antd';
import type { AccountingTemplate, TemplateAccount } from '@caiwu/core';
import { summarizeChart } from '../chart-scheme';

export default function TemplatePreview({
  template,
  scheme,
}: {
  template: AccountingTemplate;
  scheme: string;
}) {
  const result = useMemo(() => {
    try {
      return { preview: summarizeChart(template, scheme), error: '' };
    } catch (error) {
      return { preview: null, error: (error as Error).message };
    }
  }, [template, scheme]);
  if (!result.preview)
    return (
      <Alert
        type="error"
        showIcon
        title={`科目级次：${result.error}`}
        description="请调整各级编码长度，保留全部明细和上下级关系后重试。"
      />
    );
  const preview = result.preview;
  return (
    <div>
      <Typography.Paragraph>
        {preview.primaryCount}项一级、{preview.detailCount}项明细，共{preview.accounts.length}项；
        {preview.leafCount}项末级科目可直接记账。
      </Typography.Paragraph>
      <details>
        <summary>查看将要建立的科目与依据</summary>
        <Table<TemplateAccount>
          size="small"
          rowKey="code"
          dataSource={[...preview.accounts].sort((a, b) => a.code.localeCompare(b.code))}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ y: 240 }}
          columns={[
            { title: '编码', dataIndex: 'code', width: 115 },
            { title: '科目名称', dataIndex: 'name', width: 175 },
            {
              title: '类别',
              key: 'category',
              width: 85,
              render: (_, account) =>
                preview.categories.find((c) => c.id === account.category)?.name,
            },
            {
              title: '余额性质',
              key: 'nature',
              width: 145,
              render: (_, account) => {
                const usual =
                  (account.direction ??
                    preview.categories.find((c) => c.id === account.category)?.direction) ===
                  'credit'
                    ? '贷方'
                    : '借方';
                return account.balanceNature === 'both'
                  ? '借贷两向'
                  : account.balanceNature === 'no-closing-balance'
                    ? `结转后无余额（通常${usual}）`
                    : `通常${usual}`;
              },
            },
            {
              title: '备抵',
              key: 'contra',
              width: 65,
              render: (_, account) => (account.isContra ? '是' : '否'),
            },
            {
              title: '依据',
              dataIndex: 'source',
              ellipsis: true,
              render: (source: string | undefined) => <Tooltip title={source}>{source}</Tooltip>,
            },
          ]}
        />
        <Typography.Paragraph type="secondary">
          余额方向用于通常余额的显示，凭证仍可在借方或贷方登记。共同类科目可以具有借方或贷方余额；“结转后无余额”指按相应制度完成结转后的结果。
        </Typography.Paragraph>
      </details>
    </div>
  );
}
