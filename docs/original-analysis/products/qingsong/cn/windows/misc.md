# 轻松会计 · 出纳模块 — 窗口目录：其他系统窗口（登录、备份恢复、打印、杂项）（前缀 `misc`）

尺寸单位为 PowerBuilder Unit（PBU）。96 DPI、系统字体下约为：宽度像素 ≈ PBU × 0.25～0.3，高度像素 ≈ PBU × 0.25～0.28。
“打开入口”只列静态可见的调用方，运行时拼出来的窗口名可能遗漏。名字含 `_bak`、`_old`、`test` 的通常是历史残留。

### w_bb_def_cn0_bak — 格式定义

- 类型：主窗口（默认）；尺寸：3602×2296 PBU；菜单：`m_cn_work_get2`；库：rhzw9_cn2.pbd（出纳模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_1 | 数据窗口 |  | 14,4 983×96 | 数据窗口 `d_bbml`（表 bbml）；列：xh（编号）、bbname（报表名称）、row、col、bz1、bz2 |
| ole_1 | olecustomcontrol |  | ,204 2871×1540 |  |
| uo_1 | u_toolbar |  | , × |  |

- 窗口事件/函数：
  - `ue_action_get`：读写表 cn_mx
  - `ue_action_read`：读写表 bbml_pos
  - `open`：读写表 bbml_pos、xt
  - `wf_open`：读写表 bbml_pos

- 提示与校验（5 条）：
  - [窗口事件 ue_action_get]「第行的日期」（条件：`string(d1,"yyyy-mm-dd") < (xt_jzyf + "-01")`）
  - [窗口事件 ue_action_get]「本次共转入」（条件：`s_b1 = "1"`）
  - [窗口事件 ue_action_get]「没有符合条件的数据被转入！」（条件：`s_b1 = "1"`）
  - [窗口事件 ue_action_read]「请先确认文件是否存在(Y/N)?」
  - [窗口事件 wf_open]「文件  不存在或读入错！」（条件：`ftp = -1`）

### w_bb_saveas — 数据导出

- 类型：主窗口（默认）；尺寸：3602×2296 PBU；菜单：`m_bb_saveas`；库：rhzw9_root.pbd（出纳模块）
- 打开入口：`nvo_formone6` 的 事件 uf_datatoexcel

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| ole_1 | olecustomcontrol |  | ,204 2871×1540 |  |
| uo_1 | u_toolbar |  | , × |  |

- 窗口事件/函数：
  - `wf_get_cn_lr`：读写表 cn_mx

- 提示与校验（3 条）：
  - [窗口事件 wf_get_cn_lr]「第行的日期」（条件：`string(d1,"yyyy-mm-dd") < (xt_jzyf + "-01")`）
  - [窗口事件 wf_get_cn_lr]「本次共转入条对账单数据！」（条件：`s_b1 = "1"`）
  - [窗口事件 wf_get_cn_lr]「没有符合条件的数据被转入！」（条件：`s_b1 = "1"`）

### w_cb_xt_kmbm_sc — 科目速查

- 类型：弹出窗口；尺寸：3227×2096 PBU；库：rhzw9_cn2.pbd（出纳模块）
- 打开入口：`w_cn_kmsz` 的 cb_1.clicked；`w_cn_kmsz` 的 cb_18.clicked；`w_cn_kmsz` 的 cb_2.clicked；`w_cn_kmsz` 的 cb_28.clicked；`w_cn_kmsz` 的 cb_3.clicked；`w_cn_kmsz` 的 cb_4.clicked；`w_cn_kmsz` 的 cb_5.clicked；`w_cn_kmsz` 的 cb_6.clicked；`w_cn_kmsz` 的 cb_7.clicked；`w_cn_kmsz` 的 cb_8.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 搜索 | 1664,28 229×96 |  |
| cb_2 | 按钮 | 关闭 | 1947,28 229×96 |  |
| dw_1 | uo_dw |  | 37,164 3150×1784 | 数据窗口 `dw_xt_km_help`（表 kmbm）；列：kmbm（科目编码）、km_mc（科目名称）、kmqc、fbs、sls、yefx |
| sle_1 | 单行输入 |  | 352,36 1280×88 |  |
| st_1 | 静态文本 | 搜索条件: | 32,44 338×72 |  |

### w_cwxt — 关于

