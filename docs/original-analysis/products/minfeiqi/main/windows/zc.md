# 民非企 · 账务主程序（民非专版） — 窗口目录：账册打印/输出（前缀 `zc`）

尺寸单位为 PowerBuilder Unit（PBU）。96 DPI、系统字体下约为：宽度像素 ≈ PBU × 0.25～0.3，高度像素 ≈ PBU × 0.25～0.28。
“打开入口”只列静态可见的调用方，运行时拼出来的窗口名可能遗漏。名字含 `_bak`、`_old`、`test` 的通常是历史残留。

### w_zc_dlz — 多栏账

- 类型：模态对话框；尺寸：1952×1016 PBU；库：rhzw8_2.pbd（账务主程序（民非专版））
- 打开入口：菜单「O日常业务 › 账册 › 多栏账」（19 个菜单中）；`w_main1` 的 tab_1/tabpage_1/p_t_1_dl.clicked；`w_zc_dlz_1` 的 事件 u_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 517,732 247×108 | clicked 读写表 kmbm |
| cb_2 | 按钮 | 取消 | 1093,732 247×108 |  |
| cb_3 | 按钮 | 搜索 | 1705,164 201×84 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cbx_1 | 复选框 | 包含未过账凭证 | 658,540 526×72 |  |
| cbx_2 | 复选框 | 含没有数据的科目 | 983,1024 526×72 |  |
| em_1 | 格式输入 |  | 1065,344 224×88 |  |
| em_2 | 格式输入 |  | 1422,344 224×88 |  |
| em_nf | 格式输入 |  | 402,344 343×92 |  |
| sle_1 | 下拉列表 |  | 137,164 1545×948 |  |
| st_1 | 静态文本 | 科目代码： | 69,56 384×72 |  |
| st_3 | 静态文本 | 月份从 | 800,352 247×72 |  |
| st_4 | 静态文本 | 到 | 1294,352 123×72 |  |
| st_nf | 静态文本 | 会计年度 | 160,352 229×72 |  |

- 窗口事件/函数：
  - `open`：读写表 kmbm

- 提示与校验（2 条）：
  - [cb_1.clicked]「无 此 科 目 !」（条件：`i = 100`）
  - [cb_1.clicked]「此科目为明细科目，不能生成多栏明细帐！」（条件：`xx1 = "1"`）

### w_zc_dlz_1 — 多栏账

- 类型：主窗口（默认）；尺寸：3081×1972 PBU；继承：`wroot_single_1`；菜单：`m_work_zc_02`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 361,196 631×676 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| uo_1 | u_toolbar |  | , 544×200 |  |
| dw_1 | 数据窗口 |  | 14,204 2821×1348 |  |
| dw_2 | 数据窗口 |  | 955,1056 1477×480 |  |

- 窗口事件/函数：
  - `open`：读写表 kmbm
  - `user_prt`：打开 `w_print_1`「打印」；数据窗口 `dw_zc_dlz1_prt`、`dw_zc_dlz_prt`；读写表 kmbm
  - `u_open`：打开 `w_zc_dlz`「多栏账」
  - `ue_action_preview`：打开 `w_preview_dlz`「多栏帐打印」
  - `wf_get`：读写表 hz、kmbm、nc、pz、pzlx

- 提示与校验（9 条）：
  - [窗口事件 open]「建立数据窗口不成功！~r 可能是下级科目太多，内存不足！」（条件：`i = -1`）
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt]「没有记录，无法显示及预览！」（条件：`this.dw_1.rowcount() = 0`）
  - [窗口事件 user_prt]「下面打印多栏帐正页！」（条件：`this.dw_1.rowcount() = 0`）
  - [窗口事件 user_prt]「下面打印多栏帐附页！第  页」
  - [窗口事件 ue_action_saveas]「多栏账的列数超过248，无法另存！」（条件：`this.kmsl > 248`）

### w_zc_dz — 对账

- 类型：模态对话框；尺寸：2615×1096 PBU；库：rhzw8_zc1.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 992,876 247×108 |  |
| dw_1 | 数据窗口 | none | 32,136 2510×704 | 数据窗口 `dw_zc_dz`；列：kmbm（科目编码）、kmqc（科目名称）、je1（卡片金额）、je2（账务金额） |
| em_1 | 格式输入 | none | 1079,28 343×104 |  |
| st_1 | 静态文本 | 固定资产卡片和账务凭证对账日期： | 128,36 887×60 |  |

- 窗口事件/函数：
  - `open`：读写表 zc_gdzc

### w_zc_fhdlz — 辅助多栏账

- 类型：模态对话框；尺寸：2144×1024 PBU；库：rhzw8_2.pbd（账务主程序（民非专版））
- 打开入口：菜单「O日常业务 › 账册 › 辅助多栏明细账」（19 个菜单中）；`w_main1` 的 tab_1/tabpage_1/p_t_1_fzdl.clicked；`w_xt_bm_sc` 的 dw_1.doubleclicked；`w_xt_bm_sc` 的 事件 u_open；`w_xt_dw_sc` 的 dw_1.doubleclicked；`w_xt_dw_sc` 的 事件 u_open；`w_xt_gr_sc` 的 dw_1.doubleclicked；`w_xt_gr_sc` 的 事件 u_open；`w_xt_xm_sc` 的 dw_1.doubleclicked；`w_xt_xm_sc` 的 事件 u_open；`w_zc_fhdlz_1_bak` 的 事件 u_open；`w_zc_fhdlz_1` 的 事件 u_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 517,732 265×108 | clicked 读写表 kmbm |
| cb_2 | 按钮 | 取消 | 1157,732 265×108 |  |
| cb_3 | 按钮 | 搜索 | 1792,148 155×80 | clicked → `w_xt_kmwh`「科目维护」；clicked 读写表 kmbm |
| cb_xm | 按钮 | 搜索 | 1865,456 155×80 | clicked → `w_xt_xm_sc`「项目查找」、`w_xt_dw_sc`「客户查找」、`w_xt_bm_sc`「部门查找」、`w_xt_gr_sc`「人员查找」、`w_zc_fhdlz`「辅助多栏账」 |
| cbx_1 | 复选框 | 包含未过账凭证 | 677,604 608×72 |  |
| ddlb_1 | 下拉列表 |  | 439,444 1417×496 |  |
| ddlb_4 | 下拉列表 |  | 1623,300 398×512 | selectionchanged 读写表 bmk、dwk、grk、xmk |
| em_1 | 格式输入 |  | 777,292 201×92 |  |
| em_2 | 格式输入 |  | 1125,292 201×92 |  |
| em_nf | 格式输入 |  | 279,292 297×92 |  |
| sle_1 | 下拉列表 |  | 123,144 1637×948 |  |
| st_1 | 静态文本 | 项目 | 128,460 302×72 |  |
| st_2 | 静态文本 | 科目代码 | 64,60 306×72 |  |
| st_3 | 静态文本 | 月份从 | 553,300 215×72 |  |
| st_4 | 静态文本 | 到 | 997,300 110×72 |  |
| st_5 | 静态文本 | 核算类型 | 1326,312 274×84 |  |
| st_nf | 静态文本 | 会计年度 | 55,300 229×72 |  |

- 窗口事件/函数：
  - `open`：读写表 kmbm、xmk

- 提示与校验（2 条）：
  - [cb_1.clicked]「无 此 科 目 !」（条件：`i = 100`）
  - [cb_1.clicked]「此科目为明细科目，不能生成多栏明细帐！」（条件：`xx1 = "1"`）

### w_zc_fhdlz_1 — 多栏账

- 类型：主窗口（默认）；尺寸：3045×1792 PBU；继承：`wroot_single_1`；菜单：`m_work_zc_02`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 361,196 631×676 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| uo_1 | u_toolbar |  | , 544×200 |  |
| dw_1 | 数据窗口 |  | 14,212 2821×1348 |  |
| dw_2 | 数据窗口 |  | 955,1056 1477×480 |  |

- 窗口事件/函数：
  - `open`：读写表 kmbm
  - `user_prt`：数据窗口 `dw_zc_dlz1_prt`、`dw_zc_dlz_prt`；读写表 kmbm
  - `u_open`：打开 `w_zc_fhdlz`「辅助多栏账」
  - `ue_action_preview`：打开 `w_preview_dlz`「多栏帐打印」
  - `wf_sc_01`：读写表 hz、pz、pzlx、xmnc
  - `wf_sc_02`：读写表 dwnc、hz、pz、pzlx
  - `wf_sc_03`：读写表 bmnc、hz、pz、pzlx
  - `wf_sc_04`：读写表 grnc、hz、pz、pzlx

- 提示与校验（9 条）：
  - [窗口事件 open]「建立数据窗口不成功！~r 可能是下级科目太多，内存不足！」（条件：`this.i = -1`）
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt]「没有记录，无法显示及预览！」（条件：`this.dw_1.rowcount() = 0`）
  - [窗口事件 user_prt]「下面打印多栏帐正页！」（条件：`this.dw_1.rowcount() = 0`）
  - [窗口事件 user_prt]「下面打印多栏帐附页！第  页」
  - [窗口事件 ue_action_saveas]「多栏账的列数超过248，无法另存！」（条件：`this.kmsl > 248`）

### w_zc_fhdlz_1_bak — 多栏账

- 类型：主窗口（默认）；尺寸：3045×1792 PBU；继承：`wroot_single_1`；菜单：`m_work_zc_02`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 361,196 631×676 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| uo_1 | u_toolbar |  | , 544×200 |  |
| dw_1 | 数据窗口 |  | 9,212 2821×1348 | doubleclicked 读写表 b_rights |
| dw_2 | 数据窗口 |  | 955,1056 1477×480 |  |

