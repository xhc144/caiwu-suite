# 轻松会计 · 账务主程序 — 窗口目录：系统设置与初始化（前缀 `xt`）

尺寸单位为 PowerBuilder Unit（PBU）。96 DPI、系统字体下约为：宽度像素 ≈ PBU × 0.25～0.3，高度像素 ≈ PBU × 0.25～0.28。
“打开入口”只列静态可见的调用方，运行时拼出来的窗口名可能遗漏。名字含 `_bak`、`_old`、`test` 的通常是历史残留。

### w_xt_bm_sc — 部门查找

- 类型：弹出窗口；尺寸：1527×2244 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_pz_pzedit_b` 的 dw_detail.doubleclicked；`w_pz_pzedit_b` 的 dw_detail.itemchanged；`w_pz_pzedit_bak` 的 dw_detail.doubleclicked；`w_pz_pzedit_bak` 的 dw_detail.itemchanged；`w_pz_pzedit_mb` 的 dw_detail.doubleclicked；`w_pz_pzedit_mb` 的 dw_detail.itemchanged；`w_pz_pzedit` 的 dw_detail.doubleclicked；`w_pz_pzedit` 的 dw_detail.itemchanged；`w_xt_bmnc` 的 cb_t1.clicked；`w_zc_fhdlz` 的 cb_xm.clicked；`w_zc_fhslz` 的 cb_xm.clicked；`w_zw_fhslye` 的 cb_t1.clicked……（共 17 处）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 搜索 | 1138,28 174×88 |  |
| cb_2 | 按钮 | 关闭 | 1317,28 174×88 |  |
| dw_1 | 数据窗口 |  | 50,148 1417×1700 | 数据窗口 `dw_xt_bmwh`（表 bmk）；列：bmbm（编号）、bm_mc（部门名称）、bz（在用）；doubleclicked → `w_zc_fhdlz`「辅助多栏账」、`w_zc_fhslz`「辅助明细账」 |
| sle_1 | 单行输入 |  | 311,32 814×80 |  |
| st_1 | 静态文本 | 搜索条件: | 46,32 297×80 |  |
| st_2 | 静态文本 | 键盘操作说明： | 82,1876 526×68 |  |
| st_3 | 静态文本 | 1）按上下箭头选择科目 | 142,1956 585×76 |  |
| st_4 | 静态文本 | 2）找到后按F2键确认（或者鼠标双击） | 151,2044 969×76 |  |

- 窗口事件/函数：
  - `u_open`：打开 `w_zc_fhdlz`「辅助多栏账」、`w_zc_fhslz`「辅助明细账」

### w_xt_bmnc — 【（运行时设置）

- 类型：主窗口（默认）；尺寸：4201×1636 PBU；继承：`wroot_single`；菜单：`m_work_xt_fznc`；库：rhzw8_7.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 期初余额 › 部门期初录入」（19 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 9,448 2478×676 | 数据窗口 `dw_xt_bm_ye`（表 bmnc、fbgl、kmbm、bmk）；列：xmbm（部门编码）、kmbm（科目编码）、bz（币种）、nc_jf（年初借方余额）、nc_jf_b（年初借方(本)）、nc_df（年初贷方余额）、nc_df_b（年初贷方(本)）、jq_jf（帐前借方发生额）、jq_jf_b（帐前借方(本)）、jq_df（帐前贷方发生额）、fbs、ys、jq_df_b（帐前贷方(本)）、nf、nchl、kmbm_km_mc（科目名称）、bmk_bm_mc（部门名称） |
| uo_1 | u_toolbar |  | 5, 768×200 |  |
| cb_t1 | 按钮 | 搜索 | 3991,220 133×84 | clicked → `w_xt_bm_sc`「部门查找」 |
| cbx_sl | 复选框 | 期初数量 | 919,220 297×76 |  |
| ddlb_bz | 下拉列表 |  | 416,216 475×436 | selectionchanged 读写表 fbgl |
| ddlb_km | 下拉列表 |  | 480,312 2523×792 |  |
| ddlb_xm | 下拉列表 |  | 2309,220 1678×1068 |  |
| st_1 | 静态文本 | 选择币种 | 78,224 293×80 |  |
| st_2 | 静态文本 | 输入科目编码： | 78,324 471×80 |  |
| st_3 | 静态文本 | 选择部门 | 1993,224 311×80 |  |

- 窗口事件/函数：
  - `open`：读写表 bmk、bmnc、fbgl、hz、kmbm
  - `ue_action_del`：读写表 bmnc
  - `ue_action_new`：读写表 bmnc、kmbm
  - `u_hz`：读写表 bmnc、kmbm

- 提示与校验（11 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）
  - [窗口事件 ue_action_del]「是否删除-- 项?」（条件：`r = 0`）
  - [窗口事件 ue_action_del]「不允许删除!」（条件：`i = 0`）
  - [窗口事件 ue_action_new]「本年已经有过账，不能增加期初数!」（条件：`this.xgbz = "1"`）
  - [窗口事件 ue_action_new]「请先选择要增加的部门!」（条件：`xmbm = "全部"`）
  - [窗口事件 ue_action_new]「请先选择要增加的科目!」（条件：`kmbm = "全部"`）
  - [窗口事件 ue_action_new]「已有此项目!」（条件：`i > 0`）
  - [窗口事件 ue_action_new]「此科目非数量科目!」（条件：`sls = "0"`）
  - [窗口事件 ue_action_new]「此科目非复币科目!」（条件：`fbs = "0"`）
  - [窗口事件 u_hz]「是否删除所有损益科目的年初数？」（条件：`l > 0`）

### w_xt_bmwh — 部门管理

- 类型：弹出窗口；尺寸：2231×1972 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 辅助档案 › 部门信息维护」（19 个菜单中）；`w_pz_pzedit_b` 的 事件 u_pzxxbz；`w_pz_pzedit_bak` 的 事件 u_pzxxbz；`w_pz_pzedit_mb` 的 事件 u_pzxxbz；`w_pz_pzedit` 的 事件 u_pzxxbz；`w_xt_fhwh` 的 cb_3.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1915,1104 265×120 |  |
| cb_2 | 按钮 | 编号修改 | 1915,968 265×120 | clicked → `w_xt_wh`「修改编号」 |
| cb_3 | 按钮 | 删除 | 1915,1240 265×120 | clicked 读写表 bmnc、pz |
| cb_4 | 按钮 | 确定 | 1915,1376 265×120 | clicked 读写表 xt |
| cb_5 | 按钮 | 取消 | 1915,1512 265×120 |  |
| cb_6 | 按钮 | 另存 | 1915,696 265×120 |  |
| cb_9 | 按钮 | 查找... | 1307,16 206×88 |  |
| cb_get | 按钮 | 导入 | 1915,832 265×120 |  |
| dw_1 | uo_dw_single |  | 37,128 1833×1568 | 数据窗口 `dw_xt_bmwh`（表 bmk）；列：bmbm（编号）、bm_mc（部门名称）、bz（在用） |
| em_1 | 格式输入 |  | 713,1720 398×100 |  |
| sle_1 | 单行输入 |  | 489,8 777×96 |  |
| st_1 | 静态文本 | 部门分级规则(每级长度) | 50,1732 594×76 |  |
| st_12 | 静态文本 | 请输入查找条件 | 32,16 434×80 |  |
| st_2 | 静态文本 | 说明：最多5级，总长度不超过10位 | 1221,1740 910×60 |  |

- 窗口事件/函数：
  - `open`：读写表 bmk、dba、xt

- 提示与校验（4 条）：
  - [cb_3.clicked]「是否删除?」
  - [cb_3.clicked]「已使用，不能删除！」（条件：`r > 0`）
  - [cb_9.clicked]「请输入查找条件!」（条件：`isnull(xx) or xx = ""`）
  - [dw_1.itemchanged]「您的编码长度不符合规则！」（条件：`ret = -1`）

### w_xt_dlxx — 操作日志

- 类型：主窗口（默认）；尺寸：2642×1244 PBU；继承：`wroot_single_1`；菜单：`m_work_dlxx`；库：rhzw8_5.pbd（账务主程序）
- 打开入口：菜单「S系统管理 › 操作日志」（19 个菜单中）；`w_main1` 的 tab_1/tabpage_3/p_t_3_rz.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 27,228 1541×676 | 数据窗口 `dw_xt_dlxx`（表 dlxx）；列：dlrq（登录日期）、xtrq（系统日期）、jrsj（进入时间）、dlr（登录人）、cdm（使用功能）、tcsj（退出时间） |
| uo_1 | u_toolbar |  | , 544×200 |  |

- 窗口事件/函数：
  - `ue_action_del`：打开 `w_xt_dlxx_del`「登 录 信 息 删 除」

- 提示与校验（4 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」

### w_xt_dlxx_del — 登 录 信 息 删 除

- 类型：模态对话框；尺寸：1275×812 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_xt_dlxx` 的 事件 ue_action_del

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 取消 | 695,552 247×88 |  |
| cb_2 | 按钮 | 确定 | 288,548 247×88 | clicked 读写表 dlxx |
| em_1 | 格式输入 |  | 521,200 434×80 |  |
| em_2 | 格式输入 |  | 521,352 434×80 |  |
| gb_1 | 分组框 | 删除下列登录日期范围内的登录信息 | 59,64 1115×436 |  |
| st_1 | 静态文本 | 开始日期 | 219,200 329×72 |  |
| st_2 | 静态文本 | 结束日期 | 219,352 329×72 |  |

### w_xt_dw_sc — 客户查找

- 类型：弹出窗口；尺寸：2245×2092 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_ht_htda` 的 dw_master.doubleclicked；`w_pz_pzedit_b` 的 dw_detail.doubleclicked；`w_pz_pzedit_b` 的 dw_detail.itemchanged；`w_pz_pzedit_bak` 的 dw_detail.doubleclicked；`w_pz_pzedit_bak` 的 dw_detail.itemchanged；`w_pz_pzedit_mb` 的 dw_detail.doubleclicked；`w_pz_pzedit_mb` 的 dw_detail.itemchanged；`w_pz_pzedit` 的 dw_detail.doubleclicked；`w_pz_pzedit` 的 dw_detail.itemchanged；`w_xt_dwnc` 的 cb_t1.clicked；`w_zc_fhdlz` 的 cb_xm.clicked；`w_zc_fhslz` 的 cb_xm.clicked……（共 18 处）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 搜索 | 1614,28 270×96 |  |
| cb_2 | 按钮 | 关闭 | 1893,28 247×96 |  |
| dw_1 | 数据窗口 |  | 23,132 2185×1676 | 数据窗口 `dw_xt_dwwh`（表 dwk）；列：dwbm（客供编号）、dw_mc（客户/供应商名称）、txdz（通讯地址）、yzbm（邮政编码）、lxr（联系人）、lxdh（联系电话）、khyh（开户银行）、yhzh（银行帐号）、nsh（纳税登记号）、bz（在用）、rq（获得日期）、dw_jc（简称）；doubleclicked → `w_zc_fhdlz`「辅助多栏账」、`w_zc_fhslz`「辅助明细账」、`w_ht_htda`「合同档案管理」；doubleclicked 读写表 dwk |
| sle_1 | 单行输入 |  | 311,36 1262×80 |  |
| st_1 | 静态文本 | 搜索条件: | 46,40 297×80 |  |
| st_2 | 静态文本 | 键盘操作说明： | 146,1836 471×68 |  |
| st_3 | 静态文本 | 1）按上下箭头选择科目 | 704,1832 585×76 |  |
| st_4 | 静态文本 | 2）找到后按F2键确认（或者鼠标双击） | 713,1924 969×76 |  |

- 窗口事件/函数：
  - `u_open`：打开 `w_zc_fhdlz`「辅助多栏账」、`w_zc_fhslz`「辅助明细账」

### w_xt_dwnc — 【（运行时设置）

- 类型：主窗口（默认）；尺寸：4288×1616 PBU；继承：`wroot_single`；菜单：`m_work_xt_fznc`；库：rhzw8_7.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 期初余额 › 客供期初录入」（19 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 5,448 3671×676 | 数据窗口 `dw_xt_dw_ye`（表 dwnc、fbgl、kmbm、dwk）；列：xmbm（客户编码）、dwk_dw_mc（客户名称）、kmbm（科目编码）、bz（币种）、nc_jf（年初借方余额）、nc_jf_b（年初借方(本)）、nc_df（年初贷方余额）、nc_df_b（年初贷方(本)）、jq_jf（帐前借方发生额）、jq_jf_b（帐前借方(本)）、jq_df（帐前贷方发生额）、jq_df_b（帐前贷方(本)）、fbs、ys、nchl、nf、kmbm_km_mc（科目名称） |
| uo_1 | u_toolbar |  | , 768×200 |  |
| cb_t1 | 按钮 | 搜索 | 3991,204 133×84 | clicked → `w_xt_dw_sc`「客户查找」 |
| cbx_sl | 复选框 | 期初数量 | 914,212 297×76 |  |
| ddlb_bz | 下拉列表 |  | 379,196 475×436 | selectionchanged 读写表 fbgl |
| ddlb_km | 下拉列表 |  | 466,312 2615×1024 |  |
| ddlb_xm | 下拉列表 |  | 2418,200 1545×1156 |  |
| st_1 | 静态文本 | 选择币种 | 73,212 274×80 |  |
| st_2 | 静态文本 | 输入科目编码： | 73,324 471×80 |  |
| st_3 | 静态文本 | 选择客户 | 2075,212 334×80 |  |

- 窗口事件/函数：
  - `open`：读写表 dwk、dwnc、fbgl、hz、kmbm
  - `ue_action_del`：读写表 dwnc
  - `ue_action_new`：读写表 dwnc、kmbm
  - `u_hz`：读写表 dwnc、kmbm

- 提示与校验（11 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）
  - [窗口事件 ue_action_del]「是否删除--项?」（条件：`r = 0`）
  - [窗口事件 ue_action_del]「不允许删除!」（条件：`i = 0`）
  - [窗口事件 ue_action_new]「本年已经有过账，不能增加期初数!」（条件：`this.xgbz = "1"`）
  - [窗口事件 ue_action_new]「请先选择要增加的客户!」（条件：`xmbm = "全部"`）
  - [窗口事件 ue_action_new]「请先选择要增加的科目!」（条件：`kmbm = "全部"`）
  - [窗口事件 ue_action_new]「已有此项目!」（条件：`i > 0`）
  - [窗口事件 ue_action_new]「此科目非数量科目!」（条件：`sls = "0"`）
  - [窗口事件 ue_action_new]「此科目非复币科目!」（条件：`fbs = "0"`）
  - [窗口事件 u_hz]「是否删除所有损益科目的年初数？」（条件：`l > 0`）

### w_xt_dwwh — 客供维护（运行时设置）

- 类型：主窗口（默认）；尺寸：3941×2188 PBU；继承：`wroot_share_tab`；菜单：`m_work_xt_wh`；库：rhzw8_5.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 辅助档案 › 客供信息维护」（19 个菜单中）；`w_pz_pzedit_b` 的 事件 u_pzxxbz；`w_pz_pzedit_bak` 的 事件 u_pzxxbz；`w_pz_pzedit_mb` 的 事件 u_pzxxbz；`w_pz_pzedit` 的 事件 u_pzxxbz；`w_xt_fhwh` 的 cb_2.clicked

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

### w_xt_dwwh_fj — 客户分级规则设定

- 类型：模态对话框；尺寸：1307×668 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_xt_dwwh` 的 事件 ue_action_fj

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 261,368 279×104 | clicked 读写表 xt |
| cb_2 | 按钮 | 取消 | 759,368 279×104 |  |
| em_1 | 格式输入 |  | 709,156 398×100 |  |
| st_1 | 静态文本 | 客户分级规则(每级长度) | 46,168 594×76 |  |

- 窗口事件/函数：
  - `open`：读写表 xt

### w_xt_fbwh — 外币管理

- 类型：模态对话框；尺寸：2331×1088 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 外币类型维护」（19 个菜单中）；`w_main1` 的 st_3_wb.clicked；`w_main1` 的 tab_1/tabpage_3/p_t_3_wb.clicked；`w_pz_pzedit_b` 的 事件 u_hlgl；`w_pz_pzedit_bak` 的 事件 u_hlgl；`w_pz_pzedit_mb` 的 事件 u_hlgl；`w_pz_pzedit` 的 事件 u_hlgl

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 2025,412 247×100 | clicked → `w_xt_fbwh_1`「增加币种」 |
| cb_3 | 按钮 | 删除 | 2025,548 247×100 | clicked 读写表 nc、pz |
| cb_4 | 按钮 | 确定 | 2025,684 247×100 |  |
| cb_5 | 按钮 | 取消 | 2025,820 247×100 |  |
| dw_1 | uo_dw_single |  | 78,72 1838×692 | 数据窗口 `dw_xt_fbwh`（表 fbgl）；列：bz（币种）、nchl（年初汇率）、qchl、qmhl（期末汇率）、sykm、bwbz |
| gb_1 | 分组框 |  | 41,8 1938×940 |  |
| pb_1 | 图片按钮 | 查找... | 1701,792 238×96 | clicked → `w_xt_kmwh`「科目维护」 |
| sle_1 | 单行输入 |  | 567,796 1120×88 |  |
| st_1 | 静态文本 | 汇兑损益科目： | 73,800 494×80 |  |

- 窗口事件/函数：
  - `open`：读写表 dba、fbgl

- 提示与校验（3 条）：
  - [cb_3.clicked]「此项目为本位币，不能删除！」（条件：`bwbz = "1"`）
  - [cb_3.clicked]「此币种已使用，不能删除！」（条件：`i > 0`）
  - [cb_3.clicked]「是否删除？」（条件：`i > 0`）

### w_xt_fbwh_1 — 增加币种

- 类型：模态对话框；尺寸：969×580 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_xt_fbwh` 的 cb_1.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 取消 | 521,284 201×96 |  |
| cb_2 | 按钮 | 确定 | 219,284 201×96 | clicked 读写表 fbgl、kmbm、nc |
| em_1 | 格式输入 |  | 489,96 402×88 |  |
| st_1 | 静态文本 | 请输入币种： | 69,108 398×72 |  |

### w_xt_fhwh — 辅助档案

- 类型：模态对话框；尺寸：1682×936 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_main1` 的 st_3_fz.clicked；`w_main1` 的 tab_1/tabpage_3/p_t_3_fz.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 1 项目维护 | 242,164 416×108 | clicked → `w_xt_xmwh`「核算项目」 |
| cb_2 | 按钮 | 2 客供维护 | 864,164 416×108 | clicked → `w_xt_dwwh`「客供维护（运行时设置）」 |
| cb_3 | 按钮 | 3 部门维护 | 242,428 416×108 | clicked → `w_xt_bmwh`「部门管理」 |
| cb_4 | 按钮 | 4 人员维护 | 864,428 416×108 | clicked → `w_xt_grwh`「人员管理」 |
| cb_5 | 按钮 | 退出 | 626,664 247×108 |  |

### w_xt_gr_sc — 人员查找

