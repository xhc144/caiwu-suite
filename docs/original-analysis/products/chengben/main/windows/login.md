# 成本会计 · 账务+成本主程序 — 窗口目录：登录（前缀 `login`）

尺寸单位为 PowerBuilder Unit（PBU）。96 DPI、系统字体下约为：宽度像素 ≈ PBU × 0.25～0.3，高度像素 ≈ PBU × 0.25～0.28。
“打开入口”只列静态可见的调用方，运行时拼出来的窗口名可能遗漏。名字含 `_bak`、`_old`、`test` 的通常是历史残留。

### w_login — 用户登录

- 类型：模态对话框；尺寸：3077×1752 PBU；库：rhzw8_cb.exe（账务+成本主程序）
- 打开入口：菜单「F.文件 › 切换套账」（35 个菜单中）；菜单「S系统管理 › 系统初始化」（19 个菜单中）；`w_frame` 的 事件 open；`w_frame` 的 事件 ue_postopen；`w_hf` 的 cb_1.clicked；`w_main1_cb` 的 p_rjsj.clicked；`w_main1_gz` 的 p_rjsj.clicked；`w_main1_zc` 的 p_rjsj.clicked；`w_main1` 的 p_rjsj.clicked；`w_tzjl_get_all` 的 cb_1.clicked；`w_tzjl_get_all` 的 cb_4.clicked；`w_tzjl_get` 的 cb_1.clicked……（共 13 处）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | none | 3314,456 457×128 |  |
| cb_3 | 按钮 | 搜索 | 2322,528 146×76 | clicked → `w_xt_tz_find`「套账查找」 |
| cb_exit | 按钮 | &E. 退 出 | 1719,1096 293×108 |  |
| cb_new | 按钮 | &N. 新增套账 | 823,1096 338×108 | clicked → `w_tzjl`「套帐管理」、`w_main1`「主窗口」、`w_xt_kgzb_0`「系统初始化--向导选择」；clicked 读写表 b_rights、b_user、dba |
| cb_ok | 按钮 | &Y. 确 认 | 1344,1096 302×108 | clicked → `w_main1`「主窗口」、`w_main1_zc`「主窗口」、`w_main1_gz`「主窗口」、`w_main1_cb`「主窗口」；clicked 读写表 b_rights、b_user、dba、dwk、gz_gzk、pz、sys、xt、zc_gdzc、zc_yzjb |
| cb_sj | 按钮 | 免费升级 | 2597,1512 439×108 |  |
| ddlb_1 | 下拉列表 |  | 1051,524 1275×776 |  |
| dl2 | olecustomcontrol |  | 571,1912 1417×120 |  |
| em_1 | 格式输入 |  | 1051,856 837×96 |  |
| gb_1 | 分组框 |  | 823,1856 1509×152 |  |
| p_1 | 图片 | rhcb_login.jpg | , 3063×1680 | doubleclicked → `w_xtzc_1`「系统注册」 |
| p_2 | 图片 | 公众号二维码.bmp | ,1184 507×468 | doubleclicked → `w_xtzc_1`「系统注册」 |
| p_ck | 图片 | rhcb_login_ck_0.bmp | 800,1912 215×168 |  |
| p_gz | 图片 | rhcb_login_gz_0.bmp | 1321,1920 215×168 |  |
| p_zc | 图片 | rhcb_login_zc_0.bmp | 1051,1920 215×168 |  |
| p_zw | 图片 | rhcb_login_zw_0.bmp | 553,1912 215×168 |  |
| rb_cb | 单选按钮 | 成本 | 1979,1908 343×76 |  |
| rb_gz | 单选按钮 | 人事工资 | 1618,1908 343×76 |  |
| rb_zc | 单选按钮 | 固定资产 | 1262,1908 343×76 |  |
| rb_zw | 单选按钮 | 帐务报表 | 910,1908 329×76 |  |
| sle_id | 下拉列表 |  | 1051,628 837×832 | rbuttondown → `w_xtzc_del`「清除版本号」 |
| sle_password | 单行输入 |  | 1051,740 837×96 | key → `w_xt_pass0`「系统密码设定」 |
| st_1 | 静态文本 | 套账名称: | 745,536 283×72 |  |
| st_2 | 静态文本 | 默认密码为空 | 1509,752 375×72 |  |
| st_bb | 静态文本 | 试用版 | 1696,360 823×100 |  |
| st_error | 静态文本 | 用户代码或者密码错误, 请重新输入 | 873,972 1349×68 |  |
| st_pass | 静态文本 | 忘记密码？ | 1925,756 283×68 |  |
| st_pswd | 静态文本 | 用户密码: | 745,768 283×68 |  |
| st_rq | 静态文本 | 登录日期: | 745,880 283×72 |  |
| st_userid | 静态文本 | 用户代码: | 745,652 283×68 |  |

