import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineManifest, type CurrentUser } from '@caiwu/core';
import { menuEntries } from '../shared';
import { FeatureMap } from './FeatureMap';

const context = vi.hoisted(() => ({ current: {} as object }));
vi.mock('./context', () => ({ useWorkbenchContext: () => context.current }));
afterEach(cleanup);

const reference = defineManifest({
  id: 'masterdata',
  name: '基础档案',
  products: 'all',
  permissions: [{ id: 'masterdata.view', name: '读取基础档案' }],
  menu: [
    {
      group: 'master',
      title: '凭证类型、结算、外币与摘要',
      path: '/reference',
      permission: 'masterdata.view',
    },
  ],
});
const books = defineManifest({
  id: 'books',
  name: '账套',
  products: ['chengben'],
  permissions: [{ id: 'books.view', name: '读取账套' }],
  menu: [{ group: 'system', title: '账套管理', path: '/manage', permission: 'books.view' }],
});
function Location() {
  const location = useLocation();
  return <output aria-label="目标地址">{location.pathname + location.search}</output>;
}
const user: CurrentUser = {
  id: 1,
  code: 'admin',
  name: '管理员',
  isAdmin: true,
  permissions: [],
};
function setup(current = user, product: 'chengben' | 'qingsong' = 'chengben') {
  const manifests = [reference, books];
  context.current = {
    session: { user: current },
    manifests: { data: manifests },
    entries: menuEntries(manifests, current, product, false),
  };
  render(
    <MemoryRouter>
      <FeatureMap />
      <Location />
    </MemoryRouter>,
  );
}

describe('w_main1 原工作台入口', () => {
  it('合并档案入口保留各自类型参数，未实现合同不会误命中其他分析页', () => {
    setup();
    for (const [name, kind] of [
      ['摘要管理', 'summaries'],
      ['凭证类型', 'voucherTypes'],
      ['结算类别', 'settlementMethods'],
      ['外币类型', 'currencies'],
    ]) {
      fireEvent.click(
        screen.getByRole('button', { name: `${name} · 进入${reference.menu[0]!.title}` }),
      );
      expect(screen.getByLabelText('目标地址')).toHaveTextContent(
        `/m/masterdata/reference?kind=${kind}`,
      );
    }
    expect(screen.queryByRole('button', { name: /合同档案|自定义分析/ })).not.toBeInTheDocument();
    expect(screen.getByText('合同档案 · 模块未加载')).toBeVisible();
  });
  it('原名映射仍服从读取权限、管理员身份和产品过滤', () => {
    setup({ ...user, isAdmin: false, permissions: ['books.view'] });
    expect(screen.queryByRole('button', { name: /摘要管理|账套管理/ })).not.toBeInTheDocument();
    expect(screen.getByText('摘要管理 · 当前无可用入口')).toBeVisible();
    cleanup();
    setup(user, 'qingsong');
    expect(screen.queryByRole('button', { name: '账套管理' })).not.toBeInTheDocument();
    expect(screen.getByText('账套管理 · 当前无可用入口')).toBeVisible();
  });
});
