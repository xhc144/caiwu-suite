# 民非企 · 账务主程序（民非专版） — 窗口目录：其他系统窗口（登录、备份恢复、打印、杂项）（前缀 `misc`）

尺寸单位为 PowerBuilder Unit（PBU）。96 DPI、系统字体下约为：宽度像素 ≈ PBU × 0.25～0.3，高度像素 ≈ PBU × 0.25～0.28。
“打开入口”只列静态可见的调用方，运行时拼出来的窗口名可能遗漏。名字含 `_bak`、`_old`、`test` 的通常是历史残留。

### w_acini_wizard — 期初建账操作向导

- 类型：模态对话框；尺寸：2578×1636 PBU；库：rhzw8_9.pbd（账务主程序（民非专版））
- 打开入口：`w_users` 的 事件 close；`w_xt_kgzb_1` 的 cb_1.clicked；`w_xt_kgzb_3` 的 cb_1.clicked；`w_xt_kmwh` 的 cb_5.clicked；`w_xt_kmwh` 的 cb_6.clicked；`w_xt_users` 的 cb_4.clicked；`w_xt_ye` 的 事件 close

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 用户管理 | 105,224 384×100 | clicked → `w_xt_users`「用户管理」 |
| cb_2 | 按钮 | 科目维护 | 105,636 384×100 | clicked → `w_xt_kmwh`「科目维护」 |
| cb_3 | 按钮 | 期初录入 | 105,1076 384×100 | clicked → `w_xt_ye`「期初余额录入」 |
| cb_4 | 按钮 | 完成 | 1586,1412 306×96 |  |
| cb_5 | 按钮 | 关闭，我不需要向导 | 1920,1412 599×96 |  |
| gb_1 | 分组框 | 第一步、增加操作员 | 27,148 2496×396 |  |
| gb_2 | 分组框 | 第二步、维护科目 | 27,556 2496×416 |  |
| gb_3 | 分组框 | 第三步、录入年初金额 | 27,992 2496×408 |  |
| st_1 | 静态文本 | 本向导将引导您完成期初建账的必要操作，请根据下方提示进行各项操作： | 32,28 2121×64 |  |
| st_10 | 静态文本 | 此处功能是供您录入本套账的年初金额，如果您跳过本操作您的帐册和报表将会不能 | 110,1196 2391×76 |  |
| st_11 | 静态文本 | 正常显示数据。 | 114,1276 430×76 |  |
| st_3 | 静态文本 | 因为系统不允许凭证的制单人和审核人为同一操作员，所以您应该至少增加两位操作 | 114,344 2331×76 |  |
| st_4 | 静态文本 | 员才能正常使用本系统。新增加的操作员请注意分配相应的权限。 | 114,440 1737×76 |  |
| st_5 | 静态文本 | 未进行 | 530,244 1719×76 |  |
| st_6 | 静态文本 | 未进行 | 530,656 1797×76 |  |
| st_7 | 静态文本 | 未进行 | 530,1096 1870×76 |  |
| st_8 | 静态文本 | 在多数情况下系统已经预置了您常用的会计科目，但是部分科目仍然需要您亲自进行 | 91,756 2373×76 |  |
| st_9 | 静态文本 | 维护（增加科目，或者修改现有科目名称等），例如增加应收科目的下级明细科目。 | 87,840 2391×76 |  |

- 窗口事件/函数：
  - `open`：读写表 b_user、dlxx、kmbm

- 提示与校验（2 条）：
  - [窗口事件 closequery]「您确定不需要使用本向导引导您的建账工作吗？」（条件：`this.cb_4.enabled or xt_cs10 = "iswizard"`）
  - [cb_4.clicked]「恭喜，本套账的初始建账工作已经全部完成！ 您现在可以进行凭证的录入工作了。」

### w_autobak — 系统自动备份设置

- 类型：模态对话框；尺寸：1824×1080 PBU；库：rhzw8_9.pbd（账务主程序（民非专版））
- 打开入口：`w_bf` 的 cb_14.clicked；`w_main1` 的 st_3_bf.clicked；`w_main1` 的 tab_1/tabpage_3/p_t_3_bf.clicked；`w_tzjl` 的 cb_7.clicked；`w_xt_tz` 的 cb_4.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 439,820 320×104 |  |
| cb_2 | 按钮 | 取消 | 891,820 320×104 |  |
| cb_3 | 按钮 | ... | 1522,192 91×88 |  |
| cbx_1 | 复选框 | 启用自动备份功能 | 430,320 631×80 |  |
| em_1 | 格式输入 | 1 | 2213,356 178×84 |  |
| em_2 | 格式输入 | 1 | 2327,448 178×84 |  |
| gb_1 | 分组框 | 自动备份数据设置 | 41,28 1641×476 |  |
| gb_2 | 分组框 | 自动备份周期 | 1925,300 1490×400 |  |
| rb_day | 单选按钮 | 每       天进行一次备份操作 | 2048,388 914×80 |  |
| rb_every | 单选按钮 | 每次退出软件时均做自动备份 | 2048,572 869×80 |  |
| rb_month | 单选按钮 | 每月第       天进行备份操作 | 2048,480 914×80 |  |
| sle_1 | 单行输入 |  | 123,196 1394×84 |  |
| st_1 | 静态文本 | 备份文件存放目录： | 119,124 549×60 |  |
| st_2 | 静态文本 | 说明：此设置仅用于单机版，网络版由服务器端的 | 105,588 1426×84 |  |
| st_3 | 静态文本 | 数据备份伺服器来设置 | 279,656 1175×84 |  |
| st_4 | 静态文本 | 启用后，每次退出软件，系统都会做数据备份 | 215,412 1202×52 |  |

- 提示与校验（2 条）：
  - [cb_1.clicked]「请设置备份目录」（条件：`trim(parent.sle_1.text) = ""`）
  - [cb_1.clicked]「系统自动建立备份目录失败，请手工添加该目录！」（条件：`ls_temp = "F"`）

### w_bakupdata — 切换套账（取自菜单文字）

- 类型：模态对话框；尺寸：1765×364 PBU；库：rhzw8_9.pbd（账务主程序（民非专版））
- 打开入口：菜单「F.文件 › 切换套账」（26 个菜单中）；`w_frame` 的 事件 closequery；`w_main1_gz` 的 p_rjsj.clicked；`w_main1_zc` 的 p_rjsj.clicked；`w_main1` 的 p_rjsj.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 放弃 | 709,216 315×92 |  |
| dw_1 | 数据窗口 |  | 617,484 960×420 |  |
| sle_1 | 单行输入 |  | 59,104 1627×92 |  |
| st_info | 静态文本 | 正在备份数据，请稍候... | 46,20 1627×68 |  |

- 窗口事件/函数：
  - `open`：读写表 b_rights
  - `wf_bakdata`：读写表 bbml、bbml_gs、bbml_pos、sys

- 提示与校验（4 条）：
  - [窗口事件 ue_bakdata]「系统自动建立备份文件目录失败！请手工添加目录：」（条件：`not ll.uf_directory_isavailable(ls_temp)`）
  - [窗口事件 wf_bakdata]「报表文件不存在！」（条件：`fileexists(ls_filename) = false`）
  - [窗口事件 wf_bakdata]「打印格式文件不存在！」（条件：`fileexists(ls_filename) = false`）
  - [窗口事件 wf_bakdata]「压缩文件太大，请备份到其他盘上！」（条件：`upper(left(as_filename,2)) = "A:" and r > 1440000`）

