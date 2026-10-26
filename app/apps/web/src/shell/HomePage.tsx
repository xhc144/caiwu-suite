import { Card, Col, Descriptions, Empty, Row, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { MENU_GROUPS, formatCodeScheme, formatPeriod, productName } from '@caiwu/core';
import { coreApi, useBootstrap, useRequiredSession } from '@caiwu/web-kit';
import { PageContainer } from '@caiwu/ui';
import { visibleModules } from '../modules';
import { buildNavItems } from './NavMenu';

/** 壳自带的简易首页。工作台模块（manifest.entryPages 含 home）会替换它。 */
export function HomePage() {
  const session = useRequiredSession();
  const navigate = useNavigate();
  const boot = useBootstrap();
  const me = useQuery(coreApi.auth.me.queryOptions());
  const items = buildNavItems(
    visibleModules(session.book.product, boot?.devMode ?? false),
    session.user,
  );
  const groups = MENU_GROUPS.map((g) => ({
    g,
    list: items.filter((i) => i.groupId === g.id),
  })).filter((x) => x.list.length);
  return (
    <PageContainer
      title={`你好，${session.user.name}`}
      subtitle={`${session.book.orgName} · ${productName(session.book.product)}`}
    >
      <Card size="small">
        <Descriptions size="small" column={{ xs: 1, md: 3 }}>
          <Descriptions.Item label="账套">{session.book.name}</Descriptions.Item>
          <Descriptions.Item label="会计制度">{session.book.templateName}</Descriptions.Item>
          <Descriptions.Item label="科目级次">
            {formatCodeScheme(session.book.codeScheme)}
          </Descriptions.Item>
          <Descriptions.Item label="启用期间">
            {formatPeriod(session.book.startPeriod)}
          </Descriptions.Item>
          <Descriptions.Item label="当前期间">
            {me.data?.currentPeriod ? formatPeriod(me.data.currentPeriod.period) : '—'}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      {groups.length === 0 ? (
        <Empty description="还没有可用的功能模块" />
      ) : (
        <Row gutter={[12, 12]}>
          {groups.map(({ g, list }) => (
            <Col key={g.id} xs={24} md={12} xl={8}>
              <Card size="small" title={g.title}>
                {list.map((i) => (
                  <Typography.Link
                    key={i.key}
                    onClick={() => void navigate(i.to)}
                    style={{ display: 'inline-block', marginRight: 16, marginBottom: 6 }}
                  >
                    {i.title}
                  </Typography.Link>
                ))}
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </PageContainer>
  );
}