- 类型：模态对话框；尺寸：1861×864 PBU；库：rhzw9_cn0.pbd（出纳模块）
- 打开入口：菜单「H.帮助 › 版权信息」（19 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 1248,636 247×96 |  |
| p_1 | 图片 | iconwrks.jpg | 50,32 261×228 |  |
| st_1 | 静态文本 | 润衡财务管理系统 | 366,36 1454×104 |  |
| st_2 | 静态文本 | http://www.rhrj.net | 608,452 1065×84 |  |
| st_3 | 静态文本 | 深圳市润衡财经软件有限公司 版权所有 | 32,360 1783×92 |  |
| st_4 | 静态文本 | ver 2008.11.12 | 594,156 1115×76 |  |
| st_6 | 静态文本 | 1994-2026 Runsoft copyright | 672,536 1097×72 |  |
| st_fwk | 静态文本 | 售后服务卡未登记 | 96,524 521×80 |  |

### w_err_view — 错误查看

- 类型：主窗口（默认）；尺寸：7712×1240 PBU；继承：`wroot_single`；菜单：`m_work`；库：rhzw9_root.pbd（出纳模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,204 631×676 | 数据窗口 `d_errmsg`（表 b_errmsg）；列：err_time（出错时间）、err_cname（操作员）、err_num（错误号）、err_message（错误信息）、err_where（出错地方）、err_object（出错对象）、err_event（出错事件）、err_line（行号）、err_cnt |
| uo_1 | u_toolbar |  | , 768×200 |  |

- 提示与校验（2 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）

### w_frame — Frame

- 类型：MDI 框架(带状态栏)；尺寸：3730×2412 PBU；菜单：`m_frame_cn`；库：rhzw9_cn0.pbd（出纳模块）
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_open；`pfc_appsrv` 的 事件 pfc_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| mdi_1 | MDI 客户区 |  | , × |  |

- 窗口事件/函数：
  - `ue_postopen`：打开 `w_login`「用户登录」
  - `open`：打开 `w_login`「用户登录」、`w_login_oem`「用户登录」

- 提示与校验（1 条）：
  - [窗口事件 closequery]「结束 ? ~r ~r温馨提示：为了保护您的数据安全，日常工作中建议您做好数据备份。」

### w_grant — 分配权限

- 类型：模态对话框；尺寸：2747×1540 PBU；库：rhzw9_root.pbd（出纳模块）
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
| dw_grant_wait | uo_dw | 可供模块 | 1518,20 713×756 | 数据窗口 `d_grant_wait`（表 dba.b_module）；列：m_id、c_name |
| sle_cur_user | 静态文本 | 用户/组 | 279,24 361×68 |  |
| st_1 | 静态文本 | 用户/组 | 59,24 251×80 |  |

### w_idle

- 类型：弹出窗口；尺寸：2917×1909 PBU；库：rhzw9_root.pbd（出纳模块）
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_idle；`pfc_appsrv` 的 事件 pfc_idle

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| p_1 | 图片 | logo.bmp | 165,237 2359×1217 |  |
| st_1 | 静态文本 | 按任意键继续...... | 1326,65 586×77 |  |
| st_2 | 静态文本 | Press any key to continue...... | 828,1777 910×77 |  |

### w_logo

- 类型：弹出窗口；尺寸：1189×256 PBU；库：rhzw9_cn1.pbd（出纳模块）
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_open；`pfc_appsrv` 的 事件 pfc_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_1 | 数据窗口 |  | 2469,412 960×420 | 数据窗口 `dw_tzjl`（表 dba.xttz）；列：dm（代码）、tz_name（套帐名称） |
| st_1 | 静态文本 | 系统正在启动，请稍候...... | 37,88 1070×80 |  |

### w_main1_cn — 主窗口