### w_bakupdata_bak

- 类型：模态对话框；尺寸：1751×376 PBU；库：rhzw8_9.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 放弃 | 709,216 315×92 |  |
| dw_1 | 数据窗口 |  | 603,572 960×420 |  |
| sle_1 | 单行输入 |  | 50,96 1627×88 |  |
| st_info | 静态文本 | 正在备份数据，请稍候... | 46,20 1627×68 |  |

- 窗口事件/函数：
  - `wf_bakdata`：读写表 sys

- 提示与校验（3 条）：
  - [窗口事件 ue_bakdata]「系统自动建立备份文件目录失败！请手工添加目录：」（条件：`not ll.uf_directory_isavailable(ls_temp)`）
  - [窗口事件 wf_bakdata]「系统自动建立备份临时目录失败，请手工添加目录：C:\temp」（条件：`not ll.uf_directory_isavailable("c:\temp\")`）
  - [窗口事件 wf_bakdata]「压缩文件太大，请备份到其他盘上！」（条件：`upper(left(as_filename,2)) = "A:" and r > 1440000`）

### w_calc — 简易计算器

- 类型：模态对话框；尺寸：1207×888 PBU；库：rhzw8_8.pbd（账务主程序（民非专版））
- 打开入口：`w_pz_pzedit_b` 的 事件 u_calc；`w_pz_pzedit_bak` 的 事件 u_calc；`w_pz_pzedit_mb` 的 事件 u_calc；`w_pz_pzedit` 的 事件 u_calc

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_0 | 按钮 | ０ | 32,636 183×136 |  |
| cb_1 | 按钮 | １ | 32,504 183×136 |  |
| cb_10 | 按钮 | +/- | 215,636 183×136 |  |
| cb_11 | 按钮 | . | 398,636 183×136 |  |
| cb_12 | 按钮 | ＋ | 581,244 183×136 |  |
| cb_13 | 按钮 | － | 581,372 183×136 |  |
| cb_14 | 按钮 | × | 581,504 183×136 |  |
| cb_15 | 按钮 | / | 581,636 183×136 |  |
| cb_16 | 按钮 | 清除 | 763,240 407×136 |  |
| cb_17 | 按钮 | ＝ | 763,372 407×132 |  |
| cb_18 | 按钮 | 返回(Enter) | 763,500 411×272 |  |
| cb_2 | 按钮 | ２ | 215,504 183×136 |  |
| cb_3 | 按钮 | ３ | 398,504 183×136 |  |
| cb_4 | 按钮 | ４ | 32,372 183×136 |  |
| cb_5 | 按钮 | ５ | 215,372 183×136 |  |
| cb_6 | 按钮 | ６ | 398,372 183×136 |  |
| cb_7 | 按钮 | ７ | 32,240 183×136 |  |
| cb_8 | 按钮 | ８ | 215,240 183×136 |  |
| cb_9 | 按钮 | ９ | 398,240 183×136 |  |
| sle_1 | 单行输入 |  | 187,108 983×104 |  |
| st_1 | 静态文本 | 计算结果： | 50,16 480×80 |  |

### w_cwxt — 关于...

- 类型：模态对话框；尺寸：1870×1024 PBU；库：rhzw8_9.pbd（账务主程序（民非专版））
- 打开入口：菜单「H.帮助 › 版权信息」（26 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 1275,820 247×96 |  |
| st_1 | 静态文本 | 润衡财务管理系统 | 366,36 1454×104 |  |
| st_2 | 静态文本 | http://www.rhrj.net | 46,632 1673×84 |  |
| st_3 | 静态文本 | 深圳市润衡财经软件有限公司 版权所有 | 50,540 1765×92 |  |
| st_4 | 静态文本 | ver 2008.11.12 | 594,156 1115×76 |  |
| st_5 | 静态文本 | 版本更新说明 | 1166,256 585×60 |  |
| st_6 | 静态文本 | 1994-2026 Runsoft copyright | 672,716 1097×72 |  |
| st_fwk | 静态文本 | 售后服务卡未登记 | 96,704 521×80 |  |

- 窗口事件/函数：
  - `open`：读写表 dba

### w_err_view — 错误查看

- 类型：主窗口（默认）；尺寸：7712×1240 PBU；继承：`wroot_single`；菜单：`m_work`；库：rhzw_ROOT.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,204 631×676 | 数据窗口 `d_errmsg`（表 b_errmsg）；列：err_time（出错时间）、err_cname（操作员）、err_num（错误号）、err_message（错误信息）、err_where（出错地方）、err_object（出错对象）、err_event（出错事件）、err_line（行号）、err_cnt |
| uo_1 | u_toolbar |  | , 768×200 |  |

- 提示与校验（2 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）

### w_frame — Frame

- 类型：MDI 框架(带状态栏)；尺寸：3730×2412 PBU；菜单：`m_frame_zw`；库：rhzw_ROOT.pbd（账务主程序（民非专版））
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_open；`pfc_appsrv` 的 事件 pfc_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| mdi_1 | MDI 客户区 |  | , × |  |
| uo_1 | uo_vdncore |  | 219,248 × |  |

- 窗口事件/函数：
  - `ue_postopen`：打开 `w_login`「用户登录」
  - `closequery`：打开 `w_bakupdata`「切换套账（取自菜单文字）」
  - `open`：打开 `w_login`「用户登录」、`w_login_oem`「用户登录」

- 提示与校验（1 条）：
  - [窗口事件 closequery]「结束 ? ~r ~r温馨提示：1 为了保护您的数据安全，日常工作中建议您做好数据备份。~r~r~r 2 为了适应不断变化的操作系统，建议您的软件至少一年升级一次，保持平滑过渡！」

### w_grant — 分配权限

- 类型：模态对话框；尺寸：2747×1612 PBU；库：rhzw8_9.pbd（账务主程序（民非专版））
- 打开入口：`w_users` 的 cb_grant.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_add | uo_cmdbtn | &A.增加<< | 786,112 690× |  |
| cb_addall | uo_cmdbtn | &L.增加所有权限<< | 786,288 690× |  |
| cb_cancel | uo_cmdbtn | &C.放弃 | 786,1040 × |  |
| cb_remove | uo_cmdbtn | &R.移走>> | 786,464 690× |  |
| cb_removeall | uo_cmdbtn | &M.移走所有权限>> | 786,640 690× |  |
| cb_save | uo_cmdbtn | &K.存入 | 1161,1040 × |  |
| dw_grant_group | uo_dw | 可供组 | 1518,784 713×628 | 数据窗口 `d_grant_group`（表 b_user）；列：u_id、c_name |
| dw_grant_now | uo_dw | 现有模块 | 32,112 704×1296 | 数据窗口 `d_grant_now`（表 b_rights）；列：u_id、m_id、c_name、isgroup |
| dw_grant_wait | uo_dw | 可供模块 | 1518,20 713×1448 | 数据窗口 `d_grant_wait`（表 dba.b_module）；列：m_id、c_name |
| sle_cur_user | 静态文本 | 用户/组 | 279,24 361×68 |  |
| st_1 | 静态文本 | 用户/组 | 59,24 251×80 |  |

### w_gzgl_lshz — 查询累计汇总表