- 窗口事件/函数：
  - `open`：读写表 kmbm
  - `user_prt`：数据窗口 `dw_zc_dlz1_prt`、`dw_zc_dlz_prt`；读写表 kmbm
  - `u_open`：打开 `w_zc_fhdlz`「辅助多栏账」
  - `ue_action_preview`：打开 `w_preview_dlz`「多栏帐打印」
  - `wf_sc_00`：读写表 hz、pz、pzdj、pzlx、xmnc
  - `wf_sc_01`：读写表 dwnc、hz、pz、pzdj、pzlx
  - `wf_sc_02`：读写表 bmnc、hz、pz、pzdj、pzlx
  - `wf_sc_93`：读写表 grnc、hz、pz、pzdj、pzlx

- 提示与校验（7 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt]「没有记录，无法显示及预览！」（条件：`this.dw_1.rowcount() = 0`）
  - [窗口事件 user_prt]「下面打印多栏帐正页！」（条件：`this.dw_1.rowcount() = 0`）
  - [窗口事件 user_prt]「下面打印多栏帐附页！第  页」

### w_zc_fhslz — 辅助明细账

- 类型：模态对话框；尺寸：2098×984 PBU；库：rhzw8_2.pbd（账务主程序（民非专版））
- 打开入口：菜单「O日常业务 › 账册 › 辅助明细账」（19 个菜单中）；`w_main1` 的 tab_1/tabpage_1/p_t_1_fzmx.clicked；`w_xt_bm_sc` 的 dw_1.doubleclicked；`w_xt_bm_sc` 的 事件 u_open；`w_xt_dw_sc` 的 dw_1.doubleclicked；`w_xt_dw_sc` 的 事件 u_open；`w_xt_gr_sc` 的 dw_1.doubleclicked；`w_xt_gr_sc` 的 事件 u_open；`w_xt_xm_sc` 的 dw_1.doubleclicked；`w_xt_xm_sc` 的 事件 u_open；`w_zc_fhslz_1_bak` 的 事件 u_open；`w_zc_fhslz_1` 的 事件 u_open……（共 14 处）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 567,692 283×108 |  |
| cb_2 | 按钮 | 取消 | 969,696 283×108 |  |
| cb_xm | 按钮 | 搜索 | 1906,228 155×80 | clicked → `w_xt_xm_sc`「项目查找」、`w_xt_dw_sc`「客户查找」、`w_xt_bm_sc`「部门查找」、`w_xt_gr_sc`「人员查找」、`w_zc_fhslz`「辅助明细账」 |
| cbx_1 | 复选框 | 包含未过账凭证 | 594,580 608×72 |  |
| ddlb_1 | 下拉列表 |  | 421,224 1481×636 |  |
| ddlb_2 | 下拉列表 |  | 421,364 539×564 |  |
| ddlb_3 | 下拉列表 |  | 1307,364 498×528 |  |
| ddlb_4 | 下拉列表 |  | 1650,80 334×424 | selectionchanged 读写表 bmk、dwk、grk、xmk |
| em_1 | 格式输入 |  | 850,76 192×92 |  |
| em_2 | 格式输入 |  | 1157,76 192×92 |  |
| em_nf | 格式输入 |  | 315,76 306×92 |  |
| st_1 | 静态文本 | 项目 | 91,236 302×72 |  |
| st_2 | 静态文本 | 账册选择 | 87,376 306×72 |  |
| st_3 | 静态文本 | 月份从 | 599,84 247×72 |  |
| st_4 | 静态文本 | 到 | 1029,84 123×72 |  |
| st_5 | 静态文本 | 核算类型 | 1353,80 279×84 |  |
| st_6 | 静态文本 | 币种 | 1033,380 247×72 |  |
| st_nf | 静态文本 | 会计年度 | 37,84 251×72 |  |

- 窗口事件/函数：
  - `open`：读写表 bmk、dwk、fbgl、grk、xmk

### w_zc_fhslz_1 — 三栏明细账（继承自祖先）

- 类型：主窗口（默认）；尺寸：6295×2308 PBU；继承：`w_zc_slz_1`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 27,336 3936×676 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | 搜索 | 3872,208 155×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_nd1 | 按钮 | < | 4590,216 101×80 |  |
| cb_nd2 | 按钮 | > | 4901,216 101×80 |  |
| ddlb_1 | 下拉列表 |  | 334,212 1824×1380 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 2688,668 1600×564 | 数据窗口 `dw_zc_fhslz_kmbm`（表 kmbm）；列：kmbm（科目编码）、kmqc、kmjs、yjd |
| dw_3 | 数据窗口 |  | 869,776 2697×808 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| em_nd | 格式输入 | 2018 | 4690,216 201×80 |  |
| st_1 | 静态文本 | 科目： | 37,216 270×80 |  |
| st_kj | 静态文本 | 会计年度 | 4320,216 261×80 |  |
| ddlb_2 | 下拉列表 |  | 2464,216 1838×1356 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_slz`、`dw_zc_slz_b`；读写表 bmk、dwk、grk、xmk
  - `u_open`：打开 `w_zc_fhslz`「辅助明细账」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2_zw`「连续打印选择」、`w_print_zc`「账册打印」；读写表 kmbm
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 bmnc、dwnc、grnc、hz、pz、pzlx、slz、xmnc

- 提示与校验（16 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_saveas]「是否导出?」
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）

### w_zc_fhslz_1_bak — 三栏明细账（继承自祖先）

- 类型：主窗口（默认）；尺寸：6295×1832 PBU；继承：`w_zc_slz_1`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 27,336 631×676 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | 搜索 | 2441,204 155×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_nd1 | 按钮 | < | 3095,220 101×80 |  |
| cb_nd2 | 按钮 | > | 3406,220 101×80 |  |
| ddlb_1 | 下拉列表 |  | 334,216 1486×1008 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 1225,712 1655×828 | 数据窗口 `dw_zc_fhslz_kmbm`（表 kmbm）；列：kmbm（科目编码）、kmqc、kmjs、yjd |
| dw_3 | 数据窗口 |  | 869,776 2697×808 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| em_nd | 格式输入 | 2018 | 3195,220 201×80 |  |
| st_1 | 静态文本 | 科目： | 37,208 270×84 |  |
| st_kj | 静态文本 | 会计年度 | 2825,220 261×80 |  |
| ddlb_2 | 下拉列表 |  | 2144,212 1335×884 |  |

