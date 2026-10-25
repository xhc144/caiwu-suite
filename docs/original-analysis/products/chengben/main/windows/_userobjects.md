# 成本会计 · 账务+成本主程序 — 用户对象（可复用面板/控件）

### n_cst_numerical

- 类型：用户对象；继承：`pfc_n_cst_numerical`；库：rhzw8_8.pbd（账务+成本主程序）

### n_pfc_appsrv

- 类型：用户对象；继承：`pfc_appsrv`；库：rhzw8_8.pbd（账务+成本主程序）

- 窗口事件/函数：
  - `pfc_open`：打开 `w_logo`、`w_xt_szb_zc`「时钟版新用户注册」、`w_xt_szb_xf`「系统续费提示」、`w_frame`「Frame」；读写表 dba、sys
  - `pfc_idle`：打开 `w_idle`
  - `pfc_systemerror`：打开 `w_system_error`「System Error」

- 提示与校验（7 条）：
  - [窗口事件 pfc_open]「配置文件的配置有误,  其Application节的DatabaseName  小节的值不应为空.」（条件：`dbname = ""`）
  - [窗口事件 pfc_open]「与网络数据库联接失败！~r请检查您的电脑可以连到互联网！」（条件：`it_rhzw.sqlcode = -1`）
  - [窗口事件 pfc_open]「您的数据记录有问题，请电话：18026265612 ~r 时钟版授权码：」（条件：`isnull(d_d1)`）
  - [窗口事件 pfc_open]「感谢您的支持与配合，我们会一如既往为您提供便捷、贴心的服务！」
  - [窗口事件 pfc_open]「您使用的随身版软件为盗版！~r ~r 请和卖您软件的人联系！~r ~r 正版软件购买联系方式：QQ 800003004 ~r ~r 电话微信同号  13312858385」（条件：`len(s_no) >= 50 and string(gd_tt,"yyyy-mm-dd") <> "1965-05-10"`）
  - [窗口事件 pfc_open]「您使用的随身版软件为盗版！~r ~r 请和卖您软件的人联系！~r ~r 正版软件购买联系方式：QQ 800003004」（条件：`string(gd_tt,"yyyy-mm-dd") <> "2063-05-10"`）
  - [窗口事件 pfc_close]「不能关闭数据库,」（条件：`sqlca.sqlcode <> 0`）

### nv_compression

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw_ROOT.pbd（账务+成本主程序）

- 提示与校验（1 条）：
  - [窗口事件 of_uncompress_1]「此文件非备份文件」（条件：`bz = "0"`）

### nvo_comctl_datetime

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw_ROOT.pbd（账务+成本主程序）

### nvo_excel

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw_ROOT.pbd（账务+成本主程序）

- 窗口事件/函数：
  - `uf_initcolumn`：数据窗口 `dw_excel_columns`

- 提示与校验（2 条）：
  - [窗口事件 uf_datatoexcel]「无法连接到操作系统里的 EXCEL 服务器！  请检查您的计算机中是否正确安装了MS EXCEL ！」（条件：`xlapp.connecttonewobject("Excel.Application") < 0`）
  - [窗口事件 uf_datatoexcel]「由于您的列数超过excel限制，我们只能导出部分内容！」（条件：`l_cols > 255`）

### nvo_formone6

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw_ROOT.pbd（账务+成本主程序）

- 窗口事件/函数：
  - `uf_datatoexcel`：打开 `w_bb_saveas`「数据导出」
  - `uf_initcolumn`：数据窗口 `dw_excel_columns`

### nvo_formone6_bak

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw_ROOT.pbd（账务+成本主程序）

- 窗口事件/函数：
  - `uf_datatoexcel`：打开 `w_bb_saveas`「数据导出」
  - `uf_initcolumn`：数据窗口 `dw_excel_columns`

- 提示与校验（1 条）：
  - [窗口事件 uf_datatoexcel]「你需要另存的列过多，系统最多只支持256列！」（条件：`l_cols > 256`）

### nvo_md5

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw_ROOT.pbd（账务+成本主程序）

- 提示与校验（1 条）：
  - [窗口事件 uf_lshift]「Err」（条件：`ps_ishiftbits < 0 or ps_ishiftbits > 31`）

### nvo_public_function

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw8_9.pbd（账务+成本主程序）

