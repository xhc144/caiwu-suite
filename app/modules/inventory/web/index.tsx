import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [
    { path: '/master', title: '产品与仓库', component: lazy(() => import('./MasterPage')) },
    { path: '/opening', title: '库存期初', component: lazy(() => import('./OpeningPage')) },
    { path: '/receipts', title: '入库单管理', component: lazy(() => import('./DocumentPage')) },
    { path: '/issues', title: '出库单管理', component: lazy(() => import('./DocumentPage')) },
    { path: '/transfers', title: '仓库调拨', component: lazy(() => import('./TransferPage')) },
    { path: '/query', title: '单据综合查询', component: lazy(() => import('./QueryPage')) },
    { path: '/contracts', title: '采购合同', component: lazy(() => import('./ContractPage')) },
    { path: '/stock', title: '库存与台账', component: lazy(() => import('./StockPage')) },
    { path: '/counts', title: '月末盘点', component: lazy(() => import('./CountPage')) },
    { path: '/reports', title: '汇总与销售明细', component: lazy(() => import('./ReportPage')) },
    { path: '/settings', title: '仓库设置', component: lazy(() => import('./SettingsPage')) },
  ],
});
