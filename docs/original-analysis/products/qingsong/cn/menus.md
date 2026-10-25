# 轻松会计 · 出纳模块 — 菜单结构

菜单文字、快捷键、显示状态取自菜单对象 create 事件的属性赋值；“→”为 clicked 事件中静态打开的窗口（含经全局函数打开的）。“〔默认隐藏〕”的项可能在运行时按版本、权限或 OEM 由脚本显示。PB 规则：后代菜单继承祖先全部菜单项，祖先中 ShiftToRight 的项排在后代新增项之后。

## 主菜单栏：出纳（`m_frame_cn`）——主框架默认菜单

- **F.文件** <sub>m_system</sub>
  - **关闭窗口 Ctrl+F4** 快捷键 `Ctrl+F4` → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_system_closesheet</sub>
  - **关闭所有窗口** → `w_main1_cn`「主窗口」 <sub>m_system_closeall</sub>
  - **切换套账** → `w_login`「用户登录」、`w_login_oem`「用户登录」 <sub>m_system_trans</sub>
  - ———（分隔线）
  - **打印机设置** → 脚本：`printsetup()` <sub>m_system_printset</sub>
  - **屏幕打印 Shift+P** 快捷键 `Shift+P` → 脚本：`long job` <sub>m_system_printscreen</sub>
  - **工具条设置** 〔默认隐藏〕 → `w_setbar`「工具条设置」 <sub>m_system_barset</sub>
  - ———（分隔线）
  - **系统注册** 〔默认隐藏〕 <sub>m_xtzc</sub>
  - **模块管理** 〔默认隐藏〕 → `w_module`「模块维护」 <sub>m_module</sub>
  - **操作员管理** 〔默认隐藏〕 <sub>m_useright</sub>
  - **自改密码** 〔默认隐藏〕 → `w_pass`「自改密码」 <sub>m_changepswd</sub>
  - ———（分隔线）
  - **退出系统 Alt+X** 快捷键 `Alt+X` → 脚本：`close(mainwindow)` <sub>m_system_exit</sub>
- **O日常业务** <sub>m_o</sub>
  - **单据录入** → `w_cn_lr`「单据录入」 <sub>m_o_10</sub>
  - **凭证生成** → `w_cn_pz`「凭证生成」 <sub>m_o_60</sub>
  - **和账务对账** → `w_cn_dz_xz`「选择」 <sub>m_o_20</sub>
  - **支票管理** 〔默认隐藏〕 <sub>m_o_30</sub>
  - **结账** → `w_cn_fz`「结账」 <sub>m_o_50</sub>
- **I 基础档案** 〔默认隐藏〕 <sub>m_i</sub>
  - **打印格式** <sub>m_i95</sub>
- **S系统管理** <sub>m_s</sub>
  - **系统初始化** → `w_cn_xtcsh`「出纳初始化」 <sub>m_s10</sub>
  - **期初数录入** → `w_cn_lr_qc`「单据录入」 <sub>m_s20</sub>
  - **自动生成对方科目参数设置** → `w_cn_kmsz`「自动生成对方科目参数设置」 <sub>m_o_40</sub>
  - ———（分隔线）
  - **反结账** → `w_cn_fjz`「反结账」 <sub>m_s90</sub>
- **I.自助服务** 〔默认隐藏〕 <sub>m_t</sub>
  - **客服中心** → 脚本：`f_get_kf()` <sub>m_t_10</sub>
  - **视频教程** → 脚本：`runhtml("http://rhrj.net/Aboutmenuid95.html")` <sub>m_t_20</sub>
  - **软件升级** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_30</sub>
  - **软件下载** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_60</sub>
  - **会员中心** → 脚本：`runhtml("http://www.360360.com.cn/help/default.aspx?id=1193")` <sub>m_h_40</sub>
  - **官方网站 Alt+F10** 快捷键 `Alt+F10` → 脚本：`runhtml("http://www.rhrj.net")` <sub>m_t_70</sub>