- 类型：模态对话框；尺寸：2331×936 PBU；库：rhzw8_gz1.pbd（账务主程序（民非专版））
- 打开入口：菜单「O日常业务 › 累计汇总表」（3 个菜单中）；菜单「O.操作 › 累计汇总」（`m_work_gzgl`）；`w_main1_gz` 的 tab_1/tabpage_1/p_t_1_ydb.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 663,684 247×108 | clicked → `w_preview`「打印预览」；clicked 切换数据窗口 `dw_gz_prt`；clicked 读写表 gz_gzk |
| cb_2 | 按钮 | 退出 | 1225,684 247×108 |  |
| cb_3 | 按钮 | 放大 | 169,1104 247×108 |  |
| cb_4 | 按钮 | 缩小 | 553,1104 247×108 |  |
| cb_5 | 按钮 | 打印 | 937,1104 247×108 |  |
| cb_6 | 按钮 | 重选 | 1321,1104 247×108 |  |
| cb_7 | 按钮 | 退出 | 1705,1104 247×108 |  |
| ddlb_1 | 下拉列表 |  | 654,404 608×448 |  |
| ddlb_2 | 下拉列表 |  | 1541,404 608×436 |  |
| dw_1 | 数据窗口 |  | 37,8 2231×1044 | 数据窗口 `dw_gz_prt`（表 gz_gzk、gz_bmk）；列：nf（Nf）、yf（Yf）、g_j1（G L1）、g_j2（G L2）、g_j3、g_j4（G J4）、g_j5（G J5）、g_j6（G J6）、g_j7（G J7）、g_j8（G J8）、g_f1（G F1）、g_f2（G F2）、g_l01（G L1）、g_l02（G L2）、g_l03（G L3）、g_l04（G L4）、g_l05（G L5）、g_l06（G L6）、g_l07（G L7）、g_l08（G L8）、g_l09（G L9）、g_l10（G L10）、g_l11（G L11）、g_l12（G L12）、g_l13（G L13）、g_l14（G L14）、g_l15（G L15）、g_l16（G L16）、g_l17（G L17）、g_l18（G L18）…… |
| em_3 | 格式输入 |  | 617,200 393×108 |  |
| em_4 | 格式输入 |  | 1390,200 375×104 |  |
| gb_1 | 分组框 | 选择 | 142,1172 1010×360 |  |
| gb_2 | 分组框 |  | 41,52 2194×560 |  |
| rb_1 | 单选按钮 | 打印预览 | 421,1268 389×72 |  |
| rb_2 | 单选按钮 | 打印输出 | 421,1400 389×72 |  |
| st_2 | 静态文本 | 打印部门：从 | 128,404 453×72 |  |
| st_3 | 静态文本 | 到 | 1362,404 119×72 |  |
| st_5 | 静态文本 | 汇总年月：从 | 119,200 526×72 |  |
| st_6 | 静态文本 | 到 | 1134,200 133×72 |  |

- 窗口事件/函数：
  - `open`：读写表 gz_bmk
  - `del_col`：读写表 gz_gzjg

- 提示与校验（1 条）：
  - [cb_1.clicked]「没有数据选中！请重选」（条件：`parent.dw_1.rowcount() = 0`）

### w_hf — 数据恢复

- 类型：模态对话框；尺寸：2715×968 PBU；库：rhzw8_9.pbd（账务主程序（民非专版））
- 打开入口：菜单「S系统管理 › 数据恢复」（19 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 恢复数据 | 622,748 389×96 | clicked → `w_login`「用户登录」、`w_login_oem`「用户登录」；clicked 读写表 b_user、bbml、bbml_gs、bbml_pos、kmbm、sys、zc_gdzc、zc_yzjb |
| cb_2 | 按钮 | 取消 | 1115,748 389×96 |  |
| cb_3 | 按钮 | 查找... | 2240,368 238×92 |  |
| cb_4 | 按钮 | 更多选项... | 1609,752 389×92 |  |
| cb_5 | 按钮 | none | 2181,752 402×112 |  |
| cbx_1 | 复选框 | 恢复时出错不提示 | 206,900 576×72 |  |
| cbx_2 | 复选框 | 超大数据 | 1915,900 425×72 |  |
| cbx_3 | 复选框 | 备份数据重新效验(系统将试图修复备份数据) | 206,1012 1349×72 |  |
| cbx_4 | 复选框 | 不重新建立数据结构 | 1015,900 763×72 |  |
| cbx_update | 复选框 | 自动升级 | 480,1380 571×80 |  |
| dw_1 | 数据窗口 |  | 2729,784 494×360 | 数据窗口 `dw_bf_test`；列：cs1（Cs1） |
| dw_2 | 数据窗口 |  | 1577,1304 960×420 |  |
| em_1 | 单行输入 |  | 101,368 2144×92 |  |
| gb_1 | 分组框 | 特别提示： | 64,488 2432×224 |  |
| st_12 | 静态文本 | 如果您使用的是网络版，并且是旧版本备份的数据，请在数据库服务器的机器上使用，否则 | 123,568 2235×120 |  |
| st_2 | 静态文本 | 警告 | 32,36 315×124 |  |
| st_3 | 静态文本 | 系统将用备份文件里的数据覆盖本套账里的数据(包括出纳模块)，并且将不可恢复!!! | 41,180 2624×68 |  |
| st_4 | 静态文本 | 选择之前的备份文件： | 69,296 608×56 |  |

- 提示与校验（6 条）：
  - [cb_1.clicked]「转入将覆盖此套帐的所有数据！！！」
  - [cb_1.clicked]「数据库结构文件不存在！」（条件：`left(xx1,15) = "create table ls"`）
  - [cb_1.clicked]「报表文件不存在！」（条件：`parent.cbx_1.checked = false`）
  - [cb_1.clicked]「打印格式文件不存在！」（条件：`parent.cbx_1.checked = false`）
  - [cb_1.clicked]「档案文件错误：报表文件不存在！」（条件：`parent.cbx_1.checked = false`）
  - [cb_1.clicked]「转入成功！ 请重新进入本套帐！」（条件：`bz = "0"`）

### w_idle

- 类型：弹出窗口；尺寸：2917×1909 PBU；库：rhzw_ROOT.pbd（账务主程序（民非专版））
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_idle；`pfc_appsrv` 的 事件 pfc_idle

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| p_1 | 图片 | logo.bmp | 165,237 2359×1217 |  |
| st_1 | 静态文本 | 按任意键继续...... | 1326,65 586×77 |  |
| st_2 | 静态文本 | Press any key to continue...... | 828,1777 910×77 |  |

### w_ini_bf — 数据备份

