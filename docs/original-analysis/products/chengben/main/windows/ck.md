# 成本会计 · 账务+成本主程序 — 窗口目录：仓库/出入库（前缀 `ck`）

尺寸单位为 PowerBuilder Unit（PBU）。96 DPI、系统字体下约为：宽度像素 ≈ PBU × 0.25～0.3，高度像素 ≈ PBU × 0.25～0.28。
“打开入口”只列静态可见的调用方，运行时拼出来的窗口名可能遗漏。名字含 `_bak`、`_old`、`test` 的通常是历史残留。

### w_ck_ck — 出库单浏览

- 类型：主窗口（默认）；尺寸：2990×1444 PBU；继承：`wroot_single_1`；菜单：`m_cb_crk_01`；库：rhzw8_cb1.pbd（账务+成本主程序）
- 打开入口：菜单「O日常业务 › 出库单管理」（9 个菜单中）；`w_main1_cb` 的 st_1_ck.clicked；`w_main1_cb` 的 tab_1/tabpage_1/p_t_1_ck.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,312 2016×676 | 数据窗口 `dw_ck_ck`（表 pjnr1、kmbm）；列：pjdh（票据单号）、rq（日期）、kpr（操作人）、sm（摘要）、bz_sh（审核）、kmbm（收款科目）、kmbm_kmqc（收款科目名称）、pjlb（类别）、pz_bz（凭证） |
| uo_1 | u_toolbar |  | , 5463×200 |  |
| dw_1 | 数据窗口 |  | 2386,352 494×360 | 数据窗口 `dw_pjnr_save`（表 pjnr1、pjnr2）；列：pjnr1_pjlb、pjnr1_pjdh、pjnr1_rq、pjnr1_ckbh、pjnr1_kpr、pjnr1_sm、pjnr1_fpzl、pjnr1_slv、pjnr1_kmbm（Pjnr1 Kmbm）、pjnr1_cbkm（Pjnr1 Cbkm）、pjnr1_jc_bz、pjnr1_bz_sh、pjnr1_shr（Pjnr1 Shr）、pjnr2_cpbh、pjnr2_xh、pjnr2_sl、pjnr2_dj、pjnr2_dwcb、pjnr2_ckbh、pjnr2_dj_hs、pjnr2_je、pjnr2_jc_int、pjnr2_jc_bz |
| dw_2 | 数据窗口 |  | 2254,268 494×360 | 数据窗口 `dw_pjnr_save`（表 pjnr1、pjnr2）；列：pjnr1_pjlb、pjnr1_pjdh、pjnr1_rq、pjnr1_ckbh、pjnr1_kpr、pjnr1_sm、pjnr1_fpzl、pjnr1_slv、pjnr1_kmbm（Pjnr1 Kmbm）、pjnr1_cbkm（Pjnr1 Cbkm）、pjnr1_jc_bz、pjnr1_bz_sh、pjnr1_shr（Pjnr1 Shr）、pjnr2_cpbh、pjnr2_xh、pjnr2_sl、pjnr2_dj、pjnr2_dwcb、pjnr2_ckbh、pjnr2_dj_hs、pjnr2_je、pjnr2_jc_int、pjnr2_jc_bz |
| dw_3 | 数据窗口 |  | 2299,644 494×360 | 数据窗口 `dw_pjnr_save`（表 pjnr1、pjnr2）；列：pjnr1_pjlb、pjnr1_pjdh、pjnr1_rq、pjnr1_ckbh、pjnr1_kpr、pjnr1_sm、pjnr1_fpzl、pjnr1_slv、pjnr1_kmbm（Pjnr1 Kmbm）、pjnr1_cbkm（Pjnr1 Cbkm）、pjnr1_jc_bz、pjnr1_bz_sh、pjnr1_shr（Pjnr1 Shr）、pjnr2_cpbh、pjnr2_xh、pjnr2_sl、pjnr2_dj、pjnr2_dwcb、pjnr2_ckbh、pjnr2_dj_hs、pjnr2_je、pjnr2_jc_int、pjnr2_jc_bz |
| dw_4 | 数据窗口 |  | 2414,628 494×360 | 数据窗口 `dw_pjnr_save`（表 pjnr1、pjnr2）；列：pjnr1_pjlb、pjnr1_pjdh、pjnr1_rq、pjnr1_ckbh、pjnr1_kpr、pjnr1_sm、pjnr1_fpzl、pjnr1_slv、pjnr1_kmbm（Pjnr1 Kmbm）、pjnr1_cbkm（Pjnr1 Cbkm）、pjnr1_jc_bz、pjnr1_bz_sh、pjnr1_shr（Pjnr1 Shr）、pjnr2_cpbh、pjnr2_xh、pjnr2_sl、pjnr2_dj、pjnr2_dwcb、pjnr2_ckbh、pjnr2_dj_hs、pjnr2_je、pjnr2_jc_int、pjnr2_jc_bz |
| rb_1 | 单选按钮 | 全部 | 283,212 297×80 |  |
| rb_2 | 单选按钮 | 未生成凭证 | 635,212 357×80 |  |

- 窗口事件/函数：
  - `open`：读写表 pjnr1、pjnr2
  - `ue_action_query1`：打开 `w_ck_cx_ckd`「出库单综合查询」
  - `ue_action_fc`：打开 `w_cb_ck_copy`「合同复制」；读写表 pjnr1、pjnr2
  - `ue_action_modify`：读写表 pjnr1
  - `ue_action_newcopy`：打开 `w_cb_ck_copy`「合同复制」；读写表 pjnr1、pjnr2
  - `ue_action_get`：打开 `w_cg_ht_get`「凭证转入」
  - `ue_action_del`：读写表 g_fp_mx、pjnr1、pjnr2、wldj

