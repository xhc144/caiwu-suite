# 成本会计 · 账务+成本主程序 — 窗口目录：工作台（前缀 `main1`）

尺寸单位为 PowerBuilder Unit（PBU）。96 DPI、系统字体下约为：宽度像素 ≈ PBU × 0.25～0.3，高度像素 ≈ PBU × 0.25～0.28。
“打开入口”只列静态可见的调用方，运行时拼出来的窗口名可能遗漏。名字含 `_bak`、`_old`、`test` 的通常是历史残留。

### w_main1 — 主窗口

- 类型：主窗口（默认）；尺寸：7323×4480 PBU；继承：`wroot_sheet`；菜单：`m_frame_zw`；库：rhzw8_cb.exe（账务+成本主程序）
- 打开入口：菜单「F.文件 › 关闭所有窗口」（35 个菜单中）；`w_bb_main_gs` 的 事件 wf_login；`w_bb_main_pos` 的 事件 wf_login；`w_bb_main` 的 事件 wf_login；`w_login_1` 的 cb_ok.clicked；`w_login_oem` 的 cb_new.clicked；`w_login_oem` 的 cb_ok.clicked；`w_login_qhmk` 的 cb_new.clicked；`w_login_qhmk` 的 cb_ok.clicked；`w_login` 的 cb_new.clicked；`w_login` 的 cb_ok.clicked；`w_pz_pzmb_main` 的 事件 wf_login

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_1 | 数据窗口 |  | 6354,1348 242×196 | 数据窗口 `dw_xt_km_help`（表 kmbm）；列：kmbm（科目编码）、km_mc（科目名称）、kmqc、fbs、sls、yefx、zjm（助记码） |
| dw_2 | 数据窗口 |  | 6363,1556 494×360 | 数据窗口 `dw_xt_xmwh`（表 xmk）；列：xmbm（项目编码）、xm_mc（项目名称）、bz（在用） |
| dw_3 | 数据窗口 |  | 6290,580 494×360 | 数据窗口 `dw_xt_dwwh`（表 dwk）；列：dwbm（客供编号）、dw_mc（客户/供应商名称）、txdz（通讯地址）、yzbm（邮政编码）、lxr（联系人）、lxdh（联系电话）、khyh（开户银行）、yhzh（银行帐号）、nsh（纳税登记号）、bz（在用）、rq（获得日期）、dw_jc（简称） |
| dw_4 | 数据窗口 |  | 6331,972 494×360 | 数据窗口 `dw_xt_bmwh`（表 bmk）；列：bmbm（编号）、bm_mc（部门名称）、bz（在用） |
| dw_5 | 数据窗口 |  | 6427,488 741×152 | 数据窗口 `dw_xt_grwh`（表 grk）；列：grbm（人员编码）、gr_mc（人员名称）、bz（在用） |
| p_0 | 图片 | rhcb_zw_m0.jpg | ,364 923×3836 |  |
| p_11 | 图片 | rhcb_zw_1_0.bmp | 41,500 850×172 |  |
| p_12 | 图片 | rhcb_zw_2_0.bmp | 41,1200 850×172 |  |
| p_13 | 图片 | rhcb_zw_3_0.bmp | 41,1820 850×172 |  |
| p_3 | 图片 | rhcb_m1.jpg | 5, 7680×364 | doubleclicked → `w_test`「金蝶K3数据转入」 |
| p_bsjk | 图片 | bsjk_1.jpg | 4626,100 443×136 |  |
| p_ck | 图片 | rhcb_m_ck_0.bmp | 2501,32 338×196 | clicked → `w_login_qhmk`「用户登录（继承自祖先）」 |
| p_gz | 图片 | rhcb_m_gz_0.bmp | 3186,32 338×196 | clicked → `w_login_qhmk`「用户登录（继承自祖先）」 |
| p_kfzx | 图片 | kfzx_1.jpg | 3694,100 443×136 |  |
| p_rjsj | 图片 | rjsj_1.jpg | 4160,100 443×136 | clicked → `w_login`「用户登录」、`w_login_oem`「用户登录」、`w_bakupdata`「切换套账（取自菜单文字）」 |
| p_zc | 图片 | rhcb_m_zc_0.bmp | 2843,32 338×196 | clicked → `w_login_qhmk`「用户登录（继承自祖先）」 |
| p_zw | 图片 | rhcb_m_zw_0.bmp | 2162,32 338×196 |  |
| st_1_bb | 静态文本 | 报       表 | 87,1024 315×76 | clicked → `w_bb_main`「报表管理」 |
| st_1_bf | 静态文本 | 数据备份 | 87,1108 315×76 | clicked → `w_bf`「数据备份」 |
| st_1_cx | 静态文本 | 凭证查询 | 475,688 370×76 | clicked → `w_pz_see`「凭证浏览查看」 |
| st_1_gz | 静态文本 | 凭证过账 | 87,856 315×76 | clicked → `w_zw_jz`「凭证过账」 |
| st_1_ht | 静态文本 | 合同账款查询 | 475,1024 370×76 | clicked → `w_ht_httj`「合同账款查询」 |
| st_1_hz | 静态文本 | 汇总余额表 | 475,772 370×76 | clicked → `w_zw_ye`「汇总余额表」 |
| st_1_jz | 静态文本 | 月度结转 | 87,940 315×76 | clicked → `w_zw_ydjz`「月度结转」 |
| st_1_km | 静态文本 | 凭证汇总表 | 475,856 370×76 | clicked → `w_pz_kmhz`「凭证汇总」 |
| st_1_mx | 静态文本 | 明   细   账 | 475,940 370×76 | clicked → `w_zc_slz`「明细账」 |
| st_1_pz | 静态文本 | 凭证录入 | 87,688 315×76 | clicked → `w_pz_pzxsb`「凭证序时簿」 |
| st_1_sh | 静态文本 | 凭证审核 | 87,772 315×76 | clicked → `w_pz_tjsh`「批量审核」 |
| st_2 | 静态文本 | 移动端功能 | 475,1108 338×76 | clicked → `w_wb_gn`；clicked 读写表 dba |
| st_2_cw | 静态文本 | 财务费用 | 87,1596 315×76 | clicked → `w_fx_km`「财务分析表」 |
| st_2_dy | 静态文本 | 自定义分析 | 475,1688 370×76 | clicked → `w_fx_main`「财务分析」 |
| st_2_gl | 静态文本 | 管理费用 | 87,1404 315×76 | clicked → `w_fx_km`「财务分析表」 |
| st_2_qt | 静态文本 | 其它科目分析 | 475,1592 370×76 | clicked → `w_fx_km`「财务分析表」 |
| st_2_xs | 静态文本 | 销售费用 | 87,1500 315×76 | clicked → `w_fx_km`「财务分析表」 |
| st_2_yf | 静态文本 | 应付账款 | 475,1496 347×76 | clicked → `w_fx_km`「财务分析表」 |
| st_2_ys | 静态文本 | 应收账款 | 475,1400 347×76 | clicked → `w_fx_km`「财务分析表」 |
| st_2_zl | 静态文本 | 账龄分析 | 87,1688 315×76 | clicked → `w_fx_zl`「账龄分析」 |
| st_3_bf | 静态文本 | 自动备份设置 | 475,2480 370×76 | clicked → `w_autobak`「系统自动备份设置」 |
| st_3_cz | 静态文本 | 用户管理 | 475,2392 370×76 | clicked → `w_xt_users`「用户管理」 |
| st_3_dy | 静态文本 | 打印机设置 | 475,2568 370×76 |  |
| st_3_fz | 静态文本 | 辅助档案 | 87,2480 338×76 | clicked → `w_xt_fhwh`「辅助档案」 |
| st_3_gl | 静态文本 | 套账管理 | 475,2128 370×76 | clicked → `w_tzjl`「套帐管理」 |
| st_3_ht | 静态文本 | 合同档案 | 87,2392 338×76 | clicked → `w_ht_htda`「合同档案管理」 |
| st_3_jz | 静态文本 | 结转类型 | 87,2216 338×76 | clicked → `w_xt_jzwh`「结转类型维护」 |
| st_3_km | 静态文本 | 科目维护 | 87,2040 338×76 | clicked → `w_xt_kmwh`「科目维护」 |
| st_3_lx | 静态文本 | 凭证类型 | 87,2128 338×76 | clicked → `w_xt_pzlx`「凭证类型管理」 |
| st_3_mm | 静态文本 | 自改密码 | 475,2304 370×76 | clicked → `w_pass`「自改密码」 |
| st_3_qc | 静态文本 | 期初录入 | 87,2568 338×76 | clicked → `w_xt_ye_nf`「选择年份」、`w_xt_ye`「期初余额录入」 |
| st_3_tz | 静态文本 | 套账信息 | 475,2040 370×76 | clicked → `w_xt_tz`「套账信息」 |
| st_3_wb | 静态文本 | 外币类型 | 87,2304 297×76 | clicked → `w_xt_fbwh`「外币管理」 |
| st_3_zc | 静态文本 | 凭证账册设置 | 475,2216 370×76 | clicked → `w_xt_tz_zc`「账册设置」 |
| st_bb | 静态文本 | 【时钟版】 | 1394,120 713×148 |  |
| tab_1 | 标签页容器 |  | 1029,344 4649×3028 |  |
| tab_1/tabpage_1 | 用户对象 |  | 55,16 4576×2996 |  |
| tab_1/tabpage_1/p_t_1_zzs | 图片 | rhcb_zw_11_zzs_0.jpg | 1705,1800 658×88 | clicked → `w_zc_zzs`「增值税明细帐」 |
| tab_1/tabpage_1/p_t_1_lr | 图片 | rhcb_zw_1_lr_0.bmp | 187,568 347×292 | clicked → `w_pz_pzxsb`「凭证序时簿」 |
| tab_1/tabpage_1/p_t_1_00 | 图片 | rhcb_zw_m1.jpg | , 6770×3832 |  |
| tab_1/tabpage_1/p_t_1_yr | 图片 | rhcb_zw_1_yr_0.bmp | 489,172 402×328 | clicked → `w_login_1`「切换用户」 |
| tab_1/tabpage_1/p_t_1_sh | 图片 | rhcb_zw_1_sh_0.bmp | 864,568 347×292 | clicked → `w_pz_tjsh`「批量审核」 |
| tab_1/tabpage_1/p_t_1_gz | 图片 | rhcb_zw_1_gz_0.bmp | 1550,572 347×292 | clicked → `w_zw_jz`「凭证过账」 |
| tab_1/tabpage_1/p_t_1_yj | 图片 | rhcb_zw_1_yj_0.bmp | 2217,568 347×292 | clicked → `w_zw_ydjz`「月度结转」 |
| tab_1/tabpage_1/p_t_1_bb | 图片 | rhcb_zw_1_bb_0.bmp | 2917,568 347×292 | clicked → `w_bb_main`「报表管理」 |
| tab_1/tabpage_1/p_t_1_jz | 图片 | rhcb_zw_1_jz_0.bmp | 2235,1104 347×292 | clicked → `w_zw_fz`「结账」 |
| tab_1/tabpage_1/p_t_1_bf | 图片 | rhcb_zw_1_bf_0.bmp | 2926,1104 347×292 | clicked → `w_bf`「数据备份」 |
| tab_1/tabpage_1/p_t_1_cx | 图片 | rhcb_zw_1_cx_0.bmp | 197,1104 347×292 | clicked → `w_pz_see`「凭证浏览查看」 |
| tab_1/tabpage_1/p_t_1_zz | 图片 | rhcb_zw_11_zz_0.bmp | 270,1696 430×88 | clicked → `w_zc_zc`「总分类账」 |
| tab_1/tabpage_1/p_t_1_xj | 图片 | rhcb_zw_11_xj_0.bmp | 270,1920 430×88 | clicked → `w_zc_xjrjz`「日记账」 |
| tab_1/tabpage_1/p_t_1_yh | 图片 | rhcb_zw_11_yh_0.bmp | 270,1808 430×88 | clicked → `w_zc_yhrjz`「银行日记帐」 |
| tab_1/tabpage_1/p_t_1_km | 图片 | rhcb_zw_11_km_0.bmp | 901,2136 658×88 | clicked → `w_pz_kmhz`「凭证汇总」 |
| tab_1/tabpage_1/p_t_1_hz | 图片 | rhcb_zw_11_hz_0.bmp | 901,1688 658×88 | clicked → `w_zw_ye`「汇总余额表」 |
| tab_1/tabpage_1/p_t_1_wb | 图片 | rhcb_zw_11_wb_0.bmp | 901,1800 658×88 | clicked → `w_zw_wbye`「外币余额表」 |
| tab_1/tabpage_1/p_t_1_fz | 图片 | rhcb_zw_11_fz_0.bmp | 901,1912 658×88 | clicked → `w_zw_fhye`「辅助项目余额表」 |
| tab_1/tabpage_1/p_t_1_fzwb | 图片 | rhcb_zw_11_fzwb_0.bmp | 901,2024 658×88 | clicked → `w_zw_fhwbye`「辅助项目外币余额表」 |
| tab_1/tabpage_1/p_t_1_mx | 图片 | rhcb_zw_11_mx_0.bmp | 1696,1688 663×88 | clicked → `w_zc_slz`「明细账」 |
| tab_1/tabpage_1/p_t_1_dl | 图片 | rhcb_zw_11_dl_0.bmp | 1696,1912 663×88 | clicked → `w_zc_dlz`「多栏账」 |
| tab_1/tabpage_1/p_t_1_fzmx | 图片 | rhcb_zw_11_fzmx_0.bmp | 1691,2024 663×88 | clicked → `w_zc_fhslz`「辅助明细账」 |
| tab_1/tabpage_1/p_t_1_fzdl | 图片 | rhcb_zw_11_fzdl_0.bmp | 1687,2136 663×88 | clicked → `w_zc_fhdlz`「辅助多栏账」 |
| tab_1/tabpage_1/p_t_1_kc | 图片 | rhcb_zw_11_kc_0.bmp | 2491,1696 800×88 | clicked → `w_zw_slye`「库存数量金额表」 |
| tab_1/tabpage_1/p_t_1_fzkc | 图片 | rhcb_zw_11_fzkc_0.bmp | 2491,1808 800×88 | clicked → `w_zw_fhslye`「辅助项目库存数量金额表」 |
| tab_1/tabpage_1/p_t_1_ht | 图片 | rhcb_zw_11_ht_0.bmp | 2491,1920 800×88 | clicked → `w_ht_httj`「合同账款查询」 |
| tab_1/tabpage_1/p_t_1_ph | 图片 | rhcb_zw_11_ph_0.bmp | 2491,2032 800×88 | clicked → `w_zc_xjll`「现金流量试算平衡表」 |
| tab_1/tabpage_2 | 用户对象 |  | 55,16 4576×2996 |  |
| tab_1/tabpage_2/p_t_2_00 | 图片 | rhcb_zw_m2.jpg | , 6770×3832 |  |
| tab_1/tabpage_2/p_t_2_gl | 图片 | rhcb_zw_2_gl_0.bmp | 256,424 347×292 | clicked → `w_fx_km`「财务分析表」 |
| tab_1/tabpage_2/p_t_2_xs | 图片 | rhcb_zw_2_xs_0.bmp | 1111,424 347×292 | clicked → `w_fx_km`「财务分析表」 |
| tab_1/tabpage_2/p_t_2_cw | 图片 | rhcb_zw_2_cw_0.bmp | 1989,424 347×292 | clicked → `w_fx_km`「财务分析表」 |
| tab_1/tabpage_2/p_t_2_ys | 图片 | rhcb_zw_2_ys_0.bmp | 2875,424 347×292 | clicked → `w_fx_km`「财务分析表」 |
| tab_1/tabpage_2/p_t_2_yf | 图片 | rhcb_zw_2_yf_0.bmp | 233,920 347×292 | clicked → `w_fx_km`「财务分析表」 |
| tab_1/tabpage_2/p_t_2_qt | 图片 | rhcb_zw_2_qt_0.bmp | 1111,916 411×296 | clicked → `w_fx_km`「财务分析表」 |
| tab_1/tabpage_2/p_t_2_dy | 图片 | rhcb_zw_2_dy_0.bmp | 1970,916 411×296 | clicked → `w_fx_main`「财务分析」 |
| tab_1/tabpage_3 | 用户对象 |  | 55,16 4576×2996 |  |
| tab_1/tabpage_3/p_1 | 图片 | rhcb_zw_m3.jpg | , 6770×3832 |  |
| tab_1/tabpage_3/p_t_3_km | 图片 | rhcb_zw_3_km_0.bmp | 261,232 347×292 | clicked → `w_xt_kmwh`「科目维护」 |
| tab_1/tabpage_3/p_t_3_zy | 图片 | rhcb_zw_3_zy_0.bmp | 1147,232 347×292 | clicked → `w_xt_zy`「摘要管理」 |
| tab_1/tabpage_3/p_t_3_lx | 图片 | rhcb_zw_3_lx_0.bmp | 2034,232 347×292 | clicked → `w_xt_pzlx`「凭证类型管理」 |
| tab_1/tabpage_3/p_t_3_jz | 图片 | rhcb_zw_3_jz_0.bmp | 2921,232 347×292 | clicked → `w_xt_jzwh`「结转类型维护」 |
| tab_1/tabpage_3/p_t_3_js | 图片 | rhcb_zw_3_js_0.bmp | 261,724 347×292 | clicked → `w_xt_jslb`「结算类别管理」 |
| tab_1/tabpage_3/p_t_3_wb | 图片 | rhcb_zw_3_wb_0.bmp | 1147,724 347×292 | clicked → `w_xt_fbwh`「外币管理」 |
| tab_1/tabpage_3/p_t_3_ht | 图片 | rhcb_zw_3_ht_0.bmp | 2034,724 347×292 | clicked → `w_ht_htda`「合同档案管理」 |
| tab_1/tabpage_3/p_t_3_tz | 图片 | rhcb_zw_3_tz_0.bmp | 1147,1224 347×292 | clicked → `w_tzjl`「套帐管理」 |
| tab_1/tabpage_3/p_t_3_xx | 图片 | rhcb_zw_3_xx_0.bmp | 261,1224 347×292 | clicked → `w_xt_tz`「套账信息」 |
| tab_1/tabpage_3/p_t_3_zc | 图片 | rhcb_zw_3_zc_0.bmp | 2034,1224 347×292 | clicked → `w_xt_tz_zc`「账册设置」 |
| tab_1/tabpage_3/p_t_3_mm | 图片 | rhcb_zw_3_mm_0.bmp | 2921,1224 347×292 | clicked → `w_pass`「自改密码」 |
| tab_1/tabpage_3/p_t_3_cz | 图片 | rhcb_zw_3_cz_0.bmp | 256,1724 411×296 | clicked → `w_xt_users`「用户管理」 |
| tab_1/tabpage_3/p_t_3_bf | 图片 | rhcb_zw_3_bf_0.bmp | 1115,1724 411×296 | clicked → `w_autobak`「系统自动备份设置」 |
| tab_1/tabpage_3/p_t_3_rz | 图片 | rhcb_zw_3_rz_0.bmp | 2034,1728 347×292 | clicked → `w_xt_dlxx`「操作日志」 |
| tab_1/tabpage_3/p_t_3_dy | 图片 | rhcb_zw_3_dy_0.bmp | 2889,1724 411×296 |  |
| tab_1/tabpage_3/p_t_3_fz | 图片 | rhcb_zw_3_fz_0.bmp | 2921,724 347×292 | clicked → `w_xt_fhwh`「辅助档案」 |