- 类型：模态对话框；尺寸：2610×664 PBU；库：rhzw8_5.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 备份 | 686,384 311×100 | clicked 读写表 bbml、bbml_gs、bbml_pos |
| cb_2 | 按钮 | 取消 | 1449,384 311×100 |  |
| cb_3 | 按钮 | 选择... | 2153,52 242×88 |  |
| dw_bbml | 数据窗口 |  | 402,940 960×420 | 数据窗口 `dw_ini_bbml`（表 bbml）；列：xh（Xh）、bbname（Bbname）、row（Row）、col（Col）、bz1（Bz1）、bz2（Bz2） |
| dw_bbml_gs | 数据窗口 |  | 50,916 960×420 | 数据窗口 `dw_ini_bbml_gs`（表 bbml_gs）；列：xh（Xh）、bbname（Bbname）、row（Row）、col（Col）、t1（T1）、t2（T2）、t3（T3）、t4（T4）、bz1（Bz1）、bz2（Bz2） |
| dw_bbml_pos | 数据窗口 |  | 398,952 960×420 | 数据窗口 `dw_ini_bbml_pos`（表 bbml_pos）；列：xh（Xh）、bbname（Bbname）、row（Row）、col（Col）、t1（T1）、t2（T2）、t3（T3）、t4（T4）、t5（T5）、s1（S1）、s2（S2）、s3（S3）、bz1（Bz1）、bz2（Bz2） |
| dw_jzlx | 数据窗口 |  | 206,856 960×420 | 数据窗口 `dw_ini_jzlx`（表 jzlx）；列：jzlx（Jzlx）、pzlx（Pzlx）、xmlb（Xmlb）、jc（Jc）、zy（Zy）、zrkm（Zrkm）、zckm（Zckm）、bz0（Bz0）、bl0（Bl0） |
| dw_kmbm | 数据窗口 |  | 928,1012 960×420 | 数据窗口 `dw_ini_kmbm`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、kmsx（Kmsx）、zhlb（Zhlb）、fbs（Fbs）、sls（Sls）、bz（Bz）、dw（Dw）、xms（Xms）、dws（Dws）、bms（Bms）、grs（Grs）、wls（Wls）、yjd（Yjd）、yefx（Yefx）、kmqc（Kmqc）、xmbm（Xmbm）、dwbm（Dwbm）、bmbm（Bmbm）、grbm（Grbm）、sybz（Sybz）、xjs（Xjs） |
| dw_pzlx | 数据窗口 |  | 1079,1084 960×420 | 数据窗口 `dw_ini_pzlx`（表 pzlx）；列：pzlx（Pzlx）、pzlx_jc（Pzlx Jc）、pzlx_qc（Pzlx Qc）、pzlx_jfy1（Pzlx Jfy1）、pzlx_jfy2（Pzlx Jfy2）、pzlx_dfy1（Pzlx Dfy1）、pzlx_dfy2（Pzlx Dfy2）、pzlx_pzy1（Pzlx Pzy1）、pzlx_pzy2（Pzlx Pzy2）、pzlx_pzw1（Pzlx Pzw1）、pzlx_pzw2（Pzlx Pzw2）、pzlx_jz（Pzlx Jz） |
| dw_xjll_xm | 数据窗口 |  | 1819,1180 960×420 | 数据窗口 `dw_ini_xjll_xm`（表 xjll_xm）；列：xjbm（Xjbm）、xjmc（Xjmc）、jd（Jd） |
| dw_xt | 数据窗口 |  | 1833,924 960×420 | 数据窗口 `dw_ini_xt`（表 xt）；列：mc（Mc）、nr（Nr） |
| sle_1 | 单行输入 |  | 78,48 2075×88 |  |
| st_1 | 静态文本 | 此模块只备份出来部分数据，仅能用于系统初始化！ | 251,196 1696×80 |  |

- 提示与校验（4 条）：
  - [cb_1.clicked]「报表文件不存在！」（条件：`fileexists(ls_filename) = false`）
  - [cb_1.clicked]「打印格式文件不存在！」（条件：`fileexists(ls_filename) = false`）
  - [cb_1.clicked]「压缩文件太大，请备份到其他盘上！」（条件：`upper(left(as_filename,2)) = "A:" and r > 1440000`）
  - [cb_3.clicked]「是否提换现有的文件？」（条件：`i = 1`）

### w_logo

- 类型：弹出窗口；尺寸：1371×332 PBU；库：rhzw8_8.pbd（账务主程序（民非专版））
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_open；`pfc_appsrv` 的 事件 pfc_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_1 | 数据窗口 |  | 823,480 713×128 | 数据窗口 `dw_tzjl`（表 dba.xttz）；列：dm（代码）、tz_name（套帐名称） |
| st_1 | 静态文本 | 系统正在启动，请稍候...... | 37,88 1070×80 |  |

### w_module — 模块维护

- 类型：主窗口（默认）；尺寸：7712×1240 PBU；继承：`wroot_single`；菜单：`m_work`；库：rhzw_ROOT.pbd（账务主程序（民非专版））
- 打开入口：菜单「F.文件 › 模块管理」（26 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,204 1326×676 | 数据窗口 `d_module`（表 dba.b_module）；列：m_id（模块编号）、e_name（英文名）、c_name（中文名） |
| uo_1 | u_toolbar |  | , 768×200 |  |

- 提示与校验（2 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）

### w_pass — 自改密码

- 类型：模态对话框；尺寸：1659×924 PBU；库：rhzw8_9.pbd（账务主程序（民非专版））
- 打开入口：菜单「F.文件 › 自改密码」（26 个菜单中）；`w_main1_gz` 的 st_3_mm.clicked；`w_main1_zc` 的 st_3_mm.clicked；`w_main1` 的 st_3_mm.clicked；`w_main1` 的 tab_1/tabpage_3/p_t_3_mm.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_exit | 按钮 | &X. 退 出 | 933,680 357×108 |  |
| cb_ok | 按钮 | &Y. 确 认 | 320,680 366×108 | clicked 读写表 b_user |
| sle_newpass | 单行输入 |  | 727,296 695×96 |  |
| sle_oldpass | 单行输入 |  | 727,172 695×96 |  |
| sle_verifypass | 单行输入 |  | 727,420 695×96 |  |
| st_1 | 静态文本 | 输入原密码: | 320,184 398×84 |  |
| st_2 | 静态文本 | 输入新密码: | 315,308 398×84 |  |
| st_3 | 静态文本 | 重输新密码: | 315,432 398×84 |  |
| st_error | 静态文本 | 原密码错误, 请重新输入 | 169,556 1330×64 |  |
| st_ts | 静态文本 | 财务数据关系重大，密码丢失后果自负。 | 169,556 1330×64 |  |

- 提示与校验（1 条）：
  - [cb_ok.clicked]「启用新密码, 请牢记，以免密码遗忘造成不必要麻烦！」

### w_paste — 请选择粘贴值

- 类型：模态对话框；尺寸：1733×701 PBU；库：rhzw_ROOT.pbd（账务主程序（民非专版））
- 打开入口：菜单「a1 › V.取现有值」（`m_cpq_rbutton_paste`）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_cancel | 按钮 | &C.放弃 | 1390,237 266×109 |  |
| cb_paste | 按钮 | &P.粘贴 | 1390,89 266×109 |  |
| dw_1 | 数据窗口 |  | 37,33 1322×517 |  |

### w_retrieve_wait — 提示窗口

- 类型：弹出窗口；尺寸：1143×512 PBU；库：rhzw_ROOT.pbd（账务主程序（民非专版））
- 打开入口：`pfc_dwsrv` 的 事件 pfc_retrievestart；`pfc_dwsrv` 的 事件 pfc_sqlpreview

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_cancel | 按钮 | &Z. 中止 | 366,308 311×100 |  |
| st_1 | 静态文本 | 正在读取数据, 请等待...... | 169,24 832×76 |  |
| st_2 | 静态文本 | 总计： | 219,112 247×72 |  |
| st_3 | 静态文本 | 已读入 | 224,216 247×72 |  |