- 类型：主窗口（默认）；尺寸：7419×2968 PBU；继承：`wroot_sheet`；菜单：`m_frame_cn`；库：rhzw9_cn1.pbd（出纳模块）
- 打开入口：菜单「F.文件 › 关闭所有窗口」（19 个菜单中）；`w_login_oem` 的 cb_ok.clicked；`w_login` 的 cb_ok.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_1 | 数据窗口 |  | 6277,1824 242×196 | 数据窗口 `dw_xt_km_help`（表 kmbm）；列：kmbm（科目编码）、km_mc（科目名称）、kmqc、fbs、sls、yefx |
| p_0 | 图片 | rhcn_zw_1_0.jpg | 14,364 896×4200 |  |
| p_11 | 图片 | rhcb_zw_1_0.jpg | 37,500 850×172 |  |
| p_12 | 图片 | rhcb_zw_3_0.bmp | 55,1404 850×172 |  |
| p_3 | 图片 | rhcn_m1.jpg | , 7680×364 |  |
| p_kfzx | 图片 | kfzx_1.jpg | 2683,100 443×136 |  |
| p_rjsj | 图片 | rjsj_1.jpg | 3218,100 443×136 | clicked → `w_login`「用户登录」、`w_login_oem`「用户登录」 |
| st_1_dz | 静态文本 | 对        账 | 78,972 320×76 | clicked → `w_cn_dz_xz`「选择」 |
| st_1_jz | 静态文本 | 结        账 | 78,1096 320×76 | clicked → `w_cn_fz`「结账」 |
| st_1_lr | 静态文本 | 单据录入 | 78,724 320×76 | clicked → `w_cn_lr`「单据录入」 |
| st_1_pz | 静态文本 | 凭证生成 | 78,848 329×76 | clicked → `w_cn_pz`「凭证生成」 |
| st_bb | 静态文本 | 【时钟版】 | 1152,136 713×148 |  |
| tab_1 | 标签页容器 |  | 942,344 4649×3028 |  |
| tab_1/tabpage_1 | 用户对象 |  | 55,16 4576×2996 |  |
| tab_1/tabpage_1/p_cx | 图片 | rhcn0_cx_0.jpg | 1463,1460 658×88 | clicked → `w_cn_cx`「出纳单据综合查询」 |
| tab_1/tabpage_1/p_ll | 图片 | rhcn0_ll_0.jpg | 1463,1304 658×88 | clicked → `w_cn_ll`「单据浏览」 |
| tab_1/tabpage_1/p_rjz | 图片 | rhcn0_rjz_0.jpg | 430,1608 658×88 | clicked → `w_cn_slz`「明细账」 |
| tab_1/tabpage_1/p_hz1 | 图片 | rhcn0_hz1_0.jpg | 430,1460 658×88 | clicked → `w_cn_wbhz`「外币汇总余额表」 |
| tab_1/tabpage_1/p_hz | 图片 | rhcn0_hz_0.jpg | 430,1304 658×88 | clicked → `w_cn_hz`「汇总余额表」 |
| tab_1/tabpage_1/p_t_1_pz | 图片 | rhcb_ck_1_pz_0.bmp | 1170,628 347×292 | clicked → `w_cn_pz`「凭证生成」 |
| tab_1/tabpage_1/st_5 | 静态文本 | 3.出纳模块的数据备份，可进入账务系统点击【数据备份】进行操作（备份文件里包含了 | 146,2104 2994×60 |  |
| tab_1/tabpage_1/st_4 | 静态文本 | 2.如果您想设置操作员及权限，可进入账务系统【用户管理】进行设置 | 146,2032 2327×60 |  |
| tab_1/tabpage_1/st_3 | 静态文本 | 1.首次使用出纳模块须进行系统初始化（不会影响您原来账务系统的数据） | 146,1960 1810×60 |  |
| tab_1/tabpage_1/st_2 | 静态文本 | 温馨提示： | 146,1876 402×72 |  |
| tab_1/tabpage_1/p_t_1_00 | 图片 | rhcn0_m1.jpg | , 6830×4200 |  |
| tab_1/tabpage_1/p_t_1_lr | 图片 | rhcn0_lr_0.jpg | 416,616 402×328 | clicked → `w_cn_lr`「单据录入」 |
| tab_1/tabpage_1/p_t_1_dz | 图片 | rhcn0_dz_0.jpg | 1893,616 402×328 | clicked → `w_cn_dz_xz`「选择」 |
| tab_1/tabpage_1/p_t_1_jz | 图片 | rhcn0_jz_0.jpg | 2651,612 402×328 | clicked → `w_cn_fz`「结账」 |
| tab_1/tabpage_2 | 用户对象 |  | 55,16 4576×2996 |  |
| tab_1/tabpage_2/p_t_2_00 | 图片 | rhcb_ck_m2.bmp | , 6757×3820 |  |
| tab_1/tabpage_2/p_t_2_dy | 图片 | rhcb_ck_2_dy_0.bmp | 288,764 411×296 |  |
| tab_1/tabpage_2/p_t_2_gs | 图片 | rhcb_ck_2_gs_0.bmp | 2016,236 347×292 |  |
| tab_1/tabpage_2/p_t_2_cp | 图片 | rhcb_ck_2_cp_0.bmp | 288,232 347×292 |  |
| tab_1/tabpage_3 | 用户对象 |  | 55,16 4576×2996 |  |