- 窗口事件/函数：
  - `open`：读写表 dba、sys
  - `wf_cb`：读写表 b_rights、dba、pjnr2、xt
  - `wf_setmenuenable`：读写表 b_rights

- 提示与校验（23 条）：
  - [窗口事件 open]「套账数量超过此版本允许的套，不能运行！」（条件：`xt_zt0 = 5 or xt_zt0 = 6 and i > (gl_tzsl + 1)`）
  - [窗口事件 open]「您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。」（条件：`xt_zt0 = 2`）
  - [窗口事件 open]「您的系统已经有新版本,是否升级?」（条件：`messagebox(sappname,"您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。",question!,yesno!,1) = 1`）
  - [窗口事件 wf_cb]「非法的操作日期！」（条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"`）
  - [窗口事件 wf_cb]「此套帐数据量超过本版本容量，请向润衡服务中心购买正式版本！~r      本套帐数据会自动平移到正式版本软件中继续使用。~r      QQ：160239242 ；值班电话：13312858385」（条件：`i > 500`）
  - [cb_ok.clicked]「需选择套账！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「此套账不存在！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「操作日期小于开帐日期！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「此套账数据量超过试用版容量，请向润衡服务中心购买正式版本！~r      本套账数据会自动平移到正版软件中继续使用。~r   QQ：800003004 ；电话/微信：13312858385/13725250021 ~r ~r若您已购买正版，可能是加密锁没插好或电脑USB口接触不好 ~r      请换个USB口插并重启」（条件：`i > 500`）
  - [cb_ok.clicked]「此套账不含固定资产系统！是否建立？」（条件：`i = 0`）
  - [cb_ok.clicked]「固定资产系统建立失败！」（条件：`i = -1`）
  - [cb_ok.clicked]「操作日期小于开帐日期！开帐日期:」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「操作日期小于结帐日期！结帐日期:」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「未结转」（条件：`left(parent.em_1.text,4) <> left(xt_jzyf,4) or mid(parent.em_1.text,6,2) <> mid(xt_jzyf,6,2)`）
  - [cb_ok.clicked]「此套账数据量超过本版本容量，请向润衡服务中心购买正式版本！~r      本套账数据会自动平移到正式版本软件中继续使用。~r      QQ：160239242 ；值班电话：13312858385」（条件：`i > 500`）
  - [cb_ok.clicked]「此套账不含工资系统！是否建立？」（条件：`i = 0`）
  - [cb_ok.clicked]「工资系统建立失败！」（条件：`i = -1`）
  - [cb_ok.clicked]「操作日期小于开帐日期！~r开帐日期:」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「操作日期小于结帐日期！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「才结转」（条件：`integer(left(parent.em_1.text,4)) <> (integer(left(xt_jzyf,4)) + 1) or integer(mid(parent.em_1.text,6,2)) <> 1`）
  - [cb_sj.clicked]「您的系统已经有新版本,是否升级?~r    (升级将不会影响现有的数据!)~r升级程序运行过程中，如果杀毒软件提示，一定要允许操作!!!」（条件：`messagebox(sappname,"您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。",question!,yesno!,1) = 1`）
  - [cb_sj.clicked]「恭喜您，您的版本是最新版本，无需升级！」（条件：`messagebox(sappname,"  您的系统已经有新版本,是否升级?~r    (升级将不会影响现有的数据!)~r升级程序运行过程中，如果杀毒软件提示，一定要允许操作!!!",question!,yesno!,2) = 1`）
  - [ddlb_1.rbuttondown]「是否套账名称是乱码，需要解决？」