- 类型：弹出窗口；尺寸：1367×2160 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_pz_pzedit_b` 的 dw_detail.doubleclicked；`w_pz_pzedit_b` 的 dw_detail.itemchanged；`w_pz_pzedit_bak` 的 dw_detail.doubleclicked；`w_pz_pzedit_bak` 的 dw_detail.itemchanged；`w_pz_pzedit_mb` 的 dw_detail.doubleclicked；`w_pz_pzedit_mb` 的 dw_detail.itemchanged；`w_pz_pzedit` 的 dw_detail.doubleclicked；`w_pz_pzedit` 的 dw_detail.itemchanged；`w_xt_grnc` 的 cb_t1.clicked；`w_zc_fhdlz` 的 cb_xm.clicked；`w_zc_fhslz` 的 cb_xm.clicked；`w_zw_fhslye` 的 cb_t1.clicked……（共 17 处）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 搜索 | 969,28 187×96 |  |
| cb_2 | 按钮 | 关闭 | 1152,28 165×96 |  |
| dw_1 | 数据窗口 |  | 32,148 1280×1644 | 数据窗口 `dw_xt_grwh`（表 grk）；列：grbm（人员编码）、gr_mc（人员名称）、bz（在用）；doubleclicked → `w_zc_fhdlz`「辅助多栏账」、`w_zc_fhslz`「辅助明细账」 |
| sle_1 | 单行输入 |  | 311,36 649×80 |  |
| st_1 | 静态文本 | 搜索条件: | 46,40 297×80 |  |
| st_2 | 静态文本 | 键盘操作说明： | 82,1808 526×68 |  |
| st_3 | 静态文本 | 1）按上下箭头选择科目 | 142,1888 585×76 |  |
| st_4 | 静态文本 | 2）找到后按F2键确认（或者鼠标双击） | 151,1976 969×76 |  |

- 窗口事件/函数：
  - `u_open`：打开 `w_zc_fhdlz`「辅助多栏账」、`w_zc_fhslz`「辅助明细账」

### w_xt_grnc — 人员期初余额录入（运行时设置）

- 类型：主窗口（默认）；尺寸：4123×1616 PBU；继承：`wroot_single`；菜单：`m_work_xt_fznc`；库：rhzw8_7.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 期初余额 › 个人期初录入」（19 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 5,448 2478×676 | 数据窗口 `dw_xt_gr_ye`（表 grnc、fbgl、kmbm、grk）；列：xmbm（人员编码）、kmbm（科目编码）、bz（币种）、nc_jf（年初借方余额）、nc_jf_b（年初借方(本)）、nc_df（年初贷方余额）、nc_df_b（年初贷方(本)）、jq_jf（帐前借方发生额）、jq_jf_b（帐前借方(本)）、jq_df（帐前贷方发生额）、fbs、ys、jq_df_b（帐前贷方(本)）、nf、nchl、kmbm_km_mc（科目名称）、grk_gr_mc（人员名称） |
| uo_1 | u_toolbar |  | , 768×200 |  |
| cb_t1 | 按钮 | 搜索 | 3858,208 133×84 | clicked → `w_xt_gr_sc`「人员查找」 |
| cbx_sl | 复选框 | 期初数量 | 914,212 297×76 |  |
| ddlb_bz | 下拉列表 |  | 370,200 475×436 | selectionchanged 读写表 fbgl |
| ddlb_km | 下拉列表 |  | 466,312 2441×1044 |  |
| ddlb_xm | 下拉列表 |  | 2519,200 1326×1196 |  |
| st_1 | 静态文本 | 选择币种 | 73,212 293×80 |  |
| st_2 | 静态文本 | 输入科目编码： | 73,336 471×80 |  |
| st_3 | 静态文本 | 选择人员 | 2199,212 302×80 |  |

- 窗口事件/函数：
  - `open`：读写表 fbgl、grk、grnc、hz、kmbm
  - `ue_action_del`：读写表 grnc
  - `ue_action_new`：读写表 grnc、kmbm
  - `u_hz`：读写表 grnc、kmbm

- 提示与校验（11 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）
  - [窗口事件 ue_action_del]「是否删除-- 项?」（条件：`r = 0`）
  - [窗口事件 ue_action_del]「不允许删除!」（条件：`i = 0`）
  - [窗口事件 ue_action_new]「本年已经有过账，不能增加期初数!」（条件：`this.xgbz = "1"`）
  - [窗口事件 ue_action_new]「请先选择要增加的人员!」（条件：`xmbm = "全部"`）
  - [窗口事件 ue_action_new]「请先选择要增加的科目!」（条件：`kmbm = "全部"`）
  - [窗口事件 ue_action_new]「已有此项目!」（条件：`i > 0`）
  - [窗口事件 ue_action_new]「此科目非数量科目!」（条件：`sls = "0"`）
  - [窗口事件 ue_action_new]「此科目非复币科目!」（条件：`fbs = "0"`）
  - [窗口事件 u_hz]「是否删除所有损益科目的年初数？」（条件：`l > 0`）

### w_xt_grwh — 人员管理

- 类型：弹出窗口；尺寸：1925×1992 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 辅助档案 › 人员信息维护」（19 个菜单中）；`w_pz_pzedit_b` 的 事件 u_pzxxbz；`w_pz_pzedit_bak` 的 事件 u_pzxxbz；`w_pz_pzedit_mb` 的 事件 u_pzxxbz；`w_pz_pzedit` 的 事件 u_pzxxbz；`w_xt_fhwh` 的 cb_4.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1586,1104 279×108 |  |
| cb_2 | 按钮 | 编号修改 | 1586,964 279×108 | clicked → `w_xt_wh`「修改编号」 |
| cb_3 | 按钮 | 删除 | 1586,1244 279×108 | clicked 读写表 grnc、pz |
| cb_4 | 按钮 | 确定 | 1586,1384 279×108 | clicked 读写表 xt |
| cb_5 | 按钮 | 取消 | 1586,1524 279×108 |  |
| cb_6 | 按钮 | 另存 | 1586,684 279×108 |  |
| cb_9 | 按钮 | 查找... | 1294,16 206×88 |  |
| cb_get | 按钮 | 导入 | 1586,824 279×108 |  |
| dw_1 | uo_dw_single |  | 46,120 1422×1492 | 数据窗口 `dw_xt_grwh`（表 grk）；列：grbm（人员编码）、gr_mc（人员名称）、bz（在用） |
| em_1 | 格式输入 |  | 709,1676 398×100 |  |
| sle_1 | 单行输入 |  | 471,8 777×92 |  |
| st_1 | 静态文本 | 人员分级规则(每级长度) | 46,1688 594×76 |  |
| st_12 | 静态文本 | 请输入查找条件 | 32,16 434×80 |  |
| st_2 | 静态文本 | 说明：最多5级，总长度不超过10位 | 123,1800 987×60 |  |

- 窗口事件/函数：
  - `open`：读写表 dba、grk、xt

- 提示与校验（4 条）：
  - [cb_3.clicked]「是否删除?」
  - [cb_3.clicked]「已使用，不能删除！」（条件：`r > 0`）
  - [cb_9.clicked]「请输入查找条件!」（条件：`isnull(xx) or xx = ""`）
  - [dw_1.itemchanged]「您的编码长度不符合规则！」（条件：`ret = -1`）

### w_xt_ht_sc — 合同查找

- 类型：弹出窗口；尺寸：3593×2072 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_ht_htda` 的 dw_master.ue_action_save；`w_pz_pzedit_b` 的 dw_detail.doubleclicked；`w_pz_pzedit_b` 的 dw_detail.itemchanged；`w_pz_pzedit_bak` 的 dw_detail.doubleclicked；`w_pz_pzedit_bak` 的 dw_detail.itemchanged；`w_pz_pzedit_mb` 的 dw_detail.doubleclicked；`w_pz_pzedit_mb` 的 dw_detail.itemchanged；`w_pz_pzedit` 的 dw_detail.doubleclicked；`w_pz_pzedit` 的 dw_detail.itemchanged

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 搜索 | 1682,104 229×96 |  |
| cb_2 | 按钮 | 关闭 | 1920,104 206×96 |  |
| dw_1 | 数据窗口 |  | 14,288 3543×1644 | 数据窗口 `dw_ht_htda`（表 htda、dwk）；列：htbh（合同号）、khbh（客户编号）、htmc（合同名称）、nr、rq1（签定日期）、je（金额）、lx（类型）、je1、je2、dw_mc（客户名称）、sm1（备注1）、sm2（备注2）、lrr（录入人）、shr（审核人）、sh_bz（审核）、je0（期初收付款） |
| sle_1 | 单行输入 |  | 375,108 1294×88 |  |
| st_1 | 静态文本 | 搜索条件: | 18,112 357×80 |  |
| st_2 | 静态文本 | 键盘操作说明： | 2171,20 526×68 |  |
| st_3 | 静态文本 | 1）按上下箭头选择科目 | 2231,100 585×76 |  |
| st_4 | 静态文本 | 2）找到后按F2键确认（或者鼠标双击） | 2240,188 969×76 |  |

### w_xt_jslb — 结算类别管理

- 类型：模态对话框；尺寸：1499×1284 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 结算类型维护」（19 个菜单中）；`w_main1` 的 tab_1/tabpage_3/p_t_3_js.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1198,580 261×104 |  |
| cb_3 | 按钮 | 删除 | 1198,728 261×104 |  |
| cb_4 | 按钮 | 确定 | 1198,876 261×104 |  |
| cb_5 | 按钮 | 取消 | 1198,1024 261×104 |  |
| dw_1 | 数据窗口 |  | 91,104 1042×996 | 数据窗口 `dw_xt_jslb`（表 jslb）；列：jslb（代码）、jslb_mc（结算类别） |
| gb_1 | 分组框 | 结算类别： | 41,32 1143×1112 |  |

- 提示与校验（3 条）：
  - [cb_3.clicked]「不允许删空结算类别！」（条件：`i = 1`）
  - [dw_1.dberror]「结算类别重复！是否重输？」（条件：`sqldbcode = -196`）
  - [dw_1.dberror]「数据窗口出错！」（条件：`i = 1`）

### w_xt_jzwh — 结转类型维护

- 类型：模态对话框；尺寸：4037×1772 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 结转类型维护」（19 个菜单中）；`w_main1` 的 st_3_jz.clicked；`w_main1` 的 tab_1/tabpage_3/p_t_3_jz.clicked；`w_zw_ydjz_1_bak1` 的 cb_4.clicked；`w_zw_ydjz_1` 的 cb_4.clicked；`w_zw_ydjz_ts` 的 cb_2.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加类型 | 2427,116 352×108 |  |
| cb_2 | 按钮 | 增加 | 105,1448 311×96 |  |
| cb_3 | 按钮 | 删除 | 453,1448 311×96 |  |
| cb_4 | 按钮 | 确定 | 3214,196 306×168 | clicked 读写表 jzlx |
| cb_5 | 按钮 | 取消 | 3214,444 306×168 |  |
| dw_1 | 数据窗口 |  | 105,108 2304×584 | 数据窗口 `dw_xt_jzlx_1_1`（表 jzlx）；列：jzlx、jc、pzlx、xmlb |
| dw_2 | 数据窗口 |  | 105,800 3803×628 | 数据窗口 `dw_xt_jzlx_2`（表 jzlx）；列：jzlx、zy（摘要）、zrkm（转入科目名称）、zckm（转出科目名称）、pzlx、xmlb、jc、bz0（转出类型）、bl0（转出比例）；itemchanged 读写表 kmbm |
| gb_1 | 分组框 | 结转类型 | 46,28 2853×684 |  |
| gb_2 | 分组框 | 内容 | 46,724 3918×852 |  |
| st_1 | 静态文本 | 温馨提示：转出科目允许多个，转入科目只能是一个明细科目 | 1056,1460 1664×72 |  |

- 窗口事件/函数：
  - `open`：读写表 dba、jzlx、sys

- 提示与校验（5 条）：
  - [cb_4.clicked]「凭证类型不得为空，请选择凭证类型！」（条件：`xx = "" and xx1 <> ""`）
  - [cb_4.clicked]「转入/转出科目重复！是否重输？」（条件：`i = -1`）
  - [cb_4.clicked]「转入科目数不等于 1 个！是否重输？」（条件：`i <> 1`）
  - [cb_4.clicked]「转出科目数小于 1 个！是否重输？」（条件：`i < 1`）
  - [dw_2.itemchanged]「非明细科目，不能作为转入科目！」（条件：`yjd = "0"`）

### w_xt_kc_sc — 库存速查

- 类型：弹出窗口；尺寸：3419×2160 PBU；库：rhzw8_3.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 搜索 | 2053,52 247×92 |  |
| cb_2 | 按钮 | 关闭 | 2304,52 247×92 |  |
| cbx_1 | 复选框 | 选择后窗口关闭 | 2647,56 475×80 |  |
| dw_1 | uo_dw |  | 9,180 3328×1820 | 数据窗口 `dw_xt_kc_sc` |
| rb_1 | 单选按钮 | 拼音码 | 3506,484 261×52 |  |
| rb_2 | 单选按钮 | 五笔码 | 3593,216 261×72 |  |
| rb_3 | 单选按钮 | 名称 | 3547,628 247×76 |  |
| sle_1 | 单行输入 |  | 357,56 1600×84 |  |
| st_1 | 静态文本 | 搜索条件: | 41,68 297×72 |  |

### w_xt_kgzb — 系统初始化--口令验证

- 类型：模态对话框；尺寸：2016×1208 PBU；库：rhzw8_9.pbd（账务主程序）
- 打开入口：菜单「S系统管理 › 系统初始化」（19 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 继续---> | 1211,940 370×88 | clicked → `w_xt_kgzb_0`「系统初始化--向导选择」；clicked 读写表 b_user |
| cb_2 | 按钮 | 取消 | 1691,940 247×88 |  |
| cb_3 | 按钮 | <---上一步 | 827,940 370×88 |  |
| gb_1 | 分组框 | 请注意： | 55,36 1888×880 |  |
| sle_1 | 单行输入 |  | 805,748 576×88 |  |
| sle_2 | 单行输入 | MANAGER | 805,608 576×92 |  |
| st_1 | 静态文本 | 用户密码： | 489,760 320×88 |  |
| st_3 | 静态文本 | 系统初始化功能是针对当前套账 | 165,192 965×68 |  |
| st_4 | 静态文本 | 的初始建账工作。因为在本套账中已经存在会计科目及凭证，这 | 165,284 1705×76 |  |
| st_5 | 静态文本 | 数据丢失，您必须输入您登录本套账的口令才能继续操作。 | 165,468 1705×76 |  |
| st_6 | 静态文本 | 些数据在系统初始化时可能会被清除，为了避免出现误操作造成 | 165,376 1705×76 |  |
| st_7 | 静态文本 | （00-演示数据） | 1111,192 814×68 |  |
| st_8 | 静态文本 | 用户代码： | 489,628 311×76 |  |

- 窗口事件/函数：
  - `ue_pass`：打开 `w_xt_kgzb_0`「系统初始化--向导选择」
  - `open`：读写表 kmbm、pzdj

- 提示与校验（1 条）：
  - [cb_1.clicked]「口令错误！」（条件：`xx <> upper(xx1)`）

### w_xt_kgzb_0 — 系统初始化--向导选择

- 类型：模态对话框；尺寸：2007×1212 PBU；库：rhzw8_9.pbd（账务主程序）
- 打开入口：`w_login_oem` 的 cb_new.clicked；`w_login` 的 cb_new.clicked；`w_tzjl` 的 cb_1.clicked；`w_xt_kgzb_3` 的 cb_3.clicked；`w_xt_kgzb` 的 cb_1.clicked；`w_xt_kgzb` 的 事件 ue_pass

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 继续---> | 1211,1012 370×88 | clicked → `w_xt_kgzb_a1`「系统初始化--套账名称」、`w_xt_kgzb_3`「一键初始」 |
| cb_2 | 按钮 | 取消 | 1691,1012 247×88 |  |
| cb_3 | 按钮 | <---上一步 | 827,1012 370×88 |  |
| gb_1 | 分组框 | 初始化向导 | 46,32 1897×924 |  |
| lb_1 | 列表框 |  | 110,1152 224×84 |  |
| rb_1 | 单选按钮 | 一键初始 | 251,132 334×76 |  |
| rb_2 | 单选按钮 | 分步向导 | 247,532 334×76 |  |
| st_1 | 静态文本 | 适用于对系统初始化操作不熟悉，或需快速建账操作 | 325,224 1531×76 |  |
| st_2 | 静态文本 | Δ推荐本套账初次初始化时使用。 | 256,388 905×76 |  |
| st_3 | 静态文本 | 适用于对本功能较为熟悉，或需要部分保留本套账数 | 325,620 1559×76 |  |
| st_4 | 静态文本 | 据的用户。 | 325,704 489×76 |  |
| st_5 | 静态文本 | Δ推荐本套账已经有数据再次初始化时使用。 | 251,796 1321×76 |  |
| st_6 | 静态文本 | 的用户。 | 325,304 251×72 |  |

- 提示与校验（1 条）：
  - [cb_1.clicked]「本功能只能在数据库服务器所在电脑上进行操作!」（条件：`xt_netbz = "T" and i = 1`）

### w_xt_kgzb_1 — 系统初始化--信息确认

- 类型：模态对话框；尺寸：2171×1204 PBU；库：rhzw8_9.pbd（账务主程序）
- 打开入口：`w_xt_kgzb_a5` 的 cb_1.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确认 | 1198,972 379×88 | clicked → `w_xt_kgzb_2`「系统初始化--执行操作」、`w_acini_wizard`「期初建账操作向导」 |
| cb_2 | 按钮 | 取消 | 1678,972 247×88 |  |
| cb_3 | 按钮 | <---上一步 | 814,972 370×88 | clicked → `w_xt_kgzb_a5`「系统初始化--开账日期选择」 |
| cbx_1 | 复选框 | 需要进行现金流量核算 | 1106,564 690×80 |  |
| ddlb_bhff | 下拉列表 |  | 544,560 439×296 |  |
| ddlb_hy | 下拉列表 |  | 544,208 1490×604 |  |
| ddlb_syff | 下拉列表 |  | 1390,1196 416×332 |  |
| em_1 | 格式输入 | 0 | 1271,444 87×92 |  |
| em_2 | 格式输入 | 0 | 1358,444 87×92 |  |
| em_3 | 格式输入 | 0 | 1445,444 87×92 |  |
| em_4 | 格式输入 | 0 | 1531,444 87×92 |  |
| em_5 | 格式输入 | 0 | 1618,444 87×92 |  |
| em_6 | 格式输入 | 0 | 1705,444 87×92 |  |
| em_7 | 格式输入 | 0 | 1792,444 87×92 |  |
| em_8 | 格式输入 | 0 | 1879,444 87×92 |  |
| em_9 | 格式输入 | 0 | 1966,444 87×92 |  |
| em_kjqj | 格式输入 |  | 1431,792 178×88 |  |
| em_kmcd | 格式输入 | 0 | 1184,444 87×92 |  |
| em_kmjs | 格式输入 |  | 544,444 187×88 |  |
| em_kzrq | 格式输入 |  | 539,788 416×92 |  |
| gb_1 | 分组框 | 信息确认 | 46,20 2057×888 |  |
| sle_bwb | 单行输入 |  | 544,676 361×88 |  |
| sle_sydw | 单行输入 |  | 544,324 1490×88 |  |
| sle_tzname | 单行输入 |  | 544,92 1490×88 |  |
| st_1 | 静态文本 | 套账名称： | 224,104 311×84 |  |
| st_10 | 静态文本 | 会计期间从： | 1051,808 370×56 |  |
| st_11 | 静态文本 | 月开始 | 1614,808 210×60 |  |
| st_2 | 静态文本 | 使用单位： | 224,336 311×68 |  |
| st_3 | 静态文本 | 科目级数： | 224,456 311×68 |  |
| st_4 | 静态文本 | 每级代码长度： | 763,460 443×68 |  |
| st_5 | 静态文本 | 凭证编号方法： | 105,568 430×68 |  |
| st_6 | 静态文本 | 建账日期： | 229,804 325×56 |  |
| st_7 | 静态文本 | 本位币： | 283,688 251×68 |  |
| st_8 | 静态文本 | 会计准则： | 224,220 311×84 |  |
| st_9 | 静态文本 | 汇兑损益方法： | 965,1196 443×64 |  |

- 窗口事件/函数：
  - `wf_insert_km`：读写表 kmbm