- 提示与校验（1 条）：
  - [窗口事件 uf_about]「PowerBuilder 扩充 函数 集 v1.02 程序 编写：天津 王健辉  有关 版权说明 请见 用户对象 nvo_public_function 中 constructor 事件中的注释部分      _____ _______         ____   ___          ___     \|__ 」

### pfc_appsrv

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw8_8.pbd（账务+成本主程序）

- 窗口事件/函数：
  - `pfc_open`：打开 `w_logo`、`w_xt_szb_zc`「时钟版新用户注册」、`w_xt_szb_xf`「系统续费提示」、`w_frame`「Frame」；读写表 dba、sys
  - `pfc_idle`：打开 `w_idle`
  - `pfc_systemerror`：打开 `w_system_error`「System Error」

- 提示与校验（7 条）：
  - [窗口事件 pfc_open]「配置文件的配置有误,  其Application节的DatabaseName  小节的值不应为空.」（条件：`dbname = ""`）
  - [窗口事件 pfc_open]「与网络数据库联接失败！~r请检查您的电脑可以连到互联网！」（条件：`it_rhzw.sqlcode = -1`）
  - [窗口事件 pfc_open]「您的数据记录有问题，请电话：18026265612 ~r 时钟版授权码：」（条件：`isnull(d_d1)`）
  - [窗口事件 pfc_open]「感谢您的支持与配合，我们会一如既往为您提供便捷、贴心的服务！」
  - [窗口事件 pfc_open]「您使用的随身版软件为盗版！~r ~r 请和卖您软件的人联系！~r ~r 正版软件购买联系方式：QQ 800003004 ~r ~r 电话微信同号  13312858385」（条件：`len(s_no) >= 50 and string(gd_tt,"yyyy-mm-dd") <> "1965-05-10"`）
  - [窗口事件 pfc_open]「您使用的随身版软件为盗版！~r ~r 请和卖您软件的人联系！~r ~r 正版软件购买联系方式：QQ 800003004」（条件：`string(gd_tt,"yyyy-mm-dd") <> "2063-05-10"`）
  - [窗口事件 pfc_close]「不能关闭数据库,」（条件：`sqlca.sqlcode <> 0`）

### pfc_dwsrv

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw_ROOT.pbd（账务+成本主程序）

- 窗口事件/函数：
  - `pfc_rbuttondown_preview`：打开 `w_zoom`「定制」
  - `pfc_printstart`：打开 `w_print_1`「打印」
  - `pfc_retrievestart`：打开 `w_retrieve_wait`「提示窗口」
  - `pfc_sqlpreview`：打开 `w_retrieve_wait`「提示窗口」

### pfc_n_cst_datetime

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw_ROOT.pbd（账务+成本主程序）

### pfc_n_cst_numerical

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw8_8.pbd（账务+成本主程序）

### pfc_n_cst_resize

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw_ROOT.pbd（账务+成本主程序）

### pfc_n_cst_string

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw_ROOT.pbd（账务+成本主程序）

### u_menuseperator

- 类型：用户对象；尺寸：8201×8 PBU；库：rhzw_ROOT.pbd（账务+成本主程序）

### u_pb_calendar

- 类型：用户对象；尺寸：2665×860 PBU；库：rhzw_ROOT.pbd（账务+成本主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_backmonth | 按钮 | < | 78, 50×84 |  |
| cb_backyear | 按钮 | < | , 78×84 |  |
| cb_close | 按钮 | X | 622,568 82×60 |  |
| cb_forwardmonth | 按钮 | > | 581, 50×84 |  |
| cb_forwardyear | 按钮 | > | 631, 78×84 |  |
| dw_cal | 数据窗口 |  | , 736×656 | 数据窗口 `d_calendar` |
| lb_1 | 列表框 |  | 891,8 1733×756 |  |

- 提示与校验（3 条）：
  - [窗口事件 constructor]「Invalid datawindow set in the structure.」（条件：`not isvalid(this.i_dw)`）
  - [窗口事件 constructor]「Invalid row number set in the structure.」（条件：`this.i_dw.rowcount() >= this.il_row and this.il_row > 0`）
  - [dw_cal.clicked]「Add code to u_pb_calendar constructor, clicked for dw_cal events, and add a new uo_1 instance variable type.」

### u_space

- 类型：用户对象；尺寸：18×160 PBU；库：rhzw_ROOT.pbd（账务+成本主程序）

### u_toolbar

