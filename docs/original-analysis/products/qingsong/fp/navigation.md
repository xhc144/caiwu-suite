# 轻松会计 · 发票/进销存模块 — 启动流程、工作台与可达性

从主框架 `w_frame` 与登录窗口出发，沿“菜单项 → 窗口”“按钮/事件 → 窗口”“全局函数 → 窗口”“内嵌用户对象”静态边计算可达性。

## 启动流程

- 应用对象 `rh_pos.apl` 的 open 事件：读取 `rhzw8.ini`，检查加密狗/注册（`f_check_usbid`、`w_login_ts`），再打开主框架 `w_frame`（MDI）。
- `w_frame` 的 open 事件把标题设为软件名，打开登录窗口 `w_login`（OEM 版为 `w_login_oem`）。
- 登录窗口按钮「搜索」→ `w_xt_tz_find`「套账查找」
- 登录窗口按钮「Y. 确 认」→ `w_main1_fp`「主窗口」

## 工作台 `w_main1`「主窗口」

图标式导航首页（sheet）。图标是图片（文字画在图里），下面按控件列出点击后打开的窗口：

- 图标（rhcb_m1.jpg） `p_3` → `w_test`
- 图标（rhcb_m_ck_0.bmp） `p_ck` → `w_login_qhmk`「用户登录」
- 图标（rhcb_m_gz_0.bmp） `p_gz` → `w_login_qhmk`「用户登录」
- 图标（rjsj_1.jpg） `p_rjsj` → `w_login`「用户登录」、`w_login_oem`「用户登录」、`w_bakupdata`
- 图标（rhcb_m_zc_0.bmp） `p_zc` → `w_login_qhmk`「用户登录」
- 文字「报       表」 `st_1_bb` → `w_bb_main`「报表管理」
- 文字「数据备份」 `st_1_bf` → `w_bf`「数据备份」
- 文字「凭证查询」 `st_1_cx` → `w_pz_see`「凭证浏览查看」
- 文字「凭证过账」 `st_1_gz` → `w_zw_jz`「凭证过账」
- 文字「合同账款查询」 `st_1_ht` → `w_ht_httj`「合同账款查询」
- 文字「汇总余额表」 `st_1_hz` → `w_zw_ye`「汇总余额表」
- 文字「月度结转」 `st_1_jz` → `w_zw_ydjz`「月度结转」
- 文字「科目汇总表」 `st_1_km` → `w_pz_kmhz`「凭证汇总」
- 文字「明   细   账」 `st_1_mx` → `w_zc_slz`「明细账」
- 文字「凭证录入」 `st_1_pz` → `w_pz_pzxsb`「凭证序时簿」
- 文字「凭证审核」 `st_1_sh` → `w_pz_tjsh`「批量审核」
- 文字「移动端功能」 `st_2` → `w_wb_gn`
- 文字「财务费用」 `st_2_cw` → `w_fx_km`「财务分析表」
- 文字「自定义分析」 `st_2_dy` → `w_fx_main`「财务分析」
- 文字「管理费用」 `st_2_gl` → `w_fx_km`「财务分析表」
- 文字「其它科目分析」 `st_2_qt` → `w_fx_km`「财务分析表」
- 文字「销售费用」 `st_2_xs` → `w_fx_km`「财务分析表」
- 文字「应付账款」 `st_2_yf` → `w_fx_km`「财务分析表」
- 文字「应收账款」 `st_2_ys` → `w_fx_km`「财务分析表」
- 文字「账龄分析」 `st_2_zl` → `w_fx_zl`「账龄分析」
- 文字「自动备份设置」 `st_3_bf` → `w_autobak`「系统自动备份设置」
- 文字「操作员管理」 `st_3_cz` → `w_xt_users`「用户管理」
- 文字「辅助档案」 `st_3_fz` → `w_xt_fhwh`「辅助档案」
- 文字「套账管理」 `st_3_gl` → `w_tzjl`「套帐管理」
- 文字「合同档案」 `st_3_ht` → `w_ht_htda`「合同档案管理」
- 文字「结转类型」 `st_3_jz` → `w_xt_jzwh`「结转类型维护」
- 文字「科目维护」 `st_3_km` → `w_xt_kmwh`「科目维护」
- 文字「凭证类型」 `st_3_lx` → `w_xt_pzlx`「凭证类型管理」
- 文字「自改密码」 `st_3_mm` → `w_pass`「自改密码」
- 文字「期初录入」 `st_3_qc` → `w_xt_ye_nf`「选择年份」、`w_xt_ye`「期初余额录入」
- 文字「套账信息」 `st_3_tz` → `w_xt_tz`「套账信息」
- 文字「外币类型」 `st_3_wb` → `w_xt_fbwh`「外币管理」
- 文字「账册设置」 `st_3_zc` → `w_xt_tz_zc`「账册设置」
- 标签控件 `tab_1`
  - 标签页 `tabpage_1`
    - 图标（rhcb_zw_11_zzs_0.jpg） `p_t_1_zzs` → `w_zc_zzs`「增值税明细帐」
    - 图标（rhcb_zw_1_lr_0.bmp） `p_t_1_lr` → `w_pz_pzxsb`「凭证序时簿」
    - 图标（rhcb_zw_1_yr_0.bmp） `p_t_1_yr` → `w_login_1`「切换用户」
    - 图标（rhcb_zw_1_sh_0.bmp） `p_t_1_sh` → `w_pz_tjsh`「批量审核」
    - 图标（rhcb_zw_1_gz_0.bmp） `p_t_1_gz` → `w_zw_jz`「凭证过账」
    - 图标（rhcb_zw_1_yj_0.bmp） `p_t_1_yj` → `w_zw_ydjz`「月度结转」
    - 图标（rhcb_zw_1_bb_0.bmp） `p_t_1_bb` → `w_bb_main`「报表管理」
    - 图标（rhcb_zw_1_jz_0.bmp） `p_t_1_jz` → `w_zw_fz`「结账」
    - 图标（rhcb_zw_1_bf_0.bmp） `p_t_1_bf` → `w_bf`「数据备份」
    - 图标（rhcb_zw_1_cx_0.bmp） `p_t_1_cx` → `w_pz_see`「凭证浏览查看」
    - 图标（rhcb_zw_11_zz_0.bmp） `p_t_1_zz` → `w_zc_zc`「总分类账」
    - 图标（rhcb_zw_11_xj_0.bmp） `p_t_1_xj` → `w_zc_xjrjz`「日记账」
    - 图标（rhcb_zw_11_yh_0.bmp） `p_t_1_yh` → `w_zc_yhrjz`「银行日记帐」
    - 图标（rhcb_zw_11_km_0.bmp） `p_t_1_km` → `w_pz_kmhz`「凭证汇总」
    - 图标（rhcb_zw_11_hz_0.bmp） `p_t_1_hz` → `w_zw_ye`「汇总余额表」
    - 图标（rhcb_zw_11_wb_0.bmp） `p_t_1_wb` → `w_zw_wbye`「外币余额表」
    - 图标（rhcb_zw_11_fz_0.bmp） `p_t_1_fz` → `w_zw_fhye`「辅助项目余额表」
    - 图标（rhcb_zw_11_fzwb_0.bmp） `p_t_1_fzwb` → `w_zw_fhwbye`「辅助项目外币余额表」
    - 图标（rhcb_zw_11_mx_0.bmp） `p_t_1_mx` → `w_zc_slz`「明细账」
    - 图标（rhcb_zw_11_dl_0.bmp） `p_t_1_dl` → `w_zc_dlz`「多栏账」
    - 图标（rhcb_zw_11_fzmx_0.bmp） `p_t_1_fzmx` → `w_zc_fhslz`「辅助明细账」
    - 图标（rhcb_zw_11_fzdl_0.bmp） `p_t_1_fzdl` → `w_zc_fhdlz`「辅助多栏账」
    - 图标（rhcb_zw_11_kc_0.bmp） `p_t_1_kc` → `w_zw_slye`「库存数量金额表」
    - 图标（rhcb_zw_11_fzkc_0.bmp） `p_t_1_fzkc` → `w_zw_fhslye`「辅助项目库存数量金额表」
    - 图标（rhcb_zw_11_ht_0.bmp） `p_t_1_ht` → `w_ht_httj`「合同账款查询」
    - 图标（rhcb_zw_11_ph_0.bmp） `p_t_1_ph` → `w_zc_xjll`「现金流量试算平衡表」
  - 标签页 `tabpage_2`
    - 图标（rhcb_zw_2_gl_0.bmp） `p_t_2_gl` → `w_fx_km`「财务分析表」
    - 图标（rhcb_zw_2_xs_0.bmp） `p_t_2_xs` → `w_fx_km`「财务分析表」
    - 图标（rhcb_zw_2_cw_0.bmp） `p_t_2_cw` → `w_fx_km`「财务分析表」
    - 图标（rhcb_zw_2_ys_0.bmp） `p_t_2_ys` → `w_fx_km`「财务分析表」
    - 图标（rhcb_zw_2_yf_0.bmp） `p_t_2_yf` → `w_fx_km`「财务分析表」
    - 图标（rhcb_zw_2_qt_0.bmp） `p_t_2_qt` → `w_fx_km`「财务分析表」
    - 图标（rhcb_zw_2_dy_0.bmp） `p_t_2_dy` → `w_fx_main`「财务分析」
  - 标签页 `tabpage_3`
    - 图标（rhcb_zw_3_km_0.bmp） `p_t_3_km` → `w_xt_kmwh`「科目维护」
    - 图标（rhcb_zw_3_zy_0.bmp） `p_t_3_zy` → `w_xt_zy`「摘要管理」
    - 图标（rhcb_zw_3_lx_0.bmp） `p_t_3_lx` → `w_xt_pzlx`「凭证类型管理」
    - 图标（rhcb_zw_3_jz_0.bmp） `p_t_3_jz` → `w_xt_jzwh`「结转类型维护」
    - 图标（rhcb_zw_3_js_0.bmp） `p_t_3_js` → `w_xt_jslb`「结算类别管理」
    - 图标（rhcb_zw_3_wb_0.bmp） `p_t_3_wb` → `w_xt_fbwh`「外币管理」
    - 图标（rhcb_zw_3_ht_0.bmp） `p_t_3_ht` → `w_ht_htda`「合同档案管理」
    - 图标（rhcb_zw_3_tz_0.bmp） `p_t_3_tz` → `w_tzjl`「套帐管理」
    - 图标（rhcb_zw_3_xx_0.bmp） `p_t_3_xx` → `w_xt_tz`「套账信息」
    - 图标（rhcb_zw_3_zc_0.bmp） `p_t_3_zc` → `w_xt_tz_zc`「账册设置」
    - 图标（rhcb_zw_3_mm_0.bmp） `p_t_3_mm` → `w_pass`「自改密码」
    - 图标（rhcb_zw_3_cz_0.bmp） `p_t_3_cz` → `w_xt_users`「用户管理」
    - 图标（rhcb_zw_3_bf_0.bmp） `p_t_3_bf` → `w_autobak`「系统自动备份设置」
    - 图标（rhcb_zw_3_rz_0.bmp） `p_t_3_rz` → `w_xt_dlxx`「操作日志」
    - 图标（rhcb_zw_3_fz_0.bmp） `p_t_3_fz` → `w_xt_fhwh`「辅助档案」