- 窗口事件/函数：
  - `open`：读写表 bmk、dwk、grk、xmk
  - `u_open`：打开 `w_zc_fhslz`「辅助明细账」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2`「打印」、`w_print_zc`「账册打印」
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 bmnc、dwnc、grnc、hz、pz、pzlx、slz、xmnc

- 提示与校验（15 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）

### w_zc_fzslz_fb — 三栏复币明细账

- 类型：主窗口（默认）；尺寸：5394×1832 PBU；继承：`w_zc_slz_fb`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 9,412 4850×676 | 数据窗口 `dw_zc_slz_fb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目名称）、jslb、pz_ph（支票号）、pjdh、jf（借方发生额）、df（贷方发生额）、ye（余额）、pzrq、jf_wb（借方外币）、jf_hl（汇率）、df_wb（贷方外币）、df_hl（汇率）、ye_wb、nf、pzdj_bz、xmbm、xm_mc、xh |
| uo_1 | u_toolbar |  | 9, 4480×200 |  |
| cb_1 | 按钮 | 搜索 | 5093,204 155×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_nd1 | 按钮 | < | 315,308 101×80 |  |
| cb_nd2 | 按钮 | > | 626,308 101×80 |  |
| ddlb_1 | 下拉列表 |  | 293,208 1723×1412 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 622,440 1655×828 | 数据窗口 `dw_zc_fhslz_kmbm`（表 kmbm）；列：kmbm（科目编码）、kmqc、kmjs、yjd |
| dw_3 | 数据窗口 |  | 1701,592 2697×808 | 数据窗口 `dw_zc_slz_fb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目名称）、jslb、pz_ph（支票号）、pjdh、jf（借方发生额）、df（贷方发生额）、ye（余额）、pzrq、jf_wb（借方外币）、jf_hl（汇率）、df_wb（贷方外币）、df_hl（汇率）、ye_wb、nf、pzdj_bz、xmbm、xm_mc、xh |
| em_nd | 格式输入 | 2018 | 416,308 201×80 |  |
| st_1 | 静态文本 | 科目： | 9,208 256×84 |  |
| st_kj | 静态文本 | 会计年度 | 59,308 261×80 |  |
| st_2 | 静态文本 | 外币余额如果是负数，表示和金额的余额方向不一致，请查看您的凭证是否做错！ | 1961,312 2094×76 |  |
| st_3 | 静态文本 | 币种： | 2048,220 233×72 |  |
| ddlb_2 | 下拉列表 |  | 2391,220 1829×1296 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_slz_fb`、`dw_zc_slz_fb_b`；读写表 bmk、dwk、grk、xmk
  - `u_open`：打开 `w_zc_fhslz`「辅助明细账」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2_zw`「连续打印选择」、`w_print_zc`「账册打印」；读写表 kmbm
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 bmnc、dwnc、grnc、hz、pz、pzlx、slz、xmnc

- 提示与校验（15 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）

### w_zc_fzslz_sl — 三栏明细账（继承自祖先）

- 类型：主窗口（默认）；尺寸：6281×1832 PBU；继承：`w_zc_slz_sl`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 18,392 3058×676 | 数据窗口 `dw_zc_slz_fb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目名称）、jslb、pz_ph（支票号）、pjdh、jf（借方发生额）、df（贷方发生额）、ye（余额）、pzrq、jf_wb（借方外币）、jf_hl（汇率）、df_wb（贷方外币）、df_hl（汇率）、ye_wb、nf、pzdj_bz、xmbm、xm_mc、xh |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | 搜索 | 4206,304 155×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_nd1 | 按钮 | < | 315,304 101×80 |  |
| cb_nd2 | 按钮 | > | 626,304 101×80 |  |
| ddlb_1 | 下拉列表 |  | 297,208 1733×1408 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 955,568 1655×828 | 数据窗口 `dw_zc_fhslz_kmbm`（表 kmbm）；列：kmbm（科目编码）、kmqc、kmjs、yjd |
| dw_3 | 数据窗口 |  | 1810,648 2697×808 | 数据窗口 `dw_zc_slz_fb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目名称）、jslb、pz_ph（支票号）、pjdh、jf（借方发生额）、df（贷方发生额）、ye（余额）、pzrq、jf_wb（借方外币）、jf_hl（汇率）、df_wb（贷方外币）、df_hl（汇率）、ye_wb、nf、pzdj_bz、xmbm、xm_mc、xh |
| em_nd | 格式输入 | 2018 | 416,304 201×80 |  |
| st_1 | 静态文本 | 科目： | 14,220 270×84 |  |
| st_kj | 静态文本 | 会计年度 | 46,304 261×80 |  |
| st_2 | 静态文本 | 数量余额如果负数，表示和金额的余额方向不一致，请查看您的凭证是否做错！ | 1787,308 2021×76 |  |
| ddlb_2 | 下拉列表 |  | 2395,216 1733×1384 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_slz_fb`、`dw_zc_slz_fb_b`；读写表 bmk、dwk、grk、xmk
  - `x5`：读写表 kmbm
  - `u_open`：打开 `w_zc_fhslz`「辅助明细账」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2_zw`「连续打印选择」、`w_print_zc`「账册打印」；读写表 kmbm
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 bmnc、dwnc、grnc、hz、pz、pzlx、slz、xmnc

- 提示与校验（15 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）

### w_zc_qxfz — 取消折旧

- 类型：模态对话框；尺寸：1449×724 PBU；库：rhzw8_zc1.pbd（账务主程序（民非专版））
- 打开入口：菜单「S系统管理 › 取消折旧」（3 个菜单中）；`w_main1_zc` 的 tab_1/tabpage_1/p_t_1_zj.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 315,492 247×100 | clicked 读写表 xt、zc_gdzc、zc_yzjb、zc_yzzj |
| cb_2 | 按钮 | 取消 | 745,492 247×100 |  |
| st_1 | 静态文本 | 月的固定资产折旧信息 | 517,360 814×88 |  |
| st_2 | 静态文本 | 本功能将取消 | 59,256 750×88 |  |
| st_4 | 静态文本 | 提  示 | 425,48 567×124 |  |
| st_jzyf | 静态文本 | 1996.07 | 133,360 375×88 |  |

### w_zc_saveas — 批量转出选择

- 类型：模态对话框；尺寸：1591×824 PBU；库：rhzw8_2.pbd（账务主程序（民非专版））
- 打开入口：`w_zc_fhslz_1_bak` 的 事件 ue_saveas；`w_zc_fhslz_1` 的 事件 ue_saveas；`w_zc_fzslz_fb` 的 事件 ue_saveas；`w_zc_fzslz_sl` 的 事件 ue_saveas；`w_zc_slz_1_bak` 的 事件 ue_saveas；`w_zc_slz_1` 的 事件 ue_saveas；`w_zc_slz_fb` 的 事件 ue_saveas；`w_zc_slz_sl` 的 事件 ue_saveas；`w_zc_slz_slfb` 的 事件 ue_saveas；`w_zc_xjll_1` 的 事件 ue_saveas；`w_zc_xjrjz_1` 的 事件 ue_saveas；`w_zc_xjrjz_fb` 的 事件 ue_saveas……（共 15 处）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_cancel | 按钮 | &C.放弃 | 1184,404 311×108 |  |
| cb_ok | 按钮 | &Q.确定 | 1184,236 315×108 |  |
| cbx_1 | 复选框 | 包括无发生额科目 | 256,556 571×80 |  |
| gb_1 | 分组框 | 导出科目选择 | 46,36 923×468 |  |
| rb_1 | 单选按钮 | 全部科目 | 256,128 535×72 |  |
| rb_2 | 单选按钮 | 明细科目 | 256,248 535×72 |  |
| rb_3 | 单选按钮 | 一级科目 | 256,360 535×72 |  |

### w_zc_sblb — 设备类别维护

- 类型：模态对话框；尺寸：1847×1256 PBU；继承：`w_root_xt`；库：rhzw8_zc1.pbd（账务主程序（民非专版））
- 打开入口：菜单「I基础档案 › 资产类别」（3 个菜单中）；`w_main1_zc` 的 st_3_lb.clicked；`w_main1_zc` 的 tab_1/tabpage_3/p_t_3_lb.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1550,560 247×108 |  |
| cb_2 | 按钮 | 打印 | 1550,768 247×108 |  |
| cb_3 | 按钮 | 删除 | 1550,664 247×108 |  |
| cb_4 | 按钮 | 确定 | 1550,872 247×108 |  |
| cb_5 | 按钮 | 取消 | 1550,976 247×108 |  |
| cb_6 | 按钮 | 另存 | 1550,456 247×108 |  |
| dw_master | uo_dw_single |  | 9,12 1495×1104 | 数据窗口 `dw_sblb`（表 zc_sblb）；列：sblb（类别）、mc（名称）、czl、kmbm；doubleclicked → `w_xt_kmwh`「科目维护」；doubleclicked 读写表 b_rights、kmbm |

- 提示与校验（2 条）：
  - [dw_master.doubleclicked]「科目不是明细科目，不可选。」（条件：`mm_zy <> "1"`）
  - [dw_master.doubleclicked]「科目已经停用，不可选。」（条件：`mm_sybz = "1"`）

### w_zc_sblb_bak — 设备类别

- 类型：模态对话框；尺寸：1577×1048 PBU；库：rhzw8_zc1.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 201,808 247×108 |  |
| cb_2 | 按钮 | 删除 | 480,808 247×108 | clicked 读写表 zc_gdzc |
| cb_3 | 按钮 | 存盘 | 759,808 247×108 |  |
| cb_4 | 按钮 | 退出 | 1038,808 247×108 |  |
| dw_1 | 数据窗口 |  | 46,84 1458×656 | 数据窗口 `dw_sblb`（表 zc_sblb）；列：sblb（类别）、mc（名称）、czl、kmbm |
| gb_1 | 分组框 |  | 23,16 1513×740 |  |

- 窗口事件/函数：
  - `open`：读写表 zc_sblb

- 提示与校验（4 条）：
  - [cb_2.clicked]「该类别已使用，不能被删除！」（条件：`l > 0`）
  - [cb_2.clicked]「删除该 类别吗？」（条件：`l > 0`）
  - [cb_3.clicked]「编号必须要输入!」（条件：`xx = ""`）
  - [cb_3.clicked]「数据更数失败!」（条件：`parent.dw_1.update(true,false) = -1`）

### w_zc_sbyt — 用途维护

- 类型：模态对话框；尺寸：1705×1436 PBU；继承：`w_root_xt`；库：rhzw8_zc1.pbd（账务主程序（民非专版））
- 打开入口：菜单「I基础档案 › 资产用途」（3 个菜单中）；`w_main1_zc` 的 st_3_yt.clicked；`w_main1_zc` 的 tab_1/tabpage_3/p_t_3_yt.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1394,620 247×108 |  |
| cb_2 | 按钮 | 打印 | 1394,828 247×108 |  |
| cb_3 | 按钮 | 删除 | 1394,724 247×108 |  |
| cb_4 | 按钮 | 确定 | 1394,932 247×108 |  |
| cb_5 | 按钮 | 取消 | 1394,1036 247×108 |  |
| cb_6 | 按钮 | 另存 | 1394,516 247×108 |  |
| dw_master | uo_dw_single |  | 18,12 1344×1152 | 数据窗口 `dw_sbyt`（表 zc_sbyt）；列：ytbh（编号）、yt_mc（用途）、kmbm（对应折旧分配科目）；doubleclicked → `w_xt_kmwh`「科目维护」；doubleclicked 读写表 b_rights、kmbm |
| st_1 | 静态文本 | 提示：未选择科目将无法生成折旧凭证！ | 87,1188 1070×80 |  |
| st_2 | 静态文本 | 对应折旧科目选择 管理费用-折旧费等等 | 247,1264 1070×80 |  |

- 提示与校验（2 条）：
  - [dw_master.doubleclicked]「科目不是明细科目，不可选。」（条件：`mm_zy <> "1"`）
  - [dw_master.doubleclicked]「科目已经停用，不可选。」（条件：`mm_sybz = "1"`）

### w_zc_sbyt_bak — 用途维护

- 类型：模态对话框；尺寸：1486×1060 PBU；库：rhzw8_zc1.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 119,808 233×92 |  |
| cb_2 | 按钮 | 删除 | 402,808 233×92 | clicked 读写表 zc_gdzc |
| cb_3 | 按钮 | 存盘 | 686,808 233×92 |  |
| cb_4 | 按钮 | 退出 | 969,808 233×92 |  |
| dw_1 | 数据窗口 |  | 46,84 1321×612 | 数据窗口 `dw_sbyt`（表 zc_sbyt）；列：ytbh（编号）、yt_mc（用途）、kmbm（对应折旧分配科目） |
| gb_1 | 分组框 |  | 23,16 1394×728 |  |

- 提示与校验（4 条）：
  - [cb_2.clicked]「该用途已使用，不能被删除！」（条件：`l > 0`）
  - [cb_2.clicked]「删除该 用途吗？」（条件：`l > 0`）
  - [cb_3.clicked]「编号必须要输入!」（条件：`xx = ""`）
  - [cb_3.clicked]「数据更数失败!」（条件：`parent.dw_1.update(true,false) = -1`）

### w_zc_sbzt — 设备状态维护

- 类型：模态对话框；尺寸：1394×1292 PBU；继承：`w_root_xt`；库：rhzw8_zc1.pbd（账务主程序（民非专版））
- 打开入口：菜单「I基础档案 › 设备状态」（3 个菜单中）；`w_main1_zc` 的 st_3_zt.clicked；`w_main1_zc` 的 tab_1/tabpage_3/p_t_3_zt.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1093,616 247×108 |  |
| cb_2 | 按钮 | 打印 | 1093,824 247×108 |  |
| cb_3 | 按钮 | 删除 | 1093,720 247×108 |  |
| cb_4 | 按钮 | 确定 | 1093,932 247×108 |  |
| cb_5 | 按钮 | 取消 | 1093,1036 247×108 |  |
| cb_6 | 按钮 | 另存 | 1093,512 247×108 |  |
| dw_master | uo_dw_single |  | 18,12 1010×1140 | 数据窗口 `dw_sbzt`（表 zc_sbzt）；列：sbzt（编号）、sbzt_mc（状态）、zjjt（是否折旧） |

### w_zc_sbzt_bak — 设备状态

- 类型：模态对话框；尺寸：1394×1216 PBU；库：rhzw8_zc1.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1120,628 247×104 |  |
| cb_2 | 按钮 | 删除 | 1120,748 247×104 | clicked 读写表 zc_gdzc |
| cb_3 | 按钮 | 存盘 | 1120,868 247×104 |  |
| cb_4 | 按钮 | 退出 | 1120,988 247×104 |  |
| dw_1 | 数据窗口 |  | 46,84 992×992 | 数据窗口 `dw_sbzt`（表 zc_sbzt）；列：sbzt（编号）、sbzt_mc（状态）、zjjt（是否折旧） |
| gb_1 | 分组框 |  | 23,16 1056×1080 |  |

- 提示与校验（4 条）：
  - [cb_2.clicked]「该状态已使用，不能被删除！」（条件：`l > 0`）
  - [cb_2.clicked]「删除该 状态吗？」（条件：`l > 0`）
  - [cb_3.clicked]「编号必须要输入!」（条件：`xx = ""`）
  - [cb_3.clicked]「数据更数失败!」（条件：`parent.dw_1.update(true,false) = -1`）

### w_zc_sbzx — 注销原因维护

- 类型：模态对话框；尺寸：1239×1292 PBU；继承：`w_root_xt`；库：rhzw8_zc1.pbd（账务主程序（民非专版））
- 打开入口：菜单「I基础档案 › 注销原因」（3 个菜单中）；`w_main1_zc` 的 st_3_zx.clicked；`w_main1_zc` 的 tab_1/tabpage_3/p_t_3_zx.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 928,600 247×108 |  |
| cb_2 | 按钮 | 打印 | 928,808 247×108 |  |
| cb_3 | 按钮 | 删除 | 928,704 247×108 |  |
| cb_4 | 按钮 | 确定 | 928,912 247×108 |  |
| cb_5 | 按钮 | 取消 | 928,1016 247×108 |  |
| cb_6 | 按钮 | 另存 | 928,496 247×108 |  |
| dw_master | uo_dw_single |  | 18,12 850×1140 | 数据窗口 `dw_zxyy`（表 zc_sbzx）；列：zxyy（编号）、zx_sm（注销原因） |

### w_zc_sbzx_bak — 设备状态

- 类型：模态对话框；尺寸：1262×1168 PBU；库：rhzw8_zc1.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 969,528 247×108 |  |
| cb_2 | 按钮 | 删除 | 969,656 247×108 | clicked 读写表 zc_gdzc |
| cb_3 | 按钮 | 存盘 | 969,784 247×108 |  |
| cb_4 | 按钮 | 退出 | 969,912 247×108 |  |
| dw_1 | 数据窗口 |  | 41,72 864×964 | 数据窗口 `dw_zxyy`（表 zc_sbzx）；列：zxyy（编号）、zx_sm（注销原因） |
| gb_1 | 分组框 |  | 14, 923×1060 |  |

- 提示与校验（4 条）：
  - [cb_2.clicked]「该注销原因已使用，不能被删除！」（条件：`l > 0`）
  - [cb_2.clicked]「删除该 注销原因吗？」（条件：`l > 0`）
  - [cb_3.clicked]「编号必须要输入!」（条件：`xx = ""`）
  - [cb_3.clicked]「数据更数失败!」（条件：`parent.dw_1.update(true,false) = -1`）

### w_zc_slz — 明细账

- 类型：模态对话框；尺寸：2021×1328 PBU；库：rhzw8_2.pbd（账务主程序（民非专版））
- 打开入口：菜单「O日常业务 › 账册 › 明细账」（19 个菜单中）；`w_main1` 的 st_1_mx.clicked；`w_main1` 的 tab_1/tabpage_1/p_t_1_mx.clicked；`w_zc_slz_1_bak` 的 事件 u_open；`w_zc_slz_1` 的 事件 u_open；`w_zc_slz_fb` 的 事件 u_open；`w_zc_slz_sl` 的 事件 u_open；`w_zc_slz_slfb` 的 事件 u_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 475,1060 274×108 | clicked 读写表 kmbm |
| cb_2 | 按钮 | 取消 | 978,1060 274×108 |  |
| cb_3 | 按钮 | 搜索 | 1696,188 142×84 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_4 | 按钮 | 搜索 | 1696,316 142×84 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cbx_1 | 复选框 | 包含未过账凭证 | 617,940 608×72 |  |
| ddlb_1 | 下拉列表 |  | 663,664 690×508 |  |
| ddlb_3 | 下拉列表 |  | 663,796 503×480 |  |
| em_1 | 格式输入 |  | 955,496 224×92 |  |
| em_2 | 格式输入 |  | 1349,496 224×92 |  |
| em_nf | 格式输入 |  | 329,496 306×92 |  |
| gb_1 | 分组框 | 科目选择 | 41,68 1865×376 |  |
| rb_1 | 单选按钮 | 全部科目 | 2066,80 384×80 |  |
| rb_2 | 单选按钮 | 指定范围 | 2075,184 384×80 |  |
| sle_1 | 下拉列表 |  | 251,188 1431×948 |  |
| sle_2 | 下拉列表 |  | 251,312 1431×948 |  |
| st_1 | 静态文本 | 从 | 87,188 128×72 |  |
| st_2 | 静态文本 | 到 | 87,308 128×72 |  |
| st_3 | 静态文本 | 月份从 | 677,504 261×72 |  |
| st_4 | 静态文本 | 到 | 1198,504 123×72 |  |
| st_5 | 静态文本 | 币种 | 366,812 247×72 |  |
| st_6 | 静态文本 | 账册选择 | 306,672 306×72 |  |
| st_nf | 静态文本 | 会计年度 | 96,504 229×72 |  |

- 窗口事件/函数：
  - `open`：读写表 fbgl

- 提示与校验（1 条）：
  - [cb_1.clicked]「科目不存在！」（条件：`i <> 1`）

### w_zc_slz_1 — 三栏明细账

- 类型：主窗口（默认）；尺寸：6295×1832 PBU；继承：`wroot_single_1`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 37,388 631×676 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | 搜索 | 2441,204 155×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_nd1 | 按钮 | < | 3095,220 101×80 |  |
| cb_nd2 | 按钮 | > | 3406,220 101×80 |  |
| ddlb_1 | 下拉列表 |  | 343,208 2103×1408 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 672,372 1655×828 | 数据窗口 `dw_zc_slz_kmbm`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、yjd（Yjd）、kmqc |
| dw_3 | 数据窗口 |  | 1769,356 2697×808 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| em_nd | 格式输入 | 2018 | 3195,220 201×80 |  |
| st_1 | 静态文本 | 科目： | 55,208 270×84 |  |
| st_kj | 静态文本 | 会计年度 | 2825,220 261×80 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_slz`、`dw_zc_slz_b`；读写表 xt
  - `u_open`：打开 `w_zc_slz`「明细账」
  - `user_prt`：打开 `w_print_zc_pg`「明细账页码」、`w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2_zw`「连续打印选择」、`w_print_zc_pg`「明细账页码」、`w_print_zc`「账册打印」
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_print_zc_pg`「明细账页码」、`w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 hz、kmbm、nc、pz、pzlx、slz