- 提示与校验（12 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 ue_action_saveas1]「是否提换现有的文件？」（条件：`i = 1`）
  - [窗口事件 ue_action_fc]「复制不成功，请检查。」（条件：`message.returnvalue = 1`）
  - [窗口事件 ue_action_modify]「此出库单不存在！」（条件：`l = 0`）
  - [窗口事件 ue_action_get]「出库单数据转入成功！」（条件：`f_ckd_get(this.dw_2,xt_cs3,xt_cs2) = 1`）
  - [窗口事件 ue_action_del]「删除本条数据，请确认。」（条件：`l < 1`）
  - [窗口事件 ue_action_del]「此出库单已经结帐   不能删除！」（条件：`rq < gd_cb_jzrq`）
  - [窗口事件 ue_action_del]「此出库单已经生成凭证   不能删除！」（条件：`pz_bz = "1"`）
  - [窗口事件 ue_action_del]「此出库单已经审核   不能删除！」（条件：`bz_sh = "1"`）

### w_ck_ck1 — 采购合同

- 类型：主窗口（默认）；尺寸：4750×3068 PBU；继承：`wroot_md2`；菜单：`m_cb_crk_02`；库：rhzw8_cb1.pbd（账务+成本主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 5,788 3694×536 | 数据窗口 `dw_ck_ck2`（表 pjnr2、cpda）；列：pjlb、pjdh、xh、ny、cpbh（产品编号）、ckbh、dwcb、sl（数量）、dj（不含税单价）、dj_hs、je（价税合计）、jc_int、cpda_cpmc（名称）、cpda_gg（规格）、cpda_jldw（单位）、jc_bz、je0（金额）、slv（税率）、sm（说明）、se（税额）；itemchanged → `w_cb_xt_cpbh_sc`「产品编号速查」；itemchanged 读写表 cpda、kcb；rbuttondown → `w_cb_xt_cpbh_sc`「产品编号速查」；ue_rkj 读写表 cpda；doubleclicked → `w_cb_xt_kc_sc`「库存速查」；clicked → `w_ck_tz00`「库存台帐--选择」；clicked 读写表 b_rights |
| dw_master | uo_dw |  | 14,204 3634×556 | 数据窗口 `dw_ck_ck1_tt`（表 pjnr1）；列：pjlb（类别）、pjdh、rq（日期:）、ckbh、sm（摘要）、slv、fpzl、kpr、jc_bz、bz_sh、kmbm（收入凭证借方科目）、cbkm（成本凭证借方科目）、shr、pz_bz、nf、yf、pzlx、pzbh、pz_ly、lx、dh；itemchanged → `w_pz_km_find`「科目查找」；itemchanged 读写表 kmbm；doubleclicked → `w_xt_kmwh`「科目维护」；doubleclicked 读写表 b_rights、kmbm；rbuttondown → `w_pz_km_find`「科目查找」；rbuttondown 读写表 kmbm |
| uo_1 | u_toolbar |  | 9, 5143×200 |  |
| st_kc | 静态文本 | 库存： | 933,712 613×76 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_ck_ck1_tt`
  - `ue_action_sh`：读写表 pjnr1
  - `ue_action_pz_del`：读写表 pjnr1、pz、pz_fj、pzdj
  - `ue_action_pz_ins`：打开 `w_cb_pz`「凭证生成」
  - `ue_action_save`：读写表 cpda、kcb、kmbm、pjnr1、pjnr2
  - `ue_action_print`：打开 `w_preview_base_r1`「打印预览」
  - `ue_action_preview`：打开 `w_bb_pjnr`「特殊打印选择」；读写表 xt
  - `wf_kc`：读写表 kcb、pjnr2

- 提示与校验（19 条）：
  - [窗口事件 open]「此单据不存在！」（条件：`i = -1`）
  - [窗口事件 ue_action_sh]「只有才可以取消审核！」（条件：`xx = "1" and left(shr,10) <> left(u_name,10)`）
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）
  - [窗口事件 ue_action_openedit]「此月已经汇总完毕,打开修改开关失败！」（条件：`rq < gd_cb_jzrq`）
  - [窗口事件 ue_action_pz_del]「只有销售类别出库单才有销售收入凭证！」（条件：`xx <> "销售"`）
  - [窗口事件 ue_action_pz_del]「此凭证已经审核，不能删除！」
  - [窗口事件 ue_action_pz_ins]「领用出库单没有销售收入凭证，成本凭证请在本月【成本核算】后进入【凭证生成】里去统一生成！」（条件：`pjlb = "领用"`）
  - [窗口事件 ue_action_save]「收款科目没有录入，或者收款科目非明细科目！」（条件：`i = 0`）
  - [窗口事件 ue_action_save]「成本科目没有录入，或者成本科目非明细科目！」（条件：`i = 0`）
  - [窗口事件 ue_action_save]「日期小于汇总截止日期汇总截止日期为：」（条件：`rq < gd_cb_jzrq`）
  - [窗口事件 ue_action_save]「请输入出库单号！」（条件：`trim(pjdh) = ""`）
  - [窗口事件 ue_action_save]「单号重复,是否由系统重新计算单号(Y/N)!」（条件：`this.tt_bz = "1"`）
  - [窗口事件 ue_action_save]「第行 产品编号为，在产品档案里没有找到！」（条件：`k = 0`）
  - [窗口事件 ue_action_save]「此单据无内容，是否删除？」（条件：`this.dw_detail.rowcount() = 0`）
  - [窗口事件 ue_action_save]「产品出库数量大于库存数量!~r 出库数量为:  当前库存为：~r      是否进行？」（条件：`sl1 < 0`）
  - [窗口事件 wf_kc]「出库数量大于库存数量!  库存数量为:」（条件：`sl0 > (sl + old_sl)`）
  - [dw_detail.ue_rkj]「new:」（条件：`isnull(zxrkj) or zxrkj = 0`）
  - [dw_detail.clicked]「没有输入产品编号！」（条件：`isnull(xt_cs1) or trim(xt_cs1) = ""`）
  - [dw_master.doubleclicked]「科目不是明细科目，不可选。」（条件：`mm_zy <> "1"`）

### w_ck_cx_ckd — 出库单综合查询

- 类型：主窗口（默认）；尺寸：3077×1808 PBU；继承：`wroot_query`；库：rhzw8_cb1.pbd（账务+成本主程序）
- 打开入口：`w_ck_ck` 的 事件 ue_action_query1；`w_main1_cb` 的 tab_1/tabpage_1/p_t_1_cc.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | &S.另存 | 2505,928 256×108 |  |
| cb_exec | 按钮 | &Z.执行 | 2505,1056 256×108 |  |
| cb_exit | 按钮 | &F.返回 | 2505,1320 256×108 |  |
| cb_print | 按钮 | &D.打印 | 2505,1188 256×108 |  |
| cbx_1 | 复选框 | 重复内容不显示 | 101,800 471×80 |  |
| dw_column | 数据窗口 |  | 41,80 713×700 | 数据窗口 `d_column_set_ckd`；列：hz、yw、type、table |
| dw_result | uo_dw | 共查询到0条记录 | 805,12 1929×880 |  |
| dw_sort1 | 数据窗口 |  | 55,1000 1038×456 | 数据窗口 `d_sort1`；列：col_name、lenth |
| dw_sort2 | 数据窗口 |  | 1175,1000 1221×456 | 数据窗口 `d_sort2`；列：sortcol、sortype |
| dw_tab | uo_tab |  | 27,900 2446×604 | 数据窗口 `d_tab2`；列：tab1（查询条件）、tab2（排列顺序）、tab3、tab4、tab5、tab6、tab7、tab8、tab9、tab10、tab11、tab12、tab13、tab14、tab15 |
| dw_where | 数据窗口 |  | 55,1000 2341×456 | 数据窗口 `d_where`；列：precol、column1（字   段   名）、operator（操作符）、value（字    段    值）、logical（逻辑符） |
| lb_syntax | 列表框 |  | 50,996 2341×456 |  |
| sle_join | 单行输入 | pjlb.pjlb=pjnr1.pjlb and pjnr1.pjlb=pjnr | 521,416 1641×132 |  |
| sle_table | 单行输入 | pjnr1,pjnr2,cpda,kmbm,pjlb | 526,248 1641×124 |  |
| st_1 | 静态文本 | 请选择待显示列 | 73,8 603×72 |  |
| uo_1 | uo_getjoins |  | 2633,412 192×128 |  |

- 提示与校验（6 条）：
  - [cb_exec.clicked]「当前查询本模块不支持，请修改查询条件。  需要此功能者，请直接与开发商联系。」（条件：`parent.dw_result.create(sqlca.syntaxfromsql(syntax_str,"style(type = Grid)",err)) = -1`）
  - [dw_where.ue_where]「,请改正；  否则，所有查询条件将被忽略。」（条件：`i > 0`）
  - [dw_where.ue_where]「不是字符型,不能使用<含有>或<不含有>操作符,  请改正; 否则，所有查询条件将被忽略。」（条件：`trim(soper) = "like" or trim(soper) = "not like"`）
  - [dw_where.ue_where]「的值应为数字型,请改正；  否则，所有查询条件将被忽略。」（条件：`isnumber(svalue)`）
  - [dw_where.ue_where]「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」（条件：`not isdate(svalue)`）
  - [dw_where.ue_where]「这个数据类型未在本模块中定义。」

### w_ck_cx_rkd — 入库单综合查询

- 类型：主窗口（默认）；尺寸：3077×1572 PBU；继承：`wroot_query`；库：rhzw8_cb1.pbd（账务+成本主程序）
- 打开入口：`w_ck_rk` 的 事件 ue_action_query1；`w_main1_cb` 的 tab_1/tabpage_1/p_t_1_rc.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | &S.另存 | 2491,920 256×108 |  |
| cb_exec | 按钮 | &Z.执行 | 2491,1048 256×108 |  |
| cb_exit | 按钮 | &F.返回 | 2491,1312 256×108 |  |
| cb_print | 按钮 | &D.打印 | 2491,1180 256×108 |  |
| cbx_1 | 复选框 | 重复内容不显示 | 101,800 471×80 |  |
| dw_column | 数据窗口 |  | 55,84 713×700 | 数据窗口 `d_column_set_rkd`；列：hz、yw、type、table |
| dw_result | uo_dw | 共查询到0条记录 | 805,12 1929×880 |  |
| dw_sort1 | 数据窗口 |  | 55,1000 1038×456 | 数据窗口 `d_sort1`；列：col_name、lenth |
| dw_sort2 | 数据窗口 |  | 1175,1000 1221×456 | 数据窗口 `d_sort2`；列：sortcol、sortype |
| dw_tab | uo_tab |  | 27,900 2446×604 | 数据窗口 `d_tab2`；列：tab1（查询条件）、tab2（排列顺序）、tab3、tab4、tab5、tab6、tab7、tab8、tab9、tab10、tab11、tab12、tab13、tab14、tab15 |
| dw_where | 数据窗口 |  | 55,1000 2341×456 | 数据窗口 `d_where`；列：precol、column1（字   段   名）、operator（操作符）、value（字    段    值）、logical（逻辑符） |
| lb_syntax | 列表框 |  | 50,996 2341×456 |  |
| sle_join | 单行输入 | pjnr1.pjlb=pjnr2.pjlb and pjnr1.pjdh=pjn | 521,416 1641×132 |  |
| sle_table | 单行输入 | pjnr1,pjnr2,cpda,kmbm | 526,248 1641×124 |  |
| st_1 | 静态文本 | 请选择待显示列 | 73,8 603×72 |  |
| uo_1 | uo_getjoins |  | 2633,412 192×128 |  |

- 提示与校验（6 条）：
  - [cb_exec.clicked]「当前查询本模块不支持，请修改查询条件。  需要此功能者，请直接与开发商联系。」（条件：`parent.dw_result.create(sqlca.syntaxfromsql(syntax_str,"style(type = Grid)",err)) = -1`）
  - [dw_where.ue_where]「,请改正；  否则，所有查询条件将被忽略。」（条件：`i > 0`）
  - [dw_where.ue_where]「不是字符型,不能使用<含有>或<不含有>操作符,  请改正; 否则，所有查询条件将被忽略。」（条件：`trim(soper) = "like" or trim(soper) = "not like"`）
  - [dw_where.ue_where]「的值应为数字型,请改正；  否则，所有查询条件将被忽略。」（条件：`isnumber(svalue)`）
  - [dw_where.ue_where]「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」（条件：`not isdate(svalue)`）
  - [dw_where.ue_where]「这个数据类型未在本模块中定义。」

### w_ck_kc — 当前库存

- 类型：主窗口（默认）；尺寸：3808×1968 PBU；继承：`wroot_single`；菜单：`m_cb_kc`；库：rhzw8_cb1.pbd（账务+成本主程序）
- 打开入口：菜单「O日常业务 › 当前库存」（9 个菜单中）；`w_main1_cb` 的 st_1_kc.clicked；`w_main1_cb` 的 tab_1/tabpage_1/p_t_1_kc.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 9,344 3456×1372 | 数据窗口 `dw_ck_kcb`（表 kcb、cpda）；列：kcb_ckbh、cpbh（产品编号）、cpda_cpmc（产品名称）、cpda_gg（规格）、dqkc（当前库存）、cpda_jldw（单位）；doubleclicked → `w_ck_tz00`「库存台帐--选择」；doubleclicked 读写表 b_rights；ue_action_query → `wroot_dw_query`「条件搜索」 |
| uo_1 | u_toolbar |  | , 5463×200 |  |
| cb_2 | 按钮 | 搜索 | 1934,220 229×96 |  |
| cbx_1 | 复选框 | 库存为0时 不显示 | 2523,228 658×80 |  |
| sle_2 | 单行输入 |  | 869,220 1070×104 |  |
| st_1 | 静态文本 | 请输入快速搜索条件： | 55,232 759×60 |  |

- 窗口事件/函数：
  - `open`：打开 `w_cb_ckxz`「请选择仓库」；读写表 sys
  - `ue_action_hz`：打开 `w_ck_kc_hz`「库存汇总/统计」
  - `ue_action_kc`：读写表 kcb、pjnr1、pjnr2

- 提示与校验（2 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）

### w_ck_kc_hz — 库存汇总/统计

- 类型：弹出窗口；尺寸：2395×1324 PBU；库：rhzw8_cb1.pbd（账务+成本主程序）
- 打开入口：`w_ck_kc` 的 事件 ue_action_hz

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_17 | 按钮 | ... | 2043,296 82×96 | clicked → `w_cb_xt_cpbh_sc`「产品编号速查」 |
| cb_4 | 按钮 | 起始产品： | 160,152 494×100 |  |
| cb_5 | 按钮 | 截止产品： | 160,284 494×100 |  |
| cb_6 | 按钮 | 截止日期： | 160,416 494×100 |  |
| cb_7 | 按钮 | 确定 | 526,1020 247×120 | clicked → `w_preview`「打印预览」；clicked 读写表 cb_hzk、cpda |
| cb_71 | 按钮 | ... | 2043,156 82×96 | clicked → `w_cb_xt_cpbh_sc`「产品编号速查」 |
| cb_8 | 按钮 | 取消 | 1221,1020 247×120 |  |
| cbx_1 | 复选框 | 数量金额为零不显示 | 1413,432 754×76 |  |
| ddlb_1 | 单行输入 |  | 722,152 1317×100 |  |
| ddlb_2 | 单行输入 |  | 718,292 1317×100 |  |
| dw_1 | 数据窗口 |  | 91,896 494×360 | 数据窗口 `dw_ck_kc_hz_01`；列：cpbh（编码）、cpmc（名称）、gg（规格）、jldw（单位）、sl（数量）、dj（单价）、je（金额） |
| gb_1 | 分组框 | 单价选择： | 293,596 1701×252 |  |
| rb_1 | 单选按钮 | 成本价 | 489,700 315×72 |  |
| rb_2 | 单选按钮 | 默认入库价 | 905,700 407×72 |  |
| rb_3 | 单选按钮 | 默认出库价 | 1413,700 398×72 |  |
| rb_4 | 单选按钮 | 零售价 | 407,1584 315×72 |  |
| uo_1 | uo_comctl_datetime |  | 736,416 ×96 |  |

- 窗口事件/函数：
  - `open`：读写表 cpda
  - `wf_hz_01`：读写表 cb_hzk、pjnr2

- 提示与校验（1 条）：
  - [cb_7.clicked]「该条件内没有库存！」（条件：`parent.dw_1.rowcount() = 0`）

### w_ck_rk — 入库单浏览

- 类型：主窗口（默认）；尺寸：3058×1372 PBU；继承：`wroot_single_1`；菜单：`m_cb_crk_01`；库：rhzw8_cb1.pbd（账务+成本主程序）
- 打开入口：菜单「O日常业务 › 入库单管理」（9 个菜单中）；`w_main1_cb` 的 st_1_rk.clicked；`w_main1_cb` 的 tab_1/tabpage_1/p_t_1_rk.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 18,336 2158×772 | 数据窗口 `dw_ck_rk`（表 pjnr1、kmbm）；列：pjdh（票据单号）、rq（日期）、kpr（操作人）、sm（摘要）、bz_sh（审核）、kmbm（付款科目编码）、kmbm_kmqc（付款科目名称）、pjlb、pz_bz（凭证） |
| uo_1 | u_toolbar |  | , 5463×200 |  |
| dw_2 | 数据窗口 |  | 654,76 494×360 | 数据窗口 `dw_pjnr_save`（表 pjnr1、pjnr2）；列：pjnr1_pjlb、pjnr1_pjdh、pjnr1_rq、pjnr1_ckbh、pjnr1_kpr、pjnr1_sm、pjnr1_fpzl、pjnr1_slv、pjnr1_kmbm（Pjnr1 Kmbm）、pjnr1_cbkm（Pjnr1 Cbkm）、pjnr1_jc_bz、pjnr1_bz_sh、pjnr1_shr（Pjnr1 Shr）、pjnr2_cpbh、pjnr2_xh、pjnr2_sl、pjnr2_dj、pjnr2_dwcb、pjnr2_ckbh、pjnr2_dj_hs、pjnr2_je、pjnr2_jc_int、pjnr2_jc_bz |
| dw_3 | 数据窗口 |  | 768,244 494×360 | 数据窗口 `dw_pjnr_save`（表 pjnr1、pjnr2）；列：pjnr1_pjlb、pjnr1_pjdh、pjnr1_rq、pjnr1_ckbh、pjnr1_kpr、pjnr1_sm、pjnr1_fpzl、pjnr1_slv、pjnr1_kmbm（Pjnr1 Kmbm）、pjnr1_cbkm（Pjnr1 Cbkm）、pjnr1_jc_bz、pjnr1_bz_sh、pjnr1_shr（Pjnr1 Shr）、pjnr2_cpbh、pjnr2_xh、pjnr2_sl、pjnr2_dj、pjnr2_dwcb、pjnr2_ckbh、pjnr2_dj_hs、pjnr2_je、pjnr2_jc_int、pjnr2_jc_bz |
| rb_1 | 单选按钮 | 全部 | 283,220 297×80 |  |
| rb_2 | 单选按钮 | 未生成凭证 | 635,220 407×80 |  |

- 窗口事件/函数：
  - `open`：读写表 pjnr1、pjnr2
  - `ue_action_query1`：打开 `w_ck_cx_rkd`「入库单综合查询」
  - `ue_action_fc`：打开 `w_cb_ck_copy`「合同复制」；读写表 pjnr1、pjnr2
  - `ue_action_modify`：读写表 pjnr1
  - `ue_action_newcopy`：打开 `w_cb_ck_copy`「合同复制」；读写表 pjnr1、pjnr2
  - `ue_action_get`：打开 `w_cg_ht_get`「凭证转入」
  - `ue_action_del`：读写表 pjnr1、pjnr2

- 提示与校验（12 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
  - [窗口事件 ue_action_saveas1]「是否提换现有的文件？」（条件：`i = 1`）
  - [窗口事件 ue_action_fc]「复制不成功，请检查。」（条件：`message.returnvalue = 1`）
  - [窗口事件 ue_action_modify]「此入库单不存在！」（条件：`l = 0`）
  - [窗口事件 ue_action_get]「入库单数据转入成功！」（条件：`f_rkd_get(this.dw_2,xt_cs3,xt_cs2) = 1`）
  - [窗口事件 ue_action_del]「删除本条数据，请确认。」（条件：`l < 1`）
  - [窗口事件 ue_action_del]「此入库单已经结帐   不能删除！」（条件：`rq < gd_cb_jzrq`）
  - [窗口事件 ue_action_del]「此入库单已经生成凭证   不能删除！」（条件：`pz_bz = "1"`）
  - [窗口事件 ue_action_del]「此入库单已经审核   不能删除！」（条件：`bz_sh = "1"`）

### w_ck_rk1 — 入库单

- 类型：主窗口（默认）；尺寸：2299×2264 PBU；继承：`wroot_md2`；菜单：`m_cb_crk_02`；库：rhzw8_cb1.pbd（账务+成本主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 9,748 2011×536 | 数据窗口 `dw_ck_rk2`（表 pjnr2、cpda）；列：pjlb、pjdh、xh、ny、cpbh（产品编号）、sl（数量）、dj（单价）、dj_hs、je（价税合计）、dwcb、jc_int、cpda_cpmc（名称）、cpda_gg（规格）、cpda_jldw（单位）、jc_bz、ckbh、slv（税率）、je0（金额）、sm（说明）、se（税额）；itemchanged → `w_cb_xt_cpbh_sc`「产品编号速查」；itemchanged 读写表 cpda；ue_rkj 读写表 cpda；doubleclicked → `w_cb_xt_cpbh_sc`「产品编号速查」；clicked → `w_ck_tz00`「库存台帐--选择」；clicked 读写表 b_rights |
| dw_master | uo_dw |  | 14,204 1897×512 | 数据窗口 `dw_ck_rk1_tt`（表 pjnr1、kmbm）；列：pjlb、pjdh、rq（日   期）、fpzl、slv、kpr（操作人）、sm（分录摘要）、kmbm、jc_bz、bz_sh、kmbm_kmqc、shr、ckbh、cbkm、pz_bz、nf、yf、pzlx、pzbh；itemchanged → `w_pz_km_find`「科目查找」；itemchanged 读写表 kmbm；doubleclicked → `w_xt_kmwh`「科目维护」；doubleclicked 读写表 b_rights、kmbm；rbuttondown → `w_pz_km_find`「科目查找」；rbuttondown 读写表 kmbm |
| uo_1 | u_toolbar |  | 9, 5143×200 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_ck_rk1_tt`；读写表 b_rights、kmbm
  - `ue_action_sh`：读写表 pjnr1
  - `ue_action_pz_ins`：打开 `w_cb_pz`「凭证生成」
  - `ue_action_pz_del`：读写表 pjnr1、pz、pz_fj、pzdj
  - `ue_action_save`：读写表 cpda、kmbm、pjnr1、pjnr2
  - `ue_action_print`：打开 `w_preview_base_r1`「打印预览」
  - `ue_action_preview`：打开 `w_bb_pjnr`「特殊打印选择」；读写表 xt

