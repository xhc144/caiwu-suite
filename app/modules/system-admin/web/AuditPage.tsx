import { Alert, Button, Checkbox, Descriptions, Form, InputNumber, Space, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useRequiredSession } from '@caiwu/web-kit';
import { PageContainer, useUrlFilters } from '@caiwu/ui';
import { AUDIT_SCOPES, SCOPE_NAMES, type AuditInput } from '../shared';
import { api } from './api';
import { saveFile } from './session';

const scopeOptions = AUDIT_SCOPES.map((value) => ({ value, label: SCOPE_NAMES[value] }));
const countNames: Record<string, string> = {
  accounts: '科目',
  opening: '期初',
  vouchers: '凭证',
  lines: '分录',
  voucherTypes: '凭证类型',
  currencies: '币种',
  exchangeRates: '汇率',
  periods: '期间',
  dimensions: '辅助档案',
  operators: '凭证关联操作员',
};
export default function AuditPage() {
  const s = useRequiredSession();
  const minYear = Math.floor(s.book.startPeriod / 100);
  const [f, setF] = useUrlFilters({ year: minYear, scopes: AUDIT_SCOPES.join(',') });
  const [previewInput, setPreviewInput] = useState<AuditInput | null>(null);
  const scopes = useMemo(
    () =>
      f.scopes
        .split(',')
        .filter((p): p is AuditInput['scopes'][number] => AUDIT_SCOPES.some((a) => a === p)),
    [f.scopes],
  );
  const preview = useQuery(
    api.audit.preview.queryOptions(previewInput ?? { year: f.year, scopes }, {
      enabled: previewInput !== null,
      staleTime: 0,
    }),
  );
  const exp = useMutation(api.audit.export.mutationOptions());
  const valid = previewInput?.year === f.year && previewInput.scopes.join(',') === scopes.join(',');
  return (
    <PageContainer title="通用审计资料" subtitle={`账套：${s.book.name}；单位：${s.book.orgName}`}>
      <Alert
        type="info"
        showIcon
        title="通用 JSON 资料，可使用文本编辑器或审计工具读取"
        description="现有官方页面因版权不提供标准全文，尚未逐字段核对 GB/T 24589.1-2024；本功能不作标准合规声明。金额为整数分，含所选年度全部状态及作废凭证。凭证资料包含来源单据、冲销关联、修订号、处理时间及关联操作员编号和姓名，不包含密码或权限。"
      />
      <Form layout="vertical" style={{ marginTop: 20 }}>
        <Form.Item label="会计年度">
          <InputNumber
            aria-label="会计年度"
            min={minYear}
            max={2100}
            value={f.year}
            onChange={(year) => {
              if (year) setF({ year });
            }}
          />
        </Form.Item>
        <Form.Item label="导出范围">
          <Checkbox.Group
            options={scopeOptions}
            value={scopes}
            onChange={(values) => setF({ scopes: values.length ? values.join(',') : 'none' })}
          />
        </Form.Item>
        <Space>
          <Button
            type="primary"
            loading={preview.isFetching}
            disabled={!scopes.length}
            onClick={() => {
              setPreviewInput({ year: f.year, scopes });
              if (valid) void preview.refetch();
            }}
          >
            预览数据数量
          </Button>
          <Button onClick={() => setPreviewInput(null)}>取消导出</Button>
        </Space>
      </Form>
      {valid && preview.data && (
        <section style={{ marginTop: 24 }}>
          <Typography.Title level={5}>
            {`导出前确认：${preview.data.book.name} · ${preview.data.year} 年`}
          </Typography.Title>
          <Descriptions
            bordered
            size="small"
            items={Object.entries(preview.data.counts).map(([key, count]) => ({
              key,
              label: countNames[key],
              children: count,
            }))}
          />
          <Typography.Paragraph
            style={{ marginTop: 12 }}
          >{`分录借方合计：${preview.data.totals.debit} 分；贷方合计：${preview.data.totals.credit} 分。包含不同状态，正式记账金额请按状态核对。`}</Typography.Paragraph>
          {!preview.data.total ? (
            <Alert type="warning" title="所选范围没有资料，请调整年度或范围" />
          ) : (
            <Button
              loading={exp.isPending}
              onClick={async () => {
                const file = await exp.mutateAsync({
                  ...previewInput!,
                  digest: preview.data!.digest,
                });
                await saveFile(file);
              }}
            >
              确认导出通用资料
            </Button>
          )}
        </section>
      )}
    </PageContainer>
  );
}