- 提示与校验（11 条）：
  - [cb_1.clicked]「套账名称不得为空，请检查！」（条件：`isnull(xx) or xx = ""`）
  - [cb_1.clicked]「使用单位名称不得为空，请检查！」（条件：`isnull(xx) or xx = ""`）
  - [cb_1.clicked]「您的建账日期可能过小，请检查！」（条件：`date(parent.em_kzrq.text) < date("1949.01.01")`）
  - [cb_1.clicked]「您必须选择一种会计制度，请检查！」（条件：`isnull(xx) or xx = ""`）
  - [cb_1.clicked]「您选择的会计准则是 [用户自定义会计准则] ~r这样系统将不会自动生成任何会计科目~r系统已经预设了各个行业的会计准则，最好选择一下 ~r ~r确认不需要系统的预置会计科目吗？」（条件：`xx = "99"`）
  - [cb_1.clicked]「请设定科目级数！」（条件：`kmjs < 1`）
  - [cb_1.clicked]「第级科目长度不得为空！」（条件：`isnull(ln[i]) or ln[i] = 0`）
  - [cb_1.clicked]「科目长度合计不能超过位字符！」（条件：`seg[i] > xt_km_cd`）
  - [cb_1.clicked]「必需输入本位币！」（条件：`len(xx) = 0`）
  - [cb_2.clicked]「您确认要放弃系统初始化吗？」
  - [em_kjqj.modified]「我国规定的会计期间都是从1月到12月！~r您确定要将会计期间从月开始吗？」（条件：`integer(xx) = 1`）

### w_xt_kgzb_2 — 系统初始化--执行操作

- 类型：模态对话框；尺寸：2034×1164 PBU；库：rhzw8_9.pbd（账务主程序）
- 打开入口：`w_xt_kgzb_1` 的 cb_1.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 执行 | 1207,944 370×88 | clicked 读写表 bmk、bmnc、dba、dlxx、dwk、dwnc、fbgl、grk、grnc、hz、jslb、kmbm、nc、pz、pzdj、pzlx、wlhz、wlxx、xmk、xmnc、xt |
| cb_2 | 按钮 | 取消 | 1691,940 247×88 |  |
| cb_3 | 按钮 | <---上一步 | 827,940 370×88 |  |
| cbx_bb | 复选框 | 重建报表（系统将根据所选会计制度类别重新恢复系统预置的报 | 114,556 1760×76 |  |
| cbx_fh | 复选框 | 删除辅助档案（包含：客户、项目、部门、个人等信息） | 114,712 1582×76 |  |
| cbx_km | 复选框 | 重建会计科目（系统将根据您所选会计制度重建科目，现有会计 | 114,296 1810×72 |  |
| cbx_nc | 复选框 | 删除期初余额 | 224,460 539×76 |  |
| cbx_pz | 复选框 | 删除凭证 | 114,112 430×76 |  |
| cbx_wb | 复选框 | 删除外币种类 | 114,204 539×76 |  |
| cbx_wl | 复选框 | 删除往来信息 | 114,800 539×76 |  |
| dw_bbml | 数据窗口 |  | 434,1340 960×420 | 数据窗口 `dw_ini_bbml`（表 bbml）；列：xh（Xh）、bbname（Bbname）、row（Row）、col（Col）、bz1（Bz1）、bz2（Bz2） |
| dw_bbml_gs | 数据窗口 |  | 82,1316 960×420 | 数据窗口 `dw_ini_bbml_gs`（表 bbml_gs）；列：xh（Xh）、bbname（Bbname）、row（Row）、col（Col）、t1（T1）、t2（T2）、t3（T3）、t4（T4）、bz1（Bz1）、bz2（Bz2） |
| dw_bbml_pos | 数据窗口 |  | 430,1352 960×420 | 数据窗口 `dw_ini_bbml_pos`（表 bbml_pos）；列：xh（Xh）、bbname（Bbname）、row（Row）、col（Col）、t1（T1）、t2（T2）、t3（T3）、t4（T4）、t5（T5）、s1（S1）、s2（S2）、s3（S3）、bz1（Bz1）、bz2（Bz2） |
| dw_jzlx | 数据窗口 |  | 238,1256 960×420 | 数据窗口 `dw_ini_jzlx`（表 jzlx）；列：jzlx（Jzlx）、pzlx（Pzlx）、xmlb（Xmlb）、jc（Jc）、zy（Zy）、zrkm（Zrkm）、zckm（Zckm）、bz0（Bz0）、bl0（Bl0） |
| dw_kmbm | 数据窗口 |  | 960,1412 960×420 | 数据窗口 `dw_ini_kmbm`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、kmsx（Kmsx）、zhlb（Zhlb）、fbs（Fbs）、sls（Sls）、bz（Bz）、dw（Dw）、xms（Xms）、dws（Dws）、bms（Bms）、grs（Grs）、wls（Wls）、yjd（Yjd）、yefx（Yefx）、kmqc（Kmqc）、xmbm（Xmbm）、dwbm（Dwbm）、bmbm（Bmbm）、grbm（Grbm）、sybz（Sybz）、xjs（Xjs） |
| dw_pzlx | 数据窗口 |  | 1111,1484 960×420 | 数据窗口 `dw_ini_pzlx`（表 pzlx）；列：pzlx（Pzlx）、pzlx_jc（Pzlx Jc）、pzlx_qc（Pzlx Qc）、pzlx_jfy1（Pzlx Jfy1）、pzlx_jfy2（Pzlx Jfy2）、pzlx_dfy1（Pzlx Dfy1）、pzlx_dfy2（Pzlx Dfy2）、pzlx_pzy1（Pzlx Pzy1）、pzlx_pzy2（Pzlx Pzy2）、pzlx_pzw1（Pzlx Pzw1）、pzlx_pzw2（Pzlx Pzw2）、pzlx_jz（Pzlx Jz） |
| dw_xjll_xm | 数据窗口 |  | 1851,1580 960×420 | 数据窗口 `dw_ini_xjll_xm`（表 xjll_xm）；列：xjbm（Xjbm）、xjmc（Xjmc）、jd（Jd） |
| dw_xt | 数据窗口 |  | 1865,1324 960×420 | 数据窗口 `dw_ini_xt`（表 xt）；列：mc（Mc）、nr（Nr） |
| gb_1 | 分组框 | 初始化选项（选中表示将要删除） | 46,32 1897×884 |  |
| gb_2 | 分组框 |  | 183,420 1367×132 |  |
| st_1 | 静态文本 | 表，现有报表将被删除） | 201,640 1312×76 |  |
| st_2 | 静态文本 | 科目将被删除） | 183,380 430×60 |  |

- 窗口事件/函数：
  - `open`：读写表 fbgl
  - `wf_ini`：读写表 bbml、bbml_gs、bbml_pos、jzlx、kmbm、pzlx、xjll_xm、xt

- 提示与校验（8 条）：
  - [窗口事件 wf_ini]「档案文件错误：报表文件不存在！」（条件：`fileexists(ls_filename) = false`）
  - [cb_1.clicked]「此套账为主套账，初始化后的科目体系将影响所有分套账，可能导致所有分套账都需要初始化。~r               是否执行？」（条件：`lx = "0" and tz_dm = "ZW00"`）
  - [cb_1.clicked]「系统初始化将删除本套账现有的所有凭证，是否进行？」（条件：`isnull(rtn) or rtn > 0`）
  - [cb_1.clicked]「确认要执行系统初始化吗？」（条件：`messagebox("再次确认","系统初始化将删除本套账现有的所有凭证，是否进行？",question!,yesno!,2) = 2`）
  - [cb_1.clicked]「建立行业会计科目失败！」（条件：`rtn = -1`）
  - [cb_1.clicked]「建立行业会计报表失败！」（条件：`rtn = -2`）
  - [cb_1.clicked]「系统初始化完毕！」
  - [cb_2.clicked]「您确认要放弃系统初始化吗？」

### w_xt_kgzb_3 — 一键初始

- 类型：模态对话框；尺寸：2011×1340 PBU；库：rhzw8_9.pbd（账务主程序）
- 打开入口：`w_xt_kgzb_0` 的 cb_1.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 执行 | 1211,1136 370×88 | clicked → `w_acini_wizard`「期初建账操作向导」；clicked 读写表 bmnc、dba、dlxx、dwnc、fbgl、grnc、hz、jslb、jzlx、kmbm、nc、pz、pzdj、pzlx、wlhz、wlxx、xmnc、xt |
| cb_2 | 按钮 | 取消 | 1691,1136 247×88 |  |
| cb_3 | 按钮 | <---上一步 | 827,1136 370×88 | clicked → `w_xt_kgzb_0`「系统初始化--向导选择」 |
| cbx_1 | 复选框 | 需要进行现金流量核算 | 1074,900 690×80 |  |
| ddlb_hy | 下拉列表 |  | 494,308 1330×1344 |  |
| dw_bbml | 数据窗口 |  | 434,1340 960×420 | 数据窗口 `dw_ini_bbml`（表 bbml）；列：xh（Xh）、bbname（Bbname）、row（Row）、col（Col）、bz1（Bz1）、bz2（Bz2） |
| dw_bbml_gs | 数据窗口 |  | 82,1316 960×420 | 数据窗口 `dw_ini_bbml_gs`（表 bbml_gs）；列：xh（Xh）、bbname（Bbname）、row（Row）、col（Col）、t1（T1）、t2（T2）、t3（T3）、t4（T4）、bz1（Bz1）、bz2（Bz2） |
| dw_bbml_pos | 数据窗口 |  | 430,1352 960×420 | 数据窗口 `dw_ini_bbml_pos`（表 bbml_pos）；列：xh（Xh）、bbname（Bbname）、row（Row）、col（Col）、t1（T1）、t2（T2）、t3（T3）、t4（T4）、t5（T5）、s1（S1）、s2（S2）、s3（S3）、bz1（Bz1）、bz2（Bz2） |
| dw_jzlx | 数据窗口 |  | 238,1384 960×420 | 数据窗口 `dw_ini_jzlx`（表 jzlx）；列：jzlx（Jzlx）、pzlx（Pzlx）、xmlb（Xmlb）、jc（Jc）、zy（Zy）、zrkm（Zrkm）、zckm（Zckm）、bz0（Bz0）、bl0（Bl0） |
| dw_kmbm | 数据窗口 |  | 960,1412 960×420 | 数据窗口 `dw_ini_kmbm`（表 kmbm）；列：kmbm（Kmbm）、km_mc（Km Mc）、kmjs（Kmjs）、kmsx（Kmsx）、zhlb（Zhlb）、fbs（Fbs）、sls（Sls）、bz（Bz）、dw（Dw）、xms（Xms）、dws（Dws）、bms（Bms）、grs（Grs）、wls（Wls）、yjd（Yjd）、yefx（Yefx）、kmqc（Kmqc）、xmbm（Xmbm）、dwbm（Dwbm）、bmbm（Bmbm）、grbm（Grbm）、sybz（Sybz）、xjs（Xjs） |
| dw_pzlx | 数据窗口 |  | 1111,1484 960×420 | 数据窗口 `dw_ini_pzlx`（表 pzlx）；列：pzlx（Pzlx）、pzlx_jc（Pzlx Jc）、pzlx_qc（Pzlx Qc）、pzlx_jfy1（Pzlx Jfy1）、pzlx_jfy2（Pzlx Jfy2）、pzlx_dfy1（Pzlx Dfy1）、pzlx_dfy2（Pzlx Dfy2）、pzlx_pzy1（Pzlx Pzy1）、pzlx_pzy2（Pzlx Pzy2）、pzlx_pzw1（Pzlx Pzw1）、pzlx_pzw2（Pzlx Pzw2）、pzlx_jz（Pzlx Jz） |
| dw_xjll_xm | 数据窗口 |  | 1851,1580 960×420 | 数据窗口 `dw_ini_xjll_xm`（表 xjll_xm）；列：xjbm（Xjbm）、xjmc（Xjmc）、jd（Jd） |
| dw_xt | 数据窗口 |  | 1865,1324 960×420 | 数据窗口 `dw_ini_xt`（表 xt）；列：mc（Mc）、nr（Nr） |
| em_kzrq | 格式输入 |  | 494,768 416×92 |  |
| gb_1 | 分组框 | 一键初始设置 | 55,36 1897×1076 |  |
| lb_1 | 列表框 |  | 1454,1340 224×80 |  |
| sle_bwb | 单行输入 |  | 489,888 361×88 |  |
| sle_sydw | 单行输入 |  | 494,560 1330×88 |  |
| sle_tzname | 单行输入 |  | 494,120 1330×88 |  |
| st_1 | 静态文本 | 使用单位： | 165,572 329×76 |  |
| st_10 | 静态文本 | 本位币： | 229,900 251×68 |  |
| st_2 | 静态文本 | 套账名称： | 165,136 329×76 |  |
| st_3 | 静态文本 | 建账日期： | 165,784 329×76 |  |
| st_4 | 静态文本 | 会计准则： | 165,320 329×76 |  |
| st_5 | 静态文本 | （在登录系统时所显示的套账名称） | 462,232 1083×76 |  |
| st_6 | 静态文本 | （根据您所选的会计准则，系统将自动建立该准则所预置的会计 | 288,396 1600×76 |  |
| st_7 | 静态文本 | （在凭证、账册、报表等打印输出时显示该名称） | 462,676 1335×76 |  |
| st_8 | 静态文本 | （本套账的建账时间） | 1006,784 608×76 |  |
| st_9 | 静态文本 | 科目及相应报表，如果您不清楚如何选择，请咨询当地税务局） | 347,468 1577×76 |  |

- 窗口事件/函数：
  - `wf_ini`：读写表 bbml、bbml_gs、jzlx、kmbm、pzlx、xjll_xm、xt

- 提示与校验（14 条）：
  - [窗口事件 wf_ini]「档案文件错误：报表文件不存在！」（条件：`fileexists(ls_filename) = false`）
  - [cb_1.clicked]「套账名称不得为空，请检查！」（条件：`isnull(xx) or xx = ""`）
  - [cb_1.clicked]「使用单位名称不得为空，请检查！」（条件：`isnull(xx) or xx = ""`）
  - [cb_1.clicked]「您的建账日期可能过小，请检查！」（条件：`date(parent.em_kzrq.text) < date("1949-01-01")`）
  - [cb_1.clicked]「您必须选择一种会计制度，请检查！」（条件：`isnull(xx) or xx = ""`）
  - [cb_1.clicked]「您选择的会计准则是 [用户自定义会计准则] ~r这样系统将不会自动生成任何会计科目~r系统已经预设了各个行业的会计准则，最好选择一下 ~r ~r确认不需要系统的预置会计科目吗？」（条件：`xx = "99"`）
  - [cb_1.clicked]「此套账为主套账，初始化后的科目体系将影响所有分套账，可能导致所有分套账都需要初始化。~r               是否执行？」（条件：`lx = "0" and tz_dm = "ZW00"`）
  - [cb_1.clicked]「系统初始化将删除本套账现有的所有凭证并重建会计科目及报表 	请确认是否进行？」（条件：`isnull(rtn) or rtn > 0`）
  - [cb_1.clicked]「系统初始化将重建会计科目及报表，现有的会计科目及报表将被删除 	请确认是否进行？」（条件：`rtn > 0`）
  - [cb_1.clicked]「确认要执行系统初始化吗？」（条件：`messagebox(xt_ts,"系统初始化将重建会计科目及报表，现有的会计科目及报表将被删除~r~n~t请确认是否进行？",stopsign!,yesno!,2) <> 1`）
  - [cb_1.clicked]「建立行业会计科目失败！」（条件：`rtn = -1`）
  - [cb_1.clicked]「建立行业会计报表失败！」（条件：`rtn = -2`）
  - [cb_1.clicked]「系统初始化完毕！」
  - [cb_2.clicked]「您确认要放弃系统初始化吗？」

### w_xt_kgzb_a1 — 系统初始化--套账名称

- 类型：模态对话框；尺寸：2016×1208 PBU；库：rhzw8_9.pbd（账务主程序）
- 打开入口：`w_xt_kgzb_0` 的 cb_1.clicked；`w_xt_kgzb_a2` 的 cb_3.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 下一步----> | 1184,940 366×88 | clicked → `w_xt_kgzb_a2`「系统初始化--行业选择」 |
| cb_2 | 按钮 | 取消 | 1669,940 247×88 |  |
| p_1 | 图片 | rh_zt1.bmp | 41,88 471×868 |  |
| sle_1 | 单行输入 |  | 937,296 809×92 |  |
| sle_2 | 单行输入 |  | 933,636 827×92 |  |
| st_1 | 静态文本 | 请输入套账名称： | 594,164 494×76 |  |
| st_2 | 静态文本 | 使用单位: | 594,492 343×76 |  |

- 提示与校验（1 条）：
  - [cb_2.clicked]「是否退出系统初始化的进程？」

### w_xt_kgzb_a2 — 系统初始化--行业选择

- 类型：模态对话框；尺寸：2254×1164 PBU；库：rhzw8_9.pbd（账务主程序）
- 打开入口：`w_xt_kgzb_a1` 的 cb_1.clicked；`w_xt_kgzb_a3` 的 cb_3.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 下一步----> | 1211,940 366×88 | clicked → `w_xt_kgzb_a3`「系统初始化--科目设定」 |
| cb_2 | 按钮 | 取消 | 1691,940 247×88 |  |
| cb_3 | 按钮 | <----上一步 | 827,940 366×88 | clicked → `w_xt_kgzb_a1`「系统初始化--套账名称」 |
| ddlb_hy | 下拉列表 |  | 681,248 1138×1260 |  |
| lb_1 | 列表框 |  | 14,1172 494×360 |  |
| p_1 | 图片 | rh_zt2.bmp | 55,52 475×976 |  |
| st_2 | 静态文本 | 请选择本单位所属会计准则的类别： | 603,108 1083×76 |  |
| st_6 | 静态文本 | （根据您所选的会计准则，系统将自动建立该准则所预置的会计 | 567,408 1600×76 |  |
| st_9 | 静态文本 | 科目及相应报表，如果您不清楚如何选择，请咨询当地税务局） | 626,480 1577×76 |  |

- 提示与校验（3 条）：
  - [cb_1.clicked]「您必须选择一种会计制度，请检查！」（条件：`isnull(xx) or xx = ""`）
  - [cb_1.clicked]「您选择的会计准则是 [用户自定义会计准则] ~r这样系统将不会自动生成任何会计科目~r系统已经预设了各个行业的会计准则，最好选择一下 ~r ~r确认不需要系统的预置会计科目吗？」（条件：`xx = "99"`）
  - [cb_2.clicked]「是否退出系统初始化的进程？」

### w_xt_kgzb_a3 — 系统初始化--科目设定

- 类型：模态对话框；尺寸：2016×1208 PBU；库：rhzw8_9.pbd（账务主程序）
- 打开入口：`w_xt_kgzb_a2` 的 cb_1.clicked；`w_xt_kgzb_a4` 的 cb_3.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 下一步----> | 1211,940 366×88 | clicked → `w_xt_kgzb_a4`「系统初始化--外币设定」 |
| cb_2 | 按钮 | 取消 | 1691,940 247×88 |  |
| cb_3 | 按钮 | <----上一步 | 827,940 366×88 | clicked → `w_xt_kgzb_a2`「系统初始化--行业选择」 |
| em_1 | 格式输入 | 0 | 951,532 91×100 |  |
| em_2 | 格式输入 | 0 | 1061,532 91×100 |  |
| em_3 | 格式输入 | 0 | 1170,532 91×100 |  |
| em_4 | 格式输入 | 0 | 1280,532 91×100 |  |
| em_5 | 格式输入 | 0 | 1390,532 91×100 |  |
| em_6 | 格式输入 | 0 | 1499,532 91×100 |  |
| em_7 | 格式输入 | 0 | 1609,532 91×100 |  |
| em_8 | 格式输入 | 0 | 1719,532 91×100 |  |
| em_9 | 格式输入 | 0 | 1829,532 91×100 |  |
| em_kmcd | 格式输入 | 0 | 841,532 91×100 |  |
| em_kmjs | 格式输入 |  | 1399,116 187×100 |  |
| p_1 | 图片 | rh_zt3.bmp | 55,52 475×976 |  |
| st_1 | 静态文本 | (最多6级) | 1033,244 448×76 |  |
| st_2 | 静态文本 | 请设定本套账的科目级数： | 649,140 727×76 |  |
| st_21 | 静态文本 | (每级相加的总长度最多20位) | 763,672 891×76 |  |
| st_3 | 静态文本 | 请设定每级的长度： | 704,432 549×76 |  |