- 提示与校验（14 条）：
  - [窗口事件 open]「此入库单不存在！」（条件：`i = -1`）
  - [窗口事件 ue_action_sh]「只有才可以取消审核！」（条件：`xx = "1" and left(shr,10) <> left(u_name,10)`）
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）
  - [窗口事件 ue_action_openedit]「此月已经汇总完毕,不能修改！」（条件：`rq < gd_cb_jzrq`）
  - [窗口事件 ue_action_pz_del]「此凭证已经审核，不能删除！」
  - [窗口事件 ue_action_save]「付款科目没有录入，或者付款科目非明细科目！」（条件：`i = 0`）
  - [窗口事件 ue_action_save]「日期小于汇总截止日期汇总截止日期为：」（条件：`rq < gd_cb_jzrq`）
  - [窗口事件 ue_action_save]「请输入库单号！」（条件：`trim(pjdh) = ""`）
  - [窗口事件 ue_action_save]「单号重复,是否由系统重新计算单号(Y/N)!」（条件：`this.tt_bz = "1"`）
  - [窗口事件 ue_action_save]「第行 产品编号为，在产品档案里没有找到！」（条件：`k = 0`）
  - [窗口事件 ue_action_save]「此入库单无内容，是否删除？」（条件：`this.dw_detail.rowcount() = 0`）
  - [dw_detail.ue_rkj]「new:」（条件：`isnull(zxrkj) or zxrkj = 0`）
  - [dw_detail.clicked]「没有输入产品编号！」（条件：`isnull(xt_cs1) or trim(xt_cs1) = ""`）
  - [dw_master.doubleclicked]「科目不是明细科目，不可选。」（条件：`mm_zy <> "1"`）

