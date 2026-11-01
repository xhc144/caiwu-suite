import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Steps,
  Typography,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createTRPCClient, httpLink } from '@trpc/client';
import type { CoreShell } from '@caiwu/server-kit';
import { coreApi, appToken, notify, queryClient, showError } from '@caiwu/web-kit';
import { BusinessError, parseCodeScheme, productName, type BookInfo } from '@caiwu/core';
import small from '../templates/small-business.json';
import { primaryCharts, offeredTemplates } from '../chart';
import { validateScheme, WizardSchema, type WizardInput } from '../shared';
import TemplatePreview from './TemplatePreview';
import { mapChart } from '../chart-scheme';
import type { TemplateCreation } from './template-creation';

const localTemplates = primaryCharts;

async function verifyBook(book: BookInfo, input: WizardInput) {
  let token = '';
  const client = createTRPCClient<CoreShell>({
    links: [
      httpLink({
        url: '/trpc',
        headers: () => ({
          'x-caiwu-token': appToken(),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        }),
      }),
    ],
  });
  const login = await client.core.auth.login.mutate({
    bookId: book.id,
    userCode: input.adminCode,
    password: input.adminPassword ?? '',
  });
  token = login.token;
  try {
    const [me, accounts] = await Promise.all([
      client.core.auth.me.query(),
      client.core.accounts.list.query(),
    ]);
    if (me.book.id !== book.id || me.book.orgName !== input.orgName.trim())
      throw new Error('新账套信息核对失败，请刷新后检查');
    const native = localTemplates.find((t) => t.id === input.templateId);
    const template = native ? mapChart(native, input.codeScheme) : undefined;
    if (
      template &&
      (accounts.length !== template.accounts.length ||
        template.accounts.some(
          (a) =>
            !accounts.some(
              (b) =>
                b.code === a.code &&
                b.name === a.name &&
                b.categoryId === a.category &&
                b.direction ===
                  (a.direction ??
                    template.categories.find((category) => category.id === a.category)!
                      .direction) &&
                b.isContra === (a.isContra ?? false) &&
                (b.balanceNature ?? null) === (a.balanceNature ?? null) &&
                (b.closingRule ?? null) === (a.closingRule ?? null) &&
                b.sourceVersion === a.sourceVersion &&
                b.dimensions.length === a.dimensions.length &&
                a.dimensions.every((dimension) =>
                  b.dimensions.some(
                    (actual) =>
                      actual.type === dimension.type && actual.required === dimension.required,
                  ),
                ),
            ),
        ))
    )
      throw new Error('新账套科目核对失败，请保留账套并联系管理员');
  } finally {
    await client.core.auth.logout.mutate();
  }
}

