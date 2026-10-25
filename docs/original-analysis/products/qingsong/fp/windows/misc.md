# 轻松会计 · 发票/进销存模块 — 窗口目录：其他系统窗口（登录、备份恢复、打印、杂项）（前缀 `misc`）

尺寸单位为 PowerBuilder Unit（PBU）。96 DPI、系统字体下约为：宽度像素 ≈ PBU × 0.25～0.3，高度像素 ≈ PBU × 0.25～0.28。
“打开入口”只列静态可见的调用方，运行时拼出来的窗口名可能遗漏。名字含 `_bak`、`_old`、`test` 的通常是历史残留。

### w_bb_saveas — 数据导出

- 类型：主窗口（默认）；尺寸：4261×5536 PBU；菜单：`m_bb_saveas`；库：rhzw_root.pbd（发票/进销存模块）
- 打开入口：`nvo_formone6_bak` 的 事件 uf_datatoexcel；`nvo_formone6` 的 事件 uf_datatoexcel

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| ole_1 | olecustomcontrol |  | ,204 2871×1540 |  |
| uo_1 | u_toolbar |  | , × |  |

- 窗口事件/函数：
  - `ue_action_get`：读写表 cpda、pjnr2、xt
  - `wf_cbkj_cpbh_get`：读写表 cpda、kmbm
  - `wf_cbkj_qc_get`：读写表 cpda、pjnr2
  - `wf_get_bmbm`：读写表 bmk
  - `wf_get_dwbm`：读写表 dwk
  - `wf_get_gdzc`：读写表 zc_gdzc、zc_sblb、zc_sbyt、zc_sbzt、zc_sydw
  - `wf_get_gdzc_xzsy`：读写表 zc_gdzc、zc_sblb、zc_sbyt、zc_sbzt、zc_sydw
  - `wf_get_grbm`：读写表 bmk
  - `wf_get_kmbm`：读写表 bmnc、dwnc、grnc、hg_da、hz、hzyeb、kmbm、nc、pz、xmnc、yhdzd、ysda、zc_sblb、zc_sbyt
  - `wf_get_pz`：读写表 bmk、dwk、grk、htda、kmbm、pzdj、pzlx、xjll_xm、xmk、xt
  - `wf_get_qclr`：读写表 fbgl、nc
  - `wf_get_xmbm`：读写表 bmk
  - `wf_get_zw_bmnc`：读写表 bmk、bmnc、kmbm
  - `wf_get_zw_dwnc`：读写表 dwk、dwnc、kmbm
  - `wf_get_zw_grnc`：读写表 grk、grnc、kmbm
  - `wf_get_zw_htda`：读写表 dwk、htda
  - `wf_get_zw_xmnc`：读写表 kmbm、xmk、xmnc

- 提示与校验（23 条）：
  - [窗口事件 ue_action_get]「本次共转入」
  - [窗口事件 ue_action_get]「由于错误，未转入条固定资产数据！」（条件：`r1 > 0`）
  - [窗口事件 ue_action_get]「如果出现重复编号部门，是否覆盖(Y/N)?」（条件：`this.is_lx = "bmk"`）
  - [窗口事件 ue_action_get]「由于编号重复，未转入条部门档案数据！」（条件：`r1 > 0`）
  - [窗口事件 ue_action_get]「如果出现重复编号，是否覆盖(Y/N)?」（条件：`this.is_lx = "grk"`）
  - [窗口事件 ue_action_get]「由于编号重复，未转入条项目档案数据！」（条件：`r1 > 0`）
  - [窗口事件 ue_action_get]「由于编号重复，未转入条客户档案数据！」（条件：`r1 > 0`）
  - [窗口事件 ue_action_get]「本次共转入条数据！」（条件：`s_bz = "1"`）
  - [窗口事件 ue_action_get]「出现重复编号，是否覆盖(Y/N)?」（条件：`this.is_lx = "cbkj_cpda"`）
  - [窗口事件 ue_action_get]「本次共转入条产品档案数据！」
  - [窗口事件 ue_action_get]「由于错误，未转入条产品档案数据！」（条件：`r1 > 0`）
  - [窗口事件 ue_action_get]「本次共转入条产品期初数据！」
  - [窗口事件 ue_action_get]「由于错误，未转入条产品期初数据！」（条件：`r1 > 0`）
  - [窗口事件 ue_action_get]「本次共转入条合同档案数据！」
  - [窗口事件 ue_action_get]「由于错误，未转入条合同档案数据！」（条件：`r1 > 0`）
  - [窗口事件 wf_get_fp_lr]「导入完成！~r 请仔细检查导入的数据，然后【存盘】」
  - [窗口事件 wf_get_kmbm]「长度不符合规定！」（条件：`i = (xt_len0 + 1)`）
  - [窗口事件 wf_get_kmbm]「的上级科目不存在！」（条件：`i2 = 0`）
  - [窗口事件 wf_get_kmbm]「没有同级科目，请先增加后再转此科目！」（条件：`i = 0`）
  - [窗口事件 wf_get_kmbm]「本次共转入条科目！」（条件：`sqlca.sqlcode = -1`）
  - [窗口事件 wf_get_kmbm]「没有符合条件的科目被导入！」（条件：`sqlca.sqlcode = -1`）
  - [窗口事件 wf_get_pz]「需要转入的凭证数据有错误(错误显示在审核人处)，是否继续转入(Y/N)?」（条件：`s_bz = "1"`）
  - [窗口事件 wf_get_pz]「共转入条凭证分录！」（条件：`l1 > 0`）

