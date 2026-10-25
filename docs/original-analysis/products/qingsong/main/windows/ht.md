# 轻松会计 · 账务主程序 — 窗口目录：辅助核算/往来（前缀 `ht`）

尺寸单位为 PowerBuilder Unit（PBU）。96 DPI、系统字体下约为：宽度像素 ≈ PBU × 0.25～0.3，高度像素 ≈ PBU × 0.25～0.28。
“打开入口”只列静态可见的调用方，运行时拼出来的窗口名可能遗漏。名字含 `_bak`、`_old`、`test` 的通常是历史残留。

### w_ht_htda — 合同档案管理

- 类型：主窗口（默认）；尺寸：7712×1240 PBU；继承：`wroot_single`；菜单：`m_work_ht_zw`；库：rhzw8_7.pbd（账务主程序）
- 打开入口：菜单「O日常业务 › 合同管理 › 合同档案管理」（19 个菜单中）；`w_main1` 的 st_3_ht.clicked；`w_main1` 的 tab_1/tabpage_3/p_t_3_ht.clicked；`w_pz_pzedit_b` 的 事件 u_pzxxbz；`w_pz_pzedit_bak` 的 事件 u_pzxxbz；`w_pz_pzedit_mb` 的 事件 u_pzxxbz；`w_pz_pzedit` 的 事件 u_pzxxbz；`w_xt_dw_sc` 的 dw_1.doubleclicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 14,200 3090×772 | 数据窗口 `dw_ht_htda`（表 htda、dwk）；列：htbh（合同号）、khbh（客户编号）、htmc（合同名称）、nr、rq1（签定日期）、je（金额）、lx（类型）、je1、je2、dw_mc（客户名称）、sm1（备注1）、sm2（备注2）、lrr（录入人）、shr（审核人）、sh_bz（审核）、je0（期初收付款）；itemchanged 读写表 dwk；doubleclicked → `w_ht_htda_nr`「合同说明」、`w_xt_dw_sc`「客户查找」、`w_ht_htda`「合同档案管理」；ue_action_query → `wroot_dw_query`「条件搜索」；ue_action_save → `w_xt_ht_sc`「合同查找」；ue_action_del 读写表 pz |
| uo_1 | u_toolbar |  | , 2912×200 |  |
| dw_save | 数据窗口 |  | 731,376 686×500 |  |

- 窗口事件/函数：
  - `open`：读写表 htda
  - `ue_action_sh`：读写表 htda

- 提示与校验（7 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）
  - [窗口事件 ue_action_sh]「需要本人来取消审核！」（条件：`shr = u_name or shr = ""`）
  - [dw_master.ue_action_save]「此处数据错误，请重新输入。」（条件：`this.accepttext() = -1`）
  - [dw_master.ue_action_del]「存入失败，数据没有删除。」（条件：`this.update() = 1`）
  - [dw_master.ue_action_del]「此合同已经使用，不能删除！」（条件：`r > 0`）
  - [dw_master.ue_action_del]「删除本条数据，请确认。」（条件：`r > 0`）

### w_ht_htda_nr — 合同说明

- 类型：模态对话框；尺寸：2021×832 PBU；库：rhzw8_7.pbd（账务主程序）
- 打开入口：`w_ht_htda` 的 dw_master.doubleclicked；`w_ht_httj` 的 dw_1.doubleclicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 594,564 270×108 |  |
| cb_2 | 按钮 | 取消 | 1166,564 270×108 |  |
| mle_1 | 多行输入 |  | 23,20 1966×500 |  |

### w_ht_httj — 合同账款查询