### w_root_xt

- 类型：模态对话框；尺寸：1394×1292 PBU；库：rhzw8_5.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1093,616 247×108 |  |
| cb_2 | 按钮 | 打印 | 1093,824 247×108 |  |
| cb_3 | 按钮 | 删除 | 1093,720 247×108 |  |
| cb_4 | 按钮 | 确定 | 1093,932 247×108 |  |
| cb_5 | 按钮 | 取消 | 1093,1036 247×108 |  |
| cb_6 | 按钮 | 另存 | 1093,512 247×108 |  |
| dw_master | uo_dw_single |  | 18,12 946×1104 |  |

### w_setbar — 工具条设置

- 类型：模态对话框；尺寸：1825×1009 PBU；库：rhzw_ROOT.pbd（账务主程序（民非专版））
- 打开入口：菜单「F.文件 › 工具条设置」（26 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_ok | 按钮 | 结束设置 | 668,765 435×121 |  |
| cbx_show | 复选框 | 显示选择的工具条 | 947,653 682×65 |  |
| cbx_text | 复选框 | 显示带文字的大按钮 | 947,441 755×73 |  |
| gb_box | 分组框 | 方位设定 | 74,305 732×413 |  |
| gb_win | 分组框 | 工具条选择 | 74,49 1669×197 |  |
| rb_bottom | 单选按钮 | 底部 | 302,589 293×73 |  |
| rb_float | 单选按钮 | 浮动 | 279,673 293×73 |  |
| rb_frame | 单选按钮 | 框架窗口工具条 | 124,137 668×73 |  |
| rb_left | 单选按钮 | 左边 | 101,493 293×65 |  |
| rb_right | 单选按钮 | 右边 | 535,485 252×73 |  |
| rb_sheet | 单选按钮 | 当前子窗口工具条 | 997,137 682×73 |  |
| rb_top | 单选按钮 | 顶部 | 302,393 293×73 |  |

### w_system_error — System Error

- 类型：模态对话框；尺寸：2213×1093 PBU；库：rhzw_ROOT.pbd（账务主程序（民非专版））
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_systemerror；`pfc_appsrv` 的 事件 pfc_systemerror

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_continue | 按钮 | &C.继续 | 874,837 458×121 |  |
| cb_exit | 按钮 | &X.退出系统 | 284,829 458×121 |  |
| cb_print | 按钮 | &P.打印 | 1463,837 458×121 |  |
| dw_1 | 数据窗口 |  | 1697,453 494×361 | 数据窗口 `d_errmsg`（表 b_errmsg）；列：err_time（出错时间）、err_cname（操作员）、err_num（错误号）、err_message（错误信息）、err_where（出错地方）、err_object（出错对象）、err_event（出错事件）、err_line（行号）、err_cnt |
| dw_error | 数据窗口 |  | 51,41 2085×741 | 数据窗口 `d_system_error`；列：errornum、message（出错信息：）、where（出错窗口/菜单：）、object（出错对象：）、event（出错事件：）、line（出错行号：） |

### w_test

- 类型：模态对话框；尺寸：2016×1208 PBU；库：rhzw8_8.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | ping | 1239,24 247×108 |  |
| sle_1 | 单行输入 | 133.16.47.1 | 306,36 727×92 |  |
| sle_2 | 多行输入 |  | 78,192 1774×764 |  |

### w_users — 操作员管理

- 类型：主窗口（默认）；尺寸：2482×2248 PBU；菜单：`m_work_user`；库：rhzw8_9.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_grant | 按钮 | &G.分配权限 | 1065,1020 933×108 | clicked → `w_grant`「分配权限」 |
| dw_1 | 数据窗口 |  | 361,776 1719×1116 | 数据窗口 `dw_users_rights`（表 b_rights）；列：u_id（U Id）、m_id（M Id）、c_name（C Name）、isgroup（Isgroup） |
| dw_detail | 数据窗口 |  | 1065,220 1129×764 | 数据窗口 `d_users_detail`（表 b_user）；列：u_id（用户号:）、e_name（登录代码）、c_name（用户姓名）、pswd（密码）、isgroup（用户/组:） |
| dw_master | 数据窗口 |  | 9,216 1006×1124 | 数据窗口 `d_users_master`（表 b_user）；列：u_id、e_name、c_name、pswd、isgroup |
| uo_1 | u_toolbar |  | 5, ×200 |  |

- 窗口事件/函数：
  - `ue_action_new`：读写表 b_user
  - `ue_action_del`：读写表 b_rights
  - `open`：读写表 b_user
  - `close`：打开 `w_acini_wizard`「期初建账操作向导」
  - `wf_b_rights`：读写表 b_user

- 提示与校验（7 条）：
  - [窗口事件 ue_action_save]「此处数据错误，请重新输入。」（条件：`this.dw_detail.accepttext() = -1`）
  - [窗口事件 ue_action_refresh]「数据还没有存盘，刷新前是否存盘?」（条件：`this.ib_save = false`）
  - [窗口事件 ue_action_del]「删除本条数据，请确认。」（条件：`l_status = new!`）
  - [窗口事件 ue_action_del]「存入失败，数据没有删除。」
  - [窗口事件 ue_display_print]「开始打印吗?」
  - [窗口事件 open]「共享DataWindow的数据源可能不一致，请检查。」（条件：`this.dw_master.sharedata(this.dw_detail) = -1`）
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）

### w_xtzc_1 — 系统注册

- 类型：模态对话框；尺寸：1285×620 PBU；库：rhzw8_8.pbd（账务主程序（民非专版））
- 打开入口：`w_login_oem` 的 p_1.doubleclicked；`w_login_qhmk` 的 p_1.doubleclicked；`w_login_qhmk` 的 p_2.doubleclicked；`w_login` 的 p_1.doubleclicked；`w_login` 的 p_2.doubleclicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 320,384 229×92 |  |
| cb_2 | 按钮 | 取消 | 791,380 229×92 |  |
| sle_zch | 单行输入 |  | 517,176 558×88 |  |
| st_2 | 静态文本 | 系统号： | 82,68 370×72 |  |
| st_3 | 静态文本 | 校验码： | 91,184 361×76 |  |

- 窗口事件/函数：
  - `wf_unlock`：读写表 dba

- 提示与校验（1 条）：
  - [cb_1.clicked]「校验码错误！」（条件：`mod(r1 * 508,10000) <> r2 and r2 <> 630510`）

### w_xtzc_del — 清除版本号

- 类型：模态对话框；尺寸：1285×620 PBU；库：rhzw8_8.pbd（账务主程序（民非专版））
- 打开入口：`w_login_qhmk` 的 sle_id.rbuttondown；`w_login` 的 sle_id.rbuttondown

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 320,384 229×92 |  |
| cb_2 | 按钮 | 取消 | 791,380 229×92 |  |
| sle_zch | 单行输入 |  | 517,176 558×88 |  |
| st_2 | 静态文本 | 系统号： | 82,68 370×72 |  |
| st_3 | 静态文本 | 确认码: | 82,184 361×76 |  |

- 窗口事件/函数：
  - `wf_unlock`：读写表 dba

- 提示与校验（1 条）：
  - [cb_1.clicked]「确认码错误！」（条件：`mod(r1 * 123,10000) <> r2 and r2 <> 630510 and parent.sle_zch.text <> "800003004"`）

