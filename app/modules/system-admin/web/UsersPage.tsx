import { useAdminConfirm } from './confirm';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  Space,
  Switch,
  Tree,
  Typography,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { coreApi, queryClient, usePermission, useRequiredSession } from '@caiwu/web-kit';
import { DataTable, FilterBar, PageContainer, useUrlFilters, type DataColumn } from '@caiwu/ui';
import type { UserRow } from '../shared';
import { api } from './api';
import { goToLogin } from './session';

const EMPTY_PERMISSIONS: string[] = [];
type Editing = { mode: 'new' | 'edit' | 'permissions' | 'reset'; user?: UserRow };
export default function UsersPage() {
  const session = useRequiredSession();
  const [filters, setFilters] = useUrlFilters({ keyword: '' });
  const [editing, setEditing] = useState<Editing | null>(null);
  const list = useQuery(api.users.list.queryOptions(undefined, { enabled: session.user.isAdmin }));
  const canPermissions = usePermission('system-admin.permissions.manage'),
    canReset = usePermission('system-admin.password.reset');
  const columns: DataColumn<UserRow>[] = [
    { key: 'code', title: '编号', dataIndex: 'code', width: 150 },
    { key: 'name', title: '名称', dataIndex: 'name', width: 200 },
    { key: 'admin', title: '管理员', width: 110, render: (_, r) => (r.isAdmin ? '是' : '否') },
    {
      key: 'disabled',
      title: '状态',
      width: 110,
      render: (_, r) => (r.disabled ? '已停用' : '启用'),
    },
    {
      key: 'actions',
      title: '操作',
      width: 300,
      noExport: true,
      render: (_, r) => (
        <Space wrap>
          <Button size="small" onClick={() => setEditing({ mode: 'edit', user: r })}>
            修改
          </Button>
          {canPermissions && (
            <Button size="small" onClick={() => setEditing({ mode: 'permissions', user: r })}>
              权限
            </Button>
          )}
          {canReset && (
            <Button size="small" onClick={() => setEditing({ mode: 'reset', user: r })}>
              重置密码
            </Button>
          )}
        </Space>
      ),
    },
  ];
  return (
    <PageContainer
      title="用户管理"
      subtitle="停用保留制单人与审计引用；用户编号建立后不可变。"
      extra={
        session.user.isAdmin && (
          <Button type="primary" onClick={() => setEditing({ mode: 'new' })}>
            新增用户
          </Button>
        )
      }
    >
      {!session.user.isAdmin ? (
        <Alert
          type="warning"
          title="管理用户需要启用管理员身份"
          description="请切换到当前账套的管理员。"
        />
      ) : (
        <>
          <FilterBar<{ keyword: string }> initialValues={filters} onSearch={setFilters}>
            <Form.Item name="keyword" label="编号或名称">
              <Input allowClear />
            </Form.Item>
          </FilterBar>
          <DataTable
            tableId={`system-admin.users.${session.bookId}`}
            rowKey="id"
            columns={columns}
            loading={list.isLoading}
            dataSource={(list.data ?? []).filter((u) =>
              `${u.code} ${u.name}`.includes(filters.keyword),
            )}
          />
          <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
            至少保留一个启用管理员，不能停用自己。当前版本提供停用，暂不提供物理删除。
          </Typography.Paragraph>
          {editing && (
            <UserDrawer
              editing={editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                void queryClient.invalidateQueries({ queryKey: api.users.list.queryKey() });
              }}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}
function UserDrawer({
  editing,
  onClose,
  onSaved,
}: {
  editing: Editing;
  onClose: () => void;
  onSaved: () => void;
}) {
  const s = useRequiredSession();
  const [form] = Form.useForm();
  const [confirm, holder] = useAdminConfirm();
  const [dirty, setDirty] = useState(false);
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [permissionSearch, setPermissionSearch] = useState('');
  const modules = useQuery(coreApi.modules.list.queryOptions());
  const grant = useQuery(
    api.users.permissions.queryOptions(
      { id: editing.user?.id ?? 1 },
      { enabled: editing.mode === 'permissions' },
    ),
  );
  const create = useMutation(api.users.create.mutationOptions());
  const update = useMutation(api.users.update.mutationOptions());
  const setGrant = useMutation(api.users.setPermissions.mutationOptions());
  const reset = useMutation(api.users.resetPassword.mutationOptions());
  const user = editing.user,
    mode = editing.mode;
  const selected = permissions ?? grant.data?.permissions ?? EMPTY_PERMISSIONS;
  const treeData = useMemo(
    () =>
      (modules.data ?? []).map((m) => ({
        key: `module:${m.id}`,
        title: m.name,
        children: m.permissions.map((p) => ({ key: p.id, title: p.name })),
      })),
    [modules.data],
  );
  const loaded = (modules.data ?? []).flatMap((m) => m.permissions.map((p) => p.id));
  const keyword = permissionSearch.trim().toLocaleLowerCase();
  const matches = (modules.data ?? []).flatMap((m) =>
    m.permissions.filter((p) =>
      `${m.name} ${p.name} ${p.id}`.toLocaleLowerCase().includes(keyword),
    ),
  );
  const busy = create.isPending || update.isPending || setGrant.isPending || reset.isPending;
  const close = async () => {
    if (
      dirty &&
      !(await confirm({
        title: '放弃未保存内容',
        content: '修改尚未保存，关闭抽屉会丢失本次修改。',
        confirmText: '放弃修改',
      }))
    )
      return;
    onClose();
  };
  const submit = async () => {
    if (busy || (mode === 'permissions' && (grant.isError || modules.isError))) return;
    const v = await form.validateFields();
    if (mode === 'new')
      await create.mutateAsync({
        code: v.code,
        name: v.name,
        password: v.password,
        confirmPassword: v.confirmPassword,
        isAdmin: v.isAdmin ?? false,
        permissions: [],
      });
    else if (user) {
      if (mode === 'edit') {
        if (
          v.disabled &&
          !(await confirm({
            title: `停用用户 ${user.code}`,
            content: '该用户当前账套的全部旧会话将失效，凭证及日志引用保留。',
            confirmText: user.code,
          }))
        )
          return;
        await update.mutateAsync({
          id: user.id,
          name: v.name,
          disabled: v.disabled,
          confirmCode: user.code,
        });
      }
      if (mode === 'permissions') {
        if (
          !(await confirm({
            title: `保存 ${user.code} 的权限`,
            content:
              '授权变更后该用户当前账套全部旧会话失效，请重新登录。未加载模块的历史权限会保留。',
            confirmText: user.code,
          }))
        )
          return;
        await setGrant.mutateAsync({
          id: user.id,
          permissions: selected,
          isAdmin: isAdmin ?? grant.data?.isAdmin ?? false,
          confirmCode: user.code,
        });
      }
      if (mode === 'reset') {
        if (
          !(await confirm({
            title: `重置 ${user.code} 的密码`,
            content: '将设置所填的新密码，当前账套全部旧会话失效。请安全告知本人新密码。',
            confirmText: user.code,
          }))
        )
          return;
        await reset.mutateAsync({
          id: user.id,
          confirmCode: user.code,
          password: v.password,
          confirmPassword: v.confirmPassword,
        });
      }
      if (user.id === s.user.id) {
        await goToLogin(s.bookId);
        return;
      }
    }
    onSaved();
  };
  const title =
    mode === 'new'
      ? '新增用户'
      : mode === 'edit'
        ? `修改用户 ${user?.code}`
        : mode === 'permissions'
          ? `用户权限 ${user?.code}`
          : `重置密码 ${user?.code}`;
  return (
    <Drawer
      title={title}
      open
      size={640}
      onClose={() => void close()}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={() => void close()}>取消</Button>
          <Button
            type="primary"
            loading={busy}
            disabled={
              mode === 'permissions' &&
              (!grant.data || !modules.data || grant.isError || modules.isError)
            }
            onClick={() => void submit()}
          >
            保存
          </Button>
        </Space>
      }
    >
      {holder}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ name: user?.name, disabled: user?.disabled ?? false, isAdmin: false }}
        onValuesChange={() => setDirty(true)}
        onFinish={() => void submit()}
      >
        {mode === 'new' && (
          <Form.Item
            name="code"
            label="用户编号"
            rules={[
              {
                required: true,
                pattern: /^[A-Za-z0-9_.-]{1,20}$/,
                message: '请输入 1–20 位字母、数字、下划线、点或连字符',
              },
            ]}
          >
            <Input autoFocus maxLength={20} />
          </Form.Item>
        )}
        {(mode === 'new' || mode === 'edit') && (
          <Form.Item
            name="name"
            label="用户名称"
            rules={[{ required: true, whitespace: true, message: '请输入用户名称' }]}
          >
            <Input maxLength={60} />
          </Form.Item>
        )}
        {mode === 'edit' && (
          <Form.Item name="disabled" label="停用" valuePropName="checked">
            <Switch disabled={user?.id === s.user.id} />
          </Form.Item>
        )}
        {mode === 'new' && (
          <>
            <Form.Item name="isAdmin" valuePropName="checked">
              <Checkbox>设为管理员（拥有全部功能权限）</Checkbox>
            </Form.Item>
            <Alert type="info" title="普通新用户初始没有权限，请保存后在“权限”中授权。" />
          </>
        )}
        {(mode === 'new' || mode === 'reset') && (
          <>
            <Form.Item
              name="password"
              label="新密码"
              rules={[{ required: true, min: 8, max: 64, message: '请输入 8–64 个字符' }]}
            >
              <Input.Password autoComplete="new-password" maxLength={64} />
            </Form.Item>
            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['password']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator: (_, v) =>
                    v === getFieldValue('password')
                      ? Promise.resolve()
                      : Promise.reject(new Error('两次新密码不一致')),
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" maxLength={64} />
            </Form.Item>
          </>
        )}
        {mode === 'permissions' && (
          <>
            <Alert
              type="info"
              showIcon
              title="权限来自当前已加载模块"
              description="产品菜单可见性不等于授权；管理员拥有全部权限。普通用户按勾选功能授权。保存会使目标用户旧会话失效。"
            />
            {!!grant.data?.preservedPermissions.length && (
              <Alert
                style={{ marginTop: 12 }}
                type="warning"
                title={`保留 ${grant.data.preservedPermissions.length} 个未加载模块的历史权限`}
                description={grant.data.preservedPermissions.join('、')}
              />
            )}
            <Checkbox
              style={{ margin: '16px 0' }}
              checked={isAdmin ?? grant.data?.isAdmin ?? false}
              onChange={(e) => {
                setIsAdmin(e.target.checked);
                setDirty(true);
              }}
            >
              管理员（全部功能）
            </Checkbox>
            <Space style={{ display: 'flex', marginBottom: 12 }}>
              <Button
                onClick={() => {
                  setPermissions(loaded);
                  setDirty(true);
                }}
              >
                全选功能
              </Button>
              <Button
                onClick={() => {
                  setPermissions([]);
                  setDirty(true);
                }}
              >
                清空功能
              </Button>
            </Space>
            <Input
              aria-label="查找功能权限"
              placeholder="输入模块、功能名称或权限编号，高亮匹配项"
              allowClear
              value={permissionSearch}
              onChange={(e) => setPermissionSearch(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <Typography.Paragraph type="secondary">
              {`已选 ${selected.length} / ${loaded.length} 项功能${keyword ? `，匹配 ${matches.length} 项；查找不会改变授权` : ''}`}
            </Typography.Paragraph>
            {(modules.isError || grant.isError) && (
              <Alert type="error" title="权限资料读取失败，请关闭后重新打开；本次不能保存。" />
            )}
            <Tree
              checkable
              defaultExpandAll
              key={modules.data?.length ?? 0}
              checkedKeys={selected}
              onCheck={(keys) => {
                setPermissions(
                  (Array.isArray(keys) ? keys : keys.checked)
                    .map(String)
                    .filter((k) => loaded.includes(k)),
                );
                setDirty(true);
              }}
              treeData={treeData}
              filterTreeNode={(node) => !!keyword && matches.some((p) => p.id === node.key)}
            />
          </>
        )}
      </Form>
    </Drawer>
  );
}