### w_login_1 — 切换用户

- 类型：模态对话框；尺寸：1838×716 PBU；库：rhzw8_8.pbd（账务+成本主程序）
- 打开入口：菜单「S系统管理 › 切换用户」（19 个菜单中）；菜单「O.操作 › 操作易人」（`m_work_pz_pzxsb`）；`w_main1` 的 tab_1/tabpage_1/p_t_1_yr.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_exit | 按钮 | &E. 退 出 | 914,464 361×108 |  |
| cb_ok | 按钮 | &Y. 确 认 | 338,464 370×108 | clicked → `w_main1`「主窗口」；clicked 读写表 b_rights、b_user、dba |
| ddlb_1 | 下拉列表 |  | 635,1152 695×464 |  |
| em_1 | 格式输入 |  | 590,972 695×108 |  |
| sle_id | 下拉列表 |  | 480,52 1161×504 |  |
| sle_password | 单行输入 |  | 480,184 677×80 |  |
| st_1 | 静态文本 | 套帐名称 | 288,1164 320×88 |  |
| st_error | 静态文本 | 用户代码或者密码错误, 请重新输入 | 27,324 1659×68 |  |
| st_pswd | 静态文本 | 用户密码: | 123,192 261×68 |  |
| st_rq | 静态文本 | 登录日期: | 219,996 361×84 |  |
| st_userid | 静态文本 | 用户代码: | 128,68 261×68 |  |

- 窗口事件/函数：
  - `open`：读写表 b_user
  - `wf_setmenuenable`：读写表 b_rights

- 提示与校验（2 条）：
  - [cb_ok.clicked]「操作易人成功！~r现在操作员为」
  - [sle_id.rbuttondown]「是否套账名称是乱码，需要解决？」

### w_login_oem — 用户登录

- 类型：模态对话框；尺寸：3296×1884 PBU；库：rhzw8_8.pbd（账务+成本主程序）
- 打开入口：菜单「F.文件 › 切换套账」（35 个菜单中）；`w_frame` 的 事件 open；`w_hf` 的 cb_1.clicked；`w_main1_cb` 的 p_rjsj.clicked；`w_main1_gz` 的 p_rjsj.clicked；`w_main1_zc` 的 p_rjsj.clicked；`w_main1` 的 p_rjsj.clicked；`w_tzjl_get_all` 的 cb_1.clicked；`w_tzjl_get_all` 的 cb_4.clicked；`w_tzjl_get` 的 cb_1.clicked；`w_tzjl_get` 的 cb_4.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | none | 3941,1320 480×120 |  |
| cb_2 | 按钮 | none | 119,1908 480×120 | clicked → `w_tzjl_1_new`「新建套帐」 |
| cb_3 | 按钮 | 搜索 | 3022,588 146×76 | clicked → `w_xt_tz_find`「套账查找」 |
| cb_exit | 按钮 | &E. 退 出 | 2546,1148 361×108 |  |
| cb_new | 按钮 | &N. 新增套账 | 1618,1148 370×108 | clicked → `w_tzjl`「套帐管理」、`w_main1`「主窗口」、`w_xt_kgzb_0`「系统初始化--向导选择」；clicked 读写表 b_rights、b_user、dba |
| cb_ok | 按钮 | &Y. 确 认 | 2107,1148 370×108 | clicked → `w_main1`「主窗口」；clicked 读写表 b_rights、b_user、dba、dwk、pz、xt |
| ddlb_1 | 下拉列表 |  | 1746,580 1271×1132 |  |
| dl2 | olecustomcontrol |  | 617,1900 1417×120 |  |
| em_1 | 格式输入 |  | 1746,908 1056×96 |  |
| lb_1 | 列表框 |  | 3584,32 1618×964 |  |
| p_1 | 图片 | rhqs_login_oem.jpg | , 3291×1800 | doubleclicked → `w_xtzc_1`「系统注册」 |
| p_2 | 图片 |  | 9,188 1321×860 |  |
| sle_1 | 单行输入 |  | 3794,1060 1010×100 |  |
| sle_id | 下拉列表 |  | 1746,696 1056×832 |  |
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
  - `open`：读写表 dba、sys
  - `wf_setmenuenable`：读写表 b_rights