### w_zh_zhjc — 综合检查

- 类型：模态对话框；尺寸：1687×1020 PBU；库：rhzw8_5.pbd（账务主程序（民非专版））
- 打开入口：菜单「S系统管理 › 综合检查 Shift+F10」（19 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 检查 | 837,784 293×108 | clicked 读写表 b_rights、b_user、bmk、bmnc、dba、dwk、dwnc、fbgl、grk、grnc、hg_da、hz、hzyeb、kmbm、nc、pz、pzdj、pzlx、wlxx、xmk、xmnc、xt、yhdzd、ysda、zc_sblb、zc_sbyt |
| cb_2 | 按钮 | 关闭 | 1271,784 293×108 |  |
| cb_3 | 按钮 | 科目编码转入 | 713,236 416×100 | clicked → `w_xt_kmwh_copy`「从其他套帐转入科目」 |
| cb_4 | 按钮 | 开账日期调整 | 1134,236 416×100 | clicked → `w_zh_zhjc_kzrq`「开账日期调整」 |
| cb_5 | 按钮 | 科目编码调整 | 297,236 416×100 | clicked → `w_xt_kmbmchange`「科目编码调整」 |
| cbx_kjqj | 复选框 | 会计期间从1月开始 | 59,800 617×76 |  |
| cbx_km | 复选框 | 科目编码 | 59,408 343×72 |  |
| cbx_nc | 复选框 | 年初数 | 425,408 283×72 |  |
| cbx_pz | 复选框 | 凭证 | 247,568 219×72 |  |
| cbx_pz_mod | 复选框 | 自动修复 | 238,1084 338×72 |  |
| cbx_pzdj | 复选框 | 凭证登记 | 128,1264 343×72 |  |
| em_1 | 格式输入 |  | 686,572 366×88 |  |
| em_2 | 格式输入 |  | 1216,568 247×100 |  |
| em_3 | 格式输入 |  | 690,1256 366×88 |  |
| em_4 | 格式输入 |  | 1221,1252 247×100 |  |
| gb_1 | 分组框 |  | 46,500 1518×204 |  |
| gb_2 | 分组框 |  | 55,1200 1518×184 |  |
| st_1 | 静态文本 | 从 | 544,580 105×72 |  |
| st_2 | 静态文本 | 到 | 1083,580 101×72 |  |
| st_3 | 静态文本 | 从 | 549,1264 105×72 |  |
| st_4 | 静态文本 | 到 | 1088,1264 101×72 |  |
| st_5 | 静态文本 | 特别提示：此模块必须由技术服务人员运行！ | 18,48 1609×76 |  |
| st_6 | 静态文本 | 否则，造成的损失，本公司不负责！ | 361,136 1266×76 |  |
| st_7 | 静态文本 | 年初数的年份由整理的凭证确定 | 736,408 887×76 |  |

- 提示与校验（18 条）：
  - [cb_1.clicked]「科目编码库无数据！」（条件：`l3 = 0`）
  - [cb_1.clicked]「明细/分类标志不符合规定！」（条件：`yjd <> "1"`）
  - [cb_1.clicked]「长度不符合规定！」（条件：`i > xt_len0`）
  - [cb_1.clicked]「科目级数不符合规定！」（条件：`kmjs <> i`）
  - [cb_1.clicked]「上级科目不存在！」（条件：`l1 = 0`）
  - [cb_1.clicked]「凭证库无数据！」（条件：`l1 = 0`）
  - [cb_1.clicked]「年月第号凭证有错误！~r 系统将自动变为」（条件：`pzdj_bz <> "2" and parent.cbx_pz_mod.checked`）
  - [cb_1.clicked]「年月第号凭证有错误！」（条件：`pzdj_bz <> "2" and parent.cbx_pz_mod.checked`）
  - [cb_1.clicked]「年月类号凭证库/凭证登记库数据不匹配！」（条件：`isnull(dd) or dd = 0`）
  - [cb_1.clicked]「年月第号凭证第行借贷都是 0 ！」（条件：`abs(pz_jf) < 0.005 and abs(pz_df) < 0.005`）
  - [cb_1.clicked]「凭证登记库无数据！」（条件：`l2 = 0`）
  - [cb_1.clicked]「年月第号凭证登记库/凭证库数据不匹配！」（条件：`i = 0`）
  - [cb_1.clicked]「年月第号凭证借贷不等！借方余额   贷方余额」（条件：`abs(jf - df) > 0.005`）
  - [cb_1.clicked]「年初库无数据！」（条件：`l4 = 0`）
  - [cb_1.clicked]「科目库中无!」（条件：`l1 = 0`）
  - [cb_1.clicked]「是否将原会计期间从 月开始，转为从 1 月开始？」（条件：`xt_kjqj <> 1`）
  - [cb_1.clicked]「检查正确！」（条件：`err = 0`）
  - [cb_1.clicked]「检查有误！」（条件：`err = 0`）

### w_zh_zhjc_kzrq — 开账日期调整

- 类型：模态对话框；尺寸：1723×1004 PBU；库：rhzw8_5.pbd（账务主程序（民非专版））
- 打开入口：`w_zh_zhjc` 的 cb_4.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 调整 | 837,784 293×108 | clicked 读写表 bmnc、cn_mx、dwnc、grnc、hz、nc、pz、pzdj、wlxx、xmnc、xt |
| cb_2 | 按钮 | 关闭 | 1271,784 293×108 |  |
| cbx_pz_mod | 复选框 | 自动修复 | 238,1084 338×72 |  |
| cbx_pzdj | 复选框 | 凭证登记 | 128,1264 343×72 |  |
| em_1 | 格式输入 | none | 745,228 485×104 |  |
| em_3 | 格式输入 |  | 690,1256 366×88 |  |
| em_4 | 格式输入 |  | 1221,1252 247×100 |  |
| gb_2 | 分组框 |  | 55,1200 1518×184 |  |
| st_1 | 静态文本 | 本套账的开账日期是 2021年01月01日 | 110,92 1275×72 |  |
| st_2 | 静态文本 | 您希望调整到 | 247,236 457×68 |  |
| st_3 | 静态文本 | 从 | 549,1264 105×72 |  |
| st_4 | 静态文本 | 到 | 1088,1264 101×72 |  |
| st_5 | 静态文本 | 温馨提示： | 69,384 366×68 |  |
| st_6 | 静态文本 | 1 建账日期之前的凭证将全部删除，之前最好先做【数据备份】 | 101,480 1536×60 |  |
| st_7 | 静态文本 | 2 建账日期之后的凭证 需要重新过账 | 101,556 891×60 |  |
| st_8 | 静态文本 | 3 建账当年的期初数将保留，请进入【期初录入】进行修改确认 | 101,632 1559×60 |  |

- 提示与校验（4 条）：
  - [cb_1.clicked]「开账日期没有变化！」（条件：`n_kzrq = xt_kzrq`）
  - [cb_1.clicked]「请确认此套账数据已经有备份？」（条件：`n_kzrq = xt_kzrq`）
  - [cb_1.clicked]「此调整将会删除新开账日期之前的凭证，是否进行？」（条件：`n_kzrq > xt_kzrq`）
  - [cb_1.clicked]「修改开账日期成功！~r请进入【期初录入】调整期初数」

### w_zjjs — 计提折旧

