import { useState } from 'react';
import { App, Button, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { queryClient, showError, usePermission, useSubmission } from '@caiwu/web-kit';
import { DataTable, PageContainer } from '@caiwu/ui';
import { api } from './api';
import { NoPermission, ReportError } from './common';
import ResultEditor, { type ResultDraft } from './ResultEditor';

export default function ResultsPage() {
  const canView = usePermission('analysis.view');
  const canEdit = usePermission('analysis.definition.edit');
  const { modal } = App.useApp();
  const query = useQuery({ ...api.results.list.queryOptions(), enabled: canView });
  const [opened, setOpened] = useState<ResultDraft>();
  const { submit, isSubmitting } = useSubmission();
  const remove = useMutation(
    api.results.remove.mutationOptions({
      onSuccess: () => {
        void query.refetch();
      },
    }),
  );
  const open = (id: number) =>
    submit(async () => {
      const value = await queryClient.fetchQuery({
        ...api.results.get.queryOptions({ id }),
        staleTime: 0,
      });
      setOpened(value);
    });
  return (
    <PageContainer
      title="已保存分析结果"
      extra={
        <Space>
          <Link to="/m/analysis">科目分析</Link>
          <Link to="/m/analysis/custom">自定义分析表</Link>
        </Space>
      }
    >
      {!canView ? (
        <NoPermission />
      ) : (
        <>
          <Button loading={query.isFetching} onClick={() => void query.refetch()}>
            刷新列表
          </Button>
          {query.isError && <ReportError error={query.error} retry={() => void query.refetch()} />}
          <DataTable
            tableId="analysis.results"
            rowKey="id"
            dataSource={query.data ?? []}
            loading={query.isFetching}
            locale={{ emptyText: '还没有保存结果，请先完成一次科目或自定义分析' }}
            columns={[
              { title: '结果名称', dataIndex: 'name', key: 'name', width: 220 },
              {
                title: '类型',
                key: 'kind',
                width: 120,
                render: (_, r) => (r.kind === 'trend' ? '科目分析' : '自定义分析'),
              },
              { title: '开始期间', dataIndex: 'period_from', key: 'from', width: 110 },
              { title: '结束期间', dataIndex: 'period_to', key: 'to', width: 110 },
              { title: '最后保存', dataIndex: 'updated_at', key: 'date', width: 240 },
              {
                title: '操作',
                key: 'actions',
                width: 180,
                render: (_, r) => (
                  <Space>
                    <Button
                      disabled={isSubmitting}
                      onClick={() => void open(r.id).catch(showError)}
                    >
                      打开结果
                    </Button>
                    {canEdit && (
                      <Button
                        danger
                        loading={remove.isPending}
                        onClick={() =>
                          modal.confirm({
                            title: `删除“${r.name}”？`,
                            content: '删除后不能恢复，请确认所选分析结果。',
                            okText: '确认删除',
                            cancelText: '取消',
                            onOk: () =>
                              remove.mutateAsync({
                                id: r.id,
                                expectedRevision: r.revision,
                                confirmed: true,
                              }),
                          })
                        }
                      >
                        删除
                      </Button>
                    )}
                  </Space>
                ),
              },
            ]}
          />
          {opened && (
            <ResultEditor
              key={`${opened.id}-${opened.revision}`}
              initial={opened}
              onClose={() => setOpened(undefined)}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}