- 提示与校验（1 条）：
  - [st_1_dz.clicked]「请先做系统初始化!」（条件：`kg_bz = "2"`）

### w_module — 模块维护

- 类型：主窗口（默认）；尺寸：7712×1240 PBU；继承：`wroot_single`；菜单：`m_work`；库：rhzw9_root.pbd（出纳模块）
- 打开入口：菜单「F.文件 › 模块管理」（19 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,204 1326×676 | 数据窗口 `d_module`（表 dba.b_module）；列：m_id（模块编号）、e_name（英文名）、c_name（中文名） |
| uo_1 | u_toolbar |  | , 768×200 |  |

- 提示与校验（2 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）

### w_pass — 自改密码

- 类型：模态对话框；尺寸：1659×924 PBU；库：rhzw9_root.pbd（出纳模块）
- 打开入口：菜单「F.文件 › 自改密码」（19 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_exit | 按钮 | &X. 退 出 | 933,680 357×108 |  |
| cb_ok | 按钮 | &Y. 确 认 | 320,680 366×108 | clicked 读写表 b_user |
| p_1 | 图片 | btid.bmp | ,136 370×208 |  |
| sle_newpass | 单行输入 |  | 727,296 695×96 |  |
| sle_oldpass | 单行输入 |  | 727,172 695×96 |  |
| sle_verifypass | 单行输入 |  | 727,420 695×96 |  |
| st_1 | 静态文本 | 输入原密码: | 320,184 398×84 |  |
| st_2 | 静态文本 | 输入新密码: | 315,308 398×84 |  |
| st_3 | 静态文本 | 重输新密码: | 315,432 398×84 |  |
| st_czy | 静态文本 | 当前操作员：manager    系统管理 | 64,36 1531×76 |  |
| st_error | 静态文本 | 原密码错误, 请重新输入 | 416,556 1010×64 |  |

- 提示与校验（1 条）：
  - [cb_ok.clicked]「启用新密码, 请牢记」

### w_paste — 请选择粘贴值

- 类型：模态对话框；尺寸：1733×701 PBU；库：rhzw9_root.pbd（出纳模块）
- 打开入口：菜单「a1 › V.取现有值」（`m_cpq_rbutton_paste`）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_cancel | 按钮 | &C.放弃 | 1390,237 266×109 |  |
| cb_paste | 按钮 | &P.粘贴 | 1390,89 266×109 |  |
| dw_1 | 数据窗口 |  | 37,33 1322×517 |  |

### w_retrieve_wait — 提示窗口

- 类型：弹出窗口；尺寸：1143×512 PBU；库：rhzw9_root.pbd（出纳模块）
- 打开入口：`pfc_dwsrv` 的 事件 pfc_retrievestart；`pfc_dwsrv` 的 事件 pfc_sqlpreview

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_cancel | 按钮 | &Z. 中止 | 366,308 311×100 |  |
| st_1 | 静态文本 | 正在读取数据, 请等待...... | 169,24 832×76 |  |
| st_2 | 静态文本 | 总计： | 219,112 247×72 |  |
| st_3 | 静态文本 | 已读入 | 224,216 247×72 |  |

### w_setbar — 工具条设置

- 类型：模态对话框；尺寸：1825×1009 PBU；库：rhzw9_root.pbd（出纳模块）
- 打开入口：菜单「F.文件 › 工具条设置」（19 个菜单中）

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

- 类型：模态对话框；尺寸：2213×1093 PBU；库：rhzw9_root.pbd（出纳模块）
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_systemerror；`pfc_appsrv` 的 事件 pfc_systemerror

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_continue | 按钮 | &C.继续 | 874,837 458×121 |  |
| cb_exit | 按钮 | &X.退出系统 | 284,829 458×121 |  |
| cb_print | 按钮 | &P.打印 | 1463,837 458×121 |  |
| dw_1 | 数据窗口 |  | 1697,453 494×361 | 数据窗口 `d_errmsg`（表 b_errmsg）；列：err_time（出错时间）、err_cname（操作员）、err_num（错误号）、err_message（错误信息）、err_where（出错地方）、err_object（出错对象）、err_event（出错事件）、err_line（行号）、err_cnt |
| dw_error | 数据窗口 |  | 51,41 2085×741 | 数据窗口 `d_system_error`；列：errornum、message（出错信息：）、where（出错窗口/菜单：）、object（出错对象：）、event（出错事件：）、line（出错行号：） |