- **W.窗口** <sub>m_window</sub>
  - **级联排列 Shift+F5** 快捷键 `Shift+F5` → 脚本：`mainwindow.arrangesheets(cascade!)` <sub>m_window_cascade</sub>
  - **水平排列** → 脚本：`mainwindow.arrangesheets(tilehorizontal!)` <sub>m_window_htile</sub>
  - **垂直排列 Shift+F4** 快捷键 `Shift+F4` → 脚本：`mainwindow.arrangesheets(tile!)` <sub>m_window_vtile</sub>
  - **窗口铺满** → 脚本：`mainwindow.arrangesheets(layer!)` <sub>m_window_layer</sub>
  - ———（分隔线）
  - **排列图标** → 脚本：`mainwindow.arrangesheets(icons!)` <sub>m_window_arrangeicons</sub>
- **H.帮助** <sub>m_help</sub>
  - **系统帮助 F1** 快捷键 `F1` 〔默认隐藏〕 → 脚本：`f_get_kf()` <sub>m_help_sys</sub>
  - ———（分隔线）
  - **版权信息** → `w_cwxt`「关于」 <sub>m_help_about</sub>
  - **计算器 Ctrl+F12** 快捷键 `Ctrl+F12` → 运行 `calc.exe` <sub>m_help_calc</sub>

## 各功能窗口自带的菜单栏

MDI 程序中，打开某个功能窗口（sheet）时，菜单栏换成该窗口的菜单。下列菜单多继承主菜单，只列出新增或改写的部分。

### `m_bb_saveas`
使用窗口：`w_bb_saveas`「数据导出」

- **操作** 〔默认隐藏〕 <sub>m_bb</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_saveas")` <sub>m_bb_00</sub>
  - **复制** 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("u_copy")` <sub>m_copy</sub>
  - **粘贴** 工具栏「粘贴」 → 脚本：`this.parentwindow.triggerevent("u_paste")` <sub>m_paste</sub>
  - **退出** 工具栏「退出」 → 脚本：`close(this.parentwindow)` <sub>m_bb_05</sub>

### `m_cn_work`（继承 `m_frame_cn`）

- **O.操作** <sub>m_operation</sub>
  - **另存** → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **数据刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`this.parentwindow.triggerevent("ue_action_refresh")` <sub>m_operation_refrash</sub>
  - **数据存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **增加记录 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **拷加记录 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「拷加」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **删除记录 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_del</sub>
  - **重取记录 Ctrl+R** 快捷键 `Ctrl+R` 工具栏「重取」 → 脚本：`this.parentwindow.triggerevent("ue_action_reselectrow")` <sub>m_operation_reselectrow</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_cn_work_01`（继承 `m_frame_cn`）

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`integer i` <sub>m_operation_refrash</sub>
  - **增加 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **查看** 工具栏「查看」 → 脚本：`this.parentwindow.triggerevent("ue_action_modify")` <sub>m_operation_modify</sub>
  - **复制 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **转入** 工具栏「转入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_operation_reselectrow</sub>
  - **删除** 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_pzsc</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **综合查询** 工具栏「综查」 → 脚本：`this.parentwindow.triggerevent("ue_action_query1")` <sub>m_operation_query1</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上移  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下移   DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_cn_work_dz`（继承 `m_frame_cn`）
使用窗口：`w_cn_dz`「主从式应用示例」

- **O.操作** <sub>m_operation</sub>
  - **读入数据** 工具栏「读入」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_10</sub>
  - **勾销** 工具栏「勾销」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_20</sub>
  - **取消勾销** 工具栏「反勾销」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_30</sub>
  - ———（分隔线）
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_cn_work_get2`（继承 `m_frame_cn`）
使用窗口：`w_bb_def_cn0_bak`「格式定义」

- **O.操作** <sub>m_operation</sub>
  - **读入** 工具栏「读入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_operation_get</sub>
  - **复制 Ctrl+C** 快捷键 `Ctrl+C` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("u_copy")` <sub>m_operation_copy</sub>
  - **粘贴 Ctrl+V** 快捷键 `Ctrl+V` 工具栏「粘贴」 → 脚本：`this.parentwindow.triggerevent("u_paste")` <sub>m_paste</sub>
  - **读标准格式** → 脚本：`this.parentwindow.triggerevent("ue_action_read")` <sub>m_read</sub>
  - ———（分隔线）
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_cn_work_hz`（继承 `m_frame_cn`）
使用窗口：`w_cn_hz_1`「汇总余额表」、`w_cn_wbhz_1`「汇总余额表」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - ———（分隔线）
  - **打印预览** 工具栏「预览」 → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_preview</sub>
  - **查看帐册** 工具栏「帐册」 → 脚本：`this.parentwindow.triggerevent("ue_action_zc")` <sub>m_operation_zc</sub>
  - ———（分隔线）
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_cn_work_ll`（继承 `m_frame_cn`）
使用窗口：`w_cn_ll`「单据浏览」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`integer i` <sub>m_sx</sub>
  - **查询** 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_query</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_cn_work_lr`（继承 `m_frame_cn`）
