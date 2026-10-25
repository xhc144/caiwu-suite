# 轻松会计 · 出纳模块 — 启动流程、工作台与可达性

从主框架 `w_frame` 与登录窗口出发，沿“菜单项 → 窗口”“按钮/事件 → 窗口”“全局函数 → 窗口”“内嵌用户对象”静态边计算可达性。

## 启动流程

- 应用对象 `rh_pos.apl` 的 open 事件：读取 `rhzw8.ini`，检查加密狗/注册（`f_check_usbid`、`w_login_ts`），再打开主框架 `w_frame`（MDI）。
- `w_frame` 的 open 事件把标题设为软件名，打开登录窗口 `w_login`（OEM 版为 `w_login_oem`）。
- 登录窗口按钮「搜索」→ `w_xt_tz_find`「套账查找」
- 登录窗口按钮「Y. 确 认」→ `w_main1_cn`「主窗口」
- 登录窗口按钮「rhcn_login.jpg」→ `w_xtzc_1`「系统注册」

## 工作台 `w_main1_cn`「主窗口」

图标式导航首页（sheet）。图标是图片（文字画在图里），下面按控件列出点击后打开的窗口：

- 图标（rjsj_1.jpg） `p_rjsj` → `w_login`「用户登录」、`w_login_oem`「用户登录」
- 文字「对        账」 `st_1_dz` → `w_cn_dz_xz`「选择」
- 文字「结        账」 `st_1_jz` → `w_cn_fz`「结账」
- 文字「单据录入」 `st_1_lr` → `w_cn_lr`「单据录入」
- 文字「凭证生成」 `st_1_pz` → `w_cn_pz`「凭证生成」
- 标签控件 `tab_1`
  - 标签页 `tabpage_1`
    - 图标（rhcn0_cx_0.jpg） `p_cx` → `w_cn_cx`「出纳单据综合查询」
    - 图标（rhcn0_ll_0.jpg） `p_ll` → `w_cn_ll`「单据浏览」
    - 图标（rhcn0_rjz_0.jpg） `p_rjz` → `w_cn_slz`「明细账」
    - 图标（rhcn0_hz1_0.jpg） `p_hz1` → `w_cn_wbhz`「外币汇总余额表」
    - 图标（rhcn0_hz_0.jpg） `p_hz` → `w_cn_hz`「汇总余额表」
    - 图标（rhcb_ck_1_pz_0.bmp） `p_t_1_pz` → `w_cn_pz`「凭证生成」
    - 图标（rhcn0_lr_0.jpg） `p_t_1_lr` → `w_cn_lr`「单据录入」
    - 图标（rhcn0_dz_0.jpg） `p_t_1_dz` → `w_cn_dz_xz`「选择」
    - 图标（rhcn0_jz_0.jpg） `p_t_1_jz` → `w_cn_fz`「结账」
  - 标签页 `tabpage_2`
  - 标签页 `tabpage_3`

## 统计

- 本程序独有窗口 72 个，静态可达 37 个，未发现静态入口 35 个。

## 未发现静态入口的窗口

可能原因：字符串拼接后动态打开、由其他 EXE 打开、作为祖先被继承、或历史残留。

- `w_bb_def_cn0_bak`「格式定义」
- `w_bb_saveas`「数据导出」
- `w_cn_hz_1`「汇总余额表」
- `w_cn_lr_qc_nf`「选择年份」
- `w_cn_slz_1`「出纳日记账」
- `w_cn_wbhz_1`「汇总余额表」
- `w_err_view`「错误查看」
- `w_grant`「分配权限」
- `w_idle`
- `w_logo`
- `w_paste`「请选择粘贴值」
- `w_preview`「打印预览」
- `w_preview_base_r`「打印预览」（被继承的祖先窗口）
- `w_preview_base_r1`「打印预览」
- `w_preview_base_r_bak`「打印预览」
- `w_preview_report_base`「报表查询」
- `w_print`「打印」
- `w_print_1`「打印」
- `w_print_2`「打印」
- `w_retrieve_wait`「提示窗口」
- `w_system_error`「System Error」
- `w_users`「用户/组维护」
- `w_zoom`「定制」
- `wroot_fix_query`「固定查询及统计」
- `wroot_md`「主从式应用示例」
- `wroot_md2`「wroot_sheet（继承自祖先）」
- `wroot_md2_1`「wroot_sheet（继承自祖先）」
- `wroot_md_2`「主从式应用示例」
- `wroot_mds`「共享式 + 主从式应用示例」
- `wroot_query`「综合查询」（被继承的祖先窗口）
- `wroot_share`「共享式应用」
- `wroot_share_tab`「共享式应用(TAB)」
- `wroot_sheet`「wroot_sheet」（被继承的祖先窗口）
- `wroot_single`「单一式应用」（被继承的祖先窗口）
- `wroot_single_1`「单一式应用」（被继承的祖先窗口）