### w_users — 用户/组维护

- 类型：主窗口（默认）；尺寸：2098×1704 PBU；菜单：`m_work`；库：rhzw9_root.pbd（出纳模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_grant | 按钮 | &G.分配权限 | 1065,1020 933×108 | clicked → `w_grant`「分配权限」 |
| dw_detail | 数据窗口 |  | 1065,220 933×608 | 数据窗口 `d_users_detail`（表 b_user）；列：u_id（用户号:）、e_name（登录代码）、c_name（用户姓名）、pswd（密码）、isgroup（用户/组:） |
| dw_master | 数据窗口 |  | 9,216 1006×1124 | 数据窗口 `d_users_master`（表 b_user）；列：u_id、e_name、c_name、pswd、isgroup |
| uo_1 | u_toolbar |  | 5, ×200 |  |

- 提示与校验（7 条）：
  - [窗口事件 ue_action_save]「此处数据错误，请重新输入。」（条件：`this.dw_detail.accepttext() = -1`）
  - [窗口事件 ue_action_refresh]「数据还没有存盘，刷新前是否存盘?」（条件：`this.ib_save = false`）
  - [窗口事件 ue_action_del]「删除本条数据，请确认。」（条件：`l_status = new!`）
  - [窗口事件 ue_action_del]「存入失败，数据没有删除。」
  - [窗口事件 ue_display_print]「开始打印吗?」
  - [窗口事件 open]「共享DataWindow的数据源可能不一致，请检查。」（条件：`this.dw_master.sharedata(this.dw_detail) = -1`）
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）

### w_xt_tz_find — 套账查找

- 类型：模态对话框；尺寸：2071×1708 PBU；库：rhzw9_cn1.pbd（出纳模块）
- 打开入口：`w_login_oem` 的 cb_3.clicked；`w_login` 的 cb_3.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 开始搜索 | 1486,8 375×100 |  |
| cb_2 | 按钮 | 确定 | 2094,28 398×108 |  |
| dw_1 | 数据窗口 |  | 78,132 1952×1260 | 数据窗口 `dw_tzjl`（表 dba.xttz）；列：dm（代码）、tz_name（套帐名称） |
| sle_1 | 单行输入 |  | 421,12 1038×88 |  |
| st_1 | 静态文本 | 搜索内容： | 59,20 379×72 |  |
| st_2 | 静态文本 | 键盘操作说明： | 114,1416 526×68 |  |
| st_3 | 静态文本 | 1）按上下箭头选择套账 | 654,1428 585×76 |  |
| st_4 | 静态文本 | 2）找到后按回车确认（或者鼠标双击） | 663,1516 969×76 |  |

### w_xt_zy_cn — 摘要管理

- 类型：模态对话框；尺寸：2304×1348 PBU；库：rhzw9_cn1.pbd（出纳模块）
- 打开入口：`w_cn_lr_add` 的 dw_1.doubleclicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加类别 | 123,924 389×96 |  |
| cb_2 | 按钮 | 增加 | 1019,924 389×96 |  |
| cb_3 | 按钮 | 删除 | 1545,924 389×96 |  |
| cb_4 | 按钮 | 确定 | 704,1100 389×112 | clicked 读写表 zyk |
| cb_5 | 按钮 | 取消 | 1362,1104 389×112 |  |
| dw_1 | 数据窗口 |  | 96,108 471×784 | 数据窗口 `dw_xt_zy_1`（表 zyk）；列：zylb（摘要类别） |
| dw_2 | 数据窗口 |  | 654,108 1559×784 | 数据窗口 `dw_xt_zy_2`（表 zyk）；列：zybm（编码）、zydy（摘要短语）、zylb、usecut、shortcut |
| gb_1 | 分组框 | 类别 | 46,36 567×1032 |  |
| gb_2 | 分组框 | 内容 | 603,36 1646×1032 |  |

- 窗口事件/函数：
  - `open`：读写表 b_rights