- 提示与校验（16 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）
  - [窗口事件 wf_open]「无符合条件的科目!」（条件：`this.kmbm_rowmax = 0`）

### w_zc_slz_1_bak — 三栏明细账

- 类型：主窗口（默认）；尺寸：6295×1832 PBU；继承：`wroot_single_1`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 37,388 631×676 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh；doubleclicked 读写表 b_rights |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | ... | 2469,212 119×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| ddlb_1 | 下拉列表 |  | 343,208 2103×1408 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 672,372 1655×828 | 数据窗口 `dw_zc_slz_kmbm`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、yjd（Yjd）、kmqc |
| dw_3 | 数据窗口 |  | 1769,356 1605×808 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| st_1 | 静态文本 | 科目： | 55,208 270×84 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_slz`、`dw_zc_slz_b`
  - `u_open`：打开 `w_zc_slz`「明细账」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2`「打印」、`w_print_zc`「账册打印」
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 b_rights、pzdj
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 hz、nc、pz、pzlx、slz

- 提示与校验（9 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_saveas]「导出数据成功!」（条件：`dw2execl.uf_toexcel(this.dw_3,"三栏明细账","单位名称：" + xt_dwmc,"      期间：从" + string(this.yf1) + "月到" + string(this.yf2) + "月",`）
  - [窗口事件 ue_saveas]「导出数据失败!」（条件：`dw2execl.uf_toexcel(this.dw_3,"三栏明细账","单位名称：" + xt_dwmc,"      期间：从" + string(this.yf1) + "月到" + string(this.yf2) + "月",`）
  - [窗口事件 ue_action_modify]「此凭证已经审核或者过账，不能修改！」（条件：`xx <> "0"`）
  - [窗口事件 wf_open]「无符合条件的科目!」（条件：`this.kmbm_rowmax = 0`）

