# 成本会计 · 发票/进销存模块 — 窗口目录：登录（前缀 `login`）

尺寸单位为 PowerBuilder Unit（PBU）。96 DPI、系统字体下约为：宽度像素 ≈ PBU × 0.25～0.3，高度像素 ≈ PBU × 0.25～0.28。
“打开入口”只列静态可见的调用方，运行时拼出来的窗口名可能遗漏。名字含 `_bak`、`_old`、`test` 的通常是历史残留。

### w_login — 用户登录

- 类型：模态对话框；尺寸：3072×1764 PBU；库：rhzw9_g.pbd（发票/进销存模块）
- 打开入口：菜单「F.文件 › 切换套账」（46 个菜单中）；`w_frame` 的 事件 open；`w_frame` 的 事件 ue_postopen；`w_hf` 的 cb_1.clicked；`w_main1_cb` 的 p_rjsj.clicked；`w_main1_fp` 的 p_rjsj.clicked；`w_main1_gz` 的 p_rjsj.clicked；`w_main1_zc` 的 p_rjsj.clicked；`w_main1` 的 p_rjsj.clicked；`w_tzjl_get_all` 的 cb_1.clicked；`w_tzjl_get_all` 的 cb_4.clicked；`w_tzjl_get` 的 cb_1.clicked……（共 13 处）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_3 | 按钮 | 搜索 | 2336,528 146×76 | clicked → `w_xt_tz_find`「套账查找」 |
| cb_exit | 按钮 | &E. 退 出 | 1691,1116 361×108 |  |
| cb_ok | 按钮 | &Y. 确 认 | 1193,1116 370×108 | clicked → `w_main1_fp`「主窗口」；clicked 读写表 b_rights、b_user、fbgl、g_fp_mx、g_fp_mx_2、xt |
| ddlb_1 | 下拉列表 |  | 1088,524 1257×780 |  |
| em_1 | 格式输入 |  | 1088,856 928×96 |  |
| p_1 | 图片 | rhfp_login.jpg | , 3063×1680 |  |
| sle_id | 下拉列表 |  | 1088,644 928×780 |  |
| sle_password | 单行输入 |  | 1088,740 928×96 |  |
| st_1 | 静态文本 | 套账名称: | 795,536 283×72 |  |
| st_2 | 静态文本 | 默认密码为空 | 1554,756 457×72 |  |
| st_bb | 静态文本 | 【试用版】 | 1851,372 576×96 |  |
| st_error | 静态文本 | 用户代码或者密码错误, 请重新输入 | 818,1000 1531×68 |  |
| st_pass | 静态文本 | 忘记密码？ | 2021,760 357×68 |  |
| st_pswd | 静态文本 | 用户密码: | 795,752 283×68 |  |
| st_rq | 静态文本 | 登录日期: | 795,868 283×72 |  |
| st_userid | 静态文本 | 用户代码: | 795,644 283×68 |  |

- 窗口事件/函数：
  - `open`：读写表 dba、sys
  - `wf_setmenuenable`：读写表 b_rights

- 提示与校验（5 条）：
  - [窗口事件 open]「套账数量超过此版本允许的套，不能运行！」（条件：`xt_zt0 = 5 and i > (gl_tzsl + 1)`）
  - [cb_ok.clicked]「需选择套账！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「此套账不存在！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「非法的操作日期！」（条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"`）
  - [cb_ok.clicked]「操作日期小于开帐日期！」（条件：`parent.cs = 3`）

### w_login_oem — 用户登录

- 类型：模态对话框；尺寸：3296×1872 PBU；库：rhzw9_g.pbd（发票/进销存模块）
- 打开入口：`w_frame` 的 事件 open；`w_hf` 的 cb_1.clicked；`w_main1_cb` 的 p_rjsj.clicked；`w_main1_fp` 的 p_rjsj.clicked；`w_main1_gz` 的 p_rjsj.clicked；`w_main1_zc` 的 p_rjsj.clicked；`w_main1` 的 p_rjsj.clicked；`w_tzjl_get_all` 的 cb_1.clicked；`w_tzjl_get_all` 的 cb_4.clicked；`w_tzjl_get` 的 cb_1.clicked；`w_tzjl_get` 的 cb_4.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | none | 3941,1320 480×120 |  |
| cb_2 | 按钮 | none | 119,1908 480×120 | clicked → `w_tzjl_1_new`「新建套帐」 |
| cb_3 | 按钮 | 搜索 | 3099,584 146×76 | clicked → `w_xt_tz_find`「套账查找」 |
| cb_exit | 按钮 | &E. 退 出 | 2514,1168 361×108 |  |
| cb_ok | 按钮 | &Y. 确 认 | 1806,1168 370×108 | clicked → `w_main1_fp`「主窗口」；clicked 读写表 b_rights、b_user、fbgl、g_fp_mx、g_fp_mx_2、xt |
| ddlb_1 | 下拉列表 |  | 1746,580 1358×1132 |  |
| dl2 | olecustomcontrol |  | 617,1900 1417×120 |  |
| em_1 | 格式输入 |  | 1746,908 1056×96 |  |
| lb_1 | 列表框 |  | 3584,32 1618×964 |  |
| p_1 | 图片 | rhqs_login_oem.jpg | , 3291×1800 | doubleclicked → `w_xtzc_1`「系统注册」 |
| p_2 | 图片 | rh_oem_gg_fp.jpg | 9,188 1335×860 |  |
| sle_1 | 单行输入 |  | 3794,1060 1010×100 |  |
| sle_id | 下拉列表 |  | 1746,696 1358×832 |  |
| sle_password | 单行输入 |  | 1746,792 1056×96 | key → `w_xt_pass0`「系统密码设定」 |
| st_1 | 静态文本 | 套账名称: | 1435,584 283×72 |  |
| st_2 | 静态文本 | 默认密码为空 | 2400,804 384×72 |  |
| st_bb | 静态文本 | 试用版 | 1989,364 823×100 |  |
| st_error | 静态文本 | 用户代码或者密码错误, 请重新输入 | 1481,1024 1294×68 |  |
| st_pass | 静态文本 | 忘记密码？ | 2807,804 334×84 |  |
| st_pswd | 静态文本 | 用户密码: | 1435,812 283×68 |  |
| st_rq | 静态文本 | 登录日期: | 1435,924 283×72 |  |
| st_userid | 静态文本 | 用户代码: | 1435,700 283×68 |  |