使用窗口：`w_cn_lr`「单据录入」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **增加 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **修改** 工具栏「修改」 → 脚本：`this.parentwindow.triggerevent("ue_action_modify")` <sub>m_operation_modify</sub>
  - **删除** 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_pzsc</sub>
  - **凭证删除** 工具栏「删凭证」 → 脚本：`this.parentwindow.triggerevent("ue_action_pz_del")` <sub>m_o_pzdel</sub>
  - **批量删除** 工具栏「批删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del_all")` <sub>m_批量删除</sub>
  - **排序** 工具栏「排序」 → 脚本：`this.parentwindow.triggerevent("ue_action_sort")` <sub>m_1</sub>
  - **外部转入** 工具栏「外部转」 → 脚本：`this.parentwindow.triggerevent("ue_action_get2")` <sub>m_operation_get2</sub>
  - **账务转入** 工具栏「账务转」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_operation_get1</sub>
  - **查询** 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_query</sub>
  - ———（分隔线）
  - **日记账打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_cn_work_qclr`（继承 `m_frame_cn`）
使用窗口：`w_cn_lr_qc`「单据录入」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_refrash</sub>
  - ———（分隔线）
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_cn_work_zc_01`（继承 `m_frame_cn`）
使用窗口：`w_cn_slz_1`「出纳日记账」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - ———（分隔线）
  - **打印预览** 工具栏「预览」 → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_31</sub>
  - ———（分隔线）
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_preview_r`
使用窗口：`w_preview_base_r1`「打印预览」、`w_preview_base_r_bak`「打印预览」

- **操作** 〔默认隐藏〕 <sub>m_11</sub>
  - **上移** 工具栏「上移」 → 脚本：`this.parentwindow.triggerevent("ue_up")` <sub>m_1</sub>
  - **下移** 工具栏「下移」 → 脚本：`this.parentwindow.triggerevent("ue_down")` <sub>m_2</sub>
  - **左移** 工具栏「左移」 → 脚本：`this.parentwindow.triggerevent("ue_left")` <sub>m_3</sub>
  - **右移** 工具栏「右移」 → 脚本：`this.parentwindow.triggerevent("ue_right")` <sub>m_4</sub>
  - **放大** 工具栏「放大」 → 脚本：`this.parentwindow.triggerevent("ue_zoomout")` <sub>m_5</sub>
  - **缩小** 工具栏「缩小」 → 脚本：`this.parentwindow.triggerevent("ue_zoomin")` <sub>m_6</sub>
  - **设置** 工具栏「设置」 → 脚本：`this.parentwindow.triggerevent("ue_printer_setup")` <sub>m_7</sub>
  - **打印** 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_print")` <sub>m_8</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_saveas")` <sub>m_9</sub>
  - **退出** 工具栏「退出」 → 脚本：`this.parentwindow.triggerevent("ue_exit")` <sub>m_10</sub>

### `m_report_r`
使用窗口：`w_preview_report_base`「报表查询」