### w_zc_slz_fb — 三栏明细账（继承自祖先）

- 类型：主窗口（默认）；尺寸：6295×1832 PBU；继承：`w_zc_slz_1`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 37,388 631×676 | 数据窗口 `dw_zc_slz_fb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目名称）、jslb、pz_ph（支票号）、pjdh、jf（借方发生额）、df（贷方发生额）、ye（余额）、pzrq、jf_wb（借方外币）、jf_hl（汇率）、df_wb（贷方外币）、df_hl（汇率）、ye_wb、nf、pzdj_bz、xmbm、xm_mc、xh |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | 搜索 | 2382,204 155×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_nd1 | 按钮 | < | 3301,216 101×80 |  |
| cb_nd2 | 按钮 | > | 3611,216 101×80 |  |
| ddlb_1 | 下拉列表 |  | 274,208 2103×1408 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 622,440 1655×828 | 数据窗口 `dw_zc_slz_kmbm_fb`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、yjd（Yjd）、kmqc |
| dw_3 | 数据窗口 |  | 1701,592 2697×808 | 数据窗口 `dw_zc_slz_fb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目名称）、jslb、pz_ph（支票号）、pjdh、jf（借方发生额）、df（贷方发生额）、ye（余额）、pzrq、jf_wb（借方外币）、jf_hl（汇率）、df_wb（贷方外币）、df_hl（汇率）、ye_wb、nf、pzdj_bz、xmbm、xm_mc、xh |
| em_nd | 格式输入 | 2018 | 3401,216 201×80 |  |
| st_1 | 静态文本 | 科目： | 14,208 251×84 |  |
| st_kj | 静态文本 | 会计年度 | 3045,216 261×80 |  |
| st_2 | 静态文本 | 外币余额如果是负数，表示和金额的余额方向不一致，请查看您的凭证是否做错！ | 3721,216 2094×80 |  |
| st_3 | 静态文本 | 币种： | 2546,220 233×72 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_slz_fb`、`dw_zc_slz_fb_b`
  - `u_open`：打开 `w_zc_slz`「明细账」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2`「打印」、`w_print_zc`「账册打印」
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 hz、kmbm、nc、pz、pzlx、slz

- 提示与校验（16 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）
  - [窗口事件 wf_open]「无符合条件的科目!」（条件：`this.kmbm_rowmax = 0`）

### w_zc_slz_sl — 三栏明细账（继承自祖先）

- 类型：主窗口（默认）；尺寸：6295×1832 PBU；继承：`w_zc_slz_1`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 37,332 631×676 | 数据窗口 `dw_zc_slz_fb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目名称）、jslb、pz_ph（支票号）、pjdh、jf（借方发生额）、df（贷方发生额）、ye（余额）、pzrq、jf_wb（借方外币）、jf_hl（汇率）、df_wb（贷方外币）、df_hl（汇率）、ye_wb、nf、pzdj_bz、xmbm、xm_mc、xh |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | 搜索 | 2441,204 155×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_nd1 | 按钮 | < | 2990,208 101×80 |  |
| cb_nd2 | 按钮 | > | 3301,208 101×80 |  |
| ddlb_1 | 下拉列表 |  | 343,208 2103×1408 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 672,372 1655×828 | 数据窗口 `dw_zc_slz_kmbm_sl`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、yjd（Yjd）、kmqc |
| dw_3 | 数据窗口 |  | 1774,352 2697×808 | 数据窗口 `dw_zc_slz_fb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目名称）、jslb、pz_ph（支票号）、pjdh、jf（借方发生额）、df（贷方发生额）、ye（余额）、pzrq、jf_wb（借方外币）、jf_hl（汇率）、df_wb（贷方外币）、df_hl（汇率）、ye_wb、nf、pzdj_bz、xmbm、xm_mc、xh |
| em_nd | 格式输入 | 2018 | 3090,208 201×80 |  |
| st_1 | 静态文本 | 科目： | 55,208 270×84 |  |
| st_kj | 静态文本 | 会计年度 | 2720,208 261×80 |  |
| st_2 | 静态文本 | 数量余额如果负数，表示和金额的余额方向不一致，请查看您的凭证是否做错！ | 3451,208 2021×80 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_slz_fb`、`dw_zc_slz_fb_b`
  - `x5`：读写表 kmbm
  - `u_open`：打开 `w_zc_slz`「明细账」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2_zw`「连续打印选择」、`w_print_zc`「账册打印」
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 hz、kmbm、nc、pz、pzlx、slz

- 提示与校验（16 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）
  - [窗口事件 wf_open]「无符合条件的科目!」（条件：`this.kmbm_rowmax = 0`）

### w_zc_slz_slfb — 三栏明细账（继承自祖先）

- 类型：主窗口（默认）；尺寸：6295×1832 PBU；继承：`w_zc_slz_1`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 37,388 631×676 | 数据窗口 `dw_zc_slz_slfb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、pz_ph（币种）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、jf_wb（借方数量）、jf_hl（单价）、df_wb（贷方数量）、df_hl（单价）、ye_wb（余额数量）、ye_hl（原币金额）、nf、pzdj_bz、xh |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | 搜索 | 2441,204 155×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_nd1 | 按钮 | < | 3026,204 101×80 |  |
| cb_nd2 | 按钮 | > | 3337,204 101×80 |  |
| ddlb_1 | 下拉列表 |  | 343,208 2103×1408 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 672,372 1655×828 | 数据窗口 `dw_zc_slz_kmbm_sl`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、yjd（Yjd）、kmqc |
| dw_3 | 数据窗口 |  | 1769,356 2697×808 | 数据窗口 `dw_zc_slz_slfb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、pz_ph（币种）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、jf_wb（借方数量）、jf_hl（单价）、df_wb（贷方数量）、df_hl（单价）、ye_wb（余额数量）、ye_hl（原币金额）、nf、pzdj_bz、xh |
| em_nd | 格式输入 | 2018 | 3127,204 201×80 |  |
| st_1 | 静态文本 | 科目： | 55,208 270×84 |  |
| st_kj | 静态文本 | 会计年度 | 2757,204 261×80 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_slz_slfb`、`dw_zc_slz_slfb_b`
  - `u_open`：打开 `w_zc_slz`「明细账」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2_zw`「连续打印选择」、`w_print_zc`「账册打印」
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 hz、kmbm、nc、pz、pzlx、slz

- 提示与校验（16 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）
  - [窗口事件 wf_open]「无符合条件的科目!」（条件：`this.kmbm_rowmax = 0`）

### w_zc_sydw — 部门维护

- 类型：模态对话框；尺寸：1326×1292 PBU；继承：`w_root_xt`；库：rhzw8_zc1.pbd（账务主程序（民非专版））
- 打开入口：菜单「I基础档案 › 部门设置」（3 个菜单中）；`w_main1_zc` 的 st_3_bm.clicked；`w_main1_zc` 的 tab_1/tabpage_3/p_t_3_bm.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1029,600 247×108 |  |
| cb_2 | 按钮 | 打印 | 1029,808 247×108 |  |
| cb_3 | 按钮 | 删除 | 1029,704 247×108 |  |
| cb_4 | 按钮 | 确定 | 1029,912 247×108 |  |
| cb_5 | 按钮 | 取消 | 1029,1016 247×108 |  |
| cb_6 | 按钮 | 另存 | 1029,496 247×108 |  |
| dw_master | uo_dw_single |  | 18,12 969×1140 | 数据窗口 `dw_sydw`（表 zc_sydw）；列：sydw（编号）、dw_mc（部门名称） |

### w_zc_sydw_bak — 部门维护

- 类型：模态对话框；尺寸：1394×1216 PBU；库：rhzw8_zc1.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1079,552 247×108 |  |
| cb_2 | 按钮 | 删除 | 1079,692 247×108 | clicked 读写表 zc_gdzc、zc_yzjb |
| cb_3 | 按钮 | 存盘 | 1079,832 247×108 |  |
| cb_4 | 按钮 | 退出 | 1079,972 247×108 |  |
| dw_1 | 数据窗口 |  | 46,84 951×992 | 数据窗口 `dw_sydw`（表 zc_sydw）；列：sydw（编号）、dw_mc（部门名称） |
| gb_1 | 分组框 |  | 23,16 1015×1080 |  |

