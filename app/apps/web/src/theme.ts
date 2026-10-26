import type { ThemeConfig } from 'antd';

/** 全局主题：紧凑、清爽，适合数据密集的财务界面。 */
export const theme: ThemeConfig = {
  token: {
    colorPrimary: '#1f6feb',
    borderRadius: 6,
    fontSize: 13,
    controlHeight: 30,
    fontFamily:
      '"PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif',
  },
  components: {
    Layout: {
      headerHeight: 48,
      headerPadding: '0 16px',
      headerBg: '#ffffff',
      siderBg: '#ffffff',
      bodyBg: '#f5f6f8',
    },
    Table: { cellPaddingBlockSM: 4, headerBg: '#f7f8fa' },
    Menu: { itemHeight: 34, subMenuItemBg: '#ffffff' },
    Tabs: { cardHeight: 34 },
  },
};