- 类型：主窗口（默认）；尺寸：4247×1616 PBU；继承：`w_preview_report_base`；菜单：`m_report_r`；库：rhzw8_7.pbd（账务主程序）
- 打开入口：菜单「O日常业务 › 合同管理 › 合同帐款查询」（19 个菜单中）；`w_main1` 的 st_1_ht.clicked；`w_main1` 的 tab_1/tabpage_1/p_t_1_ht.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_a1 | 按钮 | 另存 | 2834,48 247×96 |  |
| cb_a3 | 按钮 | 打印机... | 1947,48 338×96 |  |
| cb_a4 | 按钮 | 打印(&P) | 2286,48 311×96 |  |
| cb_a5 | 按钮 | 关闭 | 3602,48 274×96 |  |
| cb_a6 | 按钮 | < | 942,60 78×72 |  |
| cb_a7 | 按钮 | > | 1189,60 78×72 |  |
| cbx_a1 | 复选框 | 标尺 | 1298,60 201×76 |  |
| cbx_a2 | 复选框 | 横向打印 | 1545,60 334×76 |  |
| ddlb_sfbl | 下拉列表 | 100 | 357,64 219×920 |  |
| dw_1 | uo_dw |  | 5,324 2766×944 | 数据窗口 `dw_ht_httj`（表 htda、dwk）；列：htbh（合同号）、khbh（客户编号）、htmc（合同名称）、nr、rq1（签定日期）、je（金额）、lx（类型）、je1（已收/付金额）、je2（未完成金额）、dw_mc（客户名称）；doubleclicked → `w_ht_htda_nr`「合同说明」、`w_ht_pz`「明细查询」 |
| em_a1 | 格式输入 | 100% | 933,56 338×84 |  |
| gb_1 | 分组框 |  | 14, 3886×176 |  |
| st_1 | 静态文本 | 准备好 | ,1344 3035×72 |  |
| st_b1 | 静态文本 | 打印比例： | 631,72 297×60 |  |
| st_b2 | 静态文本 | 缩放比例： | 46,68 320×64 |  |
| cb_a9 | 按钮 | 查询 | 2592,48 247×96 |  |
| uo_1 | u_toolbar |  | 10002,8 279× |  |
| ddlb_1 | 下拉列表 |  | 2848,216 1275×908 |  |
| em_rq1 | 格式输入 |  | 471,208 402×92 |  |
| em_rq2 | 格式输入 |  | 1019,208 402×92 |  |
| rb_1 | 单选按钮 | 全部 | 1641,212 270×80 |  |
| rb_2 | 单选按钮 | 付款 | 1929,212 270×80 |  |
| rb_3 | 单选按钮 | 收款 | 2217,212 270×80 |  |
| st_2 | 静态文本 | 合同时间范围： | 41,212 430×80 |  |
| st_3 | 静态文本 | 到 | 882,212 119×80 |  |
| st_4 | 静态文本 | 客户选择： | 2514,216 315×80 |  |

- 窗口事件/函数：
  - `open`：读写表 dwk、htda
  - `ue_query`：读写表 htda、pz

### w_ht_pz — 明细查询

- 类型：弹出窗口；尺寸：3269×1476 PBU；库：rhzw8_7.pbd（账务主程序）
- 打开入口：`w_ht_httj` 的 dw_1.doubleclicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 打印 | 974,1240 233×100 | clicked 读写表 dwk、htda |
| cb_2 | 按钮 | 另存 | 1371,1240 233×100 |  |
| cb_3 | 按钮 | 确定 | 1769,1240 233×100 |  |
| dw_1 | 数据窗口 |  | ,24 3173×1192 | 数据窗口 `dw_ht_pz_ll`（表 pz、pzdj、kmbm）；列：nf（年）、yf（月）、pzlx（类型）、pzbh（编号）、kmbm、kmqc、pz_zy（分录摘要）、pz_jf（借方金额）、pz_df（贷方金额）、pz_wb、bz（币种）、pzdj_pzdj_zdr |
| dw_2 | 数据窗口 |  | 5,16 3163×1176 | 数据窗口 `dw_ht_pz_prt`（表 pz、pzdj、kmbm）；列：nf（年）、yf（月）、pzlx（类型）、pzbh（编号）、kmbm（科目编码/名称）、kmbm_kmqc、pz_zy（分录摘要）、pz_jf（借方金额）、pz_df（贷方金额）、pz_wb、bz、pzdj_pzdj_zdr |

- 窗口事件/函数：
  - `open`：读写表 htda