- 提示与校验（1 条）：
  - [cb_4.clicked]「摘要编码重复！是否重输？」（条件：`i = -1`）

### w_xtzc_1 — 系统注册

- 类型：模态对话框；尺寸：1285×620 PBU；库：rhzw9_cn1.pbd（出纳模块）
- 打开入口：`w_login` 的 p_1.doubleclicked

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

### w_zoom — 定制

- 类型：模态对话框；尺寸：1002×477 PBU；库：rhzw9_root.pbd（出纳模块）
- 打开入口：`pfc_dwsrv` 的 事件 pfc_rbuttondown_preview

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_cancel | 按钮 | &F.放弃 | 558,237 316×105 |  |
| cb_ok | 按钮 | &Q.确认 | 92,237 316×105 |  |
| em_zoom | 格式输入 | 100 | 682,57 266×97 |  |
| st_1 | 静态文本 | 请输入一百分比值 : | 46,69 636×73 |  |

### wroot_dw_query — 定位查询

- 类型：模态对话框；尺寸：2729×648 PBU；库：rhzw9_root.pbd（出纳模块）
- 打开入口：`uo_dw_share_master` 的 事件 ue_action_query；`uo_dw_single` 的 事件 ue_action_query；`wroot_md_2` 的 事件 ue_action_query；`wroot_md` 的 事件 ue_action_query；`wroot_mds` 的 事件 ue_action_query；`wroot_share_tab` 的 事件 ue_action_query

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_exec | 按钮 | &Z.执行 | 2395,88 256×108 |  |
| cb_exit | 按钮 | &F.返回 | 2395,304 256×108 |  |
| dw_column | 数据窗口 |  | 2373,472 96×60 | 数据窗口 `d_column_set`；列：hz、yw、type、table |
| dw_where | 数据窗口 |  | 9,88 2313×456 | 数据窗口 `d_where`；列：precol、column1（字   段   名）、operator（操作符）、value（字    段    值）、logical（逻辑符） |
| st_1 | 静态文本 | 请输入查询条件 : | 9,12 722×76 |  |

- 提示与校验（6 条）：
  - [dw_where.ue_where]「,请改正」（条件：`i > 0`）
  - [dw_where.ue_where]「不是字符型,不能使用<含有>或<不含有>操作符」（条件：`trim(soper) = "like" or trim(soper) = "not like"`）
  - [dw_where.ue_where]「的值应为数字型,请改正」（条件：`isnumber(svalue)`）
  - [dw_where.ue_where]「的值应为日期型,请改正」（条件：`not isdate(svalue)`）
  - [dw_where.ue_where]「的值应为日期时间型,请改正」（条件：`svalue = "error"`）
  - [dw_where.ue_where]「这个数据类型未在本模块中定义。」

### wroot_dw_query_lr — 定位查询

- 类型：模态对话框；尺寸：2729×648 PBU；库：rhzw9_cn1.pbd（出纳模块）
- 打开入口：`w_cn_lr` 的 dw_master.ue_action_query

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_exec | 按钮 | &Z.执行 | 2395,88 256×108 |  |
| cb_exit | 按钮 | &F.返回 | 2395,304 256×108 |  |
| dw_column | 数据窗口 |  | 2373,472 96×60 | 数据窗口 `d_column_set`；列：hz、yw、type、table |
| dw_where | 数据窗口 |  | 9,88 2313×456 | 数据窗口 `d_where`；列：precol、column1（字   段   名）、operator（操作符）、value（字    段    值）、logical（逻辑符） |
| st_1 | 静态文本 | 请输入查询条件 : | 9,12 722×76 |  |

- 提示与校验（6 条）：
  - [dw_where.ue_where]「,请改正」（条件：`i > 0`）
  - [dw_where.ue_where]「不是字符型,不能使用<含有>或<不含有>操作符」（条件：`trim(soper) = "like" or trim(soper) = "not like"`）
  - [dw_where.ue_where]「的值应为数字型,请改正」（条件：`isnumber(svalue)`）
  - [dw_where.ue_where]「的值应为日期型,请改正」（条件：`not isdate(svalue)`）
  - [dw_where.ue_where]「的值应为日期时间型,请改正」（条件：`svalue = "error"`）
  - [dw_where.ue_where]「这个数据类型未在本模块中定义。」

### wroot_fix_query — 固定查询及统计