- 提示与校验（4 条）：
  - [cb_1.clicked]「请设定科目级数！」（条件：`kmjs < 1`）
  - [cb_1.clicked]「第级科目长度不得为空！」（条件：`isnull(ln[i]) or ln[i] = 0`）
  - [cb_1.clicked]「科目长度合计不能超过位字符！」（条件：`seg[i] > xt_km_cd`）
  - [cb_2.clicked]「是否退出系统初始化的进程？」

### w_xt_kgzb_a4 — 系统初始化--外币设定

- 类型：模态对话框；尺寸：2016×1192 PBU；库：rhzw8_9.pbd（账务主程序）
- 打开入口：`w_xt_kgzb_a3` 的 cb_1.clicked；`w_xt_kgzb_a5` 的 cb_3.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 下一步----> | 1211,940 366×88 | clicked → `w_xt_kgzb_a5`「系统初始化--开账日期选择」 |
| cb_2 | 按钮 | 取消 | 1691,940 247×88 |  |
| cb_3 | 按钮 | <----上一步 | 827,940 366×88 | clicked → `w_xt_kgzb_a3`「系统初始化--科目设定」 |
| cbx_1 | 复选框 | 需要进行现金流量核算 | 869,524 690×80 |  |
| ddlb_syff | 下拉列表 |  | 1353,1132 352×332 |  |
| p_1 | 图片 | rh_zt4.bmp | 55,52 475×976 |  |
| sle_bwb | 单行输入 |  | 1294,204 334×88 |  |
| st_7 | 静态文本 | 请选择本位币： | 846,212 425×84 |  |
| st_9 | 静态文本 | 请设定汇兑损益方法： | 722,1152 608×96 |  |

- 提示与校验（1 条）：
  - [cb_2.clicked]「是否退出系统初始化的进程？」

### w_xt_kgzb_a5 — 系统初始化--开账日期选择

- 类型：模态对话框；尺寸：2066×1192 PBU；库：rhzw8_9.pbd（账务主程序）
- 打开入口：`w_xt_kgzb_1` 的 cb_3.clicked；`w_xt_kgzb_a4` 的 cb_1.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 下一步----> | 1211,940 366×88 | clicked → `w_xt_kgzb_1`「系统初始化--信息确认」 |
| cb_2 | 按钮 | 取消 | 1691,940 247×88 |  |
| cb_3 | 按钮 | <----上一步 | 827,936 366×88 | clicked → `w_xt_kgzb_a4`「系统初始化--外币设定」 |
| em_kjqj | 格式输入 |  | 1152,500 183×88 |  |
| em_kzrq | 格式输入 |  | 1152,224 416×92 |  |
| p_1 | 图片 | rh_zt5.bmp | 55,52 475×976 |  |
| st_1 | 静态文本 | 温馨提示： | 667,676 453×96 |  |
| st_10 | 静态文本 | 会计期间从： | 745,516 389×72 |  |
| st_11 | 静态文本 | 月到 | 1344,516 165×76 |  |
| st_2 | 静态文本 | 我国规定的会计期间都是从1月到12月！ | 667,792 1330×80 |  |
| st_6 | 静态文本 | 开账日期： | 791,240 343×84 |  |

- 提示与校验（2 条）：
  - [cb_1.clicked]「我国规定的会计期间都是从1月到12月！~r您确定要将会计期间从月开始吗？」（条件：`integer(xx) = 1`）
  - [cb_2.clicked]「是否退出系统初始化的进程？」

### w_xt_kmbm_edit — 修改科目编码

- 类型：模态对话框；尺寸：2011×1088 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_xt_kmbmchange` 的 pb_1.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| gb_1 | 分组框 | 请输入要修改的科目编码 | 55,32 1883×412 |  |
| gb_2 | 分组框 | 请输入目标科目编码 | 55,476 1883×324 |  |
| pb_1 | 图片按钮 | 修改 | 498,836 352×108 | clicked 读写表 kmbm、nc、sys |
| pb_2 | 图片按钮 | 关闭 | 1161,836 352×108 |  |
| sle_1 | 单行输入 |  | 443,112 1010×88 | modified 读写表 kmbm |
| sle_3 | 单行输入 |  | 443,656 1010×88 |  |
| st_1 | 静态文本 | 科目编码： | 146,124 338×80 |  |
| st_2 | 静态文本 | 科目名称： | 146,228 338×80 |  |
| st_3 | 静态文本 | 科目编码修改为： | 146,568 599×80 |  |

- 提示与校验（10 条）：
  - [pb_1.clicked]「请注意，如果您使用的是网络版，进行该操作 时请将其他客户端的财务软件都退出，确保只 有本机在运行财务软件后再操作！ 	 要进行操作吗？」
  - [pb_1.clicked]「请输入要修改的科目编码！」（条件：`isnull(o_km) or o_km = ""`）
  - [pb_1.clicked]「请输入要修改的目标科目编码！」（条件：`isnull(n_km) or n_km = ""`）
  - [pb_1.clicked]「原科目和目标科目编码相同，不能修改！」（条件：`o_km = n_km`）
  - [pb_1.clicked]「原科目和目标科目编码长度不相同，不能修改！」（条件：`len(o_km) <> len(n_km)`）
  - [pb_1.clicked]「要修改的科目编码不存在，请检查！」（条件：`i = 0`）
  - [pb_1.clicked]「目标科目编码已经存在，请检查！」（条件：`i <> 0`）
  - [pb_1.clicked]「科目编码修改失败，原因如下：」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码修改成功，是否继续修改其他科目？」
  - [sle_1.modified]「您输入的科目编码不存在，请检查！」（条件：`i = 0`）

### w_xt_kmbm_edit_bak — 修改科目编码

- 类型：模态对话框；尺寸：2011×1088 PBU；库：rhzw8_5.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| gb_1 | 分组框 | 请输入要修改的科目编码 | 55,32 1883×412 |  |
| gb_2 | 分组框 | 请输入目标科目编码 | 55,476 1883×324 |  |
| pb_1 | 图片按钮 | 修改 | 498,836 352×108 | clicked 读写表 bmnc、dwnc、fbgl、grnc、hz、jzlx、kmbm、nc、pz、xmnc、yhdzd |
| pb_2 | 图片按钮 | 关闭 | 1161,836 352×108 |  |
| sle_1 | 单行输入 |  | 443,112 1010×88 | modified 读写表 kmbm |
| sle_3 | 单行输入 |  | 443,656 1010×88 |  |
| st_1 | 静态文本 | 科目编码： | 146,124 338×80 |  |
| st_2 | 静态文本 | 科目名称： | 146,228 338×80 |  |
| st_3 | 静态文本 | 科目编码修改为： | 146,568 599×80 |  |

- 提示与校验（20 条）：
  - [pb_1.clicked]「请注意，如果您使用的是网络版，进行该操作 时请将其他客户端的财务软件都退出，确保只 有本机在运行财务软件后再操作！ 	 要进行操作吗？」
  - [pb_1.clicked]「请输入要修改的科目编码！」（条件：`isnull(o_km) or o_km = ""`）
  - [pb_1.clicked]「请输入要修改的目标科目编码！」（条件：`isnull(n_km) or n_km = ""`）
  - [pb_1.clicked]「原科目和目标科目编码相同，不能修改！」（条件：`o_km = n_km`）
  - [pb_1.clicked]「原科目和目标科目编码长度不相同，不能修改！」（条件：`len(o_km) <> len(n_km)`）
  - [pb_1.clicked]「要修改的科目编码不存在，请检查！」（条件：`i = 0`）
  - [pb_1.clicked]「目标科目编码已经存在，请检查！」（条件：`i <> 0`）
  - [pb_1.clicked]「科目编码修改失败，原因如下：bmnc」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码修改失败，原因如下：dwnc」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码修改失败，原因如下：fbgl」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码修改失败，原因如下：grnc」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码修改失败，原因如下：hz」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码修改失败，原因如下：jzlx」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码修改失败，原因如下：nc」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码修改失败，原因如下：pz」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码修改失败，原因如下：xmnc」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码修改失败，原因如下：yhdzd」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码修改失败，原因如下：kmbm」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码修改成功，是否继续修改其他科目？」
  - [sle_1.modified]「您输入的科目编码不存在，请检查！」（条件：`i = 0`）

### w_xt_kmbm_get — 导入科目

- 类型：模态对话框；尺寸：1746×1468 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_xt_kmbmchange` 的 cb_get.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 取消 | 855,1060 361×112 |  |
| cb_2 | 按钮 | 确定 | 242,1060 361×112 | clicked 读写表 bmnc、dwnc、grnc、hg_da、hz、hzyeb、kmbm、nc、pz、xmnc、yhdzd、ysda、zc_sblb、zc_sbyt |
| cb_3 | 按钮 | 查找... | 1445,240 178×80 |  |
| cbx_1 | 复选框 | 导入时旧科目全部清除 | 453,380 640×80 |  |
| dw_1 | 数据窗口 |  | 1792,168 1248×768 | 数据窗口 `dw_xt_km_prt`（表 kmbm）；列：kmbm（科目编码）、km_mc（科目名称）、kmjs（级数）、zhlb（银行）、fbs（复币）、bz（币种）、sls（数量）、xms（项目）、dws（客户）、bms（部门）、grs（个人）、wls（往来）、yjd（分类）、yefx（余额方向）、kmqc、dw、kmsx、xjs（现金流量） |
| sle_1 | 单行输入 |  | 160,236 1275×96 |  |
| st_1 | 静态文本 | 说明： 1） 导入科目文件的格式为 TXT 或者 DBF 格式， | 151,532 1371×80 |  |
| st_2 | 静态文本 | 格式参照【科目维护】-【另存】产生的文件 | 411,616 1070×80 |  |
| st_3 | 静态文本 | 2） 转入科目后，年初数需要重新录入 | 334,712 1120×80 |  |
| st_4 | 静态文本 | 3） 您的操作涉及到的科目已经在报表中的公式 | 334,808 1326×80 |  |
| st_5 | 静态文本 | 中使用过的，请修改报表中的对应公式。 | 416,892 1138×80 |  |
| st_50 | 静态文本 | 请输入需要导入的科目文件名： | 50,108 777×92 |  |

- 提示与校验（7 条）：
  - [cb_2.clicked]「请输入需要引入的科目文件！」（条件：`parent.sle_1.text = "" or isnull(parent.sle_1.text = "")`）
  - [cb_2.clicked]「路径文件不存在或读入错！」（条件：`filehand = -1`）
  - [cb_2.clicked]「没有读入到数据！~r 请检查科目文件的格式是否正确！」（条件：`r = 0`）
  - [cb_2.clicked]「科目编码库无数据！」（条件：`l3 = 0`）
  - [cb_2.clicked]「长度不符合规定！」（条件：`i > xt_len0`）
  - [cb_2.clicked]「上级科目不存在！」（条件：`l1 = 0`）
  - [cb_3.clicked]「文件不存在！」（条件：`i <> 1`）

### w_xt_kmbm_len — 修改科目编码长度

- 类型：模态对话框；尺寸：1915×1020 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_xt_kmbmchange` 的 pb_2.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| em_6 | 格式输入 | 2 | 325,452 174×84 |  |
| em_7 | 格式输入 | 1 | 1001,452 174×84 |  |
| em_kmcd | 格式输入 | 0 | 1056,136 658×88 |  |
| em_kmjs | 格式输入 | 6 | 421,136 110×88 |  |
| gb_1 | 分组框 | 当前科目级数及长度 | 50,40 1765×260 |  |
| gb_2 | 分组框 | 科目编码调整(各级科目相加总长度不得超过20) | 50,356 1765×364 |  |
| pb_1 | 图片按钮 | 修改 | 393,768 352×104 | clicked 读写表 sys、xt |
| pb_2 | 图片按钮 | 关闭 | 1056,768 352×104 |  |
| pb_3 | 图片按钮 | 缩减 | 343,1032 352×104 | clicked 读写表 sys |
| pb_4 | 图片按钮 | 科目缩减 | 1481,772 352×104 | clicked 读写表 sys |
| rb_1 | 单选按钮 | 字符 | 722,1052 224×80 |  |
| rb_2 | 单选按钮 | 使用该级科目前#位 | 1051,1076 608×80 |  |
| sle_1 | 单行输入 | 000000 | 814,572 411×88 |  |
| st_1 | 静态文本 | 原有该级科目新增位置用 | 137,576 667×80 |  |
| st_2 | 静态文本 | 填充。 | 1243,580 201×72 |  |
| st_3 | 静态文本 | 将第        级科目长度增加至      位字符宽，同时将 | 146,464 1591×80 |  |
| st_31 | 静态文本 | 科目级数： | 105,152 311×60 |  |
| st_4 | 静态文本 | 各级科目长度： | 631,152 430×60 |  |

- 窗口事件/函数：
  - `wf_kmjs`：读写表 kmbm

- 提示与校验（15 条）：
  - [窗口事件 open]「此版本不能变更科目长度！」（条件：`tz_lx = "zgkj_jt"`）
  - [em_6.modified]「请先增加第级」（条件：`ilevel > (parent.i_kmjs + 1)`）
  - [pb_1.clicked]「请注意，如果您使用的是网络版，进行该操作 时请将其他客户端的财务软件都退出，确保只 有本机在运行财务软件后再操作！ 	 要进行操作吗？」
  - [pb_1.clicked]「无法识别正确的科目级数！」（条件：`isnull(i) or i = 0`）
  - [pb_1.clicked]「请输入要修改的科目级数！」（条件：`isnull(ilevel) or ilevel = 0`）
  - [pb_1.clicked]「科目级数必须在1至范围内！」（条件：`ilevel < 1 or ilevel > xt_len0`）
  - [pb_1.clicked]「科目级数长度不能跨级调整！」（条件：`(ilevel - i) > 1`）
  - [pb_1.clicked]「请输入要增加至的位数！」（条件：`isnull(add_len) or add_len = 0`）
  - [pb_1.clicked]「科目总长度只能增加至位，请检查！」（条件：`(xt_seg[xt_len0] + add_len) > xt_km_cd`）
  - [pb_1.clicked]「科目长度只能增加，您输入的增加至的位数不正确！」（条件：`add_len < 1`）
  - [pb_1.clicked]「科目填充字符串长度不够！」（条件：`len(addstr) < add_len`）
  - [pb_1.clicked]「增加的长度大于该级科目的原始长度，无法使用该科目的前位字符填充科目编码！」（条件：`add_len > km_len`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：xt」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更成功，是否继续增加？」

### w_xt_kmbm_len_bak — 修改科目编码长度

- 类型：模态对话框；尺寸：1915×1072 PBU；库：rhzw8_5.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| em_6 | 格式输入 | 2 | 325,412 174×84 |  |
| em_7 | 格式输入 | 1 | 1001,412 174×84 |  |
| em_kmcd | 格式输入 | 0 | 1056,136 658×88 |  |
| em_kmjs | 格式输入 | 6 | 421,136 110×88 |  |
| gb_1 | 分组框 | 当前科目级数及长度 | 50,40 1765×260 |  |
| gb_2 | 分组框 | 科目编码调整(各级科目相加总长度不得超过20) | 50,332 1765×472 |  |
| gb_3 | 分组框 |  | 814,508 695×260 |  |
| pb_1 | 图片按钮 | 修改 | 393,836 352×108 | clicked 读写表 bmnc、cn_hz、cn_mx、cn_nc、dwnc、fbgl、grnc、hz、jzlx、kmbm、nc、pz、xmnc、xt、yhdzd |
| pb_2 | 图片按钮 | 关闭 | 1056,836 352×108 |  |
| rb_1 | 单选按钮 | 字符 | 846,564 224×80 |  |
| rb_2 | 单选按钮 | 使用该级科目前#位 | 841,668 608×80 |  |
| sle_1 | 单行输入 | 000000 | 1074,560 411×88 |  |
| st_1 | 静态文本 | 原有该级科目新增位置用 | 137,632 667×80 |  |
| st_2 | 静态文本 | 填充。 | 1509,632 201×72 |  |
| st_3 | 静态文本 | 将第：      级科目长度增加至      位字符宽，同时将 | 146,424 1527×80 |  |
| st_31 | 静态文本 | 科目级数： | 105,152 311×60 |  |
| st_4 | 静态文本 | 各级科目长度： | 631,152 430×60 |  |

- 窗口事件/函数：
  - `wf_kmjs`：读写表 kmbm

- 提示与校验（27 条）：
  - [em_6.modified]「请先增加第级」（条件：`ilevel > (parent.i_kmjs + 1)`）
  - [pb_1.clicked]「请注意，如果您使用的是网络版，进行该操作 时请将其他客户端的财务软件都退出，确保只 有本机在运行财务软件后再操作！ 	 要进行操作吗？」
  - [pb_1.clicked]「无法识别正确的科目级数！」（条件：`isnull(i) or i = 0`）
  - [pb_1.clicked]「请输入要修改的科目级数！」（条件：`isnull(ilevel) or ilevel = 0`）
  - [pb_1.clicked]「科目级数必须在1至范围内！」（条件：`ilevel < 1 or ilevel > xt_len0`）
  - [pb_1.clicked]「科目级数长度不能跨级调整！」（条件：`(ilevel - i) > 1`）
  - [pb_1.clicked]「请输入要增加至的位数！」（条件：`isnull(add_len) or add_len = 0`）
  - [pb_1.clicked]「科目总长度只能增加至位，请检查！」（条件：`(xt_seg[xt_len0] + add_len) > xt_km_cd`）
  - [pb_1.clicked]「科目长度只能增加，您输入的增加至的位数不正确！」（条件：`add_len < 1`）
  - [pb_1.clicked]「科目填充字符串长度不够！」（条件：`len(addstr) < add_len`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：bmnc」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：dwnc」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：fbgl」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：grnc」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：hz」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：jzlx」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：nc」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：pz」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：xmnc」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：yhdzd」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：cn_nc」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：cn_hz」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：cn_mx」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：kmbm」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「增加的长度大于该级科目的原始长度，无法使用该科目的前位字符填充科目编码！」（条件：`add_len > km_len`）
  - [pb_1.clicked]「科目编码长度变更失败，原因如下：xt」（条件：`sqlca.sqlcode <> 0`）
  - [pb_1.clicked]「科目编码长度变更成功，是否继续增加？」

### w_xt_kmbm_replace — 科目编码字符替换

- 类型：模态对话框；尺寸：1399×596 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_xt_kmbmchange` 的 cb_1.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 替换 | 1042,268 274×88 |  |
| cb_2 | 按钮 | 取消 | 1042,364 274×88 |  |
| em_1 | 格式输入 |  | 521,144 210×88 |  |
| em_2 | 格式输入 |  | 521,284 210×88 |  |
| gb_1 | 分组框 | 替换科目编码中的单个字符 | 41,36 946×436 |  |
| st_1 | 静态文本 | 查找字符： | 192,152 311×76 |  |
| st_2 | 静态文本 | 替换为： | 251,292 251×76 |  |

- 窗口事件/函数：
  - `wf_kmbm_replace`：读写表 kmbm、sys