- **操作** 〔默认隐藏〕 <sub>m_11</sub>
  - **上移** 工具栏「上移」 → 脚本：`this.parentwindow.triggerevent("ue_up")` <sub>m_1</sub>
  - **下移** 工具栏「下移」 → 脚本：`this.parentwindow.triggerevent("ue_down")` <sub>m_2</sub>
  - **左移** 工具栏「左移」 → 脚本：`this.parentwindow.triggerevent("ue_left")` <sub>m_3</sub>
  - **右移** 工具栏「右移」 → 脚本：`this.parentwindow.triggerevent("ue_right")` <sub>m_4</sub>
  - **放大** 工具栏「放大」 → 脚本：`this.parentwindow.triggerevent("ue_zoomout")` <sub>m_5</sub>
  - **缩小** 工具栏「缩小」 → 脚本：`this.parentwindow.triggerevent("ue_zoomin")` <sub>m_6</sub>
  - **设置** 工具栏「设置」 → 脚本：`this.parentwindow.triggerevent("ue_printer_setup")` <sub>m_7</sub>
  - **打印** 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_print")` <sub>m_8</sub>
  - **查询** 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_query")` <sub>m_12</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_saveas")` <sub>m_9</sub>
  - **退出** 工具栏「退出」 → 脚本：`this.parentwindow.triggerevent("ue_exit")` <sub>m_10</sub>

### `m_work`（继承 `m_frame_cn`）
使用窗口：`w_err_view`「错误查看」、`w_module`「模块维护」、`w_users`「用户/组维护」、`wroot_fix_query`「固定查询及统计」、`wroot_md`「主从式应用示例」、`wroot_md_2`「主从式应用示例」、`wroot_mds`「共享式 + 主从式应用示例」、`wroot_share`「共享式应用」、`wroot_share_tab`「共享式应用(TAB)」、`wroot_sheet`「wroot_sheet」、`wroot_single`「单一式应用」

- **O.操作** <sub>m_operation</sub>
  - **另存** → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **数据刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`this.parentwindow.triggerevent("ue_action_refresh")` <sub>m_operation_refrash</sub>
  - **数据存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **增加记录 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **拷加记录 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「拷加」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **删除记录 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_del</sub>
  - **重取记录 Ctrl+R** 快捷键 `Ctrl+R` 工具栏「重取」 → 脚本：`this.parentwindow.triggerevent("ue_action_reselectrow")` <sub>m_operation_reselectrow</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_01`（继承 `m_frame_cn`）
使用窗口：`wroot_md2`「wroot_sheet（继承自祖先）」、`wroot_md2_1`「wroot_sheet（继承自祖先）」、`wroot_single_1`「单一式应用」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`integer i` <sub>m_operation_refrash</sub>
  - **增加 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **查看** 工具栏「查看」 → 脚本：`this.parentwindow.triggerevent("ue_action_modify")` <sub>m_operation_modify</sub>
  - **复制 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **转入** 工具栏「转入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_operation_reselectrow</sub>
  - **删除** 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_pzsc</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **综合查询** 工具栏「综查」 → 脚本：`this.parentwindow.triggerevent("ue_action_query1")` <sub>m_operation_query1</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上移  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下移   DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_dz`（继承 `m_frame_cn`）

- **O.操作** <sub>m_operation</sub>
  - **读入数据** 工具栏「读入」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_10</sub>
  - **勾销** 工具栏「勾销」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_20</sub>
  - **取消勾销** 工具栏「反勾销」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_30</sub>
  - ———（分隔线）
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_get2`（继承 `m_frame_cn`）

- **O.操作** <sub>m_operation</sub>
  - **读入** 工具栏「读入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_operation_get</sub>
  - **复制 Ctrl+C** 快捷键 `Ctrl+C` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("u_copy")` <sub>m_operation_copy</sub>
  - **粘贴 Ctrl+V** 快捷键 `Ctrl+V` 工具栏「粘贴」 → 脚本：`this.parentwindow.triggerevent("u_paste")` <sub>m_paste</sub>
  - **读标准格式** → 脚本：`this.parentwindow.triggerevent("ue_action_read")` <sub>m_read</sub>
  - ———（分隔线）
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_hz`（继承 `m_frame_cn`）

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - ———（分隔线）
  - **打印预览** 工具栏「预览」 → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_preview</sub>
  - **查看帐册** 工具栏「帐册」 → 脚本：`this.parentwindow.triggerevent("ue_action_zc")` <sub>m_operation_zc</sub>
  - ———（分隔线）
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_lr`（继承 `m_frame_cn`）

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **增加 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **修改** 工具栏「修改」 → 脚本：`this.parentwindow.triggerevent("ue_action_modify")` <sub>m_operation_modify</sub>
  - **删除** 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_pzsc</sub>
  - **批量删除** 工具栏「批删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del_all")` <sub>m_批量删除</sub>
  - **外部转入** 工具栏「外部转」 → 脚本：`this.parentwindow.triggerevent("ue_action_get2")` <sub>m_operation_get2</sub>
  - **账务转入** 工具栏「账务转」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_operation_get1</sub>
  - **查询** 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_query</sub>
  - ———（分隔线）
  - **日记账打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_qclr`（继承 `m_frame_cn`）

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_refrash</sub>
  - ———（分隔线）
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_zc_01`（继承 `m_frame_cn`）

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **批量导出** → 脚本：`this.parentwindow.triggerevent("ue_saveas")` <sub>m_operation_out</sub>
  - **重新选择** 工具栏「重选」 → 脚本：`this.parentwindow.triggerevent("u_open")` <sub>m_operation_open</sub>
  - **排序** 工具栏「排序」 → 脚本：`this.parentwindow.triggerevent("u_sort")` <sub>m_operation_sort</sub>
  - **修改** → 脚本：`this.parentwindow.triggerevent("ue_action_modify")` <sub>m_operation_modify</sub>
  - ———（分隔线）
  - **打印预览** 工具栏「预览」 → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_31</sub>
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("user_prt")` <sub>m_operation_print</sub>
  - **连续打印** 工具栏「连打」 → 脚本：`this.parentwindow.triggerevent("user_prt_lx")` <sub>m_operation_print1</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("x1")` <sub>m_move_first</sub>
    - **上移  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("x3")` <sub>m_move_prior</sub>
    - **下移   DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("x4")` <sub>m_move_next</sub>
    - **尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("x2")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