- 类型：主窗口（默认）；尺寸：2894×1561 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw9_root.pbd（出纳模块）

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

- 类型：主窗口（默认）；尺寸：1486×1548 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw9_root.pbd（出纳模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 14,772 × |  |
| dw_master | uo_dw |  | 14,208 × |  |
| uo_1 | u_toolbar |  | , 1289×200 |  |

- 窗口事件/函数：
  - `ue_action_query`：打开 `wroot_dw_query`「定位查询」

- 提示与校验（6 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）
  - [窗口事件 ue_action_del]「删除本条数据，请确认。」（条件：`this.ib_edit`）
  - [窗口事件 ue_action_del]「存入失败，数据不能从库中删除。」
  - [窗口事件 ue_action_refresh]「数据还没有存盘，刷新前是否存盘?」（条件：`this.ib_save = false`）
  - [窗口事件 ue_action_save]「主表此处数据错误，请重新输入。」（条件：`this.dw_master.accepttext() = -1`）
  - [窗口事件 ue_action_save]「从表此处数据错误，请重新输入。」（条件：`this.dw_detail.accepttext() = -1`）

### wroot_md2 — wroot_sheet（继承自祖先）

- 类型：主窗口（默认）；尺寸：2245×1520 PBU；继承：`wroot_sheet`；菜单：`m_work_01`；库：rhzw9_root.pbd（出纳模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 5,752 × |  |
| dw_master | uo_dw |  | 23,228 × |  |
| uo_1 | u_toolbar |  | 9, 544×200 |  |

- 提示与校验（1 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）

### wroot_md2_1 — wroot_sheet（继承自祖先）

- 类型：主窗口（默认）；尺寸：2245×1524 PBU；继承：`wroot_sheet`；菜单：`m_work_01`；库：rhzw9_root.pbd（出纳模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 14,712 × |  |
| dw_master | uo_dw |  | ,204 × |  |
| uo_1 | u_toolbar |  | , 544×200 |  |

- 提示与校验（1 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）

### wroot_md_2 — 主从式应用示例

- 类型：主窗口（默认）；尺寸：1486×1236 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw9_root.pbd（出纳模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 14,528 × |  |
| dw_master | uo_dw |  | 14,16 × |  |

- 窗口事件/函数：
  - `ue_action_query`：打开 `wroot_dw_query`「定位查询」

- 提示与校验（6 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）
  - [窗口事件 ue_action_del]「删除本条数据，请确认。」（条件：`this.ib_edit`）
  - [窗口事件 ue_action_del]「存入失败，数据不能从库中删除。」
  - [窗口事件 ue_action_refresh]「数据还没有存盘，刷新前是否存盘?」（条件：`this.ib_save = false`）
  - [窗口事件 ue_action_save]「主表此处数据错误，请重新输入。」（条件：`this.dw_master.accepttext() = -1`）
  - [窗口事件 ue_action_save]「从表此处数据错误，请重新输入。」（条件：`this.dw_detail.accepttext() = -1`）

### wroot_mds — 共享式 + 主从式应用示例

- 类型：主窗口（默认）；尺寸：1669×1236 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw9_root.pbd（出纳模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 622,21 567×329 |  |
| dw_master | uo_dw |  | 28,21 531×329 |  |
| dw_sublist | uo_dw |  | 42,493 × |  |

- 窗口事件/函数：
  - `ue_action_query`：打开 `wroot_dw_query`「定位查询」

- 提示与校验（6 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）
  - [窗口事件 ue_action_del]「删除本条数据，请确认。」（条件：`this.ib_edit`）
  - [窗口事件 ue_action_del]「存入失败，数据不能从库中删除。」
  - [窗口事件 ue_action_refresh]「数据还没有存盘，刷新前是否存盘?」（条件：`this.ib_save = false`）
  - [窗口事件 ue_action_save]「主表此处数据错误，请重新输入。」（条件：`this.dw_detail.accepttext() = -1`）
  - [窗口事件 ue_action_save]「从表此处数据错误，请重新输入。」（条件：`this.dw_sublist.accepttext() = -1`）

### wroot_query — 综合查询