- 提示与校验（13 条）：
  - [窗口事件 wf_kmbm_replace]「请输入要修改的科目编码！」（条件：`isnull(o_km) or o_km = ""`）
  - [窗口事件 wf_kmbm_replace]「请输入要修改的目标科目编码！」（条件：`isnull(n_km) or n_km = ""`）
  - [窗口事件 wf_kmbm_replace]「原科目和目标科目编码相同，不能修改！」（条件：`o_km = n_km`）
  - [窗口事件 wf_kmbm_replace]「原科目和目标科目编码长度不相同，不能修改！」（条件：`len(o_km) <> len(n_km)`）
  - [窗口事件 wf_kmbm_replace]「要修改的科目编码不存在，请检查！」（条件：`i = 0`）
  - [窗口事件 wf_kmbm_replace]「目标科目编码已经存在，请检查！」（条件：`i <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：」（条件：`sqlca.sqlcode <> 0`）
  - [cb_1.clicked]「请注意，如果您使用的是网络版，进行该操作 时请将其他客户端的财务软件都退出，确保只 有本机在运行财务软件后再操作！ 	 要进行操作吗？」
  - [cb_1.clicked]「请输入要查找的字符！」（条件：`isnull(o_km) or o_km = ""`）
  - [cb_1.clicked]「请输入要替换的字符！」（条件：`isnull(n_km) or n_km = ""`）
  - [cb_1.clicked]「查找字符和替换字符相同！」（条件：`o_km = n_km`）
  - [cb_1.clicked]「查找字符和替换字符长度不相同！」（条件：`len(o_km) <> len(n_km)`）
  - [cb_1.clicked]「替换完成！」（条件：`ls_old_km <> ls_new_km`）

### w_xt_kmbm_replace_bak — 科目编码字符替换

- 类型：模态对话框；尺寸：1399×596 PBU；库：rhzw8_5.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 替换 | 1042,268 274×88 |  |
| cb_2 | 按钮 | 取消 | 1042,364 274×88 |  |
| em_1 | 格式输入 |  | 521,144 210×88 |  |
| em_2 | 格式输入 |  | 521,284 210×88 |  |
| gb_1 | 分组框 | 替换科目编码中的单个字符 | 41,36 946×436 |  |
| st_1 | 静态文本 | 查找字符： | 192,152 311×76 |  |
| st_2 | 静态文本 | 替换为： | 251,292 251×76 |  |

- 窗口事件/函数：
  - `wf_kmbm_replace`：读写表 bmnc、cn_hz、cn_mx、cn_nc、dwnc、fbgl、grnc、hz、jzlx、kmbm、nc、pz、xmnc、yhdzd

- 提示与校验（26 条）：
  - [窗口事件 wf_kmbm_replace]「请输入要修改的科目编码！」（条件：`isnull(o_km) or o_km = ""`）
  - [窗口事件 wf_kmbm_replace]「请输入要修改的目标科目编码！」（条件：`isnull(n_km) or n_km = ""`）
  - [窗口事件 wf_kmbm_replace]「原科目和目标科目编码相同，不能修改！」（条件：`o_km = n_km`）
  - [窗口事件 wf_kmbm_replace]「原科目和目标科目编码长度不相同，不能修改！」（条件：`len(o_km) <> len(n_km)`）
  - [窗口事件 wf_kmbm_replace]「要修改的科目编码不存在，请检查！」（条件：`i = 0`）
  - [窗口事件 wf_kmbm_replace]「目标科目编码已经存在，请检查！」（条件：`i <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：bmnc」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：dwnc」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：fbgl」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：grnc」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：hz」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：jzlx」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：nc」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：pz」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：xmnc」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：yhdzd」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：cn_nc」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：cn_mx」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：cn_hz」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 wf_kmbm_replace]「科目编码修改失败，原因如下：kmbm」（条件：`sqlca.sqlcode <> 0`）
  - [cb_1.clicked]「请注意，如果您使用的是网络版，进行该操作 时请将其他客户端的财务软件都退出，确保只 有本机在运行财务软件后再操作！ 	 要进行操作吗？」
  - [cb_1.clicked]「请输入要查找的字符！」（条件：`isnull(o_km) or o_km = ""`）
  - [cb_1.clicked]「请输入要替换的字符！」（条件：`isnull(n_km) or n_km = ""`）
  - [cb_1.clicked]「查找字符和替换字符相同！」（条件：`o_km = n_km`）
  - [cb_1.clicked]「查找字符和替换字符长度不相同！」（条件：`len(o_km) <> len(n_km)`）
  - [cb_1.clicked]「替换完成！」（条件：`ls_old_km <> ls_new_km`）

### w_xt_kmbmchange — 科目编码调整

- 类型：模态对话框；尺寸：2002×1260 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_xt_tz` 的 cb_5.clicked；`w_zh_zhjc` 的 cb_5.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 字符替换 | 1504,900 338×88 | clicked → `w_xt_kmbm_replace`「科目编码字符替换」 |
| cb_get | 按钮 | 导入科目 | 82,900 315×88 | clicked → `w_xt_kmbm_get`「导入科目」；clicked 读写表 pz |
| em_kmcd | 格式输入 | 0 | 1125,132 731×80 |  |
| em_kmjs | 格式输入 | 6 | 421,136 110×88 |  |
| gb_1 | 分组框 | 当前科目级数及长度 | 50,40 1870×260 |  |
| gb_2 | 分组框 | 重要说明 | 50,328 1870×712 |  |
| pb_1 | 图片按钮 | 修改科目编码... | 407,900 539×88 | clicked → `w_xt_kmbm_edit`「修改科目编码」 |
| pb_2 | 图片按钮 | 变更科目长度... | 955,900 539×88 | clicked → `w_xt_kmbm_len`「修改科目编码长度」 |
| pb_3 | 图片按钮 | 关闭 | 1518,1060 402×88 |  |
| st_1 | 静态文本 | 1、可以任意修改科目编码，但是目标编码如果已经存在不能修改。 | 123,404 1769×80 |  |
| st_2 | 静态文本 | 调整完科目编码后修改报表中的对应公式。 | 206,756 1143×80 |  |
| st_3 | 静态文本 | 科目级数： | 105,152 311×60 |  |
| st_4 | 静态文本 | 各级科目长度： | 699,152 430×60 |  |
| st_5 | 静态文本 | 2、变更科目长度时只能增加长度不能减少长度，操作前请作好数 | 123,508 1769×80 |  |
| st_6 | 静态文本 | 3、如果您的操作涉及到的科目已经在报表中的公式中使用，请在 | 123,680 1769×80 |  |
| st_7 | 静态文本 | 据备份。 | 215,576 251×80 |  |

- 窗口事件/函数：
  - `open`：读写表 pzdj

- 提示与校验（4 条）：
  - [窗口事件 open]「此版本不能变更科目！」（条件：`tz_lx = "zgkj_jt"`）
  - [cb_get.clicked]「您已经录入了凭证，不能再引入【科目】了！」（条件：`r > 1`）
  - [cb_get.clicked]「凭证引入成功！」（条件：`xt_cs2 = "1"`）
  - [cb_get.clicked]「凭证引入失败！」（条件：`xt_cs2 = "1"`）

### w_xt_kmwh — 科目维护

- 类型：模态对话框；尺寸：2601×1920 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 科目维护」（19 个菜单中）；菜单「O.操作 › 科目维护 F3」（2 个菜单中）；`w_acini_wizard` 的 cb_2.clicked；`w_main1` 的 st_3_km.clicked；`w_main1` 的 tab_1/tabpage_3/p_t_3_km.clicked；`w_pz_pzedit_b` 的 事件 u_pzxxbz；`w_pz_pzedit_bak` 的 事件 u_pzxxbz；`w_pz_pzedit_mb` 的 事件 u_pzxxbz；`w_pz_pzedit` 的 事件 u_pzxxbz；`w_xt_fbwh` 的 pb_1.clicked；`w_zc_fhdlz` 的 cb_3.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 打印 | 2295,1224 251×92 | clicked → `w_preview`「打印预览」 |
| cb_2 | 按钮 | 增加 | 2295,1328 251×92 | clicked → `w_xt_kmwh_1`「科目修改」 |
| cb_3 | 按钮 | 删除 | 2295,1436 251×92 | clicked 读写表 bmnc、cn_hz、cn_mx、cn_nc、dwnc、grnc、hz、jzlx、kmbm、nc、pz、xmnc |
| cb_4 | 按钮 | 修改 | 2295,1536 251×92 | clicked → `w_xt_kmwh_1`「科目修改」 |
| cb_5 | 按钮 | 确定 | 2295,1640 251×92 | clicked → `w_acini_wizard`「期初建账操作向导」；clicked 读写表 xt |
| cb_6 | 按钮 | 取消 | 2295,1880 233×92 | clicked → `w_acini_wizard`「期初建账操作向导」 |
| cb_7 | 按钮 | 另存 | 2295,1120 251×92 |  |
| cb_8 | 按钮 | 整理科目名称 | 2807,220 421×108 | clicked 读写表 kmbm |
| cb_9 | 按钮 | 搜索 | 1266,12 165×84 |  |
| cb_get | 按钮 | 导入科目 | 2295,1016 251×92 |  |
| cbx_xjll | 复选框 | 现金流量核算 | 1742,20 466×64 |  |
| dw_1 | 数据窗口 |  | 2889,1148 1303×160 | 数据窗口 `dw_xt_km_prt`（表 kmbm）；列：kmbm（科目编码）、km_mc（科目名称）、kmjs（级数）、zhlb（银行）、fbs（复币）、bz（币种）、sls（数量）、xms（项目）、dws（客户）、bms（部门）、grs（个人）、wls（往来）、yjd（分类）、yefx（余额方向）、kmqc、dw、kmsx、xjs（现金流量） |
| dw_2 | 数据窗口 |  | 2770,512 960×420 | 数据窗口 `dw_xt_km_help`（表 kmbm）；列：kmbm（科目编码）、km_mc（科目名称）、kmqc、fbs、sls、yefx |
| dw_3 | 数据窗口 | none | 2834,1324 686×400 | 数据窗口 `dw_kmbm_get`（表 kmbm）；列：kmbm（科目编码）、km_mc（科目名称）、yefx（余额方向）、kmjs、kmsx、zhlb（银行标志）、fbs（复币标志）、sls（数量标志）、bz（币种）、dw（单位）、xms（项目标志）、dws（客户标志）、bms（部门标志）、grs（人员标志）、wls（往来标志）、yjd、kmqc、xmbm（缺省项目编码）、dwbm（缺省客户编码）、bmbm（缺省部门编码）、grbm（缺省人员编码）、sybz（停用标志）、xjs（现金流量标志） |
| sle_1 | 单行输入 |  | 96,8 1161×88 |  |
| tv_1 | 树 |  | 23,116 2245×1656 | doubleclicked 读写表 kmbm |

- 窗口事件/函数：
  - `open`：读写表 dba、kmbm、xt

- 提示与校验（7 条）：
  - [cb_2.clicked]「是否还要继续增加科目？」
  - [cb_3.clicked]「本级科目只有一个，是否要删除它并且科目缩减一级？」（条件：`i = 2 and kmjs > 1`）
  - [cb_3.clicked]「年初数(含辅助核算)不为零,不允许删除!」（条件：`nc_jf <> 0 or nc_df <> 0 or jq_jf <> 0 or jq_df <> 0`）
  - [cb_3.clicked]「已有发生额,不允许删除!」（条件：`i > 0`）
  - [cb_3.clicked]「是否删除科目?」（条件：`i > 0`）
  - [cb_8.clicked]「科目全称整理完毕！」
  - [cb_9.clicked]「请输入查找条件!」（条件：`isnull(xx) or xx = ""`）

### w_xt_kmwh_1 — 科目修改

- 类型：模态对话框；尺寸：2213×1624 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_xt_kmwh` 的 cb_2.clicked；`w_xt_kmwh` 的 cb_4.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 768,1400 288×108 | clicked → `w_xt_kmwh_cfjc`「科目名称重复性检查」；clicked 读写表 bmnc、cn_hz、cn_mx、cn_nc、dwnc、fbgl、grnc、hz、jzlx、kmbm、nc、pz、xmnc |
| cb_2 | 按钮 | 取消 | 1321,1400 288×108 |  |
| ddlb_bz | 下拉列表 |  | 923,556 ×320 |  |
| dw_1 | 数据窗口 |  | 87,112 2039×1216 | 数据窗口 `dw_xt_kmwh_1`（表 kmbm）；列：kmbm（科目代码：）、km_mc（科目名称：）、kmjs（Kmjs:）、kmsx（Kmsx:）、zhlb、fbs、sls、bz（默认币种）、dw（计量单位）、xms、dws、bms、grs、wls、yjd（Yjd:）、yefx（余额方向：）、kmqc（Kmqc:）、xmbm（默认项目编码）、dwbm（默认客供编码）、bmbm（默认部门编码）、grbm（默认人员编码）、sybz、xjs、zjm；itemchanged 读写表 kmbm |
| gb_1 | 分组框 | 科目设置 | 50,16 2117×1344 |  |
| sle_dw | 单行输入 |  | 814,856 ×88 |  |

- 窗口事件/函数：
  - `open`：读写表 kmbm
  - `close`：读写表 kmbm
  - `wf_kmbm_add`：读写表 kmbm

- 提示与校验（15 条）：
  - [窗口事件 wf_kmbm_add]「本级科目已满，请增加本级科目位数！」（条件：`r > kmws`）
  - [cb_1.clicked]「此科目编码已经存在!  是否重新输入？」（条件：`i > 0`）
  - [cb_1.clicked]「科目编码长度不符合定义要求!您的科目编码规则是即第一级位,第二级位,以此类推    是否重新输入？」（条件：`kmjs = 0`）
  - [cb_1.clicked]「此科目的上级科目不存在!  是否重新输入？」（条件：`i = 0`）
  - [cb_1.clicked]「请确认此科目的余额方向是吗？」（条件：`kmjs = 1`）
  - [cb_1.clicked]「请再次确认此科目的余额方向是吗？」（条件：`xx = "借"`）
  - [cb_1.clicked]「此科目的余额方向和上级科目的不一致！~r请确认此科目的余额方向是吗？」（条件：`yefx <> xx2`）
  - [cb_1.clicked]「非资产和负债科目一般不能有复币属性!~r请确定是要修改此科目的复币属性？」（条件：`left(parent.kmbm,1) > "2"`）
  - [cb_1.clicked]「外币年初数不为零,不允许修改!」（条件：`nc_jf <> 0 or nc_df <> 0 or jq_jf <> 0 or jq_df <> 0`）
  - [cb_1.clicked]「已有外币发生额,不允许修改!」（条件：`i <> 0`）
  - [cb_1.clicked]「数量年初数不为零,不允许修改!」（条件：`nc_jf <> 0 or nc_df <> 0 or jq_jf <> 0 or jq_df <> 0`）
  - [cb_1.clicked]「已有数量发生额,不允许修改!」（条件：`i <> 0`）
  - [dw_1.itemchanged]「科目编码长度不符合定义要求!您的科目编码规则是即第一级位,第二级位,以此类推」（条件：`kmjs = 0`）
  - [dw_1.itemchanged]「此科目的上级科目不存在!」（条件：`i = 0`）
  - [dw_1.itemchanged]「只有库存现金、银行存款、其他货币资金科目才可以选择！」（条件：`pos(xx1,"现金") = 0 and pos(xx1,"银行") = 0 and pos(xx1,"货币资金") = 0`）

### w_xt_kmwh_cfjc — 科目名称重复性检查

- 类型：模态对话框；尺寸：3223×968 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_xt_kmwh_1` 的 cb_1.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 不允许 | 2578,20 261×104 |  |
| cb_4 | 按钮 | 允许 | 2213,20 261×104 |  |
| dw_1 | 数据窗口 |  | 14,164 3127×576 | 数据窗口 `dw_xt_km_help`（表 kmbm）；列：kmbm（科目编码）、km_mc（科目名称）、kmqc、fbs、sls、yefx |
| st_1 | 静态文本 | 提示：您录入的科目名称可能与下面科目的内容重复，请确定一下是否允许！ | 128,28 1874×80 |  |

- 提示与校验（2 条）：
  - [dw_1.dberror]「结算类别重复！是否重输？」（条件：`sqldbcode = -196`）
  - [dw_1.dberror]「数据窗口出错！」（条件：`i = 1`）

### w_xt_kmwh_copy — 从其他套帐转入科目

- 类型：模态对话框；尺寸：2002×1860 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_zh_zhjc` 的 cb_3.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_cancel | 按钮 | 取消 | 896,1604 315×100 |  |
| cb_ok | 按钮 | 确定 | 421,1604 315×100 | clicked 读写表 bmk、dwk、grk、gz_bmk、gz_gsk、gz_gzjg、gz_gzk、gz_yfkm、hz、kmbm、nc、pz、pzdj、xmk、xt、zc_gdzc、zc_sbbd、zc_sblb、zc_sbyt、zc_sbzt、zc_sydw、zc_yzjb |
| cbx_1 | 复选框 | 包括年初数 | 1019,152 379×72 |  |
| cbx_2 | 复选框 | 仅转入固定资产 | 933,908 498×72 |  |
| cbx_fz | 复选框 | 包括辅助档案 | 1019,36 453×72 |  |
| cbx_gz | 复选框 | 仅转入工资 | 1513,908 402×72 |  |
| cbx_pz | 复选框 | 转凭证 | 699,148 283×80 |  |
| dw_1 | 数据窗口 |  | 96,320 1778×532 | 数据窗口 `dw_xt_kmbm_copy`；列：n_kmbm（新科目）、n_kmmc（新科目名称）、o_kmmc |
| dw_kmbm | 数据窗口 |  | 352,840 1509×360 | 数据窗口 `dw_xt_km_help`（表 kmbm）；列：kmbm（科目编码）、km_mc（科目名称）、kmqc、fbs、sls、yefx |
| em_tz | 格式输入 |  | 750,24 247×84 |  |
| gb_2 | 分组框 | 新旧科目编码对照表： | 41,244 1883×652 |  |
| sle_1 | 单行输入 |  | 1669,136 256×84 |  |
| st_1 | 静态文本 | 要求： | 82,1188 210×52 |  |
| st_12 | 静态文本 | 请选择旧科目套帐代码： | 69,36 667×72 |  |
| st_2 | 静态文本 | 无法转换的科目都转换为系统最大的科目编码，以后自己修改 | 293,1484 1678×80 |  |
| st_3 | 静态文本 | 本模块用于将其他套帐的二级及以后的科目转入到本系统。 | 105,1020 1678×76 |  |
| st_4 | 静态文本 | 说明： | 82,924 247×60 |  |
| st_5 | 静态文本 | 1、二级及以后的科目长度一致； | 238,1240 1179×56 |  |
| st_6 | 静态文本 | 2、转入的一级科目没有录入二级科目； | 238,1320 1216×56 |  |
| st_7 | 静态文本 | 转入完毕后，必须进行综合检查 科目编码和年初数！ | 105,1096 1454×76 |  |
| st_8 | 静态文本 | 3、已经录入的凭证，系统将自动进行转换。 | 238,1400 1499×56 |  |
| st_9 | 静态文本 | 年份： | 1440,152 224×76 |  |

- 提示与校验（13 条）：
  - [cb_ok.clicked]「转入固定资产数据将删除本套帐原有数据！~r           是否进行(Y/N) ?」（条件：`parent.cbx_2.checked = true`）
  - [cb_ok.clicked]「~r 请进行固定资产的初始化！」（条件：`sqlca.sqlcode = -1`）
  - [cb_ok.clicked]「固定资产转入完毕」（条件：`sqlca.sqlcode = -1`）
  - [cb_ok.clicked]「转入工资数据将删除本套帐原有数据！~r           是否进行(Y/N) ?」（条件：`parent.cbx_gz.checked = true`）
  - [cb_ok.clicked]「工资系统转入完毕」（条件：`sqlca.sqlcode = -1`）
  - [cb_ok.clicked]「二级及以后的科目长度不对，不能转入！」（条件：`len2 <> xt_len2 or len3 <> xt_len3 or len4 <> xt_len4 or len5 <> xt_len5 or len6 <> xt_len6`）
  - [cb_ok.clicked]「您已经进行了过帐处理，不能再转入！」（条件：`r > 1`）
  - [cb_ok.clicked]「请确认选择的科目无误，如果错误，将无法恢复！」（条件：`r > 1`）
  - [cb_ok.clicked]「请再一次确认选择的科目无误，如果错误，将无法恢复！」（条件：`messagebox(xt_ts,"请确认选择的科目无误，如果错误，将无法恢复！",question!,yesno!,2) = 2`）
  - [cb_ok.clicked]「您已经录入了二级科目，不能再转入！」（条件：`r > 1`）
  - [cb_ok.clicked]「您已经录入了凭证，不能再转入！」（条件：`r > 1`）
  - [cb_ok.clicked]「对于没有对应科目的凭证,系统将使用科目：」（条件：`parent.cbx_pz.checked`）
  - [cb_ok.clicked]「您必须进行综合检查 科目编码和年初数！」（条件：`sqlca.sqlcode = -1`）

### w_xt_pass0 — 系统密码设定