- 提示与校验（7 条）：
  - [窗口事件 open]「套账数量超过此版本允许的套，不能运行！」（条件：`i > (gl_tzsl + 1)`）
  - [cb_ok.clicked]「需选择套账！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「此套账不存在！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「非法的操作日期！」（条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"`）
  - [cb_ok.clicked]「操作日期小于开帐日期！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「此套账数据量超过本版本容量，请向购买正式版本！~r      本套账数据会自动平移到正式版本软件中继续使用。~r      ；」（条件：`i > 500`）
  - [ddlb_1.rbuttondown]「是否套账名称是乱码，需要解决？」

### w_login_qhmk — 用户登录（继承自祖先）

- 类型：模态对话框；尺寸：3584×1788 PBU；继承：`w_login`；库：rhzw8_cb.exe（账务+成本主程序）
- 打开入口：`w_main1_cb` 的 p_gz.clicked；`w_main1_cb` 的 p_zc.clicked；`w_main1_cb` 的 p_zw.clicked；`w_main1_gz` 的 p_ck.clicked；`w_main1_gz` 的 p_zc.clicked；`w_main1_gz` 的 p_zw.clicked；`w_main1_zc` 的 p_ck.clicked；`w_main1_zc` 的 p_gz.clicked；`w_main1_zc` 的 p_zw.clicked；`w_main1` 的 p_ck.clicked；`w_main1` 的 p_gz.clicked；`w_main1` 的 p_zc.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | none | 3314,456 457×128 |  |
| cb_3 | 按钮 | 搜索 | 2322,528 146×76 | clicked → `w_xt_tz_find`「套账查找」 |
| cb_exit | 按钮 | &E. 退 出 | 1719,1096 293×108 |  |
| cb_new | 按钮 | &N. 新增套账 | 823,1096 338×108 | clicked → `w_tzjl`「套帐管理」、`w_main1`「主窗口」、`w_xt_kgzb_0`「系统初始化--向导选择」；clicked 读写表 b_rights、b_user、dba |
| cb_ok | 按钮 | &Y. 确 认 | 1344,1096 302×108 | clicked → `w_main1`「主窗口」、`w_main1_zc`「主窗口」、`w_main1_gz`「主窗口」、`w_main1_cb`「主窗口」；clicked 读写表 b_rights、dba、gz_gzk、pjnr2、pz、sys、xt、zc_gdzc、zc_yzjb |
| cb_sj | 按钮 | 免费升级 | 2597,1512 439×108 |  |
| ddlb_1 | 下拉列表 |  | 1051,524 1275×776 |  |
| dl2 | olecustomcontrol |  | 571,1912 1417×120 |  |
| em_1 | 格式输入 |  | 1051,856 837×96 |  |
| gb_1 | 分组框 |  | 562,1700 1509×152 |  |
| p_1 | 图片 | rhcb_login.jpg | , 3063×1680 | doubleclicked → `w_xtzc_1`「系统注册」 |
| p_2 | 图片 | 公众号二维码.bmp | ,1184 507×468 | doubleclicked → `w_xtzc_1`「系统注册」 |
| p_ck | 图片 | rhcb_login_ck_0.bmp | 800,1912 215×168 |  |
| p_gz | 图片 | rhcb_login_gz_0.bmp | 1321,1920 215×168 |  |
| p_zc | 图片 | rhcb_login_zc_0.bmp | 1051,1920 215×168 |  |
| p_zw | 图片 | rhcb_login_zw_0.bmp | 553,1912 215×168 |  |
| rb_cb | 单选按钮 | 成本 | 1719,1752 343×76 |  |
| rb_gz | 单选按钮 | 人事工资 | 1358,1752 343×76 |  |
| rb_zc | 单选按钮 | 固定资产 | 1001,1752 343×76 |  |
| rb_zw | 单选按钮 | 帐务报表 | 649,1752 329×76 |  |
| sle_id | 下拉列表 |  | 1051,628 837×832 | rbuttondown → `w_xtzc_del`「清除版本号」 |
| sle_password | 单行输入 |  | 1051,740 837×96 | key → `w_xt_pass0`「系统密码设定」 |
| st_1 | 静态文本 | 套账名称: | 745,536 283×72 |  |
| st_2 | 静态文本 | 默认密码为空 | 1509,752 375×72 |  |
| st_bb | 静态文本 | 试用版 | 1696,360 823×100 |  |
| st_error | 静态文本 | 用户代码或者密码错误, 请重新输入 | 873,972 1349×68 |  |
| st_pass | 静态文本 | 忘记密码？ | 1925,756 283×68 |  |
| st_pswd | 静态文本 | 用户密码: | 745,768 283×68 |  |
| st_rq | 静态文本 | 登录日期: | 745,880 283×72 |  |
| st_userid | 静态文本 | 用户代码: | 745,652 283×68 |  |