- 提示与校验（4 条）：
  - [cb_2.clicked]「该部门已使用，不能被删除！」（条件：`l = 0`）
  - [cb_2.clicked]「删除该 部门吗？」（条件：`l = 0`）
  - [cb_3.clicked]「编号必须要输入!」（条件：`xx = ""`）
  - [cb_3.clicked]「数据更数失败!」（条件：`parent.dw_1.update(true,false) = -1`）

### w_zc_xjll — 现金流量试算平衡表

- 类型：模态对话框；尺寸：1225×828 PBU；库：rhzw8_2.pbd（账务主程序（民非专版））
- 打开入口：菜单「O日常业务 › 账务处理 › 现金流量试算平衡表」（19 个菜单中）；`w_main1` 的 tab_1/tabpage_1/p_t_1_ph.clicked；`w_zc_xjll_1` 的 cb_2.clicked；`w_zc_xjll_1` 的 事件 u_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 233,524 238×100 |  |
| cb_2 | 按钮 | 取消 | 690,524 238×100 |  |
| cbx_1 | 复选框 | 包含未过账凭证 | 288,388 608×72 |  |
| em_1 | 格式输入 |  | 411,208 224×100 |  |
| em_2 | 格式输入 |  | 805,208 224×100 |  |
| em_nf | 格式输入 |  | 498,36 370×100 |  |
| st_3 | 静态文本 | 月份从 | 146,220 247×72 |  |
| st_4 | 静态文本 | 到 | 649,220 123×72 |  |
| st_nf | 静态文本 | 会计年度 | 206,48 251×72 |  |

### w_zc_xjll_1 — 现金流量试算平衡表

- 类型：主窗口（默认）；尺寸：6295×1832 PBU；继承：`w_zc_slz_1`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 27,340 1961×676 | 数据窗口 `dw_zc_xjll`；列：month（月）、day（日）、pz_zh、zy（摘要）、lx（现金流向）、jf（借方）、df（贷方）、jy（结余）、kmbm（科目编码）、kmqc（科目名称）、pzlx、pzbh、xjbm、xh、pzdj_bz、yf、pz_xh |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | 搜索 | 2441,204 155×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_nd1 | 按钮 | < | 4215,236 101×80 |  |
| cb_nd2 | 按钮 | > | 4544,236 82×80 |  |
| ddlb_1 | 下拉列表 |  | 777,208 2103×1408 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 672,372 1655×828 | 数据窗口 `dw_zc_slz_kmbm`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、yjd（Yjd）、kmqc |
| dw_3 | 数据窗口 |  | 2793,396 2697×808 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| em_nd | 格式输入 | 2018 | 4315,236 201×80 |  |
| st_1 | 静态文本 | 现金流量项目： | 55,208 654×84 |  |
| st_kj | 静态文本 | 会计年度 | 3945,236 261×80 |  |
| cb_2 | 按钮 | 刷新 | 2949,204 343×104 | clicked → `w_zc_xjll`「现金流量试算平衡表」 |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_xjll`、`dw_zc_xjll_b`；读写表 hz、kmbm、nc、pzlx、xjll_xm
  - `ue_action_print`：打开 `w_print_xjll`「帐册打印」
  - `u_open`：打开 `w_zc_xjll`「现金流量试算平衡表」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 hz、kmbm、nc、pz、pzlx、slz

- 提示与校验（15 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）
  - [窗口事件 wf_open]「无符合条件的科目!」（条件：`this.kmbm_rowmax = 0`）

### w_zc_xjrjz — 日记账

- 类型：模态对话框；尺寸：1911×1128 PBU；库：rhzw8_2.pbd（账务主程序（民非专版））
- 打开入口：菜单「O日常业务 › 账册 › 现金日记账」（19 个菜单中）；`w_main1` 的 tab_1/tabpage_1/p_t_1_xj.clicked；`w_zc_xjrjz_1` 的 事件 u_open；`w_zc_xjrjz_fb` 的 事件 u_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 544,836 265×108 | clicked 读写表 kmbm |
| cb_2 | 按钮 | 取消 | 965,836 265×108 |  |
| cb_3 | 按钮 | 搜索 | 1563,132 142×84 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_4 | 按钮 | 搜索 | 1563,252 142×84 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cbx_1 | 复选框 | 包含未过账凭证 | 594,720 608×72 |  |
| ddlb_3 | 下拉列表 |  | 608,576 462×476 |  |
| em_1 | 格式输入 |  | 974,420 224×92 |  |
| em_2 | 格式输入 |  | 1344,420 224×92 |  |
| em_nf | 格式输入 |  | 375,420 306×92 |  |
| gb_1 | 分组框 | 科目代码 | 59,36 1696×348 |  |
| sle_1 | 下拉列表 |  | 302,124 1257×948 |  |
| sle_2 | 下拉列表 |  | 302,244 1257×948 |  |
| st_1 | 静态文本 | 从 | 91,132 133×72 |  |
| st_2 | 静态文本 | 到 | 91,252 133×72 |  |
| st_3 | 静态文本 | 月份从 | 704,428 247×72 |  |
| st_4 | 静态文本 | 到 | 1216,428 123×72 |  |
| st_5 | 静态文本 | 币种 | 338,592 247×72 |  |
| st_nf | 静态文本 | 会计年度 | 114,428 251×72 |  |

- 窗口事件/函数：
  - `open`：读写表 fbgl

- 提示与校验（1 条）：
  - [cb_1.clicked]「科目不存在！」（条件：`i <> 1`）

### w_zc_xjrjz_1 — 现金日记账

- 类型：主窗口（默认）；尺寸：6295×1832 PBU；继承：`w_zc_slz_1`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 37,388 631×676 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | 搜索 | 2441,204 155×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_nd1 | 按钮 | < | 3095,220 101×80 |  |
| cb_nd2 | 按钮 | > | 3406,220 101×80 |  |
| ddlb_1 | 下拉列表 |  | 343,208 2103×1408 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 672,372 1655×828 | 数据窗口 `dw_zc_slz_kmbm`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、yjd（Yjd）、kmqc |
| dw_3 | 数据窗口 |  | 1769,356 2697×808 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| em_nd | 格式输入 | 2018 | 3195,220 201×80 |  |
| st_1 | 静态文本 | 科目： | 55,208 270×84 |  |
| st_kj | 静态文本 | 会计年度 | 2825,220 261×80 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_slz`、`dw_zc_slz_b`
  - `u_open`：打开 `w_zc_xjrjz`「日记账」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2_zw`「连续打印选择」、`w_print_zc`「账册打印」
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 hz、kmbm、nc、pz、pzlx、slz

- 提示与校验（16 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）
  - [窗口事件 wf_open]「无符合条件的科目!」（条件：`this.kmbm_rowmax = 0`）

### w_zc_xjrjz_fb — 现金复币日记账

- 类型：主窗口（默认）；尺寸：6295×1832 PBU；继承：`w_zc_slz_1`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 37,388 631×676 | 数据窗口 `dw_zc_slz_fb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目名称）、jslb、pz_ph（支票号）、pjdh、jf（借方发生额）、df（贷方发生额）、ye（余额）、pzrq、jf_wb（借方外币）、jf_hl（汇率）、df_wb（贷方外币）、df_hl（汇率）、ye_wb、nf、pzdj_bz、xmbm、xm_mc、xh |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | 搜索 | 2487,208 123×84 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_nd1 | 按钮 | < | 3643,212 101×80 |  |
| cb_nd2 | 按钮 | > | 3954,212 101×80 |  |
| ddlb_1 | 下拉列表 |  | 375,208 2103×1408 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 672,372 1655×828 | 数据窗口 `dw_zc_slz_kmbm_fb`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、yjd（Yjd）、kmqc |
| dw_3 | 数据窗口 |  | 1769,356 2697×808 | 数据窗口 `dw_zc_slz_fb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目名称）、jslb、pz_ph（支票号）、pjdh、jf（借方发生额）、df（贷方发生额）、ye（余额）、pzrq、jf_wb（借方外币）、jf_hl（汇率）、df_wb（贷方外币）、df_hl（汇率）、ye_wb、nf、pzdj_bz、xmbm、xm_mc、xh |
| em_nd | 格式输入 | 2018 | 3744,212 201×80 |  |
| st_1 | 静态文本 | 科目： | 32,208 325×84 |  |
| st_kj | 静态文本 | 会计年度 | 3374,212 261×80 |  |
| st_2 | 静态文本 | 外币余额如果是负数，表示和金额的余额方向不一致，请查看您的凭证是否做错！ | 4101,212 2094×80 |  |
| st_3 | 静态文本 | 币种： | 2665,208 261×88 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_slz_fb`、`dw_zc_slz_fb_b`
  - `u_open`：打开 `w_zc_xjrjz`「日记账」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2_zw`「连续打印选择」、`w_print_zc`「账册打印」
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 hz、kmbm、nc、pz、pzlx、slz

- 提示与校验（16 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）
  - [窗口事件 wf_open]「无符合条件的科目!」（条件：`this.kmbm_rowmax = 0`）

### w_zc_yhrjz — 银行日记帐

- 类型：模态对话框；尺寸：1970×1120 PBU；库：rhzw8_2.pbd（账务主程序（民非专版））
- 打开入口：菜单「O日常业务 › 账册 › 银行日记账」（19 个菜单中）；`w_main1` 的 tab_1/tabpage_1/p_t_1_yh.clicked；`w_zc_yhrjz_1` 的 事件 u_open；`w_zc_yhrjz_fb` 的 事件 u_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 576,836 274×108 | clicked 读写表 kmbm |
| cb_2 | 按钮 | 取消 | 992,836 274×108 |  |
| cb_3 | 按钮 | 搜索 | 1600,128 142×84 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_4 | 按钮 | 搜索 | 1600,248 142×84 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cbx_1 | 复选框 | 包含未过账凭证 | 713,708 608×72 |  |
| ddlb_3 | 下拉列表 |  | 713,576 462×468 |  |
| em_1 | 格式输入 |  | 997,420 224×92 |  |
| em_2 | 格式输入 |  | 1394,420 224×92 |  |
| em_nf | 格式输入 |  | 375,420 306×92 |  |
| gb_1 | 分组框 | 科目代码 | 50,32 1769×352 |  |
| sle_1 | 下拉列表 |  | 302,124 1294×948 |  |
| sle_2 | 下拉列表 |  | 302,244 1294×948 |  |
| st_1 | 静态文本 | 从 | 87,128 137×72 |  |
| st_2 | 静态文本 | 到 | 87,248 137×72 |  |
| st_3 | 静态文本 | 月份从 | 722,428 247×72 |  |
| st_4 | 静态文本 | 到 | 1243,428 123×72 |  |
| st_5 | 静态文本 | 币种 | 439,588 247×72 |  |
| st_nf | 静态文本 | 会计年度 | 110,428 251×72 |  |

- 窗口事件/函数：
  - `open`：读写表 fbgl

- 提示与校验（1 条）：
  - [cb_1.clicked]「科目不存在！」（条件：`i <> 1`）

### w_zc_yhrjz_1 — 银行日记账

- 类型：主窗口（默认）；尺寸：6295×1832 PBU；继承：`w_zc_slz_1`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 37,388 631×676 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | 搜索 | 2455,208 155×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_nd1 | 按钮 | < | 3095,220 101×80 |  |
| cb_nd2 | 按钮 | > | 3406,220 101×80 |  |
| ddlb_1 | 下拉列表 |  | 347,208 2103×1272 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 672,372 1655×828 | 数据窗口 `dw_zc_slz_kmbm`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、yjd（Yjd）、kmqc |
| dw_3 | 数据窗口 |  | 1769,356 2697×808 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| em_nd | 格式输入 | 2018 | 3195,220 201×80 |  |
| st_1 | 静态文本 | 科目： | 55,208 270×84 |  |
| st_kj | 静态文本 | 会计年度 | 2825,220 261×80 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_slz`、`dw_zc_slz_b`
  - `u_open`：打开 `w_zc_yhrjz`「银行日记帐」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2_zw`「连续打印选择」、`w_print_zc`「账册打印」
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 hz、jslb、kmbm、nc、pz、pzlx、slz

- 提示与校验（16 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）
  - [窗口事件 wf_open]「无符合条件的科目!」（条件：`this.kmbm_rowmax = 0`）

### w_zc_yhrjz_fb — 银行复币日记账

- 类型：主窗口（默认）；尺寸：6295×1832 PBU；继承：`w_zc_slz_1`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 37,388 631×676 | 数据窗口 `dw_zc_slz_fb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目名称）、jslb、pz_ph（支票号）、pjdh、jf（借方发生额）、df（贷方发生额）、ye（余额）、pzrq、jf_wb（借方外币）、jf_hl（汇率）、df_wb（贷方外币）、df_hl（汇率）、ye_wb、nf、pzdj_bz、xmbm、xm_mc、xh |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | 搜索 | 2405,208 155×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_nd1 | 按钮 | < | 3552,200 101×80 |  |
| cb_nd2 | 按钮 | > | 3863,200 101×80 |  |
| ddlb_1 | 下拉列表 |  | 297,208 2103×1408 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 672,372 1655×828 | 数据窗口 `dw_zc_slz_kmbm_fb`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、yjd（Yjd）、kmqc |
| dw_3 | 数据窗口 |  | 1769,376 2697×808 | 数据窗口 `dw_zc_slz_fb`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目名称）、jslb、pz_ph（支票号）、pjdh、jf（借方发生额）、df（贷方发生额）、ye（余额）、pzrq、jf_wb（借方外币）、jf_hl（汇率）、df_wb（贷方外币）、df_hl（汇率）、ye_wb、nf、pzdj_bz、xmbm、xm_mc、xh |
| em_nd | 格式输入 | 2018 | 3653,200 201×80 |  |
| st_1 | 静态文本 | 科目： | 50,208 251×84 |  |
| st_kj | 静态文本 | 会计年度 | 3296,200 261×80 |  |
| st_2 | 静态文本 | 外币余额如果是负数，表示和金额的余额方向不一致，请查看您的凭证是否做错！ | 4000,200 2094×80 |  |
| st_3 | 静态文本 | 币种： | 2610,216 261×88 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_slz_fb`、`dw_zc_slz_fb_b`
  - `u_open`：打开 `w_zc_yhrjz`「银行日记帐」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2_zw`「连续打印选择」、`w_print_zc`「账册打印」
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 hz、kmbm、nc、pz、pzlx、slz