- 类型：模态对话框；尺寸：1138×656 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_login_oem` 的 sle_password.key；`w_login` 的 sle_password.key

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 178,368 265×100 |  |
| cb_2 | 按钮 | 取消 | 649,368 265×100 |  |
| sle_zch | 单行输入 |  | 402,192 558×80 |  |
| st_2 | 静态文本 | 系统号： | 32,40 370×80 |  |
| st_3 | 静态文本 | 新密码： | 41,192 361×80 |  |

- 窗口事件/函数：
  - `wf_unlock`：读写表 dba

- 提示与校验（1 条）：
  - [cb_1.clicked]「新密码错误！」（条件：`mod(r1 * xt_kl_pass,10000) <> r2`）

### w_xt_ptb_xf — 温馨提示

- 类型：模态对话框；尺寸：1760×524 PBU；库：rhzw8_8.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 详情点击 | 402,280 329×92 |  |
| cb_2 | 按钮 | 取消 | 937,276 229×92 |  |

- 窗口事件/函数：
  - `wf_unlock`：读写表 dba

### w_xt_pup — 今日焦点

- 类型：弹出窗口；尺寸：2368×1792 PBU；库：rhzw8_9.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 1893,1572 279×92 |  |
| cbx_1 | 复选框 | 近期不再提示 | 1326,1576 539×80 |  |
| gb_1 | 分组框 |  | 5,124 1408×852 |  |
| gb_2 | 分组框 |  | 1403,124 891×852 |  |
| gb_3 | 分组框 |  | 5,936 1243×620 |  |
| gb_4 | 分组框 |  | 1239,936 567×620 |  |
| gb_5 | 分组框 |  | 1797,936 503×620 |  |
| p_1 | 图片 | xt_pop_2.bmp | 27,272 448×600 |  |
| p_2 | 图片 | xt_pop_1.bmp | 32,1068 471×388 |  |
| st_1 | 静态文本 | 热点问题解答： | 101,188 1129×80 |  |
| st_1_0 | 静态文本 | 更多... | 1065,864 238×80 |  |
| st_1_1 | 静态文本 | 1、加密锁损坏了如何退换？ | 494,276 901×80 |  |
| st_1_2 | 静态文本 | 1、加密锁损坏了如何退换？ | 494,376 901×80 |  |
| st_1_3 | 静态文本 | 1、加密锁损坏了如何退换？ | 494,476 901×80 |  |
| st_1_4 | 静态文本 | 1、加密锁损坏了如何退换？ | 494,576 901×80 |  |
| st_1_5 | 静态文本 | 1、加密锁损坏了如何退换？ | 494,676 901×80 |  |
| st_1_6 | 静态文本 | 1、加密锁损坏了如何退换？ | 494,776 901×80 |  |
| st_2 | 静态文本 | 通知公告： | 1486,184 745×80 |  |
| st_2_0 | 静态文本 | 更多... | 1961,864 238×80 |  |
| st_2_1 | 静态文本 | 1、加密锁损坏了如何退换？ | 1477,324 795×80 |  |
| st_2_2 | 静态文本 | 1、加密锁损坏了如何退换？ | 1477,492 795×80 |  |
| st_2_3 | 静态文本 | 1、加密锁损坏了如何退换？ | 1477,660 795×80 |  |
| st_3 | 静态文本 | 在线培训视频： | 101,984 955×80 |  |
| st_3_0 | 静态文本 | 更多... | 960,1456 238×80 |  |
| st_3_1 | 静态文本 | 1、加密锁损坏了如何退换？ | 576,1084 658×80 |  |
| st_3_2 | 静态文本 | 1、加密锁损坏了如何退换？ | 576,1172 658×80 |  |
| st_3_3 | 静态文本 | 1、加密锁损坏了如何退换？ | 576,1260 658×80 |  |
| st_3_4 | 静态文本 | 1、加密锁损坏了如何退换？ | 576,1348 658×80 |  |
| st_4_1 | 静态文本 | 1、加密锁损坏了如何退换？ | 1289,1056 439×80 |  |
| st_4_2 | 静态文本 | 1、加密锁损坏了如何退换？ | 1289,1172 439×80 |  |
| st_4_3 | 静态文本 | 1、加密锁损坏了如何退换？ | 1289,1288 439×80 |  |
| st_4_4 | 静态文本 | 1、加密锁损坏了如何退换？ | 1289,1404 439×80 |  |
| st_5_1 | 静态文本 | 1、加密锁损坏了如何退换？ | 1856,1056 434×80 |  |
| st_5_2 | 静态文本 | 1、加密锁损坏了如何退换？ | 1856,1172 434×80 |  |
| st_5_3 | 静态文本 | 1、加密锁损坏了如何退换？ | 1856,1288 434×80 |  |
| st_5_4 | 静态文本 | 1、加密锁损坏了如何退换？ | 1856,1404 434×80 |  |

### w_xt_pup_bak — 今日焦点

- 类型：弹出窗口；尺寸：2368×1792 PBU；库：rhzw8_9.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 1893,1572 279×92 |  |
| cbx_1 | 复选框 | 近期不再提示 | 1326,1576 539×80 |  |
| gb_1 | 分组框 |  | 5,124 1408×852 |  |
| gb_2 | 分组框 |  | 1403,124 891×852 |  |
| gb_3 | 分组框 |  | 5,936 1243×620 |  |
| gb_4 | 分组框 |  | 1239,936 567×620 |  |
| gb_5 | 分组框 |  | 1797,936 503×620 |  |
| p_1 | 图片 | xt_pop_2.bmp | 27,272 448×600 |  |
| p_2 | 图片 | xt_pop_1.bmp | 32,1068 471×388 |  |
| st_1 | 静态文本 | 热点问题解答： | 101,188 1129×80 |  |
| st_1_0 | 静态文本 | 更多... | 1065,864 238×80 |  |
| st_1_1 | 静态文本 | 1、加密锁损坏了如何退换？ | 494,276 901×80 |  |
| st_1_2 | 静态文本 | 1、加密锁损坏了如何退换？ | 494,376 901×80 |  |
| st_1_3 | 静态文本 | 1、加密锁损坏了如何退换？ | 494,476 901×80 |  |
| st_1_4 | 静态文本 | 1、加密锁损坏了如何退换？ | 494,576 901×80 |  |
| st_1_5 | 静态文本 | 1、加密锁损坏了如何退换？ | 494,676 901×80 |  |
| st_1_6 | 静态文本 | 1、加密锁损坏了如何退换？ | 494,776 901×80 |  |
| st_2 | 静态文本 | 通知公告： | 1486,184 745×80 |  |
| st_2_0 | 静态文本 | 更多... | 1961,864 238×80 |  |
| st_2_1 | 静态文本 | 1、加密锁损坏了如何退换？ | 1477,324 795×80 |  |
| st_2_2 | 静态文本 | 1、加密锁损坏了如何退换？ | 1477,492 795×80 |  |
| st_2_3 | 静态文本 | 1、加密锁损坏了如何退换？ | 1477,660 795×80 |  |
| st_3 | 静态文本 | 在线培训视频： | 101,984 955×80 |  |
| st_3_0 | 静态文本 | 更多... | 960,1456 238×80 |  |
| st_3_1 | 静态文本 | 1、加密锁损坏了如何退换？ | 576,1084 658×80 |  |
| st_3_2 | 静态文本 | 1、加密锁损坏了如何退换？ | 576,1172 658×80 |  |
| st_3_3 | 静态文本 | 1、加密锁损坏了如何退换？ | 576,1260 658×80 |  |
| st_3_4 | 静态文本 | 1、加密锁损坏了如何退换？ | 576,1348 658×80 |  |
| st_4_1 | 静态文本 | 1、加密锁损坏了如何退换？ | 1289,1056 439×80 |  |
| st_4_2 | 静态文本 | 1、加密锁损坏了如何退换？ | 1289,1172 439×80 |  |
| st_4_3 | 静态文本 | 1、加密锁损坏了如何退换？ | 1289,1288 439×80 |  |
| st_4_4 | 静态文本 | 1、加密锁损坏了如何退换？ | 1289,1404 439×80 |  |
| st_5_1 | 静态文本 | 1、加密锁损坏了如何退换？ | 1856,1056 434×80 |  |
| st_5_2 | 静态文本 | 1、加密锁损坏了如何退换？ | 1856,1172 434×80 |  |
| st_5_3 | 静态文本 | 1、加密锁损坏了如何退换？ | 1856,1288 434×80 |  |
| st_5_4 | 静态文本 | 1、加密锁损坏了如何退换？ | 1856,1404 434×80 |  |

### w_xt_pzlx — 凭证类型管理

- 类型：模态对话框；尺寸：1531×1508 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 凭证类型维护」（19 个菜单中）；`w_main1` 的 st_3_lx.clicked；`w_main1` 的 tab_1/tabpage_3/p_t_3_lx.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1198,628 265×104 | clicked → `w_xt_pzlx_zj`「凭证类型增加」 |
| cb_3 | 按钮 | 删除 | 1198,764 265×104 | clicked 读写表 pz |
| cb_4 | 按钮 | 确定 | 1198,900 265×104 |  |
| cb_5 | 按钮 | 取消 | 1198,1036 265×104 |  |
| dw_1 | uo_dw_single |  | 32,104 1106×1024 | 数据窗口 `dw_xt_pzlx`（表 pzlx）；列：pzlx（代码）、pzlx_jc（简称）、pzlx_qc（全称） |
| gb_1 | 分组框 | 凭证类型： | 5,28 1157×1140 |  |
| st_1 | 静态文本 | 提示：简称是显示在凭证左上角的类型选择框；全称是自己对简称的详细说明。 | 87,1212 1262×140 |  |

- 窗口事件/函数：
  - `open`：读写表 dba

- 提示与校验（3 条）：
  - [cb_3.clicked]「不允许删空凭证类别！」（条件：`i = 1`）
  - [cb_3.clicked]「是否删除?」（条件：`i = 1`）
  - [cb_3.clicked]「凭证类别已经使用,不允许删！」（条件：`isnull(xx) or len(trim(xx)) = 0`）

### w_xt_pzlx_zj — 凭证类型增加

- 类型：模态对话框；尺寸：1074×708 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_xt_pzlx` 的 cb_1.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 247,432 256×100 | clicked 读写表 pzlx |
| cb_2 | 按钮 | 取消 | 571,432 256×100 |  |
| em_1 | 格式输入 |  | 512,52 201×100 |  |
| em_2 | 单行输入 |  | 512,204 421×96 |  |
| st_1 | 静态文本 | 类型编号： | 96,64 421×76 |  |
| st_2 | 静态文本 | 类型简称： | 110,216 407×76 |  |

- 提示与校验（1 条）：
  - [cb_1.clicked]「凭证类型代码重复！」（条件：`i > 0`）

### w_xt_szb_xf — 系统续费提示

- 类型：模态对话框；尺寸：1783×828 PBU；库：rhzw8_8.pbd（账务主程序）
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_open；`pfc_appsrv` 的 事件 pfc_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 续费 | 453,584 229×92 |  |
| cb_2 | 按钮 | 取消 | 923,580 229×92 |  |

- 窗口事件/函数：
  - `wf_unlock`：读写表 dba

### w_xt_szb_zc — 时钟版新用户注册

- 类型：模态对话框；尺寸：2130×1608 PBU；库：rhzw8_8.pbd（账务主程序）
- 打开入口：`n_pfc_appsrv` 的 事件 pfc_open；`pfc_appsrv` 的 事件 pfc_open

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 提交 | 297,1364 439×92 |  |
| cb_2 | 按钮 | 取消 | 997,1368 439×92 |  |
| ddlb_1 | 下拉列表 |  | 407,1056 832×684 |  |
| ddlb_cs | 下拉列表 |  | 1083,840 640×1176 |  |
| ddlb_sf | 下拉列表 |  | 421,840 521×1124 | selectionchanged 读写表 b_city |
| dw_1 | 数据窗口 |  | 2249,376 960×420 | 数据窗口 `dw_b_city`（表 b_city）；列：id、s_city（S City）、bz |
| em_dh | 格式输入 |  | 407,716 1006×92 |  |
| em_sj | 格式输入 |  | 407,600 1006×92 |  |
| rb_1 | 单选按钮 | 先生 | 1074,372 274×80 |  |
| rb_2 | 单选按钮 | 女士 | 1367,372 302×80 |  |
| sle_dw | 单行输入 |  | 407,948 1349×92 |  |
| sle_lxr | 单行输入 |  | 407,368 539×92 |  |
| sle_qq | 单行输入 |  | 407,484 1006×92 |  |
| st_10 | 静态文本 | 单位： | 160,952 242×80 |  |
| st_11 | 静态文本 | 产品用途： | 23,1068 389×80 |  |
| st_12 | 静态文本 | * | 101,384 87×80 |  |
| st_13 | 静态文本 | * | 165,500 91×80 |  |
| st_14 | 静态文本 | * | 142,620 96×80 |  |
| st_15 | 静态文本 | * | 69,852 96×80 |  |
| st_16 | 静态文本 | 有*号为身份识别要素，请务必准确填写 | 160,1156 1682×80 |  |
| st_18 | 静态文本 | 未进行注册的用户，将无法正常享受我们的售后服务！！！ | 160,1244 1682×80 |  |
| st_22 | 静态文本 | 请您完善【售后服务卡】内容，它将作为您享受贴心、便捷的售后服务的重要依据 | 146,152 1778×140 |  |
| st_3 | 静态文本 | 姓名 ： | 137,372 279×80 |  |
| st_4 | 静态文本 | QQ： | 160,488 242×80 |  |
| st_5 | 静态文本 | 手机： | 160,604 242×80 |  |
| st_6 | 静态文本 | 电话： | 160,720 242×80 |  |
| st_7 | 静态文本 | 所在地： | 160,836 242×80 |  |
| st_8 | 静态文本 | 省 | 969,836 128×80 |  |
| st_9 | 静态文本 | 市 | 1737,836 133×80 |  |

- 窗口事件/函数：
  - `open`：读写表 b_city

- 提示与校验（6 条）：
  - [cb_1.clicked]「请输入姓名！」（条件：`isnull(xt_cs2) or xt_cs2 = ""`）
  - [cb_1.clicked]「请输入QQ！」（条件：`isnull(xt_cs4) or xt_cs4 = ""`）
  - [cb_1.clicked]「请输入手机！」（条件：`isnull(xt_cs5) or xt_cs5 = ""`）
  - [cb_1.clicked]「请输入省份！」（条件：`isnull(xt_cs7) or xt_cs7 = ""`）
  - [cb_1.clicked]「请输入城市！」（条件：`isnull(xt_cs8) or xt_cs8 = ""`）
  - [cb_2.clicked]「不进行注册，软件将退出，是否退出？」（条件：`xt_zt0 = 5`）

### w_xt_tz — 套账信息

- 类型：模态对话框；尺寸：2021×2168 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：菜单「S系统管理 › 套账信息」（19 个菜单中）；`w_main1` 的 st_3_tz.clicked；`w_main1` 的 tab_1/tabpage_3/p_t_3_xx.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 取消 | 1495,1864 325×164 |  |
| cb_2 | 按钮 | 确定 | 1083,1864 325×164 | clicked 读写表 dba、xt |
| cb_3 | 按钮 | 凭证账册设置... | 1042,1464 731×136 | clicked → `w_xt_tz_zc`「账册设置」 |
| cb_4 | 按钮 | 自动备份设置... | 1042,1596 731×136 | clicked → `w_autobak`「系统自动备份设置」 |
| cb_5 | 按钮 | 科目编码调整 | 1042,1328 731×136 | clicked → `w_bf`「数据备份」、`w_xt_kmbmchange`「科目编码调整」 |
| cbx_1 | 复选框 | 自动保留操作员登录代码 | 224,1232 713×64 |  |
| cbx_bb | 复选框 | 报表与win8及以上版本兼容 | 1051,844 750×80 |  |
| cbx_double | 复选框 | 本机凭证录入关闭双击功能 | 59,1964 745×80 |  |
| cbx_fz | 复选框 | 辅助属性必须输入 | 393,1312 544×64 |  |
| cbx_glpz | 复选框 | 允许修改关联凭证 | 1179,1216 535×76 |  |
| cbx_gz | 复选框 | 过账时自动调整结转凭证 | 1042,1140 672×76 |  |
| cbx_pz | 复选框 | 本机凭证金额不显示分隔线 | 59,1880 745×80 |  |
| cbx_shsz | 复选框 | 允许未审核就过帐 | 375,1072 562×64 |  |
| cbx_view | 复选框 | 本机大字体显示 | 183,1784 622×80 |  |
| cbx_xgpz | 复选框 | 用户间不能互相删改凭证 | 224,1152 713×64 |  |
| cbx_xjll | 复选框 | 现金流量核算 | 1285,1064 430×64 |  |
| ddlb_syff | 下拉列表 |  | 1687,2232 434×512 |  |
| em_dj | 格式输入 | 0 | 750,1548 155×88 |  |
| em_hl | 格式输入 | 0 | 750,1640 155×88 |  |
| em_kmcd | 格式输入 | 0 | 978,612 731×80 |  |
| em_kmjs | 格式输入 |  | 521,612 110×80 |  |
| em_sl | 格式输入 | 0 | 750,1456 155×88 |  |
| gb_1 | 分组框 | 设置 | 41,36 1902×1748 |  |
| gb_2 | 分组框 | 凭证编号方法: | 187,828 791×212 |  |
| rb_1 | 单选按钮 | 计算机编号 | 215,916 343×76 |  |
| rb_2 | 单选按钮 | 手工编号 | 613,916 297×76 |  |
| sle_kjqj | 单行输入 |  | 521,252 114×76 |  |
| sle_sydw | 单行输入 |  | 521,492 1303×80 |  |
| st_1 | 静态文本 | 套账名称： | 91,136 421×60 |  |
| st_11 | 静态文本 | 会计期间： | 91,260 421×60 |  |
| st_12 | 静态文本 | 月 开始为本会计年度的第一个月 | 645,260 869×60 |  |
| st_13 | 静态文本 | 如果选择此项，旧版报表可能不支持！ 非win8及以上版本系统不用选择 | 992,924 933×140 |  |
| st_2 | 静态文本 | 使用单位： | 91,500 421×64 |  |
| st_3 | 静态文本 | 科目级数： | 91,620 421×64 |  |
| st_30 | 静态文本 | 数量保留小数位数： | 233,1468 507×68 |  |
| st_31 | 静态文本 | 单价保留小数位数： | 233,1560 507×68 |  |
| st_32 | 静态文本 | 汇率保留小数位数： | 233,1652 507×68 |  |
| st_4 | 静态文本 | 各级长度 | 667,620 334×64 |  |
| st_6 | 静态文本 | 开账日期： | 91,740 379×64 |  |
| st_7 | 静态文本 | 系统本位币： | 1070,740 338×64 |  |
| st_8 | 静态文本 | 会计准则： | 91,380 421×64 |  |
| st_9 | 静态文本 | 汇兑损益方法： | 1184,2252 512×64 |  |

- 窗口事件/函数：
  - `open`：读写表 dba、xt

- 提示与校验（1 条）：
  - [cb_5.clicked]「为了防止操作过程出现意外，建议数据备份后再进行此操作！~r       现在进行数据备份？」

### w_xt_tz_find — 套账查找

- 类型：模态对话框；尺寸：2071×1708 PBU；库：rhzw8_8.pbd（账务主程序）
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

### w_xt_tz_zc — 账册设置