### w_ck_tz — 库存台帐

- 类型：主窗口（默认）；尺寸：2112×1468 PBU；库：rhzw8_cb1.pbd（账务+成本主程序）
- 打开入口：菜单「O日常业务 › 库存台帐」（9 个菜单中）；`w_main1_cb` 的 st_1_tz.clicked；`w_main1_cb` 的 tab_1/tabpage_1/p_t_1_tz.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 507,1168 247×108 | clicked 读写表 cpda |
| cb_17 | 按钮 | ... | 1787,432 73×88 | clicked → `w_cb_xt_cpbh_sc`「产品编号速查」 |
| cb_2 | 按钮 | 取消 | 1056,1168 247×108 |  |
| cb_7 | 按钮 | ... | 1787,276 73×88 | clicked → `w_cb_xt_cpbh_sc`「产品编号速查」 |
| cbx_1 | 复选框 | 含金额 | 1294,704 375×76 |  |
| ddlb_1 | 单行输入 |  | 407,276 1385×88 |  |
| ddlb_2 | 单行输入 |  | 402,432 1385×88 |  |
| em_1 | 格式输入 |  | 713,696 443×96 |  |
| em_2 | 格式输入 |  | 713,844 443×96 |  |
| gb_1 | 分组框 | 产品范围： | 91,192 1883×444 |  |
| rb_1 | 单选按钮 | 仓库 | 494,48 343×76 |  |
| rb_2 | 单选按钮 | 车间 | 1065,48 343×76 |  |
| st_1 | 静态文本 | 从 | 128,288 187×76 |  |
| st_2 | 静态文本 | 到 | 137,452 187×72 |  |
| st_3 | 静态文本 | 年月从 | 357,708 247×72 |  |
| st_4 | 静态文本 | 到 | 462,860 123×76 |  |