- 类型：用户对象；尺寸：5463×208 PBU；库：rhzw_ROOT.pbd（账务+成本主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| uo_1 | u_menuseperator |  | ,180 × |  |
| uo_menuseperator | u_menuseperator |  | , × |  |

- 提示与校验（4 条）：
  - [窗口事件 destructor]「Error deleting toolbutton」（条件：`this.iwindow.closeuserobject(this.itbn_toolbutton[li_buttoncount]) = -1`）
  - [窗口事件 pf_addtotoolbar]「Error adding toolbar button」（条件：`this.iwindow.openuserobject(ltbn) = -1`）
  - [窗口事件 pf_addtotoolbar]「Error adding Space」（条件：`this.iwindow.openuserobject(lsp) = -1`）
  - [窗口事件 pf_addtotoolbar]「Cannot register object in the toolwindow control!」（条件：`this.tooltipmsg(this.hwndtt,1028,0,toolinfo) = 0`）

### u_toolbutton

- 类型：用户对象；尺寸：183×168 PBU；库：rhzw_ROOT.pbd（账务+成本主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| lv_bitmap | 列表视图 |  | 41,20 101×64 |  |

### unov_ping

- 类型：用户对象；继承：`nonvisualobject`；库：rhzw8_8.pbd（账务+成本主程序）

- 提示与校验（2 条）：
  - [窗口事件 socketscleanup]「occurred in Cleanup.」（条件：`x <> 0`）
  - [窗口事件 socketsinitialize]「environments is not successfully responding.」（条件：`x <> 0`）

### uo_cmdbtn

- 类型：用户对象；尺寸：316×109 PBU；继承：`commandbutton`；库：rhzw_ROOT.pbd（账务+成本主程序）

### uo_comctl_datetime

- 类型：用户对象；尺寸：507×100 PBU；库：rhzw_ROOT.pbd（账务+成本主程序）

### uo_ds_base

- 类型：用户对象；继承：`datastore`；库：rhzw_ROOT.pbd（账务+成本主程序）

### uo_dw

- 类型：用户对象；尺寸：1070×501 PBU；继承：`datawindow`；库：rhzw_ROOT.pbd（账务+成本主程序）

### uo_dw_

- 类型：用户对象；尺寸：1070×501 PBU；继承：`datawindow`；库：rhzw_ROOT.pbd（账务+成本主程序）

### uo_dw_query

- 类型：用户对象；尺寸：2305×449 PBU；继承：`datawindow`；库：rhzw_ROOT.pbd（账务+成本主程序）

- 窗口事件/函数：
  - `ue_post_constructor`：数据窗口 `d_column_set`

- 提示与校验（6 条）：
  - [窗口事件 ue_where]「,请改正；  否则，所有查询条件将被忽略。」（条件：`i > 0`）
  - [窗口事件 ue_where]「不是字符型,不能使用<含有>或<不含有>操作符,  请改正; 否则，所有查询条件将被忽略。」（条件：`trim(soper) = "like" or trim(soper) = "not like"`）
  - [窗口事件 ue_where]「的值应为数字型,请改正；  否则，所有查询条件将被忽略。」（条件：`isnumber(svalue)`）
  - [窗口事件 ue_where]「的值应为日期型,请改正;  否则,所有查询条件将被忽略.」（条件：`not isdate(svalue)`）
  - [窗口事件 ue_where]「的值应为日期时间型,请改正；  否则，所有查询条件将被忽略。」（条件：`svalue = "error"`）
  - [窗口事件 ue_where]「这个数据类型未在本模块中定义。」

### uo_dw_share_detail

- 类型：用户对象；尺寸：1070×501 PBU；继承：`uo_dw`；库：rhzw_ROOT.pbd（账务+成本主程序）

- 提示与校验（1 条）：
  - [窗口事件 constructor]「Not found dw_master」（条件：`not isvalid(this.dw_master)`）

### uo_dw_share_master

- 类型：用户对象；尺寸：1070×501 PBU；继承：`uo_dw`；库：rhzw_ROOT.pbd（账务+成本主程序）

- 窗口事件/函数：
  - `ue_action_query`：打开 `wroot_dw_query`「条件搜索」

