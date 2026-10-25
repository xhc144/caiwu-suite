# 轻松会计 · 出纳模块（原版静态分析）

- 安装包：`qingsong-kuaiji-setup`；程序：`rhzw9_cn0.exe`（出纳模块）；库加载顺序：rhzw9_cn0.exe、rhzw9_cn0.pbd、rhzw9_cn1.pbd、rhzw9_cn2.pbd、rhzw9_root.pbd
- 本程序加载对象：窗口 72（本文档收录本程序独有 72）、用户对象 30、菜单对象 29、全局函数 46
- 主菜单有效菜单项（不含分隔线）42 个，其中默认隐藏 9 个。

## 文档

- [menus.md](menus.md)：菜单结构（主菜单、各窗口菜单、右键菜单）
- [navigation.md](navigation.md)：启动流程、工作台、可达性
- [rules.md](rules.md)：业务规则与提示语（206 条）
- 窗口目录（按模块）：

  - [其他系统窗口（登录、备份恢复、打印、杂项）](windows/misc.md)：35 个窗口（静态可达 12，对话框 12）
  - [出纳](windows/cn.md)：25 个窗口（静态可达 21，对话框 14）
  - [打印预览](windows/preview.md)：6 个窗口（静态可达 1，对话框 0）
  - [登录](windows/login.md)：3 个窗口（静态可达 3，对话框 3）
  - [打印设置](windows/print.md)：3 个窗口（静态可达 0，对话框 3）
  - [用户对象](windows/_userobjects.md)

## 主菜单概览：出纳（`m_frame_cn`，默认可见项）

- **F.文件**：关闭窗口 Ctrl+F4、关闭所有窗口、切换套账、打印机设置、屏幕打印 Shift+P、退出系统 Alt+X
- **O日常业务**：单据录入、凭证生成、和账务对账、结账
- **S系统管理**：系统初始化、期初数录入、自动生成对方科目参数设置、反结账
- **W.窗口**：级联排列 Shift+F5、水平排列、垂直排列 Shift+F4、窗口铺满、排列图标
- **H.帮助**：版权信息、计算器 Ctrl+F12