### w_cb_xt_kmbm_sc — 科目速查

- 类型：弹出窗口；尺寸：3227×2096 PBU；库：rhzw9_g1.pbd（发票/进销存模块）
- 打开入口：`w_fp_sz_2` 的 cb_4.clicked；`w_fp_sz_2` 的 cb_7.clicked；`w_fp_sz_2` 的 cb_8.clicked；`w_fp_sz` 的 cb_1.clicked；`w_fp_sz` 的 cb_18.clicked；`w_fp_sz` 的 cb_2.clicked；`w_fp_sz` 的 cb_28.clicked；`w_fp_sz` 的 cb_3.clicked；`w_fp_sz` 的 cb_4.clicked；`w_fp_sz` 的 cb_5.clicked；`w_fp_sz` 的 cb_7.clicked；`w_fp_sz` 的 cb_8.clicked……（共 13 处）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 搜索 | 1664,28 229×96 |  |
| cb_2 | 按钮 | 关闭 | 1897,28 229×96 |  |
| dw_1 | uo_dw |  | 37,164 3150×1784 | 数据窗口 `dw_xt_km_help`（表 kmbm）；列：kmbm（科目编码）、km_mc（科目名称）、kmqc、fbs、sls、yefx |
| sle_1 | 单行输入 |  | 352,36 1280×88 |  |
| st_1 | 静态文本 | 搜索条件: | 32,44 297×72 |  |
| st_2 | 静态文本 | 双击下面的科目即可选择 | 2309,64 745×72 |  |

### w_cwxt — 关于

- 类型：模态对话框；尺寸：1861×864 PBU；库：rhzw9_g.pbd（发票/进销存模块）
- 打开入口：菜单「H.帮助 › 版权信息」（46 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 1248,636 247×96 |  |
| st_1 | 静态文本 | 润衡财务管理系统 | 366,36 1454×104 |  |
| st_2 | 静态文本 | http://www.rhrj.net | 197,452 1591×84 |  |
| st_3 | 静态文本 | 深圳市润衡财经软件有限公司 版权所有 | 123,360 1691×92 |  |
| st_4 | 静态文本 | ver 2008.11.12 | 594,156 1115×76 |  |
| st_6 | 静态文本 | 1994-2025 Runsoft copyright | 672,536 1097×72 |  |
| st_fwk | 静态文本 | 售后服务卡未登记 | 96,524 521×80 |  |

### w_err_view — 错误查看

- 类型：主窗口（默认）；尺寸：7712×1240 PBU；继承：`wroot_single`；菜单：`m_work`；库：rhzw_root.pbd（发票/进销存模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,204 631×676 | 数据窗口 `d_errmsg`（表 b_errmsg）；列：err_time（出错时间）、err_cname（操作员）、err_num（错误号）、err_message（错误信息）、err_where（出错地方）、err_object（出错对象）、err_event（出错事件）、err_line（行号）、err_cnt |
| uo_1 | u_toolbar |  | , 768×200 |  |

- 提示与校验（2 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）

### w_frame — Frame