- 提示与校验（16 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）
  - [窗口事件 wf_open]「无符合条件的科目!」（条件：`this.kmbm_rowmax = 0`）

### w_zc_zc — 总分类账

- 类型：模态对话框；尺寸：2089×964 PBU；库：rhzw8_2.pbd（账务主程序（民非专版））
- 打开入口：菜单「O日常业务 › 账册 › 总分类账」（19 个菜单中）；`w_main1` 的 tab_1/tabpage_1/p_t_1_zz.clicked；`w_zc_zc_1` 的 事件 u_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 654,716 265×108 | clicked 读写表 kmbm |
| cb_2 | 按钮 | 取消 | 1129,720 265×108 |  |
| cb_3 | 按钮 | 搜索 | 1719,300 142×84 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cb_4 | 按钮 | 搜索 | 1719,420 142×84 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| em_nf | 格式输入 |  | 933,60 306×92 |  |
| gb_1 | 分组框 | 科目代码 | 59,200 1893×360 |  |
| sle_1 | 下拉列表 |  | 302,296 1422×836 |  |
| sle_2 | 下拉列表 |  | 302,416 1422×836 |  |
| st_1 | 静态文本 | 从 | 133,296 128×72 |  |
| st_2 | 静态文本 | 到 | 133,416 128×72 |  |
| st_3 | 静态文本 | 提示：凭证只有过账后，才会在总账里体现 | 201,600 1678×68 |  |
| st_nf | 静态文本 | 会计年度 | 631,68 251×72 |  |

- 提示与校验（1 条）：
  - [cb_1.clicked]「科目不存在！」（条件：`i <> 1`）

### w_zc_zc_1 — 总分类账

- 类型：主窗口（默认）；尺寸：6331×2012 PBU；继承：`w_zc_slz_1`；菜单：`m_work_zc_01`；库：rhzw8_2.pbd（账务主程序（民非专版））

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 14,316 1358×676 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh；doubleclicked 读写表 b_rights |
| uo_1 | u_toolbar |  | 9, 699×200 |  |
| cb_1 | 按钮 | 搜索 | 2455,204 155×88 | clicked → `w_pz_km_find`「科目查找」 |
| cb_nd1 | 按钮 | < | 3095,220 101×80 |  |
| cb_nd2 | 按钮 | > | 3406,220 101×80 |  |
| ddlb_1 | 下拉列表 |  | 343,208 2103×1408 | modified 读写表 kmbm |
| dw_2 | 数据窗口 |  | 2075,796 901×712 | 数据窗口 `dw_zc_slz_kmbm`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、yjd（Yjd）、kmqc |
| dw_3 | 数据窗口 |  | 1769,356 2697×808 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| em_nd | 格式输入 | 2018 | 3195,220 201×80 |  |
| st_1 | 静态文本 | 科目： | 55,208 270×84 |  |
| st_kj | 静态文本 | 会计年度 | 2825,220 261×80 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_zc_slz`、`dw_zc_slz_b`；读写表 slz
  - `u_open`：打开 `w_zc_zc`「总分类账」
  - `user_prt`：打开 `w_print_zc`「账册打印」
  - `user_prt_lx`：打开 `w_print_2_zw`「连续打印选择」、`w_print_zc`「账册打印」
  - `ue_saveas`：打开 `w_zc_saveas`「批量转出选择」；读写表 kmbm
  - `ue_action_preview`：打开 `w_preview_zc`「帐册打印」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_del`：读写表 pz、pzdj、xt
  - `wf_dfkm`：读写表 kmbm、pz
  - `wf_open`：读写表 hz、kmbm、nc、pz、pzlx、slz
  - `wf_nf`：读写表 hz、nc、slz