- 窗口事件/函数：
  - `open`：读写表 dba
  - `wf_open`：读写表 kmbm

- 提示与校验（4 条）：
  - [st_2.clicked]「请您插入移动端功能所绑定的加密狗，再使用本功能！~r若您的加密狗未绑定，请先到【套账信息】-【移动端设置】开通绑定后再使用。」（条件：`s_no <> gs_no`）
  - [st_3_cz.clicked]「您非系统管理员，不能进入操作员管理！~r请使用MANAGER用户登录后再进入此模块！」（条件：`upper(sename) <> "MANAGER" and upper(sename) <> "RUNSOFT"`）
  - [st_3_gl.clicked]「您非系统管理员，不能进入套账管理！~r请使用MANAGER用户登录后再进入此模块！」（条件：`upper(sename) <> "MANAGER" and upper(sename) <> "RUNSOFT"`）
  - [tab_1/tabpage_3/p_t_3_tz.clicked]「您非系统管理员，不能进入套帐管理！~r请使用MANAGER用户登录后再进入此模块！」（条件：`upper(sename) <> "MANAGER" and upper(sename) <> "RUNSOFT"`）

### w_main1_cb — 主窗口

- 类型：主窗口（默认）；尺寸：7323×4480 PBU；继承：`wroot_sheet`；菜单：`m_frame_cb`；库：rhzw8_cb.exe（账务+成本主程序）
- 打开入口：`w_login_qhmk` 的 cb_ok.clicked；`w_login` 的 cb_ok.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_1 | 数据窗口 |  | 6277,1824 242×196 | 数据窗口 `dw_xt_km_help`（表 kmbm）；列：kmbm（科目编码）、km_mc（科目名称）、kmqc、fbs、sls、yefx、zjm（助记码） |
| dw_2 | 数据窗口 |  | 6450,1352 494×360 | 数据窗口 `dw_xt_xmwh`（表 xmk）；列：xmbm（项目编码）、xm_mc（项目名称）、bz（在用） |
| dw_3 | 数据窗口 |  | 6290,580 494×360 | 数据窗口 `dw_xt_dwwh`（表 dwk）；列：dwbm（客供编号）、dw_mc（客户/供应商名称）、txdz（通讯地址）、yzbm（邮政编码）、lxr（联系人）、lxdh（联系电话）、khyh（开户银行）、yhzh（银行帐号）、nsh（纳税登记号）、bz（在用）、rq（获得日期）、dw_jc（简称） |
| dw_4 | 数据窗口 |  | 6331,972 494×360 | 数据窗口 `dw_xt_bmwh`（表 bmk）；列：bmbm（编号）、bm_mc（部门名称）、bz（在用） |
| dw_5 | 数据窗口 |  | 6427,488 741×152 | 数据窗口 `dw_xt_grwh`（表 grk）；列：grbm（人员编码）、gr_mc（人员名称）、bz（在用） |
| p_0 | 图片 | rhcb_ck_m0.jpg | ,364 923×3836 |  |
| p_11 | 图片 | rhcb_zw_1_0.bmp | 41,500 850×172 |  |
| p_12 | 图片 | rhcb_zw_3_0.bmp | 41,1384 850×172 |  |
| p_3 | 图片 | rhcb_m1.jpg | , 7680×364 |  |
| p_ck | 图片 | rhcb_m_ck_0.bmp | 2583,56 338×196 |  |
| p_gz | 图片 | rhcb_m_gz_0.bmp | 3278,56 338×196 | clicked → `w_login_qhmk`「用户登录（继承自祖先）」 |
| p_kfzx | 图片 | kfzx_1.jpg | 3721,100 443×136 |  |
| p_rjsj | 图片 | rjsj_1.jpg | 4210,100 443×136 | clicked → `w_login`「用户登录」、`w_login_oem`「用户登录」、`w_bakupdata`「切换套账（取自菜单文字）」 |
| p_zc | 图片 | rhcb_m_zc_0.bmp | 2930,56 338×196 | clicked → `w_login_qhmk`「用户登录（继承自祖先）」 |
| p_zw | 图片 | rhcb_m_zw_0.bmp | 2235,56 338×196 | clicked → `w_login_qhmk`「用户登录（继承自祖先）」 |
| st_1_cb | 静态文本 | 成本利润表 | 475,1024 370×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hzsj_cblr`「收入成本利润表(仅销售出库)」 |
| st_1_ch | 静态文本 | 出库汇总 | 475,856 370×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hzsj_ck`「出库汇总」 |
| st_1_ck | 静态文本 | 出库单 | 96,772 320×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_ck_ck`「出库单浏览」 |
| st_1_hs | 静态文本 | 成本核算 | 96,940 320×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hz`「成本核算」 |
| st_1_hzyeb | 静态文本 | 汇总余额表 | 475,1192 370×76 | clicked → `w_zw_ye`「汇总余额表」 |
| st_1_kc | 静态文本 | 当前库存 | 475,688 370×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_ck_kc`「当前库存」 |
| st_1_mxz | 静态文本 | 销存明细表 | 457,1288 370×76 |  |
| st_1_pd | 静态文本 | 月末盘点 | 96,856 320×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_pdk`「月末盘点表」 |
| st_1_pz | 静态文本 | 凭证生成 | 96,1024 320×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_pz`「凭证生成」 |
| st_1_rh | 静态文本 | 入库汇总 | 475,772 370×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hzsj_rk`「入库汇总」 |
| st_1_rk | 静态文本 | 入库单 | 96,688 320×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_ck_rk`「入库单浏览」 |
| st_1_tz | 静态文本 | 库存台账 | 475,940 370×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_ck_tz`「库存台帐」 |
| st_1_xs | 静态文本 | 销售明细账 | 475,1108 370×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_ck_xsmxz`「销售明细账--选择」 |
| st_1_zwmxz | 静态文本 | 明细账 | 96,1108 338×76 | clicked → `w_zc_slz`「明细账」 |
| st_2_cp | 静态文本 | 产品档案 | 96,1580 320×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_cpda`「产品档案维护」 |
| st_2_dy | 静态文本 | 打印机设置 | 475,1868 370×76 |  |
| st_2_gs | 静态文本 | 打印格式 | 475,1764 370×76 | clicked → `w_bb_main_pos`「报表管理」 |
| st_2_mm | 静态文本 | 自改密码 | 475,1676 347×76 | clicked → `w_pass`「自改密码」 |
| st_2_qc | 静态文本 | 期初录入 | 96,1676 320×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_qc`「库存期初录入」 |
| st_2_tz | 静态文本 | 套账信息 | 475,1580 347×76 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_tzxx`「仓库模块套账信息」 |
| st_bb | 静态文本 | 【时钟版】 | 1454,120 713×148 |  |
| tab_1 | 标签页容器 |  | 946,368 4649×3028 |  |
| tab_1/tabpage_1 | 用户对象 |  | 55,16 4576×2996 |  |
| tab_1/tabpage_1/p_t_1_hzyeb | 图片 | rhcb_zw_11_hz_0.bmp | 2030,1680 658×88 | clicked → `w_zw_ye`「汇总余额表」 |
| tab_1/tabpage_1/p_t_1_zwmxz | 图片 | rhcb_zw_11_mx_0.bmp | 2030,1804 663×88 | clicked → `w_zc_slz`「明细账」 |
| tab_1/tabpage_1/p_t_1_00 | 图片 | rhcb_ck_m1.jpg | , 6770×3832 |  |
| tab_1/tabpage_1/p_t_1_rk | 图片 | rhcb_ck_1_rk_0.bmp | 201,364 347×292 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_ck_rk`「入库单浏览」 |
| tab_1/tabpage_1/p_t_1_kc | 图片 | rhcb_ck_1_kc_0.bmp | 891,692 347×292 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_ck_kc`「当前库存」 |
| tab_1/tabpage_1/p_t_1_hs | 图片 | rhcb_ck_1_hs_0.bmp | 2272,692 347×292 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hz`「成本核算」 |
| tab_1/tabpage_1/p_t_1_pd | 图片 | rhcb_ck_1_pd_0.bmp | 1623,692 347×292 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_pdk`「月末盘点表」 |
| tab_1/tabpage_1/p_t_1_pz | 图片 | rhcb_ck_1_pz_0.bmp | 2976,692 347×292 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_pz`「凭证生成」 |
| tab_1/tabpage_1/p_t_1_ck | 图片 | rhcb_ck_1_ck_0.bmp | 201,1056 347×292 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_ck_ck`「出库单浏览」 |
| tab_1/tabpage_1/p_t_1_ch | 图片 | rhcb_ck_1_ch_0.bmp | 279,1916 485×88 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hzsj_ck`「出库汇总」 |
| tab_1/tabpage_1/p_t_1_rc | 图片 | rhcb_ck_1_rc_0.bmp | 279,1804 485×88 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_ck_cx_rkd`「入库单综合查询」 |
| tab_1/tabpage_1/p_t_1_rh | 图片 | rhcb_ck_1_rh_0.bmp | 279,1692 485×88 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hzsj_rk`「入库汇总」 |
| tab_1/tabpage_1/p_t_1_tz | 图片 | rhcb_ck_1_tz_0.bmp | 1065,1804 430×88 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_ck_tz`「库存台帐」 |
| tab_1/tabpage_1/p_t_1_lr | 图片 | rhcb_ck_1_cb_0.bmp | 1065,1916 430×88 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hzsj_cblr`「收入成本利润表(仅销售出库)」 |
| tab_1/tabpage_1/p_t_1_jxc | 图片 | rhcb_ck_1_jxc_0.bmp | 1065,1692 663×88 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hzsj_sfc`「进销存表」 |
| tab_1/tabpage_1/p_t_1_cc | 图片 | rhcb_ck_1_cc_0.bmp | 279,2028 485×88 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_ck_cx_ckd`「出库单综合查询」 |
| tab_1/tabpage_1/p_t_1_mxz | 图片 | rhcb_ck_1_MXZ_0.bmp | 1769,2020 558×88 |  |
| tab_1/tabpage_1/p_t_1_xs | 图片 | rhcb_ck_1_xs_0.bmp | 1065,2028 663×88 | clicked → `w_cb_xt_kgzb`「成本初始化」、`w_ck_xsmxz`「销售明细账--选择」 |
| tab_1/tabpage_2 | 用户对象 |  | 55,16 4576×2996 |  |
| tab_1/tabpage_2/p_t_2_00 | 图片 | rhcb_ck_m2.jpg | , 6770×3832 |  |
| tab_1/tabpage_2/p_t_2_dy | 图片 | rhcb_ck_2_dy_0.bmp | 288,764 411×296 |  |
| tab_1/tabpage_2/p_t_2_gs | 图片 | rhcb_ck_2_gs_0.bmp | 2011,236 347×292 | clicked → `w_bb_main_pos`「报表管理」 |
| tab_1/tabpage_2/p_t_2_tz | 图片 | rhcb_ck_2_tz_0.bmp | 2917,232 347×292 | clicked → `w_cb_tzxx`「仓库模块套账信息」 |
| tab_1/tabpage_2/p_t_2_cp | 图片 | rhcb_ck_2_cp_0.bmp | 288,232 347×292 | clicked → `w_cb_cpda`「产品档案维护」 |
| tab_1/tabpage_2/p_t_2_qc | 图片 | rhcb_ck_2_qc_0.bmp | 1152,232 347×292 | clicked → `w_cb_qc`「库存期初录入」 |
| tab_1/tabpage_3 | 用户对象 |  | 55,16 4576×2996 |  |

- 提示与校验（3 条）：
  - [st_1_cb.clicked]「第一次使用本模块需要先做系统初始化!」（条件：`kg_bz = "2"`）
  - [st_1_cb.clicked]「您非系统管理员，不能进行系统初始化！~r请使用MANAGER用户登录后再做！」（条件：`upper(sename) <> "MANAGER"`）
  - [st_1_mxz.clicked]「请先做系统初始化!」（条件：`kg_bz = "2"`）

### w_main1_gz — 主窗口

- 类型：主窗口（默认）；尺寸：7323×4480 PBU；继承：`wroot_sheet`；菜单：`m_frame_gz`；库：rhzw8_cb.exe（账务+成本主程序）
- 打开入口：`w_login_qhmk` 的 cb_ok.clicked；`w_login` 的 cb_ok.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| p_0 | 图片 | rhcb_gz_m0.jpg | ,364 923×3836 |  |
| p_11 | 图片 | rhcb_zw_1_0.bmp | 41,500 850×172 |  |
| p_13 | 图片 | rhcb_zw_3_0.bmp | 41,1016 850×172 |  |
| p_3 | 图片 | rhcb_m1.jpg | , 7680×364 |  |
| p_ck | 图片 | rhcb_m_ck_0.bmp | 2537,56 338×196 | clicked → `w_login_qhmk`「用户登录（继承自祖先）」 |
| p_gz | 图片 | rhcb_m_gz_0.bmp | 3205,56 338×196 |  |
| p_kfzx | 图片 | kfzx_1.jpg | 3634,100 443×136 |  |
| p_rjsj | 图片 | rjsj_1.jpg | 4123,100 443×136 | clicked → `w_login`「用户登录」、`w_login_oem`「用户登录」、`w_bakupdata`「切换套账（取自菜单文字）」 |
| p_zc | 图片 | rhcb_m_zc_0.bmp | 2871,56 338×196 | clicked → `w_login_qhmk`「用户登录（继承自祖先）」 |
| p_zw | 图片 | rhcb_m_zw_0.bmp | 2208,56 338×196 | clicked → `w_login_qhmk`「用户登录（继承自祖先）」 |
| st_1_gz | 静态文本 | 结  账 | 101,856 320×76 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_jz`「工资结账」 |
| st_1_gzb | 静态文本 | 工资表 | 475,772 343×76 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 |
| st_1_gzgl | 静态文本 | 工资管理 | 101,688 320×76 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 |
| st_1_gzt | 静态文本 | 工资条 | 475,688 343×76 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 |
| st_1_hzb | 静态文本 | 工资汇总表 | 475,856 343×76 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 |
| st_3_bm | 静态文本 | 部门维护 | 101,1240 320×76 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_bmwh`「部门维护」 |
| st_3_dy | 静态文本 | 打印机设置 | 475,1408 343×76 |  |
| st_3_gs | 静态文本 | 打印格式 | 101,1680 343×76 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_xt_dysz`「打印宽度设置」 |
| st_3_jg | 静态文本 | 工资结构 | 101,1412 320×72 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_xt_gzsz`「工资栏目定义」 |
| st_3_js | 静态文本 | 公式设置 | 101,1496 320×76 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_xt_gssz`「计算公式定义」 |
| st_3_mm | 静态文本 | 自改密码 | 475,1324 343×76 | clicked → `w_pass`「自改密码」 |
| st_3_rs | 静态文本 | 人事管理 | 101,1324 320×76 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_rsgl`「人事管理」 |
| st_3_ss | 静态文本 | 个税起征点 | 101,1588 320×76 | clicked → `w_xt_kgzb_1_gz`「套帐信息」 |
| st_3_tz | 静态文本 | 套账信息 | 475,1240 343×76 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_xt_kgzb_1_gz`「套帐信息」 |
| st_bb | 静态文本 | 【时钟版】 | 1481,120 713×148 |  |
| tab_1 | 标签页容器 |  | 942,368 4649×3028 |  |
| tab_1/tabpage_1 | 用户对象 |  | 55,16 4576×2996 |  |
| tab_1/tabpage_1/p_t_1_00 | 图片 | rhcb_gz_m1.jpg | , 6770×3832 |  |
| tab_1/tabpage_1/p_t_1_gz | 图片 | rhcb_gz_1_gz_0.bmp | 1710,576 347×292 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_jz`「工资结账」 |
| tab_1/tabpage_1/p_t_1_gzgl | 图片 | rhcb_gz_1_gzgl_0.bmp | 489,576 347×292 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 |
| tab_1/tabpage_1/p_t_1_ydb | 图片 | rhcb_gz_1_ydb_0.bmp | 882,1680 530×88 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」、`w_gzgl_lshz`「查询累计汇总表」 |
| tab_1/tabpage_1/p_t_1_gzb | 图片 | rhcb_gz_1_gzb_0.bmp | 347,1820 430×88 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 |
| tab_1/tabpage_1/p_t_1_gzt | 图片 | rhcb_gz_1_gzt_0.bmp | 347,1680 430×88 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 |
| tab_1/tabpage_1/p_t_1_hzb | 图片 | rhcb_gz_1_hzb_0.bmp | 347,1960 430×88 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 |
| tab_1/tabpage_1/p_t_1_pm | 图片 | rhcb_gz_1_pm_0.bmp | 882,1820 530×88 | clicked → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 |
| tab_1/tabpage_2 | 用户对象 |  | 55,16 4576×2996 |  |
| tab_1/tabpage_3 | 用户对象 |  | 55,16 4576×2996 |  |
| tab_1/tabpage_3/p_1 | 图片 | rhcb_gz_m3.jpg | , 6770×3832 |  |
| tab_1/tabpage_3/p_t_3_bm | 图片 | rhcb_gz_3_bm_0.bmp | 270,244 347×292 | clicked → `w_gz_bmwh`「部门维护」 |
| tab_1/tabpage_3/p_t_3_rs | 图片 | rhcb_gz_3_rs_0.bmp | 1152,244 347×292 | clicked → `w_gz_rsgl`「人事管理」 |
| tab_1/tabpage_3/p_t_3_jg | 图片 | rhcb_gz_3_jg_0.bmp | 2030,244 347×292 | clicked → `w_xt_gzsz`「工资栏目定义」 |
| tab_1/tabpage_3/p_t_3_js | 图片 | rhcb_gz_3_js_0.bmp | 2880,244 347×292 | clicked → `w_xt_gssz`「计算公式定义」 |
| tab_1/tabpage_3/p_t_3_ss | 图片 | rhcb_gz_3_ss_0.bmp | 1152,740 411×296 | clicked → `w_xt_kgzb_1_gz`「套帐信息」 |
| tab_1/tabpage_3/p_t_3_gs | 图片 | rhcb_gz_3_gs_0.bmp | 2030,744 347×292 | clicked → `w_xt_dysz`「打印宽度设置」 |
| tab_1/tabpage_3/p_t_3_tz | 图片 | rhcb_gz_3_tz_0.bmp | 2880,744 347×292 | clicked → `w_xt_kgzb_1_gz`「套帐信息」 |
| tab_1/tabpage_3/p_t_3_dy | 图片 | rhcb_zw_3_dy_0.bmp | 270,736 411×296 |  |

- 窗口事件/函数：
  - `wf_open`：读写表 gz_gzk

- 提示与校验（3 条）：
  - [st_1_gz.clicked]「第一次使用本模块需要先做系统初始化!」（条件：`kg_bz = "2"`）
  - [st_1_gz.clicked]「您非系统管理员，不能进行系统初始化！~r请使用MANAGER用户登录后再做！」（条件：`upper(sename) <> "MANAGER"`）
  - [tab_1/tabpage_3/p_t_3_bm.clicked]「请先做系统初始化!」（条件：`kg_bz = "2"`）

### w_main1_zc — 主窗口

- 类型：主窗口（默认）；尺寸：7323×4480 PBU；继承：`wroot_sheet`；菜单：`m_frame_zc`；库：rhzw8_cb.exe（账务+成本主程序）
- 打开入口：`w_login_qhmk` 的 cb_ok.clicked；`w_login` 的 cb_ok.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| p_0 | 图片 | rhcb_zc_m0.jpg | ,364 923×3836 |  |
| p_11 | 图片 | rhcb_zw_1_0.bmp | 41,500 850×172 |  |
| p_13 | 图片 | rhcb_zw_3_0.bmp | 46,1124 850×172 |  |
| p_3 | 图片 | rhcb_m1.jpg | , 7680×364 |  |
| p_ck | 图片 | rhcb_m_ck_0.bmp | 2606,80 338×196 | clicked → `w_login_qhmk`「用户登录（继承自祖先）」 |
| p_gz | 图片 | rhcb_m_gz_0.bmp | 3264,80 338×196 | clicked → `w_login_qhmk`「用户登录（继承自祖先）」 |
| p_kfzx | 图片 | kfzx_1.jpg | 3707,100 443×136 |  |
| p_rjsj | 图片 | rjsj_1.jpg | 4187,100 443×136 | clicked → `w_login`「用户登录」、`w_login_oem`「用户登录」、`w_bakupdata`「切换套账（取自菜单文字）」 |
| p_zc | 图片 | rhcb_m_zc_2.bmp | 2935,80 338×196 |  |
| p_zw | 图片 | rhcb_m_zw_0.bmp | 2277,80 338×196 | clicked → `w_login_qhmk`「用户登录（继承自祖先）」 |
| st_1_cx | 静态文本 | 资产分布表 | 503,868 370×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 |
| st_1_fb | 静态文本 | 打印资产标签 | 503,952 370×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 |
| st_1_fz | 静态文本 | 附属设备表 | 69,952 361×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 |
| st_1_jt | 静态文本 | 资产减少清单 | 503,784 338×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 |
| st_1_mx | 静态文本 | 资产明细账 | 69,700 411×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 |
| st_1_qd | 静态文本 | 资产清单 | 69,784 370×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 |
| st_1_tz | 静态文本 | 固定资产台帐 | 69,868 361×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 |
| st_1_zj | 静态文本 | 到期资产清单 | 69,1036 361×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 |
| st_1_zx | 静态文本 | 资产增加清单 | 503,700 361×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 |
| st_3_bm | 静态文本 | 部门设置 | 78,1404 361×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_sydw`「部门维护」 |
| st_3_csh | 静态文本 | 资产初始化 | 78,1324 361×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」 |
| st_3_dy | 静态文本 | 打印机设置 | 471,1608 370×76 |  |
| st_3_lb | 静态文本 | 资产类别 | 78,1496 361×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_sblb`「设备类别维护」 |
| st_3_mm | 静态文本 | 自改密码 | 471,1516 370×76 | clicked → `w_pass`「自改密码」 |
| st_3_pz | 静态文本 | 凭证设置 | 475,1424 361×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_xt_kgzb_1_zc`「套帐信息」 |
| st_3_tz | 静态文本 | 套账信息 | 471,1332 370×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_xt_kgzb_1_zc`「套帐信息」 |
| st_3_yt | 静态文本 | 资产用途 | 78,1588 361×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_sbyt`「用途维护」 |
| st_3_zt | 静态文本 | 使用状态 | 78,1680 361×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_sbzt`「设备状态维护」 |
| st_3_zx | 静态文本 | 注销原因 | 78,1772 361×76 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_sbzx`「注销原因维护」 |
| st_bb | 静态文本 | 【时钟版】 | 1422,120 713×148 |  |
| tab_1 | 标签页容器 |  | 1019,364 6400×3028 |  |
| tab_1/tabpage_1 | 用户对象 |  | 55,16 6327×2996 |  |
| tab_1/tabpage_1/p_t_1_00 | 图片 | rhcb_zc_m1.jpg | , 6830×4200 |  |
| tab_1/tabpage_1/p_t_1_zj | 图片 | rhcb_zc_1_zj_0.bmp | 1125,252 402×328 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_qxfz`「取消折旧」 |
| tab_1/tabpage_1/p_t_1_tz | 图片 | rhcb_zC_1_TZ_0.bmp | 338,876 402×328 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 |
| tab_1/tabpage_1/p_t_1_jt | 图片 | rhcb_zc_1_jt_0.bmp | 1134,868 402×328 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zjjs`「计提折旧」 |
| tab_1/tabpage_1/p_t_1_cx | 图片 | rhcb_zc_1_cx_0.bmp | 2725,864 402×328 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zjgl`「折旧查询」 |
| tab_1/tabpage_1/p_t_1_zx | 图片 | rhcb_zc_1_zx_0.bmp | 1934,872 402×328 | clicked → `w_xt_kgzb_zc`「固定资产初始化」、`w_zjgl`「折旧查询」 |
| tab_1/tabpage_2 | 用户对象 |  | 55,16 6327×2996 |  |
| tab_1/tabpage_3 | 用户对象 |  | 55,16 6327×2996 |  |
| tab_1/tabpage_3/p_1 | 图片 | rhcb_zc_m3.jpg | , 6770×3832 |  |
| tab_1/tabpage_3/p_t_3_bm | 图片 | rhcb_zc_3_bm_0.bmp | 283,240 347×292 | clicked → `w_zc_sydw`「部门维护」 |
| tab_1/tabpage_3/p_t_3_lb | 图片 | rhcb_zc_3_lb_0.bmp | 1166,236 411×296 | clicked → `w_zc_sblb`「设备类别维护」 |
| tab_1/tabpage_3/p_t_3_yt | 图片 | rhcb_zc_3_yt_0.bmp | 2011,236 411×296 | clicked → `w_zc_sbyt`「用途维护」 |
| tab_1/tabpage_3/p_t_3_zt | 图片 | rhcb_zc_3_zt_0.bmp | 2880,236 411×296 | clicked → `w_zc_sbzt`「设备状态维护」 |
| tab_1/tabpage_3/p_t_3_zx | 图片 | rhcb_zc_3_zx_0.bmp | 283,732 347×292 | clicked → `w_zc_sbzx`「注销原因维护」 |
| tab_1/tabpage_3/p_t_3_pz | 图片 | rhcb_zc_3_pz_0.bmp | 1166,732 347×292 | clicked → `w_xt_kgzb_1_zc`「套帐信息」 |
| tab_1/tabpage_3/p_t_3_tz | 图片 | rhcb_zc_3_tz_0.bmp | 2011,732 347×292 | clicked → `w_xt_kgzb_1_zc`「套帐信息」 |
| tab_1/tabpage_3/p_t_3_dy | 图片 | rhcb_zw_3_dy_0.bmp | 2880,728 411×296 |  |

- 提示与校验（5 条）：
  - [st_1_cx.clicked]「第一次使用本模块需要先做系统初始化!」（条件：`kg_bz = "2"`）
  - [st_1_cx.clicked]「您非系统管理员，不能进行系统初始化！~r请使用MANAGER用户登录后再做！」（条件：`upper(sename) <> "MANAGER"`）
  - [st_1_fb.clicked]「请先指定具体的固定资产，再点菜单【统计报表】-【打印资产标签】」
  - [st_1_fz.clicked]「请先指定具体的固定资产，再点菜单【统计报表】-【附属设备表】」
  - [tab_1/tabpage_3/p_t_3_bm.clicked]「请先做系统初始化!」（条件：`kg_bz = "2"`）