- 类型：MDI 框架(带状态栏)；尺寸：3730×2412 PBU；菜单：`m_frame_fp`；库：rhzw9_g.pbd（发票/进销存模块）
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_open；`pfc_appsrv` 的 事件 pfc_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| mdi_1 | MDI 客户区 |  | , × |  |

- 窗口事件/函数：
  - `ue_postopen`：打开 `w_login`「用户登录」
  - `closequery`：打开 `w_bakupdata`
  - `open`：打开 `w_login`「用户登录」、`w_login_oem`「用户登录」

- 提示与校验（1 条）：
  - [窗口事件 closequery]「结束 ? ~r ~r温馨提示：为了保护您的数据安全，日常工作中建议您做好数据备份。」

### w_idle

- 类型：弹出窗口；尺寸：2917×1909 PBU；库：rhzw_root.pbd（发票/进销存模块）
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_idle；`pfc_appsrv` 的 事件 pfc_idle

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| p_1 | 图片 | logo.bmp | 165,237 2359×1217 |  |
| st_1 | 静态文本 | 按任意键继续...... | 1326,65 586×77 |  |
| st_2 | 静态文本 | Press any key to continue...... | 828,1777 910×77 |  |

### w_logo

- 类型：弹出窗口；尺寸：1189×256 PBU；库：rhzw9_g1.pbd（发票/进销存模块）
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_open；`pfc_appsrv` 的 事件 pfc_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_1 | 数据窗口 |  | 2469,412 960×420 | 数据窗口 `dw_tzjl`（表 dba.xttz）；列：dm（代码）、tz_name（套帐名称） |
| st_1 | 静态文本 | 系统正在启动，请稍候...... | 37,88 1070×80 |  |

### w_module — 模块维护

- 类型：主窗口（默认）；尺寸：7712×1240 PBU；继承：`wroot_single`；菜单：`m_work`；库：rhzw_root.pbd（发票/进销存模块）
- 打开入口：菜单「F.文件 › 模块管理」（46 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,204 1326×676 | 数据窗口 `d_module`（表 dba.b_module）；列：m_id（模块编号）、e_name（英文名）、c_name（中文名） |
| uo_1 | u_toolbar |  | , 768×200 |  |

- 提示与校验（2 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）

### w_paste — 请选择粘贴值

- 类型：模态对话框；尺寸：1733×701 PBU；库：rhzw_root.pbd（发票/进销存模块）
- 打开入口：菜单「a1 › V.取现有值」（`m_cpq_rbutton_paste`）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_cancel | 按钮 | &C.放弃 | 1390,237 266×109 |  |
| cb_paste | 按钮 | &P.粘贴 | 1390,89 266×109 |  |
| dw_1 | 数据窗口 |  | 37,33 1322×517 |  |

### w_print_2 — 打印

- 类型：模态对话框；尺寸：1591×800 PBU；库：rhzw_root.pbd（发票/进销存模块）
- 打开入口：`w_zc_fhslz_1_bak` 的 事件 user_prt_lx；`w_zc_slz_1_bak` 的 事件 user_prt_lx；`w_zc_slz_fb` 的 事件 user_prt_lx

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_cancel | 按钮 | &C.放弃 | 1207,320 311×108 |  |
| cb_ok | 按钮 | &Q.确定 | 1207,156 315×108 |  |
| gb_1 | 分组框 | 请选择打印范围 | 41,36 1143×628 |  |
| rb_all | 单选按钮 | 全部(&A) | 101,192 434×72 |  |
| rb_pages | 单选按钮 | 页码范围(&G) : | 101,352 503×72 |  |
| sle_1 | 单行输入 |  | 613,352 544×88 |  |
| st_3 | 静态文本 | 输入页码和/或页码范围(以逗号分隔)，如 | 101,464 1015×60 |  |
| st_4 | 静态文本 | 1,3,5-12 | 101,544 389×60 |  |

- 提示与校验（1 条）：
  - [cb_ok.clicked]「打印范围无效。」（条件：`(not isnumber(stmp)) or stmp = "" or isnull(stmp)`）

### w_retrieve_wait — 提示窗口

- 类型：弹出窗口；尺寸：1143×512 PBU；库：rhzw_root.pbd（发票/进销存模块）
- 打开入口：`pfc_dwsrv` 的 事件 pfc_retrievestart；`pfc_dwsrv` 的 事件 pfc_sqlpreview

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_cancel | 按钮 | &Z. 中止 | 366,308 311×100 |  |
| st_1 | 静态文本 | 正在读取数据, 请等待...... | 169,24 832×76 |  |
| st_2 | 静态文本 | 总计： | 219,112 247×72 |  |
| st_3 | 静态文本 | 已读入 | 224,216 247×72 |  |