- 类型：模态对话框；尺寸：1573×848 PBU；库：rhzw8_zc1.pbd（账务主程序（民非专版））
- 打开入口：菜单「O日常业务 › 计提折旧」（3 个菜单中）；`w_main1_zc` 的 tab_1/tabpage_1/p_t_1_jt.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 443,576 247×108 | clicked → `w_pz_build`「生成凭证」；clicked 读写表 xt、zc_gdzc、zc_yzjb、zc_yzzj |
| cb_2 | 按钮 | 取消 | 928,576 247×108 |  |
| p_1 | 图片 | iconwrks.bmp | 73,48 261×228 |  |
| st_1 | 静态文本 | 1997.02 | 645,352 366×72 |  |
| st_2 | 静态文本 | 本模块对 | 219,352 407×88 |  |
| st_3 | 静态文本 | 计提折旧 | 1024,352 375×84 |  |
| st_4 | 静态文本 | 提  示 | 425,76 782×168 |  |

- 窗口事件/函数：
  - `wf_zj`：读写表 zc_sbzt

- 提示与校验（6 条）：
  - [窗口事件 wf_zj]「设备编号为的设备，原值小于累计折旧」（条件：`(this.yz - this.ljzje) < 0`）
  - [窗口事件 wf_zj]「设备编号为的设备，本月工作量过大!」（条件：`this.zjff = "2" and (this.zgzl - this.ljgzl) < this.ygzl`）
  - [cb_1.clicked]「有设备未输本月工作量，是否进行？」（条件：`l > 0`）
  - [cb_1.clicked]「有设备没有使用年限，是否进行？」（条件：`l > 0`）
  - [cb_1.clicked]「设备编号为  原值调整的原值不正确，请重新检查其原值调整单据！」（条件：`abs(d_yz - d_d2) > 0.005`）
  - [cb_1.clicked]「是否生成折旧凭证？」（条件：`s1 = "1"`）

### w_zoom — 定制

- 类型：模态对话框；尺寸：1002×477 PBU；库：rhzw_ROOT.pbd（账务主程序（民非专版））
- 打开入口：`pfc_dwsrv` 的 事件 pfc_rbuttondown_preview

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_cancel | 按钮 | &F.放弃 | 558,237 316×105 |  |
| cb_ok | 按钮 | &Q.确认 | 92,237 316×105 |  |
| em_zoom | 格式输入 | 100 | 682,57 266×97 |  |
| st_1 | 静态文本 | 请输入一百分比值 : | 46,69 636×73 |  |

### wroot_dw_query — 条件搜索

- 类型：模态对话框；尺寸：2711×684 PBU；库：rhzw_ROOT.pbd（账务主程序（民非专版））
- 打开入口：`uo_dw_share_master` 的 事件 ue_action_query；`uo_dw_single` 的 事件 ue_action_query；`w_ht_htda` 的 dw_master.ue_action_query；`w_xt_dwwh` 的 事件 ue_action_query；`wroot_md_2` 的 事件 ue_action_query；`wroot_md` 的 事件 ue_action_query；`wroot_mds` 的 事件 ue_action_query；`wroot_share_tab` 的 事件 ue_action_query

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_exec | 按钮 | &Z.执行 | 2395,124 256×108 |  |
| cb_exit | 按钮 | &F.返回 | 2395,304 256×108 |  |
| dw_column | 数据窗口 |  | 233,600 2866×528 | 数据窗口 `d_column_set`；列：hz、yw、type、table |
| dw_where | 数据窗口 |  | 9,88 2313×456 | 数据窗口 `d_where`；列：precol、column1（字   段   名）、operator（操作符）、value（字    段    值）、logical（逻辑符） |
| st_1 | 静态文本 | 请输入查询条件 : | 9,12 722×76 |  |

- 提示与校验（5 条）：
  - [dw_where.ue_where]「,请改正」（条件：`i > 0`）
  - [dw_where.ue_where]「不是字符型,不能使用<含有>或<不含有>操作符」（条件：`trim(soper) = "like" or trim(soper) = "not like"`）
  - [dw_where.ue_where]「的值应为数字型,请改正」（条件：`isnumber(svalue)`）
  - [dw_where.ue_where]「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」（条件：`not isdate(svalue)`）
  - [dw_where.ue_where]「这个数据类型未在本模块中定义。」

### wroot_fix_query — 固定查询及统计

- 类型：主窗口（默认）；尺寸：2894×1561 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_ROOT.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_exec | 按钮 | &Z.执行 | 2501,1033 257×109 |  |
| cb_exit | 按钮 | &F.返回 | 2497,1329 257×109 |  |
| cb_print | 按钮 | &D.打印 | 2497,1177 257×109 |  |
| dw_master | uo_dw |  | 10,9 2817×977 |  |
| dw_where | uo_dw_query |  | 10,997 2341× |  |

- 提示与校验（2 条）：
  - [窗口事件 open]「程序员: 请修改下面打开的Window的Title.」（条件：`this.title = "固定查询及统计"`）
  - [cb_print.clicked]「开始打印吗?」

### wroot_md — 主从式应用示例

- 类型：主窗口（默认）；尺寸：1486×1548 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_ROOT.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 14,772 × |  |
| dw_master | uo_dw |  | 14,208 × |  |
| uo_1 | u_toolbar |  | , 1289×200 |  |

- 窗口事件/函数：
  - `ue_action_query`：打开 `wroot_dw_query`「条件搜索」

- 提示与校验（6 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）
  - [窗口事件 ue_action_del]「删除本条数据，请确认。」（条件：`this.ib_edit`）
  - [窗口事件 ue_action_del]「存入失败，数据不能从库中删除。」
  - [窗口事件 ue_action_refresh]「数据还没有存盘，刷新前是否存盘?」（条件：`this.ib_save = false`）
  - [窗口事件 ue_action_save]「主表此处数据错误，请重新输入。」（条件：`this.dw_master.accepttext() = -1`）
  - [窗口事件 ue_action_save]「从表此处数据错误，请重新输入。」（条件：`this.dw_detail.accepttext() = -1`）

### wroot_md2 — wroot_sheet（继承自祖先）

- 类型：主窗口（默认）；尺寸：2245×1520 PBU；继承：`wroot_sheet`；菜单：`m_work_01`；库：rhzw_ROOT.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 5,752 ×500 |  |
| dw_master | uo_dw |  | 23,228 ×500 |  |
| uo_1 | u_toolbar |  | 9, 544×200 |  |

- 提示与校验（1 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）

### wroot_md2_1 — wroot_sheet（继承自祖先）

- 类型：主窗口（默认）；尺寸：2245×1524 PBU；继承：`wroot_sheet`；菜单：`m_work_01`；库：rhzw_ROOT.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 14,712 × |  |
| dw_master | uo_dw |  | ,204 × |  |
| uo_1 | u_toolbar |  | , 544×200 |  |

- 提示与校验（1 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）

### wroot_md_2 — 主从式应用示例

- 类型：主窗口（默认）；尺寸：1486×1236 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_ROOT.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 14,528 × |  |
| dw_master | uo_dw |  | 14,16 × |  |

- 窗口事件/函数：
  - `ue_action_query`：打开 `wroot_dw_query`「条件搜索」