## 工作台 `w_main1_cb`「主窗口」

图标式导航首页（sheet）。图标是图片（文字画在图里），下面按控件列出点击后打开的窗口：

- 图标（rhcb_m_gz_0.bmp） `p_gz` → `w_login_qhmk`「用户登录」
- 图标（rjsj_1.jpg） `p_rjsj` → `w_login`「用户登录」、`w_login_oem`「用户登录」、`w_bakupdata`
- 图标（rhcb_m_zc_0.bmp） `p_zc` → `w_login_qhmk`「用户登录」
- 图标（rhcb_m_zw_0.bmp） `p_zw` → `w_login_qhmk`「用户登录」
- 文字「汇总余额表」 `st_1_hzyeb` → `w_zw_ye`「汇总余额表」
- 文字「明细账」 `st_1_zwmxz` → `w_zc_slz`「明细账」
- 文字「自改密码」 `st_2_mm` → `w_pass`「自改密码」
- 标签控件 `tab_1`
  - 标签页 `tabpage_1`
    - 图标（rhcb_zw_11_hz_0.bmp） `p_t_1_hzyeb` → `w_zw_ye`「汇总余额表」
    - 图标（rhcb_zw_11_mx_0.bmp） `p_t_1_zwmxz` → `w_zc_slz`「明细账」
  - 标签页 `tabpage_2`
  - 标签页 `tabpage_3`