- 窗口事件/函数：
  - `open`：读写表 cpda

- 提示与校验（1 条）：
  - [cb_1.clicked]「截止日期小于起始日期！」（条件：`xt_cs4 < xt_cs3`）

### w_ck_tz00 — 库存台帐--选择

- 类型：主窗口（默认）；尺寸：1733×880 PBU；库：rhzw8_cb1.pbd（账务+成本主程序）
- 打开入口：`w_cb_pdk_1` 的 dw_master.doubleclicked；`w_ck_ck1` 的 dw_detail.clicked；`w_ck_kc` 的 dw_master.doubleclicked；`w_ck_rk1` 的 dw_detail.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 315,600 247×108 |  |
| cb_2 | 按钮 | 取消 | 864,600 247×108 |  |
| cbx_1 | 复选框 | 含金额 | 1125,124 375×76 |  |
| em_1 | 格式输入 |  | 544,116 443×96 |  |
| em_2 | 格式输入 |  | 544,264 443×96 |  |
| st_3 | 静态文本 | 年月从 | 187,128 247×72 |  |
| st_4 | 静态文本 | 到 | 293,280 123×76 |  |
| st_sm | 静态文本 | 特别提示：成本仅计算到2009年10月30日之后的成本不一定正确! | 55,420 1641×140 |  |