- 窗口事件/函数：
  - `open`：读写表 dba、sys；运行 `autoupdate.exe`
  - `wf_setmenuenable`：读写表 b_rights

- 提示与校验（8 条）：
  - [窗口事件 open]「套账数量超过此版本允许的套，不能运行！」（条件：`i > (gl_tzsl + 1)`）
  - [窗口事件 open]「您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。」（条件：`xt_zt0 = 2`）
  - [窗口事件 open]「您的系统已经有最新版本,是否升级?~r(升级将不会影响现有的数据!)~r升级程序运行过程中，如果杀毒软件提示，一定要允许操作!!!」（条件：`messagebox(sappname,"您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。",question!,yesno!,1) = 1`）
  - [cb_ok.clicked]「需选择套账！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「此套账不存在！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「非法的操作日期！」（条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"`）
  - [cb_ok.clicked]「操作日期小于开帐日期！」（条件：`parent.cs = 3`）
  - [ddlb_1.rbuttondown]「是否套账名称是乱码，需要解决？」

### w_login_qhmk — 用户登录

- 类型：模态对话框；尺寸：3072×1764 PBU；库：rhzw9_g.pbd（发票/进销存模块）
- 打开入口：`w_main1_cb` 的 p_gz.clicked；`w_main1_cb` 的 p_zc.clicked；`w_main1_cb` 的 p_zw.clicked；`w_main1_gz` 的 p_ck.clicked；`w_main1_gz` 的 p_zc.clicked；`w_main1_gz` 的 p_zw.clicked；`w_main1_zc` 的 p_ck.clicked；`w_main1_zc` 的 p_gz.clicked；`w_main1_zc` 的 p_zw.clicked；`w_main1` 的 p_ck.clicked；`w_main1` 的 p_gz.clicked；`w_main1` 的 p_zc.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_exit | 按钮 | &E. 退 出 | 1691,1116 361×108 |  |
| cb_ok | 按钮 | &Y. 确 认 | 1253,1116 370×108 | clicked → `w_main1_fp`「主窗口」；clicked 读写表 b_rights、b_user、fbgl、g_fp_mx、xt |
| ddlb_1 | 下拉列表 |  | 1184,524 928×780 |  |
| em_1 | 格式输入 |  | 1184,856 928×96 |  |
| p_1 | 图片 | rhfp_login.jpg | , 3063×1680 |  |
| p_2 | 图片 | 公众号二维码.bmp | ,1192 507×468 | doubleclicked → `w_xtzc_1`「系统注册」 |
| sle_id | 下拉列表 |  | 1184,644 928×780 |  |
| sle_password | 单行输入 |  | 1184,740 928×96 |  |
| st_1 | 静态文本 | 套账名称: | 891,536 283×72 |  |
| st_2 | 静态文本 | 默认密码为空 | 1495,756 457×72 |  |
| st_bb | 静态文本 | 【试用版】 | 1851,372 576×96 |  |
| st_error | 静态文本 | 用户代码或者密码错误, 请重新输入 | 818,1000 1531×68 |  |
| st_pass | 静态文本 | 忘记密码？ | 2117,760 357×68 |  |
| st_pswd | 静态文本 | 用户密码: | 891,752 283×68 |  |
| st_rq | 静态文本 | 登录日期: | 891,868 283×72 |  |
| st_userid | 静态文本 | 用户代码: | 891,644 283×68 |  |

- 窗口事件/函数：
  - `open`：读写表 dba、sys；运行 `download.exe`、`autoupdate.exe`
  - `wf_setmenuenable`：读写表 b_rights

- 提示与校验（8 条）：
  - [窗口事件 open]「套账数量超过此版本允许的套，不能运行！」（条件：`xt_zt0 = 5 and i > (gl_tzsl + 1)`）
  - [窗口事件 open]「您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。」（条件：`xt_zt0 = 2`）
  - [窗口事件 open]「您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）」（条件：`messagebox(sappname,"您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。",question!,yesno!,1) = 1`）
  - [cb_ok.clicked]「需选择套账！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「此套账不存在！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「非法的操作日期！」（条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"`）
  - [cb_ok.clicked]「操作日期小于开帐日期！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「此套账数据量超过试用版容量，请向润衡服务中心购买正式版本！~r      本套账数据会自动平移到正版软件中继续使用。~r      QQ：800003004 ；电话/微信：13312858385 ~r ~r若您已购买正版，可能是加密锁没插好或电脑USB口接触不好 ~r      请换个USB口插并重启电脑后再试试！」（条件：`i > 500`）