- 提示与校验（5 条）：
  - [窗口事件 constructor]「Not found dw_detail」（条件：`not isvalid(this.dw_detail)`）
  - [窗口事件 ue_action_del]「删除本条数据，请确认。」（条件：`l_status = new!`）
  - [窗口事件 ue_action_del]「存入失败，数据没有删除。」
  - [窗口事件 ue_action_refresh]「数据还没有存盘，刷新前是否存盘?」（条件：`this.ib_need_save`）
  - [窗口事件 ue_action_save]「此处数据错误，请重新输入。」（条件：`this.dw_detail.accepttext() = -1`）

### uo_dw_single

- 类型：用户对象；尺寸：1070×501 PBU；继承：`uo_dw`；库：rhzw_ROOT.pbd（账务+成本主程序）

- 窗口事件/函数：
  - `ue_action_query`：打开 `wroot_dw_query`「条件搜索」

- 提示与校验（5 条）：
  - [窗口事件 ue_save_exit]「数据还没有存盘，退出前是否存盘?」（条件：`this.ib_need_save`）
  - [窗口事件 ue_action_del]「删除本条数据，请确认。」（条件：`l_status = new!`）
  - [窗口事件 ue_action_del]「存入失败，数据没有删除。」（条件：`this.update() = 1`）
  - [窗口事件 ue_action_refresh]「数据还没有存盘，刷新前是否存盘?」（条件：`this.ib_need_save`）
  - [窗口事件 ue_action_save]「此处数据错误，请重新输入。」（条件：`this.accepttext() = -1`）

### uo_getjoins

- 类型：用户对象；尺寸：2830×1197 PBU；库：rhzw_ROOT.pbd（账务+成本主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_all_joins_for_v0 | 数据窗口 |  | 860,9 1907×685 | 数据窗口 `d_all_joins_for_v0`；列：a1（A1）、a2（A2）、a3（A3）、a4（A4）、a5（A5）、a6（A6）、a7（A7）、a8（A8）、a9（A9）、a10（A10）、a11（A11）、a12（A12）、a13（A13）、a14（A14）、a15（A15） |
| dw_original_joins | 数据窗口 |  | 10,9 828×685 | 数据窗口 `d_original_joins`；列：table1（Table1）、col1（Col1）、oper（Oper）、table2（Table2）、col2（Col2）、tag（Tag） |
| dw_result_tmp | 数据窗口 |  | 860,705 1907×449 | 数据窗口 `d_all_joins_for_v0`；列：a1（A1）、a2（A2）、a3（A3）、a4（A4）、a5（A5）、a6（A6）、a7（A7）、a8（A8）、a9（A9）、a10（A10）、a11（A11）、a12（A12）、a13（A13）、a14（A14）、a15（A15） |
| dw_select_table | 数据窗口 |  | 10,705 828×449 | 数据窗口 `d_original_joins`；列：table1（Table1）、col1（Col1）、oper（Oper）、table2（Table2）、col2（Col2）、tag（Tag） |

### uo_right

- 类型：用户对象；继承：`datastore`；库：rhzw_ROOT.pbd（账务+成本主程序）

### uo_tab

- 类型：用户对象；尺寸：897×445 PBU；继承：`datawindow`；库：rhzw_ROOT.pbd（账务+成本主程序）

### uo_treeview

- 类型：用户对象；尺寸：599×941 PBU；继承：`treeview`；库：rhzw_ROOT.pbd（账务+成本主程序）

- 提示与校验（2 条）：
  - [窗口事件 constructor]「uo_treeview的tag值不允许为空, 请赋值, 如 d_treeview」（条件：`this.tag = ""`）
  - [窗口事件 of_add_items]「Error inserting item」（条件：`this.insertitemlast(al_parent,ltvi_new) < 1`）

### uo_vdncore

- 类型：用户对象；尺寸：407×88 PBU；库：rhzw8_8.pbd（账务+成本主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| p_1 | 图片 | Custom033! | 9,12 73×64 |  |
| st_1 | 静态文本 | VDN Core | 101,12 311×68 |  |

- 窗口事件/函数：
  - `ini`：数据窗口 `d_online_user`

- 提示与校验（4 条）：
  - [窗口事件 responsemsg]「服务器注销该客户端。」（条件：`ll_find > 0`）
  - [窗口事件 getexepath]「获取程序目录失败！」（条件：`ll_rtn = 0`）
  - [窗口事件 sendtohtml]「消息体中不能包含/符号,请修正」（条件：`pos(as_msg,"/") > 0`）
  - [窗口事件 showwait_load]「Create DataWindow these errors:」（条件：`len(ls_error) > 0`）