- 类型：主窗口（默认）；尺寸：2885×1648 PBU；库：rhzw9_root.pbd（出纳模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | &S.另存 | 2482,980 256×108 |  |
| cb_exec | 按钮 | &Z.执行 | 2482,1108 256×108 |  |
| cb_exit | 按钮 | &F.返回 | 2482,1364 256×108 |  |
| cb_print | 按钮 | &D.打印 | 2482,1236 256×108 |  |
| dw_column | 数据窗口 |  | 37,80 713×812 |  |
| dw_result | uo_dw | 共查询到0条记录 | 805,12 1797×880 |  |
| dw_sort1 | 数据窗口 |  | 55,1000 1038×456 | 数据窗口 `d_sort1`；列：col_name、lenth |
| dw_sort2 | 数据窗口 |  | 1175,1000 1221×456 | 数据窗口 `d_sort2`；列：sortcol、sortype |
| dw_tab | uo_tab |  | 27,900 2446×604 | 数据窗口 `d_tab2`；列：tab1（查询条件）、tab2（排列顺序）、tab3、tab4、tab5、tab6、tab7、tab8、tab9、tab10、tab11、tab12、tab13、tab14、tab15 |
| dw_where | 数据窗口 |  | 55,1000 2341×456 | 数据窗口 `d_where`；列：precol、column1（字   段   名）、operator（操作符）、value（字    段    值）、logical（逻辑符） |
| lb_syntax | 列表框 |  | 50,996 2341×456 |  |
| sle_join | 单行输入 |  | 521,416 1641×132 |  |
| sle_table | 单行输入 |  | 521,248 1641×124 |  |
| st_1 | 静态文本 | 请选择待显示列 | 73,8 603×72 |  |
| uo_1 | uo_getjoins |  | 2633,412 192×128 |  |

- 提示与校验（7 条）：
  - [cb_exec.clicked]「当前查询本模块不支持，请修改查询条件。  需要此功能者，请直接与开发商联系。」（条件：`parent.dw_result.create(sqlca.syntaxfromsql(syntax_str,"style(type = Grid)",err)) = -1`）
  - [dw_where.ue_where]「,请改正；  否则，所有查询条件将被忽略。」（条件：`i > 0`）
  - [dw_where.ue_where]「不是字符型,不能使用<含有>或<不含有>操作符,  请改正; 否则，所有查询条件将被忽略。」（条件：`trim(soper) = "like" or trim(soper) = "not like"`）
  - [dw_where.ue_where]「的值应为数字型,请改正；  否则，所有查询条件将被忽略。」（条件：`isnumber(svalue)`）
  - [dw_where.ue_where]「的值应为日期型,请改正；  否则，所有查询条件将被忽略。」（条件：`not isdate(svalue)`）
  - [dw_where.ue_where]「的值应为日期时间型,请改正；  否则，所有查询条件将被忽略。」（条件：`svalue = "error"`）
  - [dw_where.ue_where]「这个数据类型未在本模块中定义。」

### wroot_share — 共享式应用

- 类型：主窗口（默认）；尺寸：1499×1536 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw9_root.pbd（出纳模块）

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

- 类型：主窗口（默认）；尺寸：1961×1356 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw9_root.pbd（出纳模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| tab_1 | 标签页容器 |  | 32,224 1362×864 |  |
| tab_1/tabpage_1 | 用户对象 | master | 18,112 1326×736 |  |
| tab_1/tabpage_1/dw_master | uo_dw |  | 87,32 × |  |
| tab_1/tabpage_2 | 用户对象 | detail | 18,112 1326×736 |  |
| tab_1/tabpage_2/dw_detail | uo_dw |  | 78,84 × |  |
| uo_1 | u_toolbar |  | , 544×200 |  |

- 窗口事件/函数：
  - `open`：读写表 b_rights
  - `ue_action_query`：打开 `wroot_dw_query`「定位查询」

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

- 类型：主窗口（默认）；尺寸：2245×1236 PBU；菜单：`m_work`；库：rhzw9_root.pbd（出纳模块）

### wroot_single — 单一式应用

- 类型：主窗口（默认）；尺寸：7712×1240 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw9_root.pbd（出纳模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,204 631×676 |  |
| uo_1 | u_toolbar |  | , 768×200 |  |

- 提示与校验（2 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）

### wroot_single_1 — 单一式应用

- 类型：主窗口（默认）；尺寸：7255×1244 PBU；继承：`wroot_sheet`；菜单：`m_work_01`；库：rhzw9_root.pbd（出纳模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 27,228 631×676 |  |
| uo_1 | u_toolbar |  | , 722×200 |  |

- 提示与校验（1 条）：
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