- 提示与校验（1 条）：
  - [cb_1.clicked]「截止日期小于起始日期！」（条件：`xt_cs4 < xt_cs3`）

### w_ck_tz1 — 库存台帐

- 类型：主窗口（默认）；尺寸：5349×2240 PBU；继承：`wroot_sheet`；菜单：`m_ck_kctz`；库：rhzw8_cb1.pbd（账务+成本主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cbx_sl | 复选框 | 仅数量 | 2203,232 251×80 |  |
| ddlb_1 | 下拉列表 |  | 416,232 1504×1508 |  |
| dw_1 | 数据窗口 |  | 1257,252 494×360 | 数据窗口 `dw_ck_tz_fl`；列：pjlb（Pjlb）、pjdh（Pjdh） |
| dw_2 | uo_dw |  | 411,500 4987×1536 | 数据窗口 `dw_ck_tz_new`；列：pjlb1（类型）、pjlb、pjdh（单号）、rq（日期）、zy（摘要）、rksl（入库数量）、rkdj（成本单价）、rkje（入库金额）、cksl（出库数量）、ckdj（成本单价）、ckje（出库金额）、jysl（结余数量）、jydj（结余单价）、jyje（结余金额）、ph；doubleclicked 读写表 b_rights、pjnr1 |
| dw_3 | uo_dw |  | 1129,440 3867×1536 | 数据窗口 `dw_ck_tz_new`；列：pjlb1（类型）、pjlb、pjdh（单号）、rq（日期）、zy（摘要）、rksl（入库数量）、rkdj（成本单价）、rkje（入库金额）、cksl（出库数量）、ckdj（成本单价）、ckje（出库金额）、jysl（结余数量）、jydj（结余单价）、jyje（结余金额）、ph；doubleclicked 读写表 b_rights、pjnr1 |
| dw_detail | uo_dw |  | 9,440 4987×1536 | 数据窗口 `dw_ck_tz_new`；列：pjlb1（类型）、pjlb、pjdh（单号）、rq（日期）、zy（摘要）、rksl（入库数量）、rkdj（成本单价）、rkje（入库金额）、cksl（出库数量）、ckdj（成本单价）、ckje（出库金额）、jysl（结余数量）、jydj（结余单价）、jyje（结余金额）、ph；doubleclicked 读写表 b_rights、pjnr1 |
| dw_master | uo_dw |  | 5,216 ×204 | 数据窗口 `dw_ck_tz_cp`（表 pjnr2）；列：cpbh |
| dw_print | 数据窗口 |  | 4091,272 960×420 |  |
| st_1 | 静态文本 | 产品选择： | 110,232 297×84 |  |
| uo_1 | u_toolbar |  | , ×200 |  |

