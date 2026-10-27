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
import { parseTemplate, productName, type BookInfo } from '@caiwu/core';
import small from '../templates/small-business.json';
import enterprise from '../templates/enterprise.json';
import { validateScheme, WizardSchema, type WizardInput } from '../shared';
import { templateReviewWarning } from '../enterprise-evidence';

const localTemplates = [small, enterprise].map((t) => parseTemplate(t));

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
    const template = localTemplates.find((t) => t.id === input.templateId);
    if (
      template &&
      (accounts.length !== template.accounts.length ||
        template.accounts.some(
          (a) => !accounts.some((b) => b.code === a.code && b.name === a.name),
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
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { modal } = App.useApp();
  const templates = useQuery(coreApi.books.templates.queryOptions());
  const [step, setStep] = useState(0);
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
  const reviewWarning =
    selectedLocal?.regime === 'enterprise' ? templateReviewWarning(selectedLocal) : null;
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
  const close = () => {
    if (busy.current || checking) return;
    if (dirty && !created)
      modal.confirm({
        title: '放弃未提交的新建账套内容？',
        content: '取消后不会建立账套。',
        okText: '放弃创建',
        cancelText: '继续编辑',
        onOk: onClose,
      });
    else onClose();
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
    if (busy.current || created) return;
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
      setFailure('');
      const book = await create.mutateAsync(input);
      const entry = { book, input };
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
              : field === 'startYear' || field === 'startMonth'
                ? 3
                : 0,
        );
        notify.error(first?.errors[0] ?? '请检查填写内容');
      }
      if (e instanceof Error) {
        setFailure(e.message);
        showError(e);
      }
    } finally {
      busy.current = false;
    }
  };
  const next = async () => {
    try {
      await form.validateFields(
        step === 0
          ? ['name', 'orgName', 'adminCode', 'adminName', 'adminPassword']
          : step === 1
            ? ['templateId']
            : step === 2
              ? ['codeScheme']
              : ['startYear', 'startMonth'],
      );
      const local = localTemplates.find((t) => t.id === values?.templateId);
      if (step === 2 && local) validateScheme(local, values?.codeScheme ?? '');
      setStep(Math.min(step + 1, 4));
    } catch (e) {
      if (e instanceof Error) showError(e);
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
      open
      title="新建账套"
      width={900}
      onCancel={close}
      maskClosable={false}
      footer={
        <Space>
          <Button onClick={close} disabled={create.isPending || checking}>
            取消
          </Button>
          {step > 0 && !created && <Button onClick={() => setStep(step - 1)}>上一步</Button>}
          {step < 4 && !created && <Button onClick={() => void next()}>下一步</Button>}
          {created ? (
            <Button type="primary" loading={checking} onClick={() => void verify(created)}>
              重试核对
            </Button>
          ) : (
            <Button
              type="primary"
              loading={create.isPending || checking}
              disabled={!selected}
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
      {reviewWarning && <Alert type="warning" title={reviewWarning} showIcon />}
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
        disabled={!!created || create.isPending || checking}
        onValuesChange={() => setDirty(true)}
        initialValues={{
          name: '',
          orgName: '',
          adminCode: 'admin',
          adminName: '系统管理员',
          adminPassword: '',
          product: 'qingsong',
          codeScheme: '4-2-2',
          startYear: new Date().getFullYear(),
          startMonth: 1,
        }}
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
                const t = templates.data?.find((t) => t.id === e.target.value);
                if (t) form.setFieldValue('codeScheme', t.codeScheme);
              }}
            >
              <Space orientation="vertical">
                {templates.data?.map((t) => (
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
            最多8级，每级1—6位；一级编码和上下级链必须与模板相容。一个制度只提供一个模板。
          </Typography.Paragraph>
        </div>
        <div hidden={step !== 3}>
          <Alert
            type="info"
            title="当前支持人民币本位币（CNY）"
            description="启用月份只是首次记账月份，年中启用不会改变公历1—12月的会计年度。"
          />
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
      </Form>
      <Typography.Title level={5}>创建前复核</Typography.Title>
      {summary}
      <Typography.Paragraph type="secondary">{selected?.description}</Typography.Paragraph>
      {step < 4 && (
        <Button
          type="link"
          onClick={() => {
            setStep(4);
          }}
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
