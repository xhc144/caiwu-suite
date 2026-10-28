import {
  Alert,
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Steps,
  Typography,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  queryClient,
  useRequiredSession,
  useUnsavedChanges,
  useTab,
  useSubmission,
  notify,
} from '@caiwu/web-kit';
import { PageContainer } from '@caiwu/ui';
import type { ResetParameters } from '../shared';
import { api } from './api';
import { goToLogin } from './session';
import { useAdminConfirm } from './confirm';
import { useSessionLeave } from './unsaved';

const names: Record<string, string> = {
  account: '科目',
  voucher: '凭证',
  voucher_line: '分录',
  opening_balance: '期初',
  dimension_item: '辅助档案',
  currency: '币种',
  period: '期间',
  operation_log: '日志',
  app_user: '用户',
};
export default function ResetPage() {
  const session = useRequiredSession();
  const preflight = useQuery(
    api.reset.preflight.queryOptions(undefined, { enabled: session.user.isAdmin, staleTime: 0 }),
  );
  const d = preflight.data;
  return (
    <PageContainer title="系统初始化" subtitle="完整重建当前账套的业务资料，执行前自动保护备份。">
      {!session.user.isAdmin ? (
        <Alert type="warning" title="需要启用管理员身份" />
      ) : preflight.isError ? (
        <Alert type="error" title="账套资料读取失败，请刷新后重试" />
      ) : (
        d && <ResetEditor data={d} />
      )}
    </PageContainer>
  );
}
function ResetEditor({
  data: d,
}: {
  data: {
    book: {
      id: string;
      name: string;
      orgName: string;
      templateId: string;
      codeScheme: readonly number[];
      startPeriod: number;
      baseCurrency: string;
    };
    templates: { id: string; name: string; codeScheme: string }[];
    counts: Record<string, number>;
    impact: string;
    draft: ResetParameters | null;
  };
}) {
  const session = useRequiredSession();
  const [form] = Form.useForm<ResetParameters & { password: string; confirmBookName: string }>();
  const [dirty, setDirty] = useState(false);
  const revision = useRef(0);
  const [confirm, holder] = useAdminConfirm();
  const [leaveOthers, leaveHolder] = useSessionLeave();
  const tab = useTab();
  const submission = useSubmission();
  const draft = useMutation(api.reset.saveDraft.mutationOptions());
  const prepare = useMutation(api.reset.prepare.mutationOptions());
  const cancel = useMutation(api.reset.cancel.mutationOptions());
  const activePlan = useRef<string | null>(null);
  const execute = useMutation(api.reset.execute.mutationOptions());
  const busy = prepare.isPending || execute.isPending || draft.isPending || cancel.isPending;
  const cancelPreview = async () => {
    const planId = activePlan.current;
    if (!planId) return;
    // A failed/aborted cancellation may already have cancelled the server ticket.
    // Retain its cleanup handle, but never offer execution until a new preview succeeds.
    prepare.reset();
    await cancel.mutateAsync({ planId });
    if (activePlan.current === planId) {
      activePlan.current = null;
      prepare.reset();
      form.setFieldValue('confirmBookName', '');
    }
  };
  const parameters = (): ResetParameters => {
    const v = form.getFieldsValue(true);
    return {
      name: v.name,
      orgName: v.orgName,
      templateId: v.templateId,
      codeScheme: v.codeScheme,
      startYear: v.startYear,
      startMonth: v.startMonth,
      numbering: v.numbering,
    };
  };
  const saveDraft = () =>
    submission.submit(async () => {
      if (busy) return false;
      const version = revision.current;
      await form.validateFields([
        'name',
        'orgName',
        'templateId',
        'codeScheme',
        'startYear',
        'startMonth',
        'numbering',
      ]);
      await cancelPreview();
      await draft.mutateAsync(parameters());
      if (version !== revision.current) return false;
      form.setFieldsValue({ password: '', confirmBookName: '' });
      setDirty(false);
      prepare.reset();
      return true;
    });
  useUnsavedChanges({
    title: '系统初始化参数',
    dirty: dirty || activePlan.current !== null,
    version: revision.current,
    save: saveDraft,
    discard: async () => {
      await cancelPreview();
      form.resetFields();
      setDirty(false);
      prepare.reset();
    },
  });
  const preview = () =>
    submission.submit(async () => {
      if (busy) return;
      const v = await form.validateFields([
        'name',
        'orgName',
        'templateId',
        'codeScheme',
        'startYear',
        'startMonth',
        'numbering',
        'password',
      ]);
      if (!(await leaveOthers(tab.key))) return;
      await cancelPreview();
      const plan = await prepare.mutateAsync({
        parameters: parameters(),
        password: v.password ?? '',
      });
      activePlan.current = plan.planId;
    });
  const initialize = () =>
    submission.submit(async () => {
      if (busy || !prepare.data) return;
      const v = await form.validateFields(['confirmBookName', 'password']);
      if (
        !(await confirm({
          title: '再次确认完整重新初始化',
          content: d.impact,
          confirmText: '重新初始化',
        }))
      )
        return;
      if (!(await leaveOthers(tab.key))) return;
      const result = await execute.mutateAsync({
        planId: prepare.data.planId,
        confirmBookName: v.confirmBookName,
        password: v.password ?? '',
        confirmed: true,
        confirmation: '重新初始化',
      });
      activePlan.current = null;
      flushSync(() => {
        setDirty(false);
        prepare.reset();
      });
      if (result.cleanupPending)
        notify.warning('初始化已完成，受管暂存清理待处理；请保留保护备份并联系管理员核对存储');
      await queryClient.cancelQueries();
      await goToLogin(session.bookId);
    });
  return (
    <>
      {holder}
      {leaveHolder}
      <Alert
        type="warning"
        showIcon
        title="初始化会清除当前账套全部业务数据"
        description={d.impact}
      />
      <Descriptions
        style={{ margin: '16px 0' }}
        bordered
        size="small"
        items={[
          { key: 'book', label: '当前账套', children: d.book.name },
          {
            key: 'currency',
            label: '本位币',
            children: d.book.baseCurrency === 'CNY' ? '人民币' : d.book.baseCurrency,
          },
          ...Object.entries(d.counts).map(([key, count]) => ({
            key,
            label: names[key],
            children: count,
          })),
        ]}
      />
      <Steps
        style={{ marginBottom: 24 }}
        current={prepare.data ? 1 : 0}
        items={[
          { title: '填写并预览参数' },
          { title: '核对影响并再次确认' },
          { title: '备份、初始化、重新登录' },
        ]}
      />
      <Typography.Paragraph>
        保存参数仅保留填写内容，不保存口令，也不执行初始化。会计年度按 1–12
        月，现金流量科目按所选制度设置。
      </Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        style={{ maxWidth: 680 }}
        disabled={busy || submission.isSubmitting}
        initialValues={
          d.draft ?? {
            name: d.book.name,
            orgName: d.book.orgName,
            templateId: d.book.templateId,
            codeScheme: d.book.codeScheme.join('-'),
            startYear: Math.trunc(d.book.startPeriod / 100),
            startMonth: d.book.startPeriod % 100,
            numbering: 'automatic',
          }
        }
        onValuesChange={(changed) => {
          revision.current++;
          setDirty(true);
          if (Object.keys(changed).some((key) => key !== 'confirmBookName' && key !== 'password')) {
            prepare.reset();
            void cancelPreview().catch(() => {
              /* 全局显示清理失败；保留计划以供重试。 */
            });
          }
        }}
      >
        <Form.Item
          name="name"
          label="初始化后的账套名称"
          rules={[{ required: true, whitespace: true, message: '请输入账套名称' }]}
        >
          <Input maxLength={60} />
        </Form.Item>
        <Form.Item
          name="orgName"
          label="单位名称"
          rules={[{ required: true, whitespace: true, message: '请输入单位名称' }]}
        >
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item
          name="templateId"
          label="会计制度"
          rules={[{ required: true, message: '请选择会计制度' }]}
        >
          <Select
            options={d.templates.map((t) => ({ value: t.id, label: t.name }))}
            onChange={(id) =>
              form.setFieldValue('codeScheme', d.templates.find((t) => t.id === id)?.codeScheme)
            }
          />
        </Form.Item>
        <Form.Item
          name="codeScheme"
          label="科目级次"
          rules={[{ required: true, message: '请填写科目级次，例如 4-2-2' }]}
        >
          <Input placeholder="例如 4-2-2" maxLength={40} />
        </Form.Item>
        <Space>
          <Form.Item name="startYear" label="开账年度" rules={[{ required: true }]}>
            <InputNumber min={2000} max={2100} precision={0} />
          </Form.Item>
          <Form.Item name="startMonth" label="启用月份" rules={[{ required: true }]}>
            <InputNumber min={1} max={12} precision={0} />
          </Form.Item>
        </Space>
        {activePlan.current && (
          <Button
            aria-label="取消初始化预览"
            style={{ marginLeft: 8 }}
            onClick={() => void cancelPreview().catch(() => undefined)}
            loading={cancel.isPending}
          >
            取消初始化预览
          </Button>
        )}
        {cancel.isError && (
          <Alert
            style={{ marginTop: 12 }}
            type="error"
            title="初始化暂存未能清理，请重试取消；原账套及保护副本保留"
          />
        )}
        <Form.Item name="numbering" label="凭证编号方式">
          <Select
            options={[
              { value: 'automatic', label: '自动编号' },
              { value: 'manual', label: '手工编号' },
            ]}
          />
        </Form.Item>
        <Form.Item name="password" label="当前管理员密码">
          <Input.Password autoComplete="current-password" maxLength={64} />
        </Form.Item>
        <Space wrap>
          <Button onClick={() => void saveDraft()} loading={draft.isPending}>
            保存参数
          </Button>
          <Button type="primary" onClick={() => void preview()} loading={prepare.isPending}>
            预览初始化内容
          </Button>
        </Space>
        {prepare.data && (
          <div style={{ marginTop: 20 }}>
            <Alert
              type="warning"
              title={`即将初始化「${prepare.data.bookName}」`}
              description={`保留 ${prepare.data.retainedUsers} 个用户及 ${prepare.data.retainedLogs} 条历史日志；确认有效期五分钟。任何账套资料变化都需重新预览。`}
            />
            <Form.Item
              style={{ marginTop: 16 }}
              name="confirmBookName"
              label="输入当前账套完整名称确认"
              rules={[
                { required: true, message: '请输入当前账套完整名称' },
                {
                  validator: (_, value) =>
                    value === d.book.name
                      ? Promise.resolve()
                      : Promise.reject(new Error('请准确输入当前账套名称')),
                },
              ]}
            >
              <Input autoComplete="off" maxLength={60} />
            </Form.Item>
            <Button
              danger
              type="primary"
              onClick={() => void initialize()}
              loading={execute.isPending}
            >
              执行完整重新初始化
            </Button>
          </div>
        )}
      </Form>
    </>
  );
}
