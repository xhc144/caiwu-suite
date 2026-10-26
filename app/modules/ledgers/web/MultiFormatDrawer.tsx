import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Drawer, Form, Input, Select, Space } from 'antd';
import { notify, useAccounts, usePermission } from '@caiwu/web-kit';
import {
  MULTI_MODES,
  MultiColumnsSchema,
  type MultiColumnDefinition,
  type MultiFormat,
} from '../multicolumn';
import { api } from './api';

export default function MultiFormatDrawer({
  account,
  format,
  initial,
  open,
  onClose,
  onApply,
  onSaved,
}: {
  account: string;
  format: MultiFormat;
  initial: MultiColumnDefinition[];
  open: boolean;
  onClose: () => void;
  onApply: (columns: MultiColumnDefinition[]) => Promise<void>;
  onSaved: () => void;
}) {
  const { accounts } = useAccounts();
  const canSave = usePermission('ledgers.config.edit');
  const [form] = Form.useForm<{ columns: MultiColumnDefinition[] }>();
  const save = useMutation(
    api.saveMultiFormat.mutationOptions({
      onSuccess: async () => {
        onSaved();
        await onApply(form.getFieldValue('columns') as MultiColumnDefinition[]);
        notify.success('多栏账格式已保存到账套');
        onClose();
      },
    }),
  );
  const submit = async (persist: boolean) => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const parsed = MultiColumnsSchema.safeParse(values.columns);
    if (!parsed.success) {
      form.setFields([{ name: 'columns', errors: parsed.error.issues.map((i) => i.message) }]);
      return;
    }
    if (persist)
      save.mutate({
        account,
        columns: parsed.data,
        expectedRevision: format.revision,
        confirmed: true,
      });
    else {
      try {
        await onApply(parsed.data);
        onClose();
      } catch {
        /* 业务提示由接口统一展示，保留当前编辑内容。 */
      }
    }
  };
  return (
    <Drawer
      title="自定义多栏账栏目"
      open={open}
      onClose={onClose}
      width={740}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button onClick={() => void submit(false)}>应用到当前查询</Button>
          {canSave && (
            <Button type="primary" loading={save.isPending} onClick={() => void submit(true)}>
              确认保存到账套
            </Button>
          )}
        </Space>
      }
    >
      <Alert
        type="info"
        title="每栏独立选择名称、科目集合和取数方向"
        description="同一栏不能同时选父科目与其下级；不同栏目可重复使用科目，例如分别列出借方和贷方。自定义栏不能相加作为主账合计。保存到账套后，重新打开该科目会使用所存格式。"
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{ columns: initial }}
        style={{ marginTop: 16 }}
      >
        <Form.List name="columns">
          {(fields, { add, remove, move }, { errors }) => (
            <>
              {fields.map(({ key, name }) => (
                <div key={key} style={{ borderBottom: '1px solid #ddd', marginBottom: 16 }}>
                  <Form.Item
                    name={[name, 'name']}
                    label={`第${name + 1}栏名称`}
                    rules={[{ required: true, whitespace: true, message: '请填写栏目名称' }]}
                  >
                    <Input maxLength={60} />
                  </Form.Item>
                  <Form.Item
                    name={[name, 'accountCodes']}
                    label={`第${name + 1}栏科目集合`}
                    rules={[{ required: true, message: '请选择科目' }]}
                  >
                    <Select
                      mode="multiple"
                      showSearch={{ optionFilterProp: 'label' }}
                      options={accounts
                        .filter((a) => a.code.startsWith(account))
                        .map((a) => ({ value: a.code, label: `${a.code} ${a.fullName}` }))}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[name, 'mode']}
                    label={`第${name + 1}栏取数方向`}
                    rules={[{ required: true }]}
                  >
                    <Select
                      options={Object.entries(MULTI_MODES).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                    />
                  </Form.Item>
                  <Space style={{ marginBottom: 12 }}>
                    <Button disabled={name === 0} onClick={() => move(name, name - 1)}>
                      上移第{name + 1}栏
                    </Button>
                    <Button
                      disabled={name === fields.length - 1}
                      onClick={() => move(name, name + 1)}
                    >
                      下移第{name + 1}栏
                    </Button>
                    <Button danger onClick={() => remove(name)}>
                      删除第{name + 1}栏
                    </Button>
                  </Space>
                </div>
              ))}
              <Form.ErrorList errors={errors} />
              <Button onClick={() => add({ name: '', accountCodes: [], mode: 'debit' })}>
                增加栏目
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </Drawer>
  );
}