- 窗口事件/函数：
  - `open`：读写表 cpda
  - `x5`：读写表 cpda、pjnr1、pjnr2
  - `ue_action_out`：读写表 cpda、kmbm
  - `ue_action_query`：打开 `wroot_dw_query`「条件搜索」
  - `ue_action_print`：打开 `w_cb_hzsj_preview_base`「打印预览」；数据窗口 `dw_ck_tz1_ph`、`dw_ck_tz_ph`；读写表 cpda
  - `ue_action_saveas`：读写表 cpda
  - `ue_action_preview`：数据窗口 `dw_ck_tz1_ph`、`dw_ck_tz_ph`；读写表 cpda

- 提示与校验（4 条）：
  - [窗口事件 open]「该范围内没有产品进出信息！」（条件：`this.dw_master.rowcount() = 0`）
  - [窗口事件 ue_action_preview]「每页打印完毕是否提示？」（条件：`xt_cs3 = "2"`）
  - [窗口事件 ue_action_preview]「是否继续打印?」（条件：`r = 1`）
  - [dw_2.doubleclicked]「此单据不存在！」（条件：`l = 0`）

### w_ck_tz1_bak — 库存台帐

- 类型：主窗口（默认）；尺寸：3543×1760 PBU；继承：`wroot_sheet`；菜单：`m_cb_kctz`；库：rhzw8_cb1.pbd（账务+成本主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| ddlb_1 | 下拉列表 |  | 690,216 1248×788 |  |
| dw_1 | 数据窗口 |  | 1568,708 494×360 | 数据窗口 `dw_ck_tz_fl`；列：pjlb（Pjlb）、pjdh（Pjdh） |
| dw_detail | uo_dw |  | 18,348 ×888 | 数据窗口 `dw_ck_tz_ph`；列：pjlb1（类型）、pjlb（类型编号）、pjdh（单号）、rq（日期）、zy（摘要）、rksl（入库数量）、rkdj（成本单价）、rkje（入库金额）、cksl（出库数量）、ckdj（成本单价）、ckje（出库金额）、jysl（结余数量）、jydj（结余单价）、jyje（结余金额）、ph；doubleclicked 读写表 b_rights、pjnr1 |
| dw_master | uo_dw |  | 18,228 ×100 | 数据窗口 `dw_ck_tz_cp`（表 pjnr2）；列：cpbh |
| st_1 | 静态文本 | 产品选择： | 128,212 521×84 |  |
| uo_1 | u_toolbar |  | , ×200 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_ck_tz1_ph`、`dw_ck_tz_ph`；读写表 cpda
  - `x5`：读写表 cpda、pjnr1、pjnr2
  - `x6`：读写表 pjnr2
  - `ue_action_query`：打开 `wroot_dw_query`「条件搜索」
  - `ue_action_saveas`：读写表 cpda

- 提示与校验（4 条）：
  - [窗口事件 open]「该产品范围没有台帐信息！」（条件：`this.dw_master.rowcount() = 0`）
  - [窗口事件 ue_action_preview]「每页打印完毕是否提示？」（条件：`xt_cs3 = "2"`）
  - [窗口事件 ue_action_preview]「是否继续打印?」（条件：`r = 1`）
  - [dw_detail.doubleclicked]「此单据不存在！」（条件：`l = 0`）

### w_ck_xsmxz — 销售明细账--选择

- 类型：主窗口（默认）；尺寸：2112×1196 PBU；库：rhzw8_cb1.pbd（账务+成本主程序）
- 打开入口：菜单「O日常业务 › 销售明细账」（9 个菜单中）；`w_main1_cb` 的 st_1_xs.clicked；`w_main1_cb` 的 tab_1/tabpage_1/p_t_1_xs.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 626,864 247×108 | clicked 读写表 cpda |
| cb_17 | 按钮 | ... | 1815,388 73×88 | clicked → `w_cb_xt_cpbh_sc`「产品编号速查」 |
| cb_2 | 按钮 | 取消 | 1175,868 247×108 |  |
| cb_7 | 按钮 | ... | 1815,272 73×88 | clicked → `w_cb_xt_cpbh_sc`「产品编号速查」 |
| ddlb_1 | 单行输入 |  | 366,272 1454×88 |  |
| ddlb_2 | 单行输入 |  | 361,388 1454×88 |  |
| em_1 | 格式输入 |  | 599,572 379×96 |  |
| em_2 | 格式输入 |  | 1221,572 379×96 |  |
| gb_1 | 分组框 | 产品范围： | 114,192 1883×348 |  |
| st_1 | 静态文本 | 从 | 151,284 187×76 |  |
| st_2 | 静态文本 | 到 | 160,408 187×72 |  |
| st_3 | 静态文本 | 年月从 | 238,584 247×72 |  |
| st_4 | 静态文本 | 到 | 1033,584 123×76 |  |

- 窗口事件/函数：
  - `open`：读写表 cpda

- 提示与校验（1 条）：
  - [cb_1.clicked]「截止日期小于起始日期！」（条件：`xt_cs4 < xt_cs3`）

### w_ck_xsmxz1 — 库存台帐

- 类型：主窗口（默认）；尺寸：5349×2240 PBU；继承：`wroot_sheet`；菜单：`m_ck_kctz`；库：rhzw8_cb1.pbd（账务+成本主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| ddlb_1 | 下拉列表 |  | 416,232 1504×1508 |  |
| dw_1 | 数据窗口 |  | 1257,252 494×360 | 数据窗口 `dw_ck_tz_fl`；列：pjlb（Pjlb）、pjdh（Pjdh） |
| dw_detail | uo_dw |  | 9,440 4987×1536 | 数据窗口 `dw_ck_xsmxz`；列：rq（日期）、pjdh（单号）、zy（摘要）、sl（数量）、dwsr（单位销售收入）、dwcb（单位销售成本）、xssr（销售收入）、xscb（销售成本）、xsfy（销售费用）、xssj、xslr（销售利润）、nf、yf、ri；doubleclicked 读写表 b_rights、pjnr1 |
| dw_master | uo_dw |  | 5,216 ×204 | 数据窗口 `dw_ck_xsmxz_cp`（表 pjnr2）；列：cpbh |
| st_1 | 静态文本 | 产品选择： | 110,232 297×84 |  |
| uo_1 | u_toolbar |  | , ×200 |  |

- 窗口事件/函数：
  - `open`：读写表 cpda
  - `x5`：读写表 cpda、pjnr1、pjnr2
  - `ue_action_query`：打开 `wroot_dw_query`「条件搜索」
  - `ue_action_print`：打开 `w_cb_hzsj_preview_base`「打印预览」；数据窗口 `dw_ck_xsmxz_prt`；读写表 cpda
  - `ue_action_saveas`：读写表 cpda

- 提示与校验（2 条）：
  - [窗口事件 open]「该范围内没有产品进出信息！」（条件：`this.dw_master.rowcount() = 0`）
  - [dw_detail.doubleclicked]「此单据不存在！」（条件：`l = 0`）
