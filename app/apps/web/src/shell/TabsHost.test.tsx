import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useState } from 'react';
import { defineManifest } from '@caiwu/core';
import { sessionStore, useHotkey, useTab } from '@caiwu/web-kit';
import { useUrlFilters } from '@caiwu/ui';
import { TabsHost } from './TabsHost';
import { buildNavItems } from './NavMenu';

const manifest = defineManifest({
  id: 'fixture',
  name: '测试页面',
  products: 'all',
  menu: [
    { group: 'ledger', title: '页面甲', path: '/a' },
    { group: 'ledger', title: '页面乙', path: '/b' },
  ],
});
const saves: Record<string, number> = {};
function FixturePage() {
  const tab = useTab();
  const [filters, setFilters] = useUrlFilters({ period: 202601, keyword: '' });
  const [draft, setDraft] = useState('');
  useHotkey('Ctrl+S', () => {
    saves[tab.key] = (saves[tab.key] ?? 0) + 1;
  });
  return (
    <section data-testid={tab.key}>
      <output>{`${filters.period}:${filters.keyword}`}</output>
      <input aria-label="未保存表单" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button onClick={() => setFilters({ period: 202602, keyword: '改变' })}>更新URL筛选</button>
    </section>
  );
}
const promise = Promise.resolve({
  manifest,
  routes: [
    { path: '/a', title: '页面甲', component: FixturePage },
    { path: '/b', title: '页面乙', component: FixturePage },
  ],
});
vi.mock('../modules', () => ({
  visibleModules: () => [manifest],
  loadWebModule: () => promise,
  entryPageProvider: () => null,
}));
vi.mock('./HomePage', () => ({ HomePage: () => <div>首页内容</div> }));
function Harness() {
  const nav = useNavigate();
  const loc = useLocation();
  return (
    <>
      <div>
        <button onClick={() => void nav('/m/fixture/a?period=202603&keyword=甲')}>打开甲</button>
        <button onClick={() => void nav('/m/fixture/b?period=202604&keyword=乙')}>打开乙</button>
        <button onClick={() => void nav(-1)}>后退</button>
        <button onClick={() => void nav(1)}>前进</button>
        <button onClick={() => void nav('/home')}>首页导航</button>
        <button
          onClick={() => {
            for (let i = 0; i < 1; i++) void nav(`/m/fixture/new${Math.random()}`);
          }}
        >
          新标签
        </button>
        <output data-testid="browser-url">{loc.pathname + loc.search}</output>
      </div>
      <TabsHost
        devMode
        navItems={buildNavItems([manifest], {
          id: 1,
          code: 'admin',
          name: '管理',
          isAdmin: true,
          permissions: [],
        })}
      />
    </>
  );
}
beforeEach(() => {
  sessionStore.set({
    token: 'tabs-token',
    bookId: 'book-a',
    user: { id: 1, code: 'admin', name: '管理', isAdmin: true, permissions: [] },
    book: {
      id: 'book-a',
      name: '账套',
      orgName: '单位',
      templateId: 'demo',
      templateName: '制度',
      regime: 'enterprise',
      product: 'chengben',
      startPeriod: 202601,
      codeScheme: [4, 2, 2],
      baseCurrency: 'CNY',
      createdAt: '',
    },
  });
  for (const key of Object.keys(saves)) delete saves[key];
});
afterEach(() => {
  cleanup();
  sessionStore.set(null);
});
const pageA = () => within(screen.getByTestId('/m/fixture/a'));
const pageB = () => within(screen.getByTestId('/m/fixture/b'));
async function setup() {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/*" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}
describe('TabsHost URL与状态', () => {
  it('同标签useUrlFilters更新即时可见，返回前进和多标签参数/表单不串页', async () => {
    await setup();
    await click(screen.getByText('打开甲'));
    await screen.findByTestId('/m/fixture/a');
    expect(pageA().getByText('202603:甲')).toBeInTheDocument();
    fireEvent.change(pageA().getByLabelText('未保存表单'), { target: { value: '未保存输入' } });
    await click(pageA().getByText('更新URL筛选'));
    await waitFor(() => expect(pageA().getByText('202602:改变')).toBeInTheDocument());
    expect(screen.getByTestId('browser-url')).toHaveTextContent('period=202602');
    await click(screen.getByText('打开乙'));
    await screen.findByTestId('/m/fixture/b');
    expect(pageB().getByText('202604:乙')).toBeInTheDocument();
    expect(pageA().getByText('202602:改变')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(saves['/m/fixture/a'] ?? 0).toBe(0);
    expect(saves['/m/fixture/b']).toBe(1);
    await click(screen.getByRole('tab', { name: /页面甲/ }));
    await waitFor(() => expect(pageA().getByLabelText('未保存表单')).toHaveValue('未保存输入'));
    expect(screen.getByTestId('browser-url')).toHaveTextContent(
      '/m/fixture/a?period=202602&keyword=',
    );
    await click(screen.getByText('后退'));
    await waitFor(() =>
      expect(screen.getByTestId('browser-url')).toHaveTextContent('/m/fixture/b?period=202604'),
    );
    await click(screen.getByText('前进'));
    await waitFor(() => expect(pageA().getByText('202602:改变')).toBeInTheDocument());
  });
  it('Ctrl+F4关闭当前回相邻，已有离开保护可阻止，首页不可关闭', async () => {
    await setup();
    await click(screen.getByText('打开甲'));
    await screen.findByTestId('/m/fixture/a');
    await click(screen.getByText('打开乙'));
    await screen.findByTestId('/m/fixture/b');
    const block = (e: Event) => e.preventDefault();
    window.addEventListener('beforeunload', block);
    fireEvent.keyDown(window, { key: 'F4', code: 'F4', ctrlKey: true });
    expect(screen.getByTestId('/m/fixture/b')).toBeInTheDocument();
    window.removeEventListener('beforeunload', block);
    fireEvent.keyDown(window, { key: 'F4', code: 'F4', ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByTestId('browser-url')).toHaveTextContent('/m/fixture/a?period=202603'),
    );
    await click(screen.getByText('首页导航'));
    fireEvent.keyDown(window, { key: 'F4', code: 'F4', ctrlKey: true });
    await act(async () => {});
    expect(screen.getByRole('tab', { name: '首页' })).toBeInTheDocument();
  });
  it('关闭所有可取消，已有离开保护会阻止批量关闭', async () => {
    await setup();
    await click(screen.getByText('打开甲'));
    await screen.findByTestId('/m/fixture/a');
    await click(screen.getByText('打开乙'));
    await screen.findByTestId('/m/fixture/b');
    await click(screen.getByText('关闭所有'));
    await click(
      within(await screen.findByRole('dialog', { name: '关闭所有标签' })).getByRole('button', {
        name: /取\s*消/,
      }),
    );
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    const block = (e: Event) => e.preventDefault();
    window.addEventListener('beforeunload', block);
    await click(screen.getByText('关闭所有'));
    await click(
      within(await screen.findByRole('dialog', { name: '关闭所有标签' })).getByText(
        '已保存内容，关闭',
      ),
    );
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    window.removeEventListener('beforeunload', block);
    await click(
      within(screen.getByRole('dialog', { name: '关闭所有标签' })).getByText('已保存内容，关闭'),
    );
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByTestId('browser-url')).toHaveTextContent('/home');
  });
  it('标签达到上限不自动淘汰任何页面', async () => {
    await setup();
    await click(screen.getByText('打开甲'));
    await screen.findByTestId('/m/fixture/a');
    fireEvent.change(pageA().getByLabelText('未保存表单'), { target: { value: '保留我' } });
    for (let i = 0; i < 19; i++) {
      await click(screen.getByText('新标签'));
      await act(async () => {});
    }
    expect(screen.getByRole('dialog', { name: '标签数量已达上限' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(20);
    expect(pageA().getByLabelText('未保存表单')).toHaveValue('保留我');
  });
});