### w_setbar — 工具条设置

- 类型：模态对话框；尺寸：1825×1009 PBU；库：rhzw_root.pbd（发票/进销存模块）
- 打开入口：菜单「F.文件 › 工具条设置」（46 个菜单中）

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

- 类型：模态对话框；尺寸：2213×1093 PBU；库：rhzw_root.pbd（发票/进销存模块）
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_systemerror；`pfc_appsrv` 的 事件 pfc_systemerror

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_continue | 按钮 | &C.继续 | 874,837 458×121 |  |
| cb_exit | 按钮 | &X.退出系统 | 284,829 458×121 |  |
| cb_print | 按钮 | &P.打印 | 1463,837 458×121 |  |
| dw_1 | 数据窗口 |  | 1697,453 494×361 | 数据窗口 `d_errmsg`（表 b_errmsg）；列：err_time（出错时间）、err_cname（操作员）、err_num（错误号）、err_message（错误信息）、err_where（出错地方）、err_object（出错对象）、err_event（出错事件）、err_line（行号）、err_cnt |
| dw_error | 数据窗口 |  | 51,41 2085×741 | 数据窗口 `d_system_error`；列：errornum、message（出错信息：）、where（出错窗口/菜单：）、object（出错对象：）、event（出错事件：）、line（出错行号：） |

### w_xt_dwwh — 客供维护（运行时设置）

- 类型：主窗口（默认）；尺寸：3941×2188 PBU；继承：`wroot_share_tab`；菜单：`m_work_xt_wh`；库：rhzw9_g1.pbd（发票/进销存模块）
- 打开入口：`w_main1_fp` 的 st_1_kh.clicked；`w_pz_pzedit_b` 的 事件 u_pzxxbz；`w_pz_pzedit_bak` 的 事件 u_pzxxbz；`w_pz_pzedit_mb` 的 事件 u_pzxxbz；`w_pz_pzedit` 的 事件 u_pzxxbz；`w_xt_fhwh` 的 cb_2.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| tab_1 | 标签页容器 |  | 23,240 3593×1612 |  |
| tab_1/tabpage_1 | 用户对象 | 主表 | 18,112 3557×1484 |  |
| tab_1/tabpage_1/dw_master | uo_dw |  | 87,32 2962×1228 | 数据窗口 `dw_xt_dwwh`（表 dwk）；列：dwbm（客供编号）、dw_mc（客户/供应商名称）、txdz（通讯地址）、yzbm（邮政编码）、lxr（联系人）、lxdh（联系电话）、khyh（开户银行）、yhzh（银行帐号）、nsh（纳税登记号）、bz（在用）、rq（获得日期）、dw_jc（简称） |
| tab_1/tabpage_2 | 用户对象 | 明细 | 18,112 3557×1484 |  |
| tab_1/tabpage_2/dw_detail | uo_dw |  | 82,84 1518×1108 | 数据窗口 `dw_xt_dwwh_1`（表 dwk）；列：dwbm（客供编码：）、dw_mc（客户/供应商名称：）、txdz（通信地址：）、yzbm（邮政编码：）、lxr（联系人：）、lxdh（联系电话：）、khyh（开户行：）、yhzh（帐号：）、nsh（纳税登记号：）、bz（在用：）、rq、dw_jc（简称：） |
| uo_1 | u_toolbar |  | , 3625×200 |  |
| em_1 | 格式输入 |  | 1705,232 398×100 |  |
| st_1 | 静态文本 | 客户/供应商分级规则(每级长度) | 910,244 773×76 |  |

- 窗口事件/函数：
  - `open`：读写表 dba、dwk、sys、xt
  - `ue_action_del`：读写表 dwnc、kmbm、pz
  - `ue_action_save`：读写表 dwk、xt
  - `ue_action_query`：打开 `wroot_dw_query`「条件搜索」
  - `ue_action_newcopy`：打开 `w_xt_wh`「修改编号」
  - `ue_action_fj`：打开 `w_xt_dwwh_fj`「客户分级规则设定」