- 提示与校验（6 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）
  - [窗口事件 ue_action_del]「删除本条数据，请确认。」（条件：`this.ib_edit`）
  - [窗口事件 ue_action_del]「存入失败，数据不能从库中删除。」
  - [窗口事件 ue_action_refresh]「数据还没有存盘，刷新前是否存盘?」（条件：`this.ib_save = false`）
  - [窗口事件 ue_action_save]「主表此处数据错误，请重新输入。」（条件：`this.dw_master.accepttext() = -1`）
  - [窗口事件 ue_action_save]「从表此处数据错误，请重新输入。」（条件：`this.dw_detail.accepttext() = -1`）

### wroot_mds — 共享式 + 主从式应用示例

- 类型：主窗口（默认）；尺寸：1669×1236 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_ROOT.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 622,21 567×329 |  |
| dw_master | uo_dw |  | 28,21 531×329 |  |
| dw_sublist | uo_dw |  | 42,493 × |  |

- 窗口事件/函数：
  - `ue_action_query`：打开 `wroot_dw_query`「条件搜索」

- 提示与校验（6 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）
  - [窗口事件 ue_action_del]「删除本条数据，请确认。」（条件：`this.ib_edit`）
  - [窗口事件 ue_action_del]「存入失败，数据不能从库中删除。」
  - [窗口事件 ue_action_refresh]「数据还没有存盘，刷新前是否存盘?」（条件：`this.ib_save = false`）
  - [窗口事件 ue_action_save]「主表此处数据错误，请重新输入。」（条件：`this.dw_detail.accepttext() = -1`）
  - [窗口事件 ue_action_save]「从表此处数据错误，请重新输入。」（条件：`this.dw_sublist.accepttext() = -1`）

### wroot_query — 综合查询

- 类型：主窗口（默认）；尺寸：3077×1648 PBU；库：rhzw_ROOT.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | &S.另存 | 2487,920 256×108 |  |
| cb_exec | 按钮 | &Z.执行 | 2487,1036 256×108 |  |
| cb_exit | 按钮 | &F.返回 | 2487,1268 256×108 |  |
| cb_print | 按钮 | &D.打印 | 2487,1152 256×108 |  |
| cbx_1 | 复选框 | 重复内容不显示 | 101,800 471×80 |  |
| dw_column | 数据窗口 |  | 37,80 713×700 |  |
| dw_result | uo_dw | 共查询到0条记录 | 805,12 1929×880 |  |
| dw_sort1 | 数据窗口 |  | 55,1000 1038×456 | 数据窗口 `d_sort1`；列：col_name、lenth |
| dw_sort2 | 数据窗口 |  | 1175,1000 1221×456 | 数据窗口 `d_sort2`；列：sortcol、sortype |
| dw_tab | uo_tab |  | 27,900 2446×604 | 数据窗口 `d_tab2`；列：tab1（查询条件）、tab2（排列顺序）、tab3、tab4、tab5、tab6、tab7、tab8、tab9、tab10、tab11、tab12、tab13、tab14、tab15 |
| dw_where | 数据窗口 |  | 55,1000 2341×456 | 数据窗口 `d_where`；列：precol、column1（字   段   名）、operator（操作符）、value（字    段    值）、logical（逻辑符） |
| lb_syntax | 列表框 |  | 50,996 2341×456 |  |
| sle_join | 单行输入 |  | 521,416 1641×132 |  |
| sle_table | 单行输入 |  | 521,248 1641×124 |  |
| st_1 | 静态文本 | 请选择待显示列 | 73,8 603×72 |  |
| uo_1 | uo_getjoins |  | 2633,412 192×128 |  |

- 提示与校验（6 条）：
  - [cb_exec.clicked]「当前查询本模块不支持，请修改查询条件。  需要此功能者，请直接与开发商联系。」（条件：`parent.dw_result.create(sqlca.syntaxfromsql(syntax_str,"style(type = Grid)",err)) = -1`）
  - [dw_where.ue_where]「,请改正；  否则，所有查询条件将被忽略。」（条件：`i > 0`）
  - [dw_where.ue_where]「不是字符型,不能使用<含有>或<不含有>操作符,  请改正; 否则，所有查询条件将被忽略。」（条件：`trim(soper) = "like" or trim(soper) = "not like"`）
  - [dw_where.ue_where]「的值应为数字型,请改正；  否则，所有查询条件将被忽略。」（条件：`isnumber(svalue)`）
  - [dw_where.ue_where]「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」（条件：`not isdate(svalue)`）
  - [dw_where.ue_where]「这个数据类型未在本模块中定义。」

### wroot_share — 共享式应用

- 类型：主窗口（默认）；尺寸：1499×1536 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_ROOT.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw_share_detail |  | 23,736 × |  |
| dw_master | uo_dw_share_master |  | 23,220 × |  |
| uo_1 | u_toolbar |  | 32, 544×200 |  |

- 窗口事件/函数：
  - `open`：读写表 b_rights

- 提示与校验（2 条）：
  - [窗口事件 open]「共享DataWindow的数据源可能不一致，请检查。」（条件：`this.dw_master.sharedata(this.dw_detail) = -1`）
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）

### wroot_share_tab — 共享式应用(TAB)

- 类型：主窗口（默认）；尺寸：1961×1356 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_ROOT.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| tab_1 | 标签页容器 |  | 32,224 1362×864 |  |
| tab_1/tabpage_1 | 用户对象 | master | 18,112 1326×736 |  |
| tab_1/tabpage_1/dw_master | uo_dw |  | 87,32 ×500 |  |
| tab_1/tabpage_2 | 用户对象 | detail | 18,112 1326×736 |  |
| tab_1/tabpage_2/dw_detail | uo_dw |  | 78,84 ×500 |  |
| uo_1 | u_toolbar |  | , 544×200 |  |

- 窗口事件/函数：
  - `open`：读写表 b_rights
  - `ue_action_query`：打开 `wroot_dw_query`「条件搜索」

- 提示与校验（8 条）：
  - [窗口事件 open]「共享DataWindow的数据源可能不一致，请检查。」（条件：`this.dw_master.sharedata(this.dw_detail) = -1`）
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）
  - [窗口事件 ue_action_del]「删除本条数据，请确认。」（条件：`l_status = new!`）
  - [窗口事件 ue_action_del]「存入失败，数据没有删除。」
  - [窗口事件 ue_action_print]「开始打印吗?」
  - [窗口事件 ue_action_refresh]「数据还没有存盘，刷新前是否存盘?」（条件：`this.ib_save = false`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」（条件：`message.returnvalue = 1`）
  - [窗口事件 ue_action_save]「此处数据错误，请重新输入。」（条件：`this.dw_detail.accepttext() = -1`）

### wroot_sheet — wroot_sheet

- 类型：主窗口（默认）；尺寸：2245×1236 PBU；菜单：`m_work`；库：rhzw_ROOT.pbd（账务主程序（民非专版））

### wroot_single — 单一式应用

- 类型：主窗口（默认）；尺寸：7712×1240 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_ROOT.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,204 631×676 |  |
| uo_1 | u_toolbar |  | , 768×200 |  |

- 提示与校验（2 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）

### wroot_single_1 — 单一式应用

- 类型：主窗口（默认）；尺寸：2642×1244 PBU；继承：`wroot_sheet`；菜单：`m_work_01`；库：rhzw_ROOT.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 27,228 631×676 |  |
| uo_1 | u_toolbar |  | , 544×200 |  |

- 提示与校验（4 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