- 类型：模态对话框；尺寸：2496×1228 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_main1` 的 st_3_zc.clicked；`w_main1` 的 tab_1/tabpage_3/p_t_3_zc.clicked；`w_xt_tz` 的 cb_3.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 1774,772 448×164 | clicked 读写表 xt |
| cb_2 | 按钮 | 取消 | 1774,936 448×164 |  |
| cb_3 | 按钮 | 应交税金(增值税)明细帐设置 | 1554,444 768×120 | clicked → `w_xt_tz_zc_zzsmxz`「应交税金(增值税)明细帐设置」 |
| cbx_1 | 复选框 | 打印单位名称： | 905,804 448×72 |  |
| cbx_2 | 复选框 | 横向打印 | 905,892 329×76 |  |
| cbx_3 | 复选框 | 明细账页码连续编号 | 905,984 631×76 |  |
| cbx_pzkm | 复选框 | 打印科目编码 | 814,136 521×80 |  |
| cbx_xs | 复选框 | 摘要重复不显示 | 82,476 576×80 |  |
| cbx_zg | 复选框 | 自动打印会计主管名字 | 82,572 695×80 |  |
| cbx_ztsz | 复选框 | 字体不自动改变大小 | 814,424 576×80 |  |
| cbx_zyfz | 复选框 | 打印辅助项目 | 814,280 521×80 |  |
| ddlb_1 | 下拉列表 |  | 375,804 393×324 |  |
| em_left | 格式输入 |  | 2866,428 247×100 |  |
| em_left1 | 格式输入 |  | 457,348 229×80 |  |
| em_len | 格式输入 |  | 1975,240 247×100 |  |
| em_len_pz | 格式输入 |  | 453,140 247×88 |  |
| em_sl | 格式输入 | 0 | 1435,1696 155×88 |  |
| em_top | 格式输入 |  | 2866,308 247×100 |  |
| em_top1 | 格式输入 |  | 457,244 229×80 |  |
| em_zoom | 格式输入 |  | 567,1732 247×80 |  |
| gb_2 | 分组框 | 账册页面设置 | 1454,32 965×696 |  |
| gb_3 | 分组框 | 凭证页面设置 | 14,32 1445×696 |  |
| gb_4 | 分组框 | 打印颜色 | 55,900 718×192 |  |
| rb_3 | 单选按钮 | 彩色 | 443,972 247×72 |  |
| rb_4 | 单选按钮 | 单色 | 119,972 247×72 |  |
| sle_mz | 单行输入 |  | 800,568 608×92 |  |
| st_1 | 静态文本 | 顶部预留 | 2610,320 233×72 |  |
| st_10 | 静态文本 | 数量保留小数位数： | 942,1712 507×68 |  |
| st_11 | 静态文本 | 打印格式： | 46,804 311×64 |  |
| st_12 | 静态文本 | 打印比例 | 311,1736 247×76 |  |
| st_13 | 静态文本 | % | 814,1736 73×76 |  |
| st_2 | 静态文本 | 每页打印行数 | 55,144 379×80 |  |
| st_3 | 静态文本 | 左方预留 | 2610,444 233×64 |  |
| st_5 | 静态文本 | 每页打印行数 | 1545,252 407×72 |  |
| st_6 | 静态文本 | 顶部预留 | 178,248 251×72 |  |
| st_7 | 静态文本 | 左方预留 | 178,356 251×64 |  |

- 窗口事件/函数：
  - `open`：读写表 xt

### w_xt_tz_zc_zzsmxz — 应交税金(增值税)明细帐设置

- 类型：模态对话框；尺寸：3419×1204 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_xt_tz_zc` 的 cb_3.clicked；`w_zc_zzs` 的 cb_3.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 1390,968 297×96 | clicked 读写表 xt |
| cb_2 | 按钮 | 取消 | 1934,968 297×96 |  |
| dw_1 | 数据窗口 |  | 9,12 3383×936 | 数据窗口 `dw_xt_tz_zc_zzsmxz`；列：sm（科目说明）、km（对应科目）、kmmc、mc（帐册打印名称）、e_mc；itemchanged 读写表 kmbm；doubleclicked → `w_pz_km_find`「科目查找」；doubleclicked 读写表 kmbm |

- 窗口事件/函数：
  - `open`：读写表 kmbm、xt

### w_xt_user — 操作易人

- 类型：模态对话框；尺寸：1801×1056 PBU；库：rhzw8_5.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 361,764 283×104 |  |
| cb_2 | 按钮 | 取消 | 777,764 283×104 |  |
| sle_id | 单行输入 |  | 494,72 695×96 |  |
| sle_password | 单行输入 |  | 494,188 695×96 | rbuttondown 读写表 dba |
| st_error | 静态文本 | 注册信息错误, 请重新输入 | 169,576 1298×68 |  |
| st_pswd | 静态文本 | 用户密码: | 123,212 361×84 |  |
| st_userid | 静态文本 | 用户代码: | 133,88 352×84 |  |

- 提示与校验（1 条）：
  - [sle_password.rbuttondown]「???」（条件：`len(xlh) = 0 and cs_1 = 0`）

### w_xt_users — 用户管理

- 类型：模态对话框；尺寸：1989×2376 PBU；库：rhzw8_9.pbd（账务主程序）
- 打开入口：菜单「F.文件 › 用户管理」（20 个菜单中）；`w_acini_wizard` 的 cb_1.clicked；`w_main1` 的 st_3_cz.clicked；`w_main1` 的 tab_1/tabpage_3/p_t_3_cz.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1627,1068 315×108 | clicked → `w_xt_uses_zj`「增加用户」、`w_xt_users_qx`「用户权限」；clicked 读写表 b_rights、dba |
| cb_2 | 按钮 | 权限 | 1627,1580 315×108 | clicked → `w_xt_users_qx`「用户权限」；clicked 读写表 b_rights、dba |
| cb_3 | 按钮 | 删除 | 1627,1324 315×108 | clicked 读写表 b_user |
| cb_4 | 按钮 | 关闭 | 1627,1708 315×108 | clicked → `w_acini_wizard`「期初建账操作向导」 |
| cb_6 | 按钮 | 清除密码 | 1627,1452 315×108 |  |
| cb_7 | 按钮 | 修改 | 1627,1196 315×108 | clicked → `w_xt_uses_zj`「增加用户」 |
| dw_1 | 数据窗口 |  | 78,120 1467×1756 | 数据窗口 `dw_xt_users`（表 b_user）；列：e_name（用户代码）、c_name（用户名称）、u_id、pswd |
| dw_2 | 数据窗口 |  | 1815,480 494×360 | 数据窗口 `dw_users_rights`（表 b_rights）；列：u_id（U Id）、m_id（M Id）、c_name（C Name）、isgroup（Isgroup） |
| gb_1 | 分组框 | 用户： | 37,24 1559×1888 |  |
| st_1 | 静态文本 | 温馨提示： | 14,1928 1787×72 |  |
| st_2 | 静态文本 | 1.MANAGER为软件默认系统管理员，拥有最高权限，不可删除或修改； | 69,2012 1787×72 |  |
| st_3 | 静态文本 | 2.一般增设2个或以上用户（至少1个用于记账，1个用于审核）； | 69,2096 1787×72 |  |
| st_4 | 静态文本 | 3.新增用户后请别忘记给它设权限。 | 69,2180 1787×72 |  |

- 窗口事件/函数：
  - `open`：读写表 b_user
  - `wf_b_rights`：读写表 b_rights、b_user

- 提示与校验（7 条）：
  - [cb_2.clicked]「MANAGER不能修改！」（条件：`upper(xx) = "MANAGER"`）
  - [cb_3.clicked]「MANAGER不能删除！」（条件：`upper(xx2) = "MANAGER"`）
  - [cb_3.clicked]「您不能不能删除自己！」（条件：`xx = suid`）
  - [cb_3.clicked]「确实是否删除操作员：？」（条件：`xx = suid`）
  - [cb_6.clicked]「是否清除操作员：的登录密码？」
  - [dw_1.dberror]「用户编码重复！是否重输？」（条件：`sqldbcode = -196`）
  - [dw_1.dberror]「数据窗口出错！」（条件：`i = 1`）

### w_xt_users_qx — 用户权限

- 类型：模态对话框；尺寸：2341×1536 PBU；库：rhzw8_9.pbd（账务主程序）
- 打开入口：`w_xt_users` 的 cb_1.clicked；`w_xt_users` 的 cb_2.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 1957,844 247×128 | clicked 读写表 b_rights |
| cb_2 | 按钮 | 取消 | 1957,1064 247×128 |  |
| cb_3 | 按钮 | 增加所有权限 | 1870,260 421×92 | clicked 读写表 b_rights、dba |
| cb_4 | 按钮 | 取消所有权限 | 1870,376 421×92 | clicked 读写表 b_rights |
| tab_1 | 标签页容器 |  | ,8 1829×1392 |  |
| tab_1/tabpage_1 | 用户对象 | 系统管理 | 18,108 1792×1268 |  |
| tab_1/tabpage_1/cbx_470 | 复选框 | 系统初始化 | 827,656 398×76 |  |
| tab_1/tabpage_1/cbx_803 | 复选框 | 综合检查 | 133,228 393×76 |  |
| tab_1/tabpage_1/cbx_802 | 复选框 | 套帐管理 | 206,1280 393×76 |  |
| tab_1/tabpage_1/cbx_801 | 复选框 | 系统初始化 | 709,1260 393×76 |  |
| tab_1/tabpage_1/cbx_a04 | 复选框 | 导出 | 914,380 283×76 |  |
| tab_1/tabpage_1/cbx_a03 | 复选框 | 另存 | 914,288 283×76 |  |
| tab_1/tabpage_1/cbx_a02 | 复选框 | 打印 | 914,196 283×76 |  |
| tab_1/tabpage_1/cbx_101 | 复选框 | 操作员管理 | 101,1152 430×72 |  |
| tab_1/tabpage_1/cbx_473 | 复选框 | 反结帐 | 827,992 398×72 |  |
| tab_1/tabpage_1/cbx_472 | 复选框 | 反过帐 | 827,912 398×72 |  |
| tab_1/tabpage_1/cbx_474 | 复选框 | 操作日志 | 827,832 398×72 |  |
| tab_1/tabpage_1/cbx_2 | 复选框 | 切换套帐 | 96,156 430×84 |  |
| tab_1/tabpage_1/cbx_471 | 复选框 | 套帐信息 | 827,740 398×84 |  |
| tab_1/tabpage_1/cbx_804 | 复选框 | 数据备份 | 133,456 393×72 |  |
| tab_1/tabpage_1/cbx_805 | 复选框 | 数据恢复 | 1234,1256 393×72 |  |
| tab_1/tabpage_1/gb_8 | 分组框 |  | 718,592 672×520 |  |
| tab_1/tabpage_1/gb_7 | 分组框 |  | 718,48 672×520 |  |
| tab_1/tabpage_1/gb_2 | 分组框 |  | 41,52 603×1064 |  |
| tab_1/tabpage_2 | 用户对象 | 凭证/帐务 | 18,108 1792×1268 |  |
| tab_1/tabpage_2/cbx_431 | 复选框 | 报表定义 | 846,1064 288×76 |  |
| tab_1/tabpage_2/cbx_427 | 复选框 | 辅助多栏帐 | 1298,580 343×76 |  |
| tab_1/tabpage_2/cbx_419 | 复选框 | 现金流量试算平衡表 | 521,648 562×76 |  |
| tab_1/tabpage_2/cbx_435 | 复选框 | 财务分析 | 1243,1064 453×72 |  |
| tab_1/tabpage_2/cbx_403 | 复选框 | 凭证审核 | 96,252 320×72 |  |
| tab_1/tabpage_2/cbx_421 | 复选框 | 总分类帐 | 1298,124 320×72 |  |
| tab_1/tabpage_2/cbx_430 | 复选框 | 报表管理 | 846,884 320×72 |  |
| tab_1/tabpage_2/cbx_426 | 复选框 | 辅助三栏帐 | 1298,504 379×72 |  |
| tab_1/tabpage_2/cbx_418 | 复选框 | 辅助数量汇总余额表 | 521,572 617×72 |  |
| tab_1/tabpage_2/cbx_417 | 复选框 | 辅助外币汇总余额表 | 521,496 617×72 |  |
| tab_1/tabpage_2/cbx_416 | 复选框 | 辅助汇总余额表 | 521,420 517×72 |  |
| tab_1/tabpage_2/cbx_401 | 复选框 | 凭证输入 | 96,136 320×92 |  |
| tab_1/tabpage_2/cbx_411 | 复选框 | 月度结转 | 521,116 375×72 |  |
| tab_1/tabpage_2/cbx_412 | 复选框 | 结帐 | 928,116 215×72 |  |
| tab_1/tabpage_2/cbx_413 | 复选框 | 汇总余额表 | 521,192 480×72 |  |
| tab_1/tabpage_2/cbx_402 | 复选框 | 凭证查询 | 96,356 320×92 |  |
| tab_1/tabpage_2/cbx_404 | 复选框 | 凭证过帐 | 96,476 320×92 |  |
| tab_1/tabpage_2/cbx_415 | 复选框 | 数量汇总余额表 | 521,344 517×72 |  |
| tab_1/tabpage_2/cbx_414 | 复选框 | 外币汇总余额表 | 521,268 517×72 |  |
| tab_1/tabpage_2/cbx_422 | 复选框 | 现金日记帐 | 1298,200 379×72 |  |
| tab_1/tabpage_2/cbx_423 | 复选框 | 银行日记帐 | 1298,276 379×72 |  |
| tab_1/tabpage_2/cbx_424 | 复选框 | 三栏明细帐 | 1298,352 379×72 |  |
| tab_1/tabpage_2/cbx_425 | 复选框 | 多栏帐 | 1298,428 261×72 |  |
| tab_1/tabpage_2/cbx_450 | 复选框 | 期初余额 | 59,884 320×72 |  |
| tab_1/tabpage_2/cbx_451 | 复选框 | 项目期初 | 59,976 320×72 |  |
| tab_1/tabpage_2/cbx_452 | 复选框 | 客户期初 | 73,1076 320×72 |  |
| tab_1/tabpage_2/cbx_453 | 复选框 | 部门期初 | 434,980 320×72 |  |
| tab_1/tabpage_2/cbx_454 | 复选框 | 个人期初 | 443,1084 320×72 |  |
| tab_1/tabpage_2/gb_12 | 分组框 | 报表/分析 | 809,784 955×412 |  |
| tab_1/tabpage_2/gb_3 | 分组框 | 凭证 | 27,28 453×736 |  |
| tab_1/tabpage_2/gb_4 | 分组框 | 帐务 | 466,28 741×736 |  |
| tab_1/tabpage_2/gb_5 | 分组框 | 帐册 | 1198,28 558×736 |  |
| tab_1/tabpage_2/gb_6 | 分组框 | 期初余额 | 14,784 805×412 |  |
| tab_1/tabpage_3 | 用户对象 | 档案 | 18,108 1792×1268 |  |
| tab_1/tabpage_3/cbx_446 | 复选框 | 凭证模版维护 | 1010,952 535×80 |  |
| tab_1/tabpage_3/cbx_43n | 复选框 | 合同帐款查询 | 1029,300 453×76 |  |
| tab_1/tabpage_3/cbx_43m | 复选框 | 合同档案管理 | 1029,156 453×76 |  |
| tab_1/tabpage_3/cbx_464 | 复选框 | 现金流量项目维护 | 133,956 517×76 |  |
| tab_1/tabpage_3/cbx_440 | 复选框 | 科目维护 | 142,152 389×80 |  |
| tab_1/tabpage_3/cbx_441 | 复选框 | 摘要维护 | 142,300 389×72 |  |
| tab_1/tabpage_3/cbx_460 | 复选框 | 项目维护 | 146,500 389×72 |  |
| tab_1/tabpage_3/cbx_461 | 复选框 | 客户维护 | 146,616 389×72 |  |
| tab_1/tabpage_3/cbx_462 | 复选框 | 部门维护 | 142,732 389×72 |  |
| tab_1/tabpage_3/cbx_463 | 复选框 | 个人维护 | 142,848 389×72 |  |
| tab_1/tabpage_3/cbx_442 | 复选框 | 凭证类型维护 | 1010,500 535×72 |  |
| tab_1/tabpage_3/cbx_443 | 复选框 | 结算类型维护 | 1010,616 535×72 |  |
| tab_1/tabpage_3/cbx_444 | 复选框 | 外币种类维护 | 1010,732 535×72 |  |
| tab_1/tabpage_3/cbx_445 | 复选框 | 结转类型维护 | 1010,848 535×72 |  |
| tab_1/tabpage_3/gb_13 | 分组框 |  | 878,72 763×360 |  |
| tab_1/tabpage_3/gb_11 | 分组框 |  | 82,436 640×644 |  |
| tab_1/tabpage_3/gb_10 | 分组框 |  | 878,436 763×644 |  |
| tab_1/tabpage_3/gb_9 | 分组框 |  | 82,72 640×360 |  |
| tab_1/tabpage_4 | 用户对象 | 工资/固定资产 | 18,108 1792×1268 |  |
| tab_1/tabpage_4/cbx_497 | 复选框 | 固定资产反过帐 | 1006,900 526×76 |  |
| tab_1/tabpage_4/cbx_496 | 复选框 | 固定资产初始化 | 942,1336 526×76 |  |
| tab_1/tabpage_4/cbx_495 | 复选框 | 固定资产辅助维护 | 1006,764 526×76 |  |
| tab_1/tabpage_4/cbx_494 | 复选框 | 折旧查询 | 1006,628 526×76 |  |
| tab_1/tabpage_4/cbx_493 | 复选框 | 计提折旧 | 1006,492 526×76 |  |
| tab_1/tabpage_4/cbx_492 | 复选框 | 固定资产台帐管理 | 1006,356 526×76 |  |
| tab_1/tabpage_4/cbx_491 | 复选框 | 固定资产套帐信息 | 1006,220 526×76 |  |
| tab_1/tabpage_4/cbx_48a | 复选框 | 工资反过帐 | 256,920 448×76 |  |
| tab_1/tabpage_4/cbx_489 | 复选框 | 工资初始化 | 219,1328 448×76 |  |
| tab_1/tabpage_4/cbx_488 | 复选框 | 工资部门维护 | 256,816 448×76 |  |
| tab_1/tabpage_4/cbx_487 | 复选框 | 工资凭证设置 | 1911,788 448×76 |  |
| tab_1/tabpage_4/cbx_486 | 复选框 | 工资打印格式 | 256,712 448×76 |  |
| tab_1/tabpage_4/cbx_485 | 复选框 | 工资计算公式 | 256,608 448×76 |  |
| tab_1/tabpage_4/cbx_484 | 复选框 | 工资结构设置 | 256,504 448×76 |  |
| tab_1/tabpage_4/cbx_483 | 复选框 | 工资管理 | 256,400 448×76 |  |
| tab_1/tabpage_4/cbx_482 | 复选框 | 工资人事管理 | 256,296 448×76 |  |
| tab_1/tabpage_4/cbx_481 | 复选框 | 工资套帐信息 | 256,192 448×76 |  |
| tab_1/tabpage_4/gb_15 | 分组框 | 固定资产 | 896,92 791×968 |  |
| tab_1/tabpage_4/gb_14 | 分组框 | 工资 | 105,92 800×968 |  |
| tab_1/tabpage_5 | 用户对象 | 仓库 | 18,108 1792×1268 |  |
| tab_1/tabpage_5/cbx_525 | 复选框 | 费用分摊 | 1275,700 343×76 |  |
| tab_1/tabpage_5/cbx_524 | 复选框 | 成本利润表 | 1275,560 343×76 |  |
| tab_1/tabpage_5/cbx_523 | 复选框 | 库存汇总余额表 | 1275,420 453×76 |  |
| tab_1/tabpage_5/cbx_522 | 复选框 | 出库汇总 | 1275,280 288×76 |  |
| tab_1/tabpage_5/cbx_521 | 复选框 | 入库汇总 | 1275,140 288×76 |  |
| tab_1/tabpage_5/cbx_516 | 复选框 | 凭证生成 | 2185,968 370×76 |  |
| tab_1/tabpage_5/cbx_515 | 复选框 | 成本计算 | 672,840 370×76 |  |
| tab_1/tabpage_5/cbx_514 | 复选框 | 盘点表 | 672,700 370×76 |  |
| tab_1/tabpage_5/cbx_517 | 复选框 | 库存台帐 | 672,560 370×76 |  |
| tab_1/tabpage_5/cbx_513 | 复选框 | 当前库存 | 672,420 370×76 |  |
| tab_1/tabpage_5/cbx_512 | 复选框 | 出库单管理 | 672,280 370×76 |  |
| tab_1/tabpage_5/cbx_511 | 复选框 | 入库单管理 | 672,140 370×76 |  |
| tab_1/tabpage_5/cbx_506 | 复选框 | 打印格式定义 | 119,740 398×76 |  |
| tab_1/tabpage_5/cbx_505 | 复选框 | 期初库存 | 119,592 288×76 |  |
| tab_1/tabpage_5/cbx_504 | 复选框 | 产品档案 | 119,444 288×76 |  |
| tab_1/tabpage_5/cbx_503 | 复选框 | 套帐信息 | 119,296 288×76 |  |
| tab_1/tabpage_5/cbx_502 | 复选框 | 反过账 | 119,148 247×76 |  |
| tab_1/tabpage_5/cbx_501 | 复选框 | 初始化 | 2176,1128 247×76 |  |
| tab_1/tabpage_5/gb_19 | 分组框 |  | 1166,32 654×1112 |  |
| tab_1/tabpage_5/gb_18 | 分组框 |  | 558,32 622×1112 |  |
| tab_1/tabpage_5/gb_16 | 分组框 |  | 32,32 539×1112 |  |
| tab_1/tabpage_6 | 用户对象 | 出纳 | 18,108 1792×1268 |  |
| tab_1/tabpage_6/cbx_4ae | 复选框 | 出纳日记账 | 901,700 370×76 |  |
| tab_1/tabpage_6/cbx_4ad | 复选框 | 汇总余额表 | 901,588 370×76 |  |
| tab_1/tabpage_6/cbx_4ac | 复选框 | 结账 | 901,472 370×80 |  |
| tab_1/tabpage_6/cbx_4ab | 复选框 | 对账 | 901,356 370×80 |  |
| tab_1/tabpage_6/cbx_4aa | 复选框 | 单据录入 | 901,240 370×80 |  |
| tab_1/tabpage_6/cbx_4a3 | 复选框 | 反结账 | 219,580 375×80 |  |
| tab_1/tabpage_6/cbx_4a2 | 复选框 | 期初录入 | 219,412 375×80 |  |
| tab_1/tabpage_6/cbx_4a1 | 复选框 | 出纳初始化 | 219,244 375×80 |  |
| tab_1/tabpage_6/gb_17 | 分组框 |  | 777,80 695×1068 |  |
| tab_1/tabpage_6/gb_20 | 分组框 |  | 142,80 649×1068 |  |
| tab_1/tabpage_7 | 用户对象 | 发票 | 18,108 1792×1268 |  |
| tab_1/tabpage_7/cbx_4c7 | 复选框 | 发票反结账 | 965,688 407×76 |  |
| tab_1/tabpage_7/cbx_4c6 | 复选框 | 发票结账 | 965,548 407×76 |  |
| tab_1/tabpage_7/cbx_4c5 | 复选框 | 季度汇总表 | 965,268 407×76 |  |
| tab_1/tabpage_7/cbx_4c4 | 复选框 | 凭证生成 | 965,408 407×76 |  |
| tab_1/tabpage_7/cbx_4c3 | 复选框 | 发票录入 | 965,128 407×76 |  |
| tab_1/tabpage_7/cbx_4c2 | 复选框 | 发票参数设置 | 142,128 398×76 |  |
| tab_1/tabpage_7/cbx_4c1 | 复选框 | 发票初始化 | 183,652 343×76 |  |