## 工作台 `w_main1_fp`「主窗口」

图标式导航首页（sheet）。图标是图片（文字画在图里），下面按控件列出点击后打开的窗口：

- 图标（rjsj_1.jpg） `p_rjsj` → `w_login`「用户登录」、`w_login_oem`「用户登录」
- 文字「报    表」 `st_1_bb` → `w_bb_main`「报表管理」
- 文字「销项发票综合查询」 `st_1_cx` → `w_fp_cx`「销项发票综合查询」
- 文字「进项发票导入/录入」 `st_1_dk` → `w_fp_lr_2`「进项发票录入」
- 文字「发票汇总」 `st_1_fx` → `w_fp_hz`「发票汇总」
- 文字「增 值 税 比 对」 `st_1_hz` → `w_fp_zzs_hz`「增值税比对」
- 文字「汇总余额表」 `st_1_hzb` → `w_zw_ye`「汇总余额表」
- 文字「结        账」 `st_1_jz` → `w_fp_fz`「结账」
- 文字「客户/供应商档案」 `st_1_kh` → `w_xt_dwwh`「客供维护（运行时设置）」
- 文字「客户汇总表」 `st_1_khhz` → `w_fp_khhz`「客户汇总」
- 文字「发 票 处 理」 `st_1_pz1` → `w_fp_pz`「凭证生成」
- 文字「销项发票导入/录入」 `st_1_zk` → `w_fp_lr_1`「销项发票录入」
- 文字「进项发票综合查询」 `st_6` → `w_fp_cx_2`「进项发票综合查询」
- 文字「供应商汇总表」 `st_7` → `w_fp_khhz_2`「供应商汇总」
- 标签控件 `tab_1`
  - 标签页 `tabpage_1`
    - 图标（rhfp0_pz1_0.jpg） `p_t_1_pz1` → `w_fp_pz`「凭证生成」
    - 图标（rhfp0_dk_0.jpg） `p_t_1_dk` → `w_fp_lr_2`「进项发票录入」
    - 图标（rhfp0_zk_0.jpg） `p_t_1_zk` → `w_fp_lr_1`「销项发票录入」
    - 图标（rhfp0_hz_0.jpg） `p_t_1_hz` → `w_fp_zzs_hz`「增值税比对」
    - 图标（rhfp0_jz_0.jpg） `p_t_1_jz` → `w_fp_fz`「结账」
  - 标签页 `tabpage_2`
  - 标签页 `tabpage_3`