## 右键/弹出菜单

### `m_bb_saveas_get`

- **操作** 〔默认隐藏〕 <sub>m_bb</sub>
  - **读入** 工具栏「读入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_bb_get</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_saveas")` <sub>m_bb_00</sub>
  - **复制** 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("u_copy")` <sub>m_copy</sub>
  - **粘贴** 工具栏「粘贴」 → 脚本：`this.parentwindow.triggerevent("u_paste")` <sub>m_paste</sub>
  - **退出** 工具栏「退出」 → 脚本：`close(this.parentwindow)` <sub>m_bb_05</sub>

### `m_cpq_rbutton_paste`

- **a1** <sub>m_1</sub>
  - **V.取现有值** → `w_paste`「请选择粘贴值」 <sub>m_value</sub>
  - **D.清除本列** → 脚本：`datawindow dwp` <sub>m_clear</sub>
  - **N.返回** <sub>m_return</sub>

### `m_cpq_rbutton_select`

- **a1** <sub>m_1</sub>
  - **A.选择所有列** → 脚本：`long i` <sub>m_selectall</sub>
  - **D.去掉所有列** → 脚本：`long i` <sub>m_unselectall</sub>
  - **N.返回** <sub>m_return</sub>

### `m_rbtn_paste`

- **a1** <sub>m_1</sub>
  - **H.帮助 Shift+F1** 快捷键 `Shift+F1` 〔默认禁用〕 → 脚本：`message.stringparm = "help"` <sub>m_help</sub>
  - ———（分隔线）
  - **U.取消上次操作 Ctrl+Z** 快捷键 `Ctrl+Z` → 脚本：`message.stringparm = "undo"` <sub>m_undo</sub>
  - ———（分隔线）
  - **T.剪切 Ctrl+X** 快捷键 `Ctrl+X` → 脚本：`message.stringparm = "cut"` <sub>m_cut</sub>
  - **C.拷贝 Ctrl+C** 快捷键 `Ctrl+C` → 脚本：`message.stringparm = "copy"` <sub>m_copy</sub>
  - **P.粘贴 Ctrl+V** 快捷键 `Ctrl+V` → 脚本：`message.stringparm = "paste"` <sub>m_paste</sub>
  - **L.清除 Del** 快捷键 `Delete` → 脚本：`message.stringparm = "clear"` <sub>m_clear</sub>
  - ———（分隔线）
  - **S.选中当前列 Ctrl+A** 快捷键 `Ctrl+A` → 脚本：`message.stringparm = "selectall"` <sub>m_s</sub>

### `m_rbtn_preview`

- **Preview** <sub>m_1</sub>
  - **预览** → 脚本：`message.stringparm = "preview"` <sub>m_preview</sub>
  - **标尺** → 脚本：`message.stringparm = "rulers"` <sub>m_rulers</sub>
  - ———（分隔线）
  - **200%** → 脚本：`message.stringparm = "200"` <sub>m_200</sub>
  - **100%** → 脚本：`message.stringparm = "100"` <sub>m_100</sub>
  - **75%** → 脚本：`message.stringparm = "75"` <sub>m_75</sub>
  - **50%** → 脚本：`message.stringparm = "50"` <sub>m_50</sub>
  - **25%** → 脚本：`message.stringparm = "25"` <sub>m_25</sub>
  - ———（分隔线）
  - **定制** → 脚本：`message.stringparm = "custom"` <sub>m_custom</sub>

### `m_rbutton`

- **a1** <sub>m_1</sub>
  - **A.插入一行** → 脚本：`message.stringparm = "insertrow"` <sub>m_add</sub>
  - **D.删除一行** → 脚本：`message.stringparm = "deleterow"` <sub>m_deletearow</sub>
  - **N.返回** <sub>m_return</sub>

### `m_root`

- **F.文件** <sub>m_system</sub>
  - **关闭窗口 Ctrl+F4** 快捷键 `Ctrl+F4` → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_system_closesheet</sub>
  - **关闭所有窗口** → `w_main1_cn`「主窗口」 <sub>m_system_closeall</sub>
  - **切换套账** → `w_login`「用户登录」、`w_login_oem`「用户登录」 <sub>m_system_trans</sub>
  - ———（分隔线）
  - **打印机设置** → 脚本：`printsetup()` <sub>m_system_printset</sub>
  - **屏幕打印 Shift+P** 快捷键 `Shift+P` → 脚本：`long job` <sub>m_system_printscreen</sub>
  - **工具条设置** 〔默认隐藏〕 → `w_setbar`「工具条设置」 <sub>m_system_barset</sub>
  - ———（分隔线）
  - **系统注册** 〔默认隐藏〕 <sub>m_xtzc</sub>
  - **模块管理** 〔默认隐藏〕 → `w_module`「模块维护」 <sub>m_module</sub>
  - **操作员管理** 〔默认隐藏〕 <sub>m_useright</sub>
  - **自改密码** → `w_pass`「自改密码」 <sub>m_changepswd</sub>
  - ———（分隔线）
  - **退出系统 Alt+X** 快捷键 `Alt+X` → 脚本：`close(mainwindow)` <sub>m_system_exit</sub>
- **I.自助服务** 〔默认隐藏〕 <sub>m_t</sub>
  - **客服中心** → 脚本：`f_get_kf()` <sub>m_t_10</sub>
  - **视频教程** → 脚本：`runhtml("http://rhrj.net/Aboutmenuid95.html")` <sub>m_t_20</sub>
  - **软件升级** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_30</sub>
  - **软件下载** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_60</sub>
  - **会员中心** → 脚本：`runhtml("http://www.360360.com.cn/help/default.aspx?id=1193")` <sub>m_h_40</sub>
  - **官方网站 Alt+F10** 快捷键 `Alt+F10` → 脚本：`runhtml("http://www.rhrj.net")` <sub>m_t_70</sub>
- **W.窗口** <sub>m_window</sub>
  - **级联排列 Shift+F5** 快捷键 `Shift+F5` → 脚本：`mainwindow.arrangesheets(cascade!)` <sub>m_window_cascade</sub>
  - **水平排列** → 脚本：`mainwindow.arrangesheets(tilehorizontal!)` <sub>m_window_htile</sub>
  - **垂直排列 Shift+F4** 快捷键 `Shift+F4` → 脚本：`mainwindow.arrangesheets(tile!)` <sub>m_window_vtile</sub>
  - **窗口铺满** → 脚本：`mainwindow.arrangesheets(layer!)` <sub>m_window_layer</sub>
  - ———（分隔线）
  - **排列图标** → 脚本：`mainwindow.arrangesheets(icons!)` <sub>m_window_arrangeicons</sub>
- **H.帮助** <sub>m_help</sub>
  - **系统帮助 F1** 快捷键 `F1` 〔默认隐藏〕 → 脚本：`f_get_kf()` <sub>m_help_sys</sub>
  - ———（分隔线）
  - **版权信息** → `w_cwxt`「关于」 <sub>m_help_about</sub>
  - **计算器 Ctrl+F12** 快捷键 `Ctrl+F12` → 运行 `calc.exe` <sub>m_help_calc</sub>

### `m_treeview_rbutton`

- **a1** <sub>m_1</sub>
  - **扩展所有项** → 脚本：`message.stringparm = "expandall"` <sub>m_expandall</sub>
  - ———（分隔线）
  - **关闭所有项** → 脚本：`message.stringparm = "unexpandall"` <sub>m_unexpandall</sub>
