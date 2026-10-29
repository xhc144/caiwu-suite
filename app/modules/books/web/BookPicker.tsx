import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Space, Spin, Table, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { formatPeriod, productName, type BookSummary } from '@caiwu/core';
import { coreApi, queryClient, useSession } from '@caiwu/web-kit';
import { filterBooks, moveBookSelection, selectedBook } from '../shared';
import Wizard from './Wizard';
import { switchBook } from './session';
import type { TemplateCreation } from './template-creation';

export default function BookPicker({ templateCreation }: { templateCreation?: TemplateCreation }) {
  const session = useSession();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (session) return;
    let alive = true;
    void queryClient.cancelQueries().then(() => {
      queryClient.clear();
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [session]);
  if (session)
    return (
      <div className="cw-center-page">
        <Card title="切换账套">
          <p>当前已登录「{session.book.name}」。退出后再选择账套。</p>
          <Button type="primary" onClick={() => void switchBook()}>
            退出并选择账套
          </Button>
        </Card>
      </div>
    );
  if (!ready) return <Spin />;
  return <PickerContent templateCreation={templateCreation} />;
}

function PickerContent({ templateCreation }: { templateCreation?: TemplateCreation }) {
  const navigate = useNavigate();
  const books = useQuery(coreApi.books.list.queryOptions());
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [missing, setMissing] = useState('');
  const rows = filterBooks(books.data ?? [], keyword);
  const selected = selectedBook(rows, selectedId);
  const firstId = rows[0]?.id;
  useEffect(() => {
    if (selectedId === null && firstId) setSelectedId(firstId);
  }, [firstId, selectedId]);
  const enter = async (b: BookSummary) => {
    const latest = await books.refetch();
    if (latest.isError) {
      setMissing('无法确认账套文件状态，请刷新列表后重试');
      return;
    }
    if (!latest.data?.some((v) => v.id === b.id)) {
      setMissing('所选账套文件已移走、损坏或不再存在，请刷新列表并检查数据目录');
      setKeyword('');
      return;
    }
    await navigate(`/login/${b.id}`);
  };
  return (
    <div className="cw-center-page">
      <Card
        style={{ width: 1120, maxWidth: '100%' }}
        title="选择账套"
        extra={
          <Button type="primary" onClick={() => setCreating(true)}>
            新建账套
          </Button>
        }
      >
        <Space style={{ width: '100%', marginBottom: 16 }}>
          <Input
            aria-label="搜索账套"
            placeholder="搜索编号、名称、单位或会计制度；↑↓选择，Enter进入"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setSelectedId(null);
              setMissing('');
            }}
            onKeyDown={(e) => {
              if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) e.preventDefault();
              if (e.key === 'ArrowDown') setSelectedId(moveBookSelection(rows, selectedId, 1));
              if (e.key === 'ArrowUp') setSelectedId(moveBookSelection(rows, selectedId, -1));
              if (e.key === 'Enter') {
                if (selected) void enter(selected);
                else if (selectedId) setMissing('原选账套已不在当前结果中，请重新选择账套后进入');
              }
            }}
            style={{ width: 560, maxWidth: '70vw' }}
          />
          <Button onClick={() => void books.refetch()}>刷新列表</Button>
        </Space>
        {books.isError && <Alert type="error" title="账套列表读取失败，请检查数据目录后刷新列表" />}
        {missing && <Alert type="error" title={missing} closable onClose={() => setMissing('')} />}
        <Table<BookSummary>
          rowKey="id"
          loading={books.isLoading}
          dataSource={rows}
          pagination={false}
          rowClassName={(b) => (b.id === selected?.id ? 'ant-table-row-selected' : '')}
          onRow={(b) => ({
            'aria-selected': b.id === selected?.id,
            onClick: () => setSelectedId(b.id),
            onDoubleClick: () => void enter(b),
          })}
          locale={{
            emptyText: (
              <Empty
                description={
                  keyword ? '没有匹配的账套，请修改搜索内容' : '还没有可用账套，可新建首个账套'
                }
              />
            ),
          }}
          columns={[
            {
              title: '账套名称 / 编号',
              render: (_, b) => (
                <>
                  <div>{b.name}</div>
                  <Typography.Text
                    type="secondary"
                    copyable={{ tooltips: ['复制账套编号', '编号已复制'] }}
                  >
                    {b.id}
                  </Typography.Text>
                </>
              ),
            },
            { title: '单位', dataIndex: 'orgName' },
            { title: '会计制度', dataIndex: 'templateName' },
            { title: '产品', render: (_, b) => productName(b.product) },
            { title: '启用年月', render: (_, b) => formatPeriod(b.startPeriod) },
            {
              title: '最近打开',
              render: (_, b) =>
                b.lastOpenedAt ? new Date(b.lastOpenedAt).toLocaleString('zh-CN') : '尚未打开',
            },
            {
              title: '操作',
              render: (_, b) => <Button onClick={() => void enter(b)}>进入</Button>,
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          各账套数据独立。文件移走或损坏后可能不出现在列表；请检查数据目录并保留原文件，使用有效备份恢复。已登录后可在账套管理查看损坏文件提示。
        </Typography.Paragraph>
        {creating && (
          <Wizard
            templateCreation={templateCreation}
            onClose={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false);
              void navigate(`/login/${id}`);
            }}
          />
        )}
      </Card>
    </div>
  );
}
