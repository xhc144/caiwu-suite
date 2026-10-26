import { Button, Card, Empty, List, Space, Tag, Typography } from 'antd';
import { PlusOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { formatPeriod, productName } from '@caiwu/core';
import { coreApi } from '@caiwu/web-kit';
import { CreateBookDialog } from './CreateBookDialog';

/** 壳自带的账套选择页。账套管理模块（manifest.entryPages 含 bookPicker）会替换它。 */
export function BookPickerPage() {
  const navigate = useNavigate();
  const books = useQuery(coreApi.books.list.queryOptions());
  const [creating, setCreating] = useState(false);
  return (
    <div className="cw-center-page">
      <Card
        style={{ width: 760, maxWidth: '100%' }}
        title={
          <Space>
            <FolderOpenOutlined />
            选择账套
          </Space>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            新建账套
          </Button>
        }
      >
        <List
          loading={books.isLoading}
          dataSource={books.data ?? []}
          locale={{ emptyText: <Empty description="还没有账套，先新建一个" /> }}
          renderItem={(b) => (
            <List.Item
              actions={[
                <Button
                  key="open"
                  type="primary"
                  ghost
                  onClick={() => void navigate(`/login/${b.id}`)}
                >
                  进入
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Typography.Text strong>{b.name}</Typography.Text>
                    <Tag color="blue">{productName(b.product)}</Tag>
                  </Space>
                }
                description={
                  <Space separator="·" wrap>
                    <span>{b.orgName}</span>
                    <span>{b.templateName}</span>
                    <span>{formatPeriod(b.startPeriod)}启用</span>
                    {b.lastOpenedAt && (
                      <span>上次使用 {new Date(b.lastOpenedAt).toLocaleString('zh-CN')}</span>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>
      <CreateBookDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          void books.refetch();
          void navigate(`/login/${id}`);
        }}
      />
    </div>
  );
}