- 窗口事件/函数：
  - `open`：读写表 b_user
  - `wf_cb`：读写表 b_rights、dba、pjnr2、xt
  - `wf_setmenuenable`：读写表 b_rights

- 提示与校验（17 条）：
  - [窗口事件 wf_cb]「非法的操作日期！」（条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"`）
  - [窗口事件 wf_cb]「此套帐数据量超过本版本容量，请向润衡服务中心购买正式版本！~r      本套帐数据会自动平移到正式版本软件中继续使用。~r      QQ：160239242 ；值班电话：13312858385」（条件：`i > 500`）
  - [cb_ok.clicked]「操作日期小于开帐日期！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「此套账的数据量超过试用版的要求，请购买正式版本！」（条件：`i > 500`）
  - [cb_ok.clicked]「此套账不含固定资产系统！是否建立？」（条件：`i = 0`）
  - [cb_ok.clicked]「固定资产系统建立失败！」（条件：`i = -1`）
  - [cb_ok.clicked]「此套账不含工资系统！是否建立？」（条件：`i = 0`）
  - [cb_ok.clicked]「工资系统建立失败！」（条件：`i = -1`）
  - [cb_ok.clicked]「操作日期小于开帐日期！开帐日期:」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「操作日期小于结帐日期！」（条件：`parent.cs = 3`）
  - [cb_ok.clicked]「才结转」（条件：`integer(left(parent.em_1.text,4)) <> (integer(left(xt_jzyf,4)) + 1) or integer(mid(parent.em_1.text,6,2)) <> 1`）
  - [cb_ok.clicked]「未结转」（条件：`month(xt_dlrq) <> (integer(mid(xt_jzyf,6,2)) + 1) or left(parent.em_1.text,4) <> left(xt_jzyf,4)`）
  - [cb_ok.clicked]「此套账数据量超过本版本容量，请向润衡服务中心购买正式版本！~r本套账数据会自动平移到正式版本软件中继续使用。~r      QQ：160239242；电话：020-38492763」（条件：`i > 500`）
  - [cb_sj.clicked]「您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。」（条件：`xt_zt0 = 2`）
  - [cb_sj.clicked]「您的系统已经有新版本,是否升级?~r    (升级将不会影响现有的数据!)~r升级程序运行过程中，如果杀毒软件提示，一定要允许操作!!!」（条件：`messagebox(sappname,"您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。",question!,yesno!,1) = 1`）
  - [cb_sj.clicked]「恭喜您，您的版本是最新版本，无需升级！」（条件：`messagebox(sappname,"  您的系统已经有新版本,是否升级?~r    (升级将不会影响现有的数据!)~r升级程序运行过程中，如果杀毒软件提示，一定要允许操作!!!",question!,yesno!,2) = 1`）
  - [ddlb_1.rbuttondown]「是否套账名称是乱码，需要解决？」

### w_login_ts

- 类型：模态对话框；尺寸：1554×596 PBU；库：rhzw8_8.pbd（账务+成本主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 退出 | 498,340 265×92 |  |
| cb_2 | 按钮 | 重试 | 782,340 265×92 |  |
| cb_3 | 按钮 | 试用 | 1065,340 265×92 |  |
| st_1 | 静态文本 | 没有发现加密锁，请将加密锁插入本机USB 口后重试！ | 9,40 1454×80 |  |
| st_2 | 静态文本 | 点击【试用】进入试用版！ | 343,184 791×80 |  |