- 提示与校验（18 条）：
  - [窗口事件 open]「无符合条件的科目!」（条件：`this.kmbm_rowmax = 0`）
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 user_prt_lx]「下面打印科目」（条件：`xz_bz = "1"`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您没有凭证删除权限」（条件：`i0 = 0`）
  - [窗口事件 ue_action_del]「您不能删除别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_del]「凭证已做审核，不能删除！」（条件：`xx > "0"`）
  - [窗口事件 ue_action_del]「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_del]「是否删除号凭证？~r删除后此凭证将不能恢复！」（条件：`i0 <> pzbh`）
  - [窗口事件 ue_action_save]「导出数据成功!」（条件：`dw2execl.uf_toexcel(this.dw_3,"总分类帐","单位名称：" + xt_dwmc,"      期间：从" + string(this.yf1) + "月到" + string(this.yf2) + "月","`）
  - [窗口事件 ue_action_save]「导出数据失败!」（条件：`dw2execl.uf_toexcel(this.dw_3,"总分类帐","单位名称：" + xt_dwmc,"      期间：从" + string(this.yf1) + "月到" + string(this.yf2) + "月","`）

### w_zc_zcgl — 固定资产管理

- 类型：主窗口（默认）；尺寸：3419×1240 PBU；继承：`wroot_single`；菜单：`m_work_zcgl`；库：rhzw8_zc1.pbd（账务主程序（民非专版））
- 打开入口：菜单「O日常业务 › 固定资产台账」（3 个菜单中）；菜单「O日常业务 › 增加固定资产」（3 个菜单中）；菜单「O日常业务 › 注销固定资产」（3 个菜单中）；菜单「B统计报表 › 资产明细账」（3 个菜单中）；菜单「B统计报表 › 资产清单」（3 个菜单中）；菜单「B统计报表 › 附属设备表」（3 个菜单中）；菜单「B统计报表 › 到期资产清单」（3 个菜单中）；菜单「B统计报表 › 资产增加清单」（3 个菜单中）；菜单「B统计报表 › 资产减少清单」（3 个菜单中）；菜单「B统计报表 › 资产分布表」（3 个菜单中）；菜单「B统计报表 › 打印资产标签」（3 个菜单中）；菜单「B统计报表 › 固定资产台帐」（3 个菜单中）……（共 22 处）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,204 2400×676 | 数据窗口 `dw_zcgl`（表 zc_gdzc）；列：bh（设备编号）、mc（设备名称）、sblb（类别）、sbzt（状态）、sydw（使用部门）、gzrq（购置日期）、yz（原值）、czl（残值率）、yzcz（预计残值）、syrq（使用日期）、zjff（折旧方法）、synx、zgzl（总工作量）、bz（规格型号）、ytbh（用途）、ygzl（月工作量）、yzje（月折旧额）、ljzjy（累计折旧月）、ljgzl（累计工作量）、ljzje（累计折旧额）、sbbz（标志）、zxyy（注销原因）、zxrq（注销日期）、zcjz（净值）、bjbh（本机编号）、zccm（制造厂名）、azdd（安装地点）、zcrq（制造日期）、dw（单位）、sl（数量）……；itemchanged 读写表 zc_sblb |
| uo_1 | u_toolbar |  | , 768×200 |  |
| dw_fssb | 数据窗口 |  | 2533,348 494×360 | 数据窗口 `dw_fssb_prt`（表 zc_fssb、zc_gdzc）；列：bh（设备编号）、fsbh（编号）、fsmc（附属设备名称）、fssl（数量）、fsdj（单价）、fsje（金额）、sm（说明）、zc_gdzc_mc |
| dw_zctz | 数据窗口 |  | 2706,404 535×572 | 数据窗口 `dw_zctz_prt`（表 zc_gdzc）；列：bh（设备编号）、mc（设备名称）、sblb（类  别）、sbzt、sydw、gzrq（购置日期）、yz（原   值）、czl、yzcz（预计残值）、syrq、zjff（折旧方法）、synx、zgzl、bz、ytbh、ygzl、yzje、ljzjy、ljgzl、ljzje、sbbz、zxyy、zxrq、zcjz（累计折旧额）、bjbh、zccm、azdd、zcrq、dw、sl（台数）…… |

- 窗口事件/函数：
  - `open`：读写表 sys、xt、zc_gdzc
  - `ue_action_del`：读写表 zc_yzjb、zc_yzzj
  - `ue_action_new`：打开 `w_zcgl_kp`「固定资产卡片」；读写表 zc_sblb、zc_sbyt、zc_sbzt、zc_sydw
  - `ue_action_save`：读写表 zc_gdzc
  - `ue_action_newcopy`：打开 `w_zcgl_kp`「固定资产卡片」
  - `ue_clear`：打开 `w_zcgl_delete`「注销设备」
  - `u_modify`：打开 `w_zcgl_kp`「固定资产卡片」
  - `u_mx`：打开 `w_zcgl_kp`「固定资产卡片」
  - `u_prt_nddq`：打开 `w_zcgl_nd_1`「资产到期年度（运行时设置）」、`w_preview`「打印预览」
  - `u_prt_ndjs`：打开 `w_zcgl_nd`「资产到期年度（运行时设置）」、`w_preview`「打印预览」
  - `u_prt_ndzj`：打开 `w_zcgl_nd`「资产到期年度（运行时设置）」、`w_preview`「打印预览」
  - `u_prt_sbqd`：打开 `w_preview`「打印预览」
  - `u_prt_fssb`：打开 `w_preview`「打印预览」
  - `u_prt_zcfb`：打开 `w_zcgl_fb`「资产分布表」
  - `u_prt_mxz`：打开 `w_preview_zc_mxz`「固定资产明细账打印」
  - `u_prt_bq`：打开 `w_zcgl_label`「打印固定资产标签」
  - `u_prt_tz`：打开 `w_print_tz`「固定资产台帐」、`w_preview`「打印预览」；读写表 zc_yzjb、zc_yzzj
  - `u_pz`：打开 `w_pz_build`「生成凭证」
  - `u_zs`：打开 `w_zcgl_zs`「统一置数」；读写表 zc_gdzc、zc_yzjb
  - `ue_action_yztz`：打开 `w_zcgl_yztz`「原值调整」
  - `ue_action_get`：读写表 zc_sblb、zc_sbyt、zc_sbzt、zc_sydw

- 提示与校验（12 条）：
  - [窗口事件 ue_action_del]「此设备已提折旧，不允许删除！」（条件：`i > 0`）
  - [窗口事件 ue_action_del]「是否删除」（条件：`i > 0`）
  - [窗口事件 ue_action_new]「请先增加设备类别！」（条件：`r = 0`）
  - [窗口事件 ue_action_new]「请先增加设备状态！」（条件：`r = 0`）
  - [窗口事件 ue_action_new]「请先增加用途！」（条件：`r = 0`）
  - [窗口事件 ue_action_new]「请先增加部门！」（条件：`r = 0`）
  - [窗口事件 ue_action_refresh]「是否包括已注销的设备？」
  - [窗口事件 ue_action_save]「存盘失败！」（条件：`i = 1`）
  - [窗口事件 u_prt_ndjs]「年度无资产减少!」（条件：`this.dw_master.rowcount() = 0`）
  - [窗口事件 u_prt_fssb]「此设备没有附属设备!」（条件：`r = 0`）
  - [窗口事件 ue_action_zjjs]「本功能将查询出来的设备重新按使用日期开始计算累计折旧~r之前的累计折旧将全部改写，按【存盘】后，将不可恢复！~r是否进行(Y/N)?」
  - [dw_master.itemchanged]「此处是填写设备的使用年限(按月计算)!~r 此设备是否只能使用个月? 请查证!」（条件：`r < 30`）

### w_zc_zzs — 增值税明细帐

- 类型：主窗口（默认）；尺寸：3424×1672 PBU；继承：`w_preview_report_base`；菜单：`m_report_r`；库：rhzw8_2.pbd（账务主程序（民非专版））
- 打开入口：`w_main1` 的 tab_1/tabpage_1/p_t_1_zzs.clicked

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
| dw_1 | uo_dw |  | 14,352 3063×944 | 数据窗口 `dw_zc_zzs`；列：yf（月）、ri（日）、pzzh（凭证 字号）、pzzy（摘                             要）、j_hj（合    计）、j_1、j_2、j_3、j_4、j_5、d_hj（合    计）、d_1、d_2、d_3、d_4、d_5、jd（借 或 贷）、ye（余  额）、xh |
| em_a1 | 格式输入 | 100% | 933,56 338×84 |  |
| gb_1 | 分组框 |  | 14, 3886×176 |  |
| st_1 | 静态文本 | 准备好 | ,1344 3035×72 |  |
| st_b1 | 静态文本 | 打印比例： | 631,72 297×60 |  |
| st_b2 | 静态文本 | 缩放比例： | 46,68 320×64 |  |
| cb_a9 | 按钮 | 查询 | 2592,48 247×96 |  |
| uo_1 | u_toolbar |  | 10002,8 279× |  |
| cb_3 | 按钮 | 应交税金(增值税)明细账设置 | 2235,236 768×96 | clicked → `w_xt_tz_zc_zzsmxz`「应交税金(增值税)明细帐设置」 |
| cbx_jzbz | 复选框 | 包含未过账凭证 | 1573,244 608×72 |  |
| em_nf | 格式输入 |  | 306,240 306×92 |  |
| em_yf1 | 格式输入 |  | 878,232 224×100 |  |
| em_yf2 | 格式输入 |  | 1271,232 224×100 |  |
| st_3 | 静态文本 | 月份从 | 613,248 229×72 |  |
| st_4 | 静态文本 | 到 | 1120,248 123×72 |  |
| st_nf | 静态文本 | 会计年度 | 23,248 251×72 |  |

- 窗口事件/函数：
  - `ue_print`：打开 `w_preview_zzsmxz`「帐册打印」
  - `ue_query`：读写表 pzlx、xt
  - `wf_nc`：读写表 nc、pz