## 工作台 `w_main1_gz`「主窗口」

图标式导航首页（sheet）。图标是图片（文字画在图里），下面按控件列出点击后打开的窗口：

- 图标（rhcb_m_ck_0.bmp） `p_ck` → `w_login_qhmk`「用户登录」
- 图标（rjsj_1.jpg） `p_rjsj` → `w_login`「用户登录」、`w_login_oem`「用户登录」、`w_bakupdata`
- 图标（rhcb_m_zc_0.bmp） `p_zc` → `w_login_qhmk`「用户登录」
- 图标（rhcb_m_zw_0.bmp） `p_zw` → `w_login_qhmk`「用户登录」
- 文字「自改密码」 `st_3_mm` → `w_pass`「自改密码」
- 标签控件 `tab_1`
  - 标签页 `tabpage_1`
  - 标签页 `tabpage_2`
  - 标签页 `tabpage_3`

## 工作台 `w_main1_zc`「主窗口」

图标式导航首页（sheet）。图标是图片（文字画在图里），下面按控件列出点击后打开的窗口：

- 图标（rhcb_m_ck_0.bmp） `p_ck` → `w_login_qhmk`「用户登录」
- 图标（rhcb_m_gz_0.bmp） `p_gz` → `w_login_qhmk`「用户登录」
- 图标（rjsj_1.jpg） `p_rjsj` → `w_login`「用户登录」、`w_login_oem`「用户登录」、`w_bakupdata`
- 图标（rhcb_m_zw_0.bmp） `p_zw` → `w_login_qhmk`「用户登录」
- 文字「自改密码」 `st_3_mm` → `w_pass`「自改密码」
- 标签控件 `tab_1`
  - 标签页 `tabpage_1`
  - 标签页 `tabpage_2`
  - 标签页 `tabpage_3`

## 统计

- 本程序独有窗口 64 个，静态可达 29 个，未发现静态入口 35 个。

## 未发现静态入口的窗口

可能原因：字符串拼接后动态打开、由其他 EXE 打开、作为祖先被继承、或历史残留。

- `w_bb_saveas`「数据导出」
- `w_err_view`「错误查看」
- `w_fp_hz_1_bak`「发票季度汇总」
- `w_fp_hz_bak`「发票汇总」
- `w_fp_preview`「打印预览」
- `w_fp_pz_bak`「凭证生成」
- `w_fp_pz_hz`「季度凭证生成」
- `w_fp_pz_sz`「凭证生成」
- `w_idle`
- `w_logo`
- `w_main1_cb`「主窗口」
- `w_main1_gz`「主窗口」
- `w_main1_zc`「主窗口」
- `w_paste`「请选择粘贴值」
- `w_preview_base_r`「打印预览」（被继承的祖先窗口）
- `w_preview_base_r1`「打印预览」
- `w_preview_base_r_bak`「打印预览」
- `w_preview_fp`「打印预览」
- `w_preview_report_base`「报表查询」（被继承的祖先窗口）
- `w_print_2`「打印」
- `w_retrieve_wait`「提示窗口」
- `w_system_error`「System Error」
- `w_zoom`「定制」
- `wroot_fix_query`「固定查询及统计」
- `wroot_md`「主从式应用示例」
- `wroot_md2`「wroot_sheet（继承自祖先）」
- `wroot_md2_1`「wroot_sheet（继承自祖先）」
- `wroot_md_2`「主从式应用示例」
- `wroot_mds`「共享式 + 主从式应用示例」
- `wroot_query`「综合查询」（被继承的祖先窗口）
- `wroot_share`「共享式应用」（被继承的祖先窗口）
- `wroot_share_tab`「共享式应用(TAB)」（被继承的祖先窗口）
- `wroot_sheet`「wroot_sheet」（被继承的祖先窗口）
- `wroot_single`「单一式应用」（被继承的祖先窗口）
- `wroot_single_1`「单一式应用」（被继承的祖先窗口）