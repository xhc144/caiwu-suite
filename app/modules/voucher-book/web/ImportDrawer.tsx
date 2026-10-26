import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
} from 'antd';
import { useMutation } from '@tanstack/react-query';
import { notify, useVoucherTypes, usePermission } from '@caiwu/web-kit';
import { downloadBlob } from '@caiwu/ui';
import { TRANSFER_FIELD_LABELS, type ImportInput, type ActionResult } from '../shared';
import type { ImportPreview } from '../server/transfer';
import { api } from './api';

type ImportValues = Omit<ImportInput, 'file'>;
export function ImportDrawer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (result: ActionResult) => void;
}) {
  const [file, setFile] = useState<{
    name: string;
    contents: string;
    format: 'json' | 'xlsx';
  } | null>(null);
  const [plan, setPlan] = useState<ImportPreview | null>(null);
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const canOverwrite = usePermission('voucher-book.overwrite');
  const [form] = Form.useForm<ImportValues>();
  const types = useVoucherTypes();
  const preview = useMutation(api.importPreview.mutationOptions({ onSuccess: setPlan }));
  const commit = useMutation(
    api.importCommit.mutationOptions({
      onSuccess: (r) => {
        onSaved(r);
        setPlan(null);
        setFile(null);
        onClose();
      },
    }),
  );
  const chooseFile = async (f: File | undefined) => {
    setPlan(null);
    setOverwriteConfirmed(false);
    setFile(null);
    if (!f) return;
    if (f.size > 14_000_000) {
      notify.warning('文件过大，请拆分为14MB以内的批次');
      return;
    }
    try {
      if (f.name.toLowerCase().endsWith('.xlsx')) {
        let binary = '';
        for (const b of new Uint8Array(await f.arrayBuffer())) binary += String.fromCharCode(b);
        setFile({ name: f.name, contents: btoa(binary), format: 'xlsx' });
      } else setFile({ name: f.name, contents: await f.text(), format: 'json' });
    } catch {
      notify.warning('文件无法读取，请重新选择');
    }
  };
  const startPreview = async () => {
    if (!file) {
      notify.warning('请选择文件');
      return;
    }
    const v = await form.validateFields();
    preview.mutate({
      ...v,
      file: file.contents,
      format: file.format,
      mapping: v.mapping,
      targetDate: v.targetDate || undefined,
      to: v.to || undefined,
      voucherTypeId: v.voucherTypeId || undefined,
    });
  };
  return (
    <Drawer
      open={open}
      title="凭证导入 / 转入"
      size={900}
      onClose={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          {plan ? (
            <Button
              type="primary"
              loading={commit.isPending}
              disabled={
                plan.stopped ||
                !plan.validCount ||
                (!!plan.errorCount && !plan.onlyValid) ||
                (plan.rows.some((r) => r.replacement) && !overwriteConfirmed)
              }
              onClick={() =>
                commit.mutate({ token: plan.token, confirmed: true, overwriteConfirmed })
              }
            >
              确认导入
            </Button>
          ) : (
            <Button type="primary" loading={preview.isPending} onClick={() => void startPreview()}>
              逐凭证预览
            </Button>
          )}
        </Space>
      }
    >
      <Alert
        type="info"
        title="v1 Excel（金额为整数分）或本模块结构化文本"
        description="导入为新的手工待审核凭证，使用当前制单人。保留编码、辅助项、外币、数量、票号与业务日期；已审核、过账、作废和来源凭证不能覆盖；待审核覆盖须单独授权、预览与确认"
      />
      <Form
        disabled={preview.isPending || commit.isPending}
        name="voucher-book-import"
        form={form}
        layout="vertical"
        initialValues={{
          from: 1,
          numbering: 'auto',
          start: 1,
          mapping: {},
          onlyValid: false,
          keepDay: false,
        }}
        onValuesChange={() => {
          setPlan(null);
          setOverwriteConfirmed(false);
        }}
      >
        <Form.Item label="选择文件">
          <input
            aria-label="选择文件"
            type="file"
            disabled={preview.isPending || commit.isPending}
            accept=".xlsx,.json"
            onChange={(e) => void chooseFile(e.target.files?.[0])}
          />
          {file && <span>{file.name}</span>}
        </Form.Item>
        <Space align="start" wrap>
          <Form.Item name="from" label="凭证范围起">
            <InputNumber min={1} />
          </Form.Item>
          <Form.Item name="to" label="凭证范围止">
            <InputNumber min={1} />
          </Form.Item>
          <Form.Item name="targetDate" label="目标日期（留空保留原日期）">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="voucherTypeId" label="目标凭证类型（留空保留）">
            <Select
              allowClear
              style={{ width: 200 }}
              options={types
                .filter((t) => !t.disabled)
                .map((t) => ({ value: t.id, label: t.code }))}
            />
          </Form.Item>
        </Space>
        <Form.Item name="keepDay" valuePropName="checked">
          <Checkbox>保留原凭证日，年月取目标日期（不存在的日期阻止）</Checkbox>
        </Form.Item>
        <Space align="start">
          <Form.Item name="numbering" label="编号策略">
            <Select
              style={{ width: 200 }}
              options={[
                { value: 'auto', label: '最大号后自动编号' },
                { value: 'original', label: '保留原编号' },
                { value: 'start', label: '从指定号连续编号' },
              ]}
            />
          </Form.Item>
          <Form.Item name="start" label="起始编号">
            <InputNumber min={1} max={10000} />
          </Form.Item>
        </Space>
        <Form.Item
          name="mapping"
          label="Excel字段映射"
          tooltip="本模块导出的文件无需修改；其它表格请填写对应列的表头文字。金额列必须为整数分。"
        >
          <FieldMapping />
        </Form.Item>
        {canOverwrite && (
          <Form.Item name="overwritePending" valuePropName="checked">
            <Checkbox>允许预览覆盖同号手工待审核凭证（确认时再次核对原版本）</Checkbox>
          </Form.Item>
        )}
        <Form.Item name="onlyValid" valuePropName="checked">
          <Checkbox>若有错误，仅导入逐凭证预览中完全合法的集合</Checkbox>
        </Form.Item>
      </Form>
      {plan && (
        <>
          <Alert
            type={plan.errorCount ? 'warning' : 'success'}
            title={`合法 ${plan.validCount} 张；错误 ${plan.errorCount} 项${plan.stopped ? '，超过100项停止写入' : ''}`}
          />
          <Table
            rowKey={(r, i) => `${i}:${r.key}`}
            pagination={{ pageSize: 15 }}
            dataSource={plan.rows}
            columns={[
              { title: '凭证', dataIndex: 'label' },
              {
                title: '检查',
                render: (_, r) =>
                  r.errors.length
                    ? r.errors.join('；')
                    : r.replacement
                      ? `将覆盖 ${r.replacement.label}`
                      : '完全合法，可导入',
              },
            ]}
          />
          {plan.rows.some((r) => r.replacement) && (
            <Checkbox
              checked={overwriteConfirmed}
              onChange={(e) => setOverwriteConfirmed(e.target.checked)}
            >
              确认覆盖上述待审核凭证，原分录将被替换，版本变化后本确认失效
            </Checkbox>
          )}
          <Button
            onClick={() =>
              downloadBlob(
                new Blob([JSON.stringify(plan.rows, null, 2)], { type: 'application/json' }),
                '导入检查清单.json',
              )
            }
          >
            下载检查清单
          </Button>
          <Button onClick={() => setPlan(null)}>返回修正映射</Button>
        </>
      )}
    </Drawer>
  );
}

function FieldMapping({
  value = {},
  onChange,
}: {
  value?: Record<string, string>;
  onChange?: (value: Record<string, string>) => void;
}) {
  return (
    <details>
      <summary>查看或修正字段对应关系</summary>
      <Table
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={Object.entries(TRANSFER_FIELD_LABELS)
          .filter(([key]) => key !== 'line')
          .map(([key, label]) => ({ key, label }))}
        columns={[
          { title: '凭证字段', dataIndex: 'label' },
          {
            title: '文件中的表头文字',
            render: (_, r) => (
              <Input
                aria-label={`映射${r.label}`}
                placeholder={r.label}
                value={value[r.key] ?? ''}
                onChange={(e) => onChange?.({ ...value, [r.key]: e.target.value })}
              />
            ),
          },
        ]}
      />
    </details>
  );
}