- 提示与校验（11 条）：
  - [窗口事件 open]「共享DataWindow的数据源可能不一致，请检查。」（条件：`this.dw_master.sharedata(this.dw_detail) = -1`）
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）
  - [窗口事件 ue_action_del]「是否删除?」（条件：`r < 1`）
  - [窗口事件 ue_action_del]「有期初数，不能删除！」（条件：`l > 0`）
  - [窗口事件 ue_action_del]「有凭证已使用，不能删除！」（条件：`l > 0`）
  - [窗口事件 ue_action_del]「存入失败，数据没有删除。」（条件：`this.dw_master.update() = 1`）
  - [窗口事件 ue_action_print]「开始打印吗?」
  - [窗口事件 ue_action_refresh]「数据还没有存盘，刷新前是否存盘?」（条件：`this.ib_save = false`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」（条件：`message.returnvalue = 1`）
  - [窗口事件 ue_action_save]「此处数据错误，请重新输入。」（条件：`this.dw_detail.accepttext() = -1`）
  - [窗口事件 wf_itemchanged]「您的编码长度不符合规则！」（条件：`ret = -1`）

### w_zoom — 定制

- 类型：模态对话框；尺寸：1002×477 PBU；库：rhzw_root.pbd（发票/进销存模块）
- 打开入口：`pfc_dwsrv` 的 事件 pfc_rbuttondown_preview

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_cancel | 按钮 | &F.放弃 | 558,237 316×105 |  |
| cb_ok | 按钮 | &Q.确认 | 92,237 316×105 |  |
| em_zoom | 格式输入 | 100 | 682,57 266×97 |  |
| st_1 | 静态文本 | 请输入一百分比值 : | 46,69 636×73 |  |

### wroot_dw_query — 条件搜索

- 类型：模态对话框；尺寸：2711×684 PBU；库：rhzw_root.pbd（发票/进销存模块）
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

- 类型：主窗口（默认）；尺寸：2894×1561 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_root.pbd（发票/进销存模块）

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

- 类型：主窗口（默认）；尺寸：1486×1548 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_root.pbd（发票/进销存模块）

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

- 类型：主窗口（默认）；尺寸：2245×1520 PBU；继承：`wroot_sheet`；菜单：`m_work_01`；库：rhzw_root.pbd（发票/进销存模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 5,752 ×500 |  |
| dw_master | uo_dw |  | 23,228 ×500 |  |
| uo_1 | u_toolbar |  | 9, 544×200 |  |

- 提示与校验（1 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）

### wroot_md2_1 — wroot_sheet（继承自祖先）

- 类型：主窗口（默认）；尺寸：2245×1524 PBU；继承：`wroot_sheet`；菜单：`m_work_01`；库：rhzw_root.pbd（发票/进销存模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw |  | 14,712 × |  |
| dw_master | uo_dw |  | ,204 × |  |
| uo_1 | u_toolbar |  | , 544×200 |  |

- 提示与校验（1 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`not this.ib_save`）

### wroot_md_2 — 主从式应用示例

- 类型：主窗口（默认）；尺寸：1486×1236 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_root.pbd（发票/进销存模块）

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

- 类型：主窗口（默认）；尺寸：1669×1236 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_root.pbd（发票/进销存模块）

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

- 类型：主窗口（默认）；尺寸：3077×1648 PBU；库：rhzw_root.pbd（发票/进销存模块）

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

- 类型：主窗口（默认）；尺寸：1499×1536 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_root.pbd（发票/进销存模块）

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

- 类型：主窗口（默认）；尺寸：1961×1356 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_root.pbd（发票/进销存模块）

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

- 类型：主窗口（默认）；尺寸：2245×1236 PBU；菜单：`m_work`；库：rhzw_root.pbd（发票/进销存模块）

### wroot_single — 单一式应用

- 类型：主窗口（默认）；尺寸：7712×1240 PBU；继承：`wroot_sheet`；菜单：`m_work`；库：rhzw_root.pbd（发票/进销存模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,204 631×676 |  |
| uo_1 | u_toolbar |  | , 768×200 |  |

- 提示与校验（2 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）

### wroot_single_1 — 单一式应用

- 类型：主窗口（默认）；尺寸：2642×1244 PBU；继承：`wroot_sheet`；菜单：`m_work_01`；库：rhzw_root.pbd（发票/进销存模块）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 27,228 631×676 |  |
| uo_1 | u_toolbar |  | , 544×200 |  |

- 提示与校验（4 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」