- 窗口事件/函数：
  - `u_open`：读写表 b_rights

### w_xt_uses_zj — 增加用户

- 类型：模态对话框；尺寸：1179×772 PBU；库：rhzw8_9.pbd（账务主程序）
- 打开入口：`w_xt_users` 的 cb_1.clicked；`w_xt_users` 的 cb_7.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 229,516 297×104 | clicked 读写表 b_rights、b_user、dba |
| cb_2 | 按钮 | 取消 | 640,516 297×104 |  |
| cbx_1 | 复选框 | 给此用户赋予全部权限 | 270,384 791×76 |  |
| em_1 | 格式输入 |  | 453,56 635×104 |  |
| sle_1 | 单行输入 |  | 453,228 635×104 |  |
| st_1 | 静态文本 | 登录代码： | 46,56 407×104 |  |
| st_2 | 静态文本 | 用户名称： | 46,228 407×104 |  |

- 窗口事件/函数：
  - `wf_u_id`：读写表 b_user

- 提示与校验（1 条）：
  - [cb_1.clicked]「登录代码重复！」（条件：`i > 0`）

### w_xt_wh — 修改编号

- 类型：模态对话框；尺寸：2153×772 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_pz_pzmb_main` 的 cb_2.clicked；`w_xt_bmwh` 的 cb_2.clicked；`w_xt_dwwh` 的 事件 ue_action_newcopy；`w_xt_grwh` 的 cb_2.clicked；`w_xt_xjwh` 的 cb_2.clicked；`w_xt_xmwh` 的 cb_2.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 530,500 279×104 | clicked 读写表 bmk、bmnc、dt_mxb、dwk、dwnc、grk、grnc、htda、hz、kmbm、pz、pzmb、pzmb_pz、wlhz、wlxx、xjll_xm、xmk、xmnc |
| cb_2 | 按钮 | 取消 | 1083,500 279×104 |  |
| em_1 | 格式输入 |  | 370,312 759×88 |  |
| st_1 | 静态文本 | 编号： | 46,64 329×60 |  |
| st_2 | 静态文本 | 名称： | 46,196 329×60 |  |
| st_3 | 静态文本 | 新编号： | 46,328 329×60 |  |

- 提示与校验（2 条）：
  - [cb_1.clicked]「编号重复！」（条件：`i > 0`）
  - [cb_1.clicked]「转换完毕！」

### w_xt_xjwh — 现金流量项目设定

- 类型：模态对话框；尺寸：1847×1908 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 辅助档案 › 现金项目维护」（19 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1522,1276 283×108 |  |
| cb_2 | 按钮 | 编号修改 | 1522,1152 283×108 | clicked → `w_xt_wh`「修改编号」 |
| cb_3 | 按钮 | 删除 | 1522,1400 283×108 |  |
| cb_4 | 按钮 | 确定 | 1522,1524 283×108 |  |
| cb_5 | 按钮 | 取消 | 1522,1648 283×108 |  |
| cb_6 | 按钮 | 另存 | 1522,1028 283×108 |  |
| dw_1 | uo_dw_single |  | 59,84 1399×1652 | 数据窗口 `dw_xt_xjll`（表 xjll_xm）；列：xjbm（编号）、xjmc（名称）、jd |
| gb_1 | 分组框 | 现金流量项目： | 14,4 1490×1776 |  |

- 窗口事件/函数：
  - `open`：读写表 dba、xjll_xm

### w_xt_xm_sc — 项目查找

- 类型：弹出窗口；尺寸：1742×2184 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：`w_pz_pzedit_b` 的 dw_detail.doubleclicked；`w_pz_pzedit_b` 的 dw_detail.itemchanged；`w_pz_pzedit_bak` 的 dw_detail.doubleclicked；`w_pz_pzedit_bak` 的 dw_detail.itemchanged；`w_pz_pzedit_mb` 的 dw_detail.doubleclicked；`w_pz_pzedit_mb` 的 dw_detail.itemchanged；`w_pz_pzedit` 的 dw_detail.doubleclicked；`w_pz_pzedit` 的 dw_detail.itemchanged；`w_xt_xmnc` 的 cb_t1.clicked；`w_zc_fhdlz` 的 cb_xm.clicked；`w_zc_fhslz` 的 cb_xm.clicked；`w_zw_fhslye` 的 cb_t1.clicked……（共 17 处）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 搜索 | 1330,28 187×96 |  |
| cb_2 | 按钮 | 关闭 | 1513,28 165×96 |  |
| dw_1 | 数据窗口 |  | 14,136 1682×1652 | 数据窗口 `dw_xt_xmwh`（表 xmk）；列：xmbm（项目编码）、xm_mc（项目名称）、bz（在用）；doubleclicked → `w_zc_fhdlz`「辅助多栏账」、`w_zc_fhslz`「辅助明细账」 |
| sle_1 | 单行输入 |  | 311,36 1015×80 |  |
| st_1 | 静态文本 | 搜索条件: | 46,40 297×80 |  |
| st_2 | 静态文本 | 键盘操作说明： | 82,1808 526×68 |  |
| st_3 | 静态文本 | 1）按上下箭头选择科目 | 142,1888 585×76 |  |
| st_4 | 静态文本 | 2）找到后按F2键确认（或者鼠标双击） | 151,1976 969×76 |  |

- 窗口事件/函数：
  - `u_open`：打开 `w_zc_fhdlz`「辅助多栏账」、`w_zc_fhslz`「辅助明细账」

### w_xt_xmnc — 【（运行时设置）

- 类型：主窗口（默认）；尺寸：4187×2204 PBU；继承：`wroot_single`；菜单：`m_work_xt_fznc`；库：rhzw8_7.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 期初余额 › 项目期初录入」（19 个菜单中）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 5,448 2560×768 | 数据窗口 `dw_xt_xm_ye`（表 xmnc、fbgl、kmbm、xmk）；列：xmbm（项目编码）、kmbm（科目编码）、bz（币种）、nc_jf（年初借方余额）、nc_jf_b（年初借方(本)）、nc_df（年初贷方余额）、nc_df_b（年初贷方(本)）、jq_jf（帐前借方发生额）、jq_jf_b（帐前借方(本)）、jq_df（帐前贷方发生额）、fbs、ys、jq_df_b（帐前贷方(本)）、nf、nchl、kmbm_km_mc（科目名称）、xmk_xm_mc（项目名称） |
| uo_1 | u_toolbar |  | , 768×200 |  |
| cb_t1 | 按钮 | 搜索 | 3941,220 133×84 | clicked → `w_xt_xm_sc`「项目查找」 |
| cbx_sl | 复选框 | 期初数量 | 965,224 297×76 |  |
| ddlb_bz | 下拉列表 |  | 411,220 475×436 | selectionchanged 读写表 fbgl |
| ddlb_km | 下拉列表 |  | 466,332 2217×1400 |  |
| ddlb_xm | 下拉列表 |  | 2222,228 1705×972 |  |
| st_1 | 静态文本 | 选择币种 | 73,236 306×80 |  |
| st_2 | 静态文本 | 输入科目编码： | 73,344 471×80 |  |
| st_3 | 静态文本 | 选择项目 | 1938,236 274×80 |  |

- 窗口事件/函数：
  - `open`：读写表 fbgl、hz、kmbm、xmk、xmnc
  - `ue_action_del`：读写表 xmnc
  - `ue_action_new`：读写表 kmbm、xmnc
  - `u_hz`：读写表 kmbm、xmnc

- 提示与校验（11 条）：
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）
  - [窗口事件 ue_action_del]「是否删除-- 项?」（条件：`r = 0`）
  - [窗口事件 ue_action_del]「不允许删除!」（条件：`i = 0`）
  - [窗口事件 ue_action_new]「本年已经有过账，不能增加期初数!」（条件：`this.xgbz = "1"`）
  - [窗口事件 ue_action_new]「请先选择要增加的项目!」（条件：`xmbm = "全部"`）
  - [窗口事件 ue_action_new]「请先选择要增加的科目!」（条件：`kmbm = "全部"`）
  - [窗口事件 ue_action_new]「已有此项目!」（条件：`i > 0`）
  - [窗口事件 ue_action_new]「此科目非数量科目!」（条件：`sls = "0"`）
  - [窗口事件 ue_action_new]「此科目非复币科目!」（条件：`fbs = "0"`）
  - [窗口事件 u_hz]「是否删除所有损益科目的年初数？」（条件：`l > 0`）

### w_xt_xmwh — 核算项目

- 类型：弹出窗口；尺寸：2958×2084 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 辅助档案 › 项目信息维护」（19 个菜单中）；`w_pz_pzedit_b` 的 事件 u_pzxxbz；`w_pz_pzedit_bak` 的 事件 u_pzxxbz；`w_pz_pzedit_mb` 的 事件 u_pzxxbz；`w_pz_pzedit` 的 事件 u_pzxxbz；`w_xt_fhwh` 的 cb_1.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 2546,1216 334×104 |  |
| cb_2 | 按钮 | 编号修改 | 2546,1080 334×104 | clicked → `w_xt_wh`「修改编号」 |
| cb_3 | 按钮 | 删除 | 2546,1352 334×104 | clicked 读写表 pz、xmnc |
| cb_4 | 按钮 | 确定 | 2546,1488 334×104 | clicked 读写表 xt |
| cb_5 | 按钮 | 取消 | 2546,1624 334×104 |  |
| cb_6 | 按钮 | 另存 | 2546,808 334×104 |  |
| cb_9 | 按钮 | 查找... | 1522,16 206×88 |  |
| cb_get | 按钮 | 导入 | 2546,944 334×104 |  |
| dw_1 | uo_dw_single |  | 32,116 2455×1604 | 数据窗口 `dw_xt_xmwh`（表 xmk）；列：xmbm（项目编码）、xm_mc（项目名称）、bz（在用） |
| em_1 | 格式输入 |  | 709,1764 398×100 |  |
| sle_1 | 单行输入 |  | 489,8 1010×96 |  |
| st_1 | 静态文本 | 项目分级规则(每级长度) | 46,1776 594×76 |  |
| st_12 | 静态文本 | 请输入查找条件 | 32,16 434×80 |  |
| st_2 | 静态文本 | 说明：最多5级，总长度不超过10位 | 1646,1784 910×60 |  |

- 窗口事件/函数：
  - `open`：读写表 dba、xmk、xt

- 提示与校验（4 条）：
  - [cb_3.clicked]「是否删除?」
  - [cb_3.clicked]「已使用，不能删除！」（条件：`r > 0`）
  - [cb_9.clicked]「请输入查找条件!」（条件：`isnull(xx) or xx = ""`）
  - [dw_1.itemchanged]「您的编码长度不符合规则！」（条件：`ret = -1`）

### w_xt_ye — 期初余额录入

- 类型：主窗口（默认）；尺寸：3049×1436 PBU；继承：`wroot_single`；菜单：`m_work_xt_01`；库：rhzw8_8.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 期初余额 › 期初录入」（19 个菜单中）；`w_acini_wizard` 的 cb_3.clicked；`w_main1` 的 st_3_qc.clicked；`w_zw_jz` 的 cb_1.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,420 1618×688 | 数据窗口 `dw_xt_ye`（表 fbgl、kmbm、nc）；列：nc_kmbm（科目编码）、kmbm_km_mc（科目名称）、nc_nc_jf（年初借方）、nc_nc_df（年初贷方）、nc_jq_jf（账前借方发生额）、nc_jq_df（账前贷方发生额）、nc_yjd、nc_fbs、nc_kmjs、nc_bz（币种）、xxxx、nc_nc_jf_b（折合本位币）、nc_nc_df_b（折合本位币）、nc_jq_jf_b（折合本位币）、nc_jq_df_b（折合本位币）、nc_nf |
| uo_1 | u_toolbar |  | , 768×200 |  |
| cbx_sl | 复选框 | 期初数量 | 1234,212 297×76 |  |
| ddlb_1 | 下拉列表 |  | 539,208 631×668 | selectionchanged 读写表 fbgl、xt |
| dw_3 | 数据窗口 | none | 2053,660 686×400 | 数据窗口 `dw_xt_ye`（表 fbgl、kmbm、nc）；列：nc_kmbm（科目编码）、kmbm_km_mc（科目名称）、nc_nc_jf（年初借方）、nc_nc_df（年初贷方）、nc_jq_jf（账前借方发生额）、nc_jq_df（账前贷方发生额）、nc_yjd、nc_fbs、nc_kmjs、nc_bz（币种）、xxxx、nc_nc_jf_b（折合本位币）、nc_nc_df_b（折合本位币）、nc_jq_jf_b（折合本位币）、nc_jq_df_b（折合本位币）、nc_nf |
| st_1 | 静态文本 | 选择内容： | 183,212 329×72 |  |
| st_2 | 静态文本 | 温馨提示:点菜单栏【存盘】按钮可检验期初数借贷是否平衡。 | 178,340 2025×64 |  |

- 窗口事件/函数：
  - `open`：读写表 fbgl、hz、xt
  - `close`：打开 `w_acini_wizard`「期初建账操作向导」
  - `ue_action_print`：打开 `w_print`「账册打印」
  - `ue_action_save`：读写表 nc
  - `ue_action_preview`：打开 `w_preview`「打印预览」

- 提示与校验（6 条）：
  - [窗口事件 open]「年期初库还未建立！」（条件：`f_xt_ncye(this.nf) = -1`）
  - [窗口事件 close]「是否存储所作的修改？」（条件：`this.dw_master.modifiedcount() <> 0`）
  - [窗口事件 closequery]「有数据未存盘, 退出前是否存盘 ?」（条件：`this.dw_master.ib_need_save`）
  - [窗口事件 closequery]「存盘不成功，请检查。」（条件：`message.returnvalue = 1`）
  - [窗口事件 ue_action_save]「余额借贷不平！年初借方余额：」（条件：`string(xt_kzrq,"mm") = "01"`）
  - [窗口事件 ue_action_save]「年初借方余额：」（条件：`string(xt_kzrq,"mm") = "01"`）

### w_xt_ye_nf — 选择年份

- 类型：模态对话框；尺寸：1143×676 PBU；库：rhzw8_8.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 期初余额 › 期初录入」（19 个菜单中）；菜单「I 基础档案 › 期初余额 › 项目期初录入」（19 个菜单中）；菜单「I 基础档案 › 期初余额 › 客供期初录入」（19 个菜单中）；菜单「I 基础档案 › 期初余额 › 部门期初录入」（19 个菜单中）；菜单「I 基础档案 › 期初余额 › 个人期初录入」（19 个菜单中）；`w_fx_zl` 的 dw_master.doubleclicked；`w_main1` 的 st_3_qc.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 393,392 247×100 |  |
| em_1 | 格式输入 |  | 411,184 247×96 |  |
| st_1 | 静态文本 | 请选择： | 229,64 283×76 |  |
| st_2 | 静态文本 | 年份 | 695,196 247×76 |  |

- 提示与校验（1 条）：
  - [cb_1.clicked]「小于开帐年份!」（条件：`nf < nf0`）

### w_xt_zy — 摘要管理

- 类型：模态对话框；尺寸：2304×1348 PBU；库：rhzw8_5.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 摘要信息维护」（19 个菜单中）；`w_main1` 的 tab_1/tabpage_3/p_t_3_zy.clicked；`w_pz_pzedit_b` 的 dw_master.doubleclicked；`w_pz_pzedit_b` 的 事件 u_pzxxbz；`w_pz_pzedit_bak` 的 dw_master.doubleclicked；`w_pz_pzedit_bak` 的 事件 u_pzxxbz；`w_pz_pzedit_mb` 的 dw_master.doubleclicked；`w_pz_pzedit_mb` 的 事件 u_pzxxbz；`w_pz_pzedit` 的 dw_master.doubleclicked；`w_pz_pzedit` 的 事件 u_pzxxbz

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加类别 | 123,924 389×96 |  |
| cb_2 | 按钮 | 增加 | 1019,924 389×96 |  |
| cb_3 | 按钮 | 删除 | 1545,924 389×96 |  |
| cb_4 | 按钮 | 确定 | 713,1104 389×112 |  |
| cb_5 | 按钮 | 取消 | 1362,1104 389×112 |  |
| dw_1 | 数据窗口 |  | 96,108 471×784 | 数据窗口 `dw_xt_zy_1`（表 zyk）；列：zylb（摘要类别） |
| dw_2 | 数据窗口 |  | 654,108 1559×784 | 数据窗口 `dw_xt_zy_2`（表 zyk）；列：zybm（编码）、zydy（摘要短语）、zylb、usecut、shortcut |
| gb_1 | 分组框 | 类别 | 46,36 567×1032 |  |
| gb_2 | 分组框 | 内容 | 603,36 1646×1032 |  |

- 窗口事件/函数：
  - `open`：读写表 b_rights、zyk

- 提示与校验（1 条）：
  - [cb_4.clicked]「摘要编码重复！是否重输？」（条件：`i = -1`）
