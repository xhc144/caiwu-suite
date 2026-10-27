import { Alert, Button, Empty, Input, Space, Spin, Tag, Typography, type InputRef } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { getBusinessError, usePermission } from '@caiwu/web-kit';
import { MENU_GROUPS } from '@caiwu/core';
import type { SearchResult } from '../shared';
import { api } from './api';
import { matchesFunction } from './search-match';
import { useWorkbenchContext } from './context';

/** 同一组件通过模块路由用于搜索页，也由壳按模块发现加载到搜索弹窗。 */
export default function SearchPage() {
  const { entries, scope, manifests } = useWorkbenchContext();
  const canSearch = usePermission('workbench.search');
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState(0);
  const resultsId = useId();
  const inputRef = useRef<InputRef>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);
  const opts = api.search.queryOptions(
    { term: debounced || ' ', limit: 30 },
    { trpc: { abortOnUnmount: true } },
  );
  const query = useQuery({
    ...opts,
    queryKeyHashFn: (key) => JSON.stringify([scope, key]),
    enabled: canSearch && !!debounced,
    gcTime: 0,
    staleTime: 0,
  });
  const functions: SearchResult[] = entries
    .filter((i) => matchesFunction(term, i.title, i.keywords))
    .slice(0, 30)
    .map((i) => ({
      key: `fn:${i.to}`,
      category: '功能',
      title: i.title,
      detail: `功能 · ${MENU_GROUPS.find((group) => group.id === i.group)?.title ?? '其他功能'}`,
      to: i.to,
    }));
  // 只展示当前输入对应的数据，旧查询不能覆盖新词；查询内容不写持久存储。
  const settled = term.trim() === debounced;
  const results = canSearch && settled && query.data ? query.data.results : functions;
  const groups = ['功能', '凭证', '科目', '摘要', '往来单位']
    .map((category) => ({ category, items: results.filter((r) => r.category === category) }))
    .filter((g) => g.items.length);
  const ordered = groups.flatMap((g) => g.items);
  const index = Math.min(selected, Math.max(ordered.length - 1, 0));
  const activeResultKey = ordered[index]?.key;
  useEffect(() => {
    document.getElementById(`${resultsId}-${index}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [index, activeResultKey, resultsId]);
  const choose = (r: SearchResult) => void navigate(r.to);
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 12 }}>
      <Input
        ref={inputRef}
        aria-label="全局搜索关键词"
        role="combobox"
        aria-controls={resultsId}
        aria-expanded={!!ordered.length}
        aria-activedescendant={ordered[index] ? `${resultsId}-${index}` : undefined}
        value={term}
        maxLength={64}
        placeholder="功能、凭证号、科目、摘要、往来单位（最多64字）"
        allowClear
        onChange={(e) => {
          setTerm(e.target.value);
          setSelected(0);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setSelected(
              (index + (e.key === 'ArrowDown' ? 1 : -1) + Math.max(ordered.length, 1)) %
                Math.max(ordered.length, 1),
            );
          }
          if (e.key === 'Enter' && ordered[index]) {
            e.preventDefault();
            choose(ordered[index]!);
          }
        }}
      />
      <Typography.Paragraph type="secondary">
        ↑↓ 选择，Enter
        跳转；凭证按当前工作期间查找。编码、中文名称和基础档案拼音首字母可查，每次最多30条。
      </Typography.Paragraph>
      {!canSearch && (
        <Alert
          type="warning"
          title="当前仅可搜索功能"
          description="没有全局实体搜索权限，请联系管理员授权。"
        />
      )}
      {canSearch && debounced && query.isError && (
        <Alert
          type="error"
          title="业务资料搜索失败"
          description={
            getBusinessError(query.error)?.message ?? '无法读取业务资料，请检查本地服务后重试'
          }
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      )}
      {manifests.isError && (
        <Alert
          type="error"
          title="功能清单读取失败"
          action={<Button onClick={() => void manifests.refetch()}>重试</Button>}
        />
      )}
      {canSearch && settled && query.data?.denied.length ? (
        <Alert
          type="info"
          title={`未检索：${query.data.denied.join('、')}`}
          description="对应来源功能尚未启用、产品不可用或没有明确读取权限。"
        />
      ) : null}
      {canSearch && term.trim() && (!settled || query.isFetching) && <Spin size="small" />}
      <div
        id={resultsId}
        role="listbox"
        aria-label="搜索结果"
        style={{ maxHeight: 'calc(55vh / var(--cw-scale, 1))', overflow: 'auto' }}
      >
        {groups.map((g) => (
          <section key={g.category}>
            <Typography.Title level={5}>{g.category}</Typography.Title>
            {g.items.map((r) => {
              const i = ordered.indexOf(r);
              return (
                <div
                  role="option"
                  id={`${resultsId}-${i}`}
                  aria-selected={i === index}
                  key={r.key}
                  style={{
                    padding: 6,
                    background:
                      i === index ? 'var(--ant-color-primary-bg, rgba(31,111,235,.12))' : undefined,
                  }}
                >
                  <Button
                    block
                    type="text"
                    style={{
                      height: 'auto',
                      whiteSpace: 'normal',
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                    }}
                    onClick={() => choose(r)}
                  >
                    <Space wrap>
                      <Tag>{r.category}</Tag>
                      <span>{r.title}</span>
                      <Typography.Text type="secondary">{r.detail}</Typography.Text>
                    </Space>
                  </Button>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      {!ordered.length && settled && !query.isFetching && (
        <Empty description={term ? '没有匹配结果' : '输入关键词开始搜索'} />
      )}
    </div>
  );
}