export default function Wizard({
  onClose,
  onCreated,
  templateCreation,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  templateCreation?: TemplateCreation;
}) {
  const { modal } = App.useApp();
  const templates = useQuery(coreApi.books.templates.queryOptions());
  const [open, setOpen] = useState(true);
  const closing = useRef(false);
  const cancellation = useRef<{ destroy: () => void } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState(0);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [initialValues] = useState<WizardInput>(() => ({
    name: '',
    orgName: '',
    adminCode: 'admin',
    adminName: '系统管理员',
    adminPassword: '',
    product: 'qingsong',
    templateId: small.id,
    baseCurrency: 'CNY',
    codeScheme: '4-2-2',
    startYear: new Date().getFullYear(),
    startMonth: 1,
    facts: undefined,
  }));
  const [form] = Form.useForm<WizardInput>();
  const values = Form.useWatch([], form) as WizardInput | undefined;
  const [dirty, setDirty] = useState(false);
  const busy = useRef(false);
  const [created, setCreated] = useState<{ book: BookInfo; input: WizardInput } | null>(null);
  const [failure, setFailure] = useState('');
  const [checking, setChecking] = useState(false);
  const create = useMutation(coreApi.books.create.mutationOptions());
  const selected = templates.data?.find((t) => t.id === values?.templateId);
  const selectedLocal = localTemplates.find((t) => t.id === selected?.id);
  const offered = offeredTemplates(templates.data ?? []);
  useEffect(
    () => () => {
      const dialog = cancellation.current;
      cancellation.current = null;
      dialog?.destroy();
    },
    [],
  );
  useEffect(() => {
    const available = templates.data;
    if (available?.length && !form.getFieldValue('templateId')) {
      const t = available.find((t) => t.id === small.id) ?? available[0]!;
      form.setFieldsValue({ templateId: t.id, codeScheme: t.codeScheme });
    }
  }, [templates.data, form]);
  useLayoutEffect(() => {
    if (!dirty || created) return;
    let confirmedTravel = false;
    const handler = (event: BeforeUnloadEvent) => {
      if (!confirmedTravel) event.preventDefault();
    };
    const originalIndex = (history.state as { idx?: number } | null)?.idx;
    let restoring = false;
    const pop = (event: PopStateEvent) => {
      if (confirmedTravel) {
        confirmedTravel = false;
        return;
      }
      if (restoring) {
        restoring = false;
        event.stopImmediatePropagation();
        return;
      }
      const nextIndex = (event.state as { idx?: number } | null)?.idx;
      if (
        typeof originalIndex !== 'number' ||
        typeof nextIndex !== 'number' ||
        originalIndex === nextIndex
      )
        return;
      if (!window.confirm('放弃未提交的新建账套内容并离开？取消后不会建立账套。')) {
        event.stopImmediatePropagation();
        restoring = true;
        history.go(originalIndex - nextIndex);
      }
    };
    // Chromium的Navigation事件发生在历史位置和React路由变化前，可以直接取消后退。
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const navigate = (event: Event) => {
      const travel = event as Event & { navigationType?: string };
      if (travel.navigationType !== 'traverse' || !travel.cancelable) return;
      if (window.confirm('放弃未提交的新建账套内容并离开？取消后不会建立账套。'))
        confirmedTravel = true;
      else travel.preventDefault();
    };
    navigation?.addEventListener('navigate', navigate);
    window.addEventListener('beforeunload', handler);
    window.addEventListener('popstate', pop, true);
    return () => {
      navigation?.removeEventListener('navigate', navigate);
      window.removeEventListener('beforeunload', handler);
      window.removeEventListener('popstate', pop, true);
    };
  }, [dirty, created]);
  const finishClose = () => {
    if (closing.current) return;
    closing.current = true;
    // 保留退场中的遮罩，吸收快速第二次点击；afterClose 再通知父组件卸载。
    setOpen(false);
  };
  const close = () => {
    if (closing.current || busy.current || checking || cancellation.current) return;
    if (dirty && !created) {
      setConfirming(true);
      const dialog = modal.confirm({
        title: '放弃未提交的新建账套内容？',
        content: '取消后不会建立账套。',
        okText: '放弃创建',
        cancelText: '继续编辑',
        onOk: finishClose,
        afterClose: () => {
          if (cancellation.current !== dialog) return;
          cancellation.current = null;
          setConfirming(false);
        },
      });
      cancellation.current = dialog;
    } else finishClose();
  };
  const verify = async (entry: { book: BookInfo; input: WizardInput }) => {
    setChecking(true);
    try {
      await verifyBook(entry.book, entry.input);
      await queryClient.fetchQuery({ ...coreApi.books.list.queryOptions(), staleTime: 0 });
      notify.success('账套已创建，信息及科目已核对');
      onCreated(entry.book.id);
    } catch (e) {
      setFailure(`账套已创建，但核对未完成：${(e as Error).message}。可重试核对，不会重复创建。`);
    } finally {
      setChecking(false);
    }
  };
  const submit = async () => {
    if (closing.current || cancellation.current || busy.current || created) return;
    busy.current = true;
    try {
      const input = WizardSchema.parse(await form.validateFields());
      const t = templates.data?.find((t) => t.id === input.templateId);
      if (!t) {
        notify.error('请选择实际登记的会计制度');
        return;
      }
      const local = localTemplates.find((t) => t.id === input.templateId);
      if (local) validateScheme(local, input.codeScheme);
      templateCreation?.validate(input);
      setFailure('');
      const actualInput = { ...input, requestKey };
      const book = await create.mutateAsync(actualInput);
      const entry = { book, input: actualInput };
      setCreated(entry);
      await verify(entry);
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) {
        const first = (e as { errorFields: { name: string[]; errors: string[] }[] }).errorFields[0];
        const field = first?.name[0];
        setStep(
          field === 'templateId'
            ? 1
            : field === 'codeScheme'
              ? 2
              : field === 'baseCurrency' || field === 'startYear' || field === 'startMonth'
                ? 3
                : 0,
        );
        notify.error(first?.errors[0] ?? '请检查填写内容');
      }
      if (e instanceof Error) {
        if (e instanceof BusinessError && e.data.code.startsWith('TEMPLATE_')) setStep(3);
        setFailure(e.message);
        showError(e);
      }
    } finally {
      busy.current = false;
    }
  };
  const changeStep = (nextStep: number) => {
    if (closing.current || cancellation.current || busy.current || checking || created) return;
    setStep(nextStep);
  };
  const next = async () => {
    if (closing.current || cancellation.current || busy.current || checking || created) return;
    try {
      await form.validateFields(
        step === 0
          ? ['name', 'orgName', 'adminCode', 'adminName', 'adminPassword']
          : step === 1
            ? ['templateId']
            : step === 2
              ? ['codeScheme']
              : ['baseCurrency', 'startYear', 'startMonth'],
      );
      const local = localTemplates.find((t) => t.id === values?.templateId);
      if (step === 2 && local) validateScheme(local, values?.codeScheme ?? '');
      if (step === 3 && templateCreation)
        templateCreation.validate(WizardSchema.parse(form.getFieldsValue(true)));
      setFailure('');
      if (!closing.current && !cancellation.current && !busy.current)
        setStep(Math.min(step + 1, 4));
    } catch (e) {
      if (e instanceof Error) {
        setFailure(e.message);
        showError(e);
      }
    }
  };
  const summary = (
    <Descriptions column={1} size="small" bordered>
      <Descriptions.Item label="账套名称">{values?.name?.trim() || '尚未填写'}</Descriptions.Item>
      <Descriptions.Item label="单位名称">
        {values?.orgName?.trim() || '尚未填写'}
      </Descriptions.Item>
      <Descriptions.Item label="会计制度">{selected?.name || '必须选择'}</Descriptions.Item>
      <Descriptions.Item label="科目级次">{values?.codeScheme}</Descriptions.Item>
      {selectedLocal && (
        <Descriptions.Item label="将建立的科目">
          <TemplatePreview
            template={selectedLocal}
            scheme={values?.codeScheme ?? selectedLocal.codeScheme}
          />
        </Descriptions.Item>
      )}
      <Descriptions.Item label="产品">
        {values?.product ? productName(values.product) : ''}
      </Descriptions.Item>
      <Descriptions.Item label="本位币">人民币 CNY（当前仅支持人民币本位币）</Descriptions.Item>
      <Descriptions.Item label="启用年月">
        {values?.startYear}年{values?.startMonth}月；公历会计年度1—12月
      </Descriptions.Item>
      <Descriptions.Item label="管理员">
        {values?.adminCode} / {values?.adminName}
      </Descriptions.Item>
    </Descriptions>
  );
  return (
    <Modal
      open={open}
      title="新建账套"
      width={900}
      onCancel={close}
      afterClose={onClose}
      keyboard={open && !confirming}
      maskClosable={false}
      footer={
        <Space>
          <Button onClick={close} disabled={!open || confirming || create.isPending || checking}>
            取消
          </Button>
          {step > 0 && !created && (
            <Button
              disabled={!open || confirming || create.isPending || checking}
              onClick={() => changeStep(step - 1)}
            >
              上一步
            </Button>
          )}
          {step < 4 && !created && (
            <Button
              disabled={!open || confirming || create.isPending || checking}
              onClick={() => void next()}
            >
              下一步
            </Button>
          )}
          {created ? (
            <Button
              type="primary"
              disabled={!open || confirming}
              loading={checking}
              onClick={() => void verify(created)}
            >
              重试核对
            </Button>
          ) : (
            <Button
              type="primary"
              loading={create.isPending || checking}
              disabled={!open || confirming || !selected}
              onClick={() => void submit()}
            >
              创建
            </Button>
          )}
        </Space>
      }
    >
      <Steps
        size="small"
        current={step}
        items={['名称与管理员', '会计制度', '科目级次', '启用期间', '最终复核'].map((title) => ({
          title,
        }))}
      />
      <Typography.Paragraph style={{ marginTop: 16 }}>
        逐步填写，或在下方复核全部默认参数后直接创建。取消不会产生半成品。
      </Typography.Paragraph>
      {failure && <Alert type="error" title={failure} showIcon />}
      {templates.isError && (
        <Alert
          type="error"
          title="会计制度读取失败，请重试"
          action={<Button onClick={() => void templates.refetch()}>重试</Button>}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        disabled={!open || confirming || !!created || create.isPending || checking}
        onValuesChange={(_, current: WizardInput) => {
          setFailure('');
          setDirty(
            Object.entries(initialValues).some(
              ([key, value]) => (current as unknown as Record<string, unknown>)[key] !== value,
            ),
          );
        }}
        initialValues={initialValues}
      >
        <div hidden={step !== 0}>
          <Form.Item
            name="name"
            label="账套名称"
            rules={[{ whitespace: true, required: true, max: 60, message: '请输入1—60字账套名称' }]}
          >
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item
            name="orgName"
            label="单位名称"
            rules={[
              { whitespace: true, required: true, max: 100, message: '请输入1—100字单位名称' },
            ]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <Space align="start">
            <Form.Item
              name="adminCode"
              label="管理员编号"
              rules={[
                {
                  required: true,
                  pattern: /^[A-Za-z0-9_.-]{1,20}$/,
                  message: '请输入有效的管理员编号',
                },
              ]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="adminName"
              label="管理员姓名"
              rules={[{ required: true, whitespace: true }]}
            >
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="adminPassword" label="管理员密码" rules={[{ max: 64 }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="product" label="产品">
            <Select
              options={[
                { value: 'qingsong', label: '轻松会计' },
                { value: 'minfei', label: '民非企会计' },
                { value: 'chengben', label: '成本会计' },
              ]}
            />
          </Form.Item>
        </div>
        <div hidden={step !== 1}>
          <Form.Item
            name="templateId"
            label="会计制度"
            rules={[{ required: true, message: '必须选择会计制度' }]}
          >
            <Radio.Group
              onChange={(e) => {
                form.setFieldValue('facts', undefined);
                setFailure('');
                const t = templates.data?.find((t) => t.id === e.target.value);
                if (!t) return;
                try {
                  const current = parseCodeScheme(form.getFieldValue('codeScheme') ?? '');
                  if (current[0] === parseCodeScheme(t.codeScheme)[0]) return;
                } catch {
                  /* 首次选择或级次尚未填写时使用制度默认值。 */
                }
                form.setFieldValue('codeScheme', t.codeScheme);
              }}
            >
              <Space orientation="vertical">
                {offered.map((t) => (
                  <Radio value={t.id} key={t.id}>
                    {t.name} · 默认{t.codeScheme} · {t.accountCount}科目
                    <Typography.Paragraph type="secondary">{t.description}</Typography.Paragraph>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>
          <Alert type="info" title="空白/用户自定义制度暂不支持；现有模板要求至少一个科目。" />
        </div>
        <div hidden={step !== 2}>
          <Form.Item
            name="codeScheme"
            label="科目级次"
            rules={[
              { required: true, whitespace: true, message: '请设置科目级次' },
              {
                validator: async (_, text: string) => {
                  const t = localTemplates.find((t) => t.id === form.getFieldValue('templateId'));
                  if (t) validateScheme(t, text ?? '');
                },
              },
            ]}
          >
            <Input placeholder="例如4-2-2或4-3-3" />
          </Form.Item>
          <Typography.Paragraph>
            最多8级，每级1—6位；一级编码和上下级链必须与模板相容。 4-2-2示例：2221 → 222101 →
            22210101；4-3-3示例：2221 → 2221001 → 2221001001。
          </Typography.Paragraph>
        </div>
        <div hidden={step !== 3}>
          <Alert
            type="info"
            title="当前支持人民币本位币（CNY）"
            description="启用月份只是首次记账月份，年中启用不会改变公历1—12月的会计年度。"
          />
          <Form.Item
            name="baseCurrency"
            label="本位币"
            rules={[{ required: true, message: '请选择本位币' }]}
          >
            <Select options={[{ value: 'CNY', label: '人民币 CNY' }]} />
          </Form.Item>
          <Form.Item
            name="startYear"
            label="启用年份"
            rules={[{ required: true, type: 'integer', min: 2000, max: 2100 }]}
          >
            <InputNumber min={2000} max={2100} />
          </Form.Item>
          <Form.Item
            name="startMonth"
            label="启用月份"
            rules={[{ required: true, type: 'integer', min: 1, max: 12 }]}
          >
            <InputNumber min={1} max={12} />
          </Form.Item>
        </div>
        {templateCreation && (
          <div hidden={step !== 3 && step !== 4}>
            <Form.Item name="facts" label="制度适用条件">
              <templateCreation.Fields
                templateId={values?.templateId ?? ''}
                startYear={values?.startYear ?? Number.NaN}
                startMonth={values?.startMonth ?? Number.NaN}
              />
            </Form.Item>
          </div>
        )}
      </Form>
      <Typography.Title level={5}>创建前复核</Typography.Title>
      {summary}
      <Typography.Paragraph type="secondary">{selected?.description}</Typography.Paragraph>
      {step < 4 && (
        <Button
          type="link"
          disabled={!open || confirming || create.isPending || checking}
          onClick={() => changeStep(4)}
        >
          展开最终复核
        </Button>
      )}
      {step === 4 && (
        <Typography.Paragraph>
          请核对上述全部参数；需要修改时使用“上一步”。点击“创建”后由核心原子建立账套、期间、管理员、模板科目和基础资料。
        </Typography.Paragraph>
      )}
    </Modal>
  );
}
