# 轻松会计 · 账务主程序 — 窗口目录：凭证（前缀 `pz`）

尺寸单位为 PowerBuilder Unit（PBU）。96 DPI、系统字体下约为：宽度像素 ≈ PBU × 0.25～0.3，高度像素 ≈ PBU × 0.25～0.28。
“打开入口”只列静态可见的调用方，运行时拼出来的窗口名可能遗漏。名字含 `_bak`、`_old`、`test` 的通常是历史残留。

### w_pz_bhzl — 凭证编号重新整理

- 类型：模态对话框；尺寸：1490×956 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzxsb_bak` 的 事件 ue_action_bh；`w_pz_pzxsb_see` 的 事件 ue_action_bh；`w_pz_pzxsb` 的 事件 ue_action_bh

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 306,680 302×108 |  |
| cb_2 | 按钮 | 取消 | 777,680 302×108 |  |
| cbx_1 | 复选框 | 按照凭证日期重新排序 | 334,316 617×80 |  |
| ddlb_1 | 下拉列表 |  | 526,180 475×1092 |  |
| em_1 | 格式输入 |  | 389,40 261×80 |  |
| em_3 | 格式输入 |  | 818,40 183×80 |  |
| st_1 | 静态文本 | 说明：本功能将对凭证编号出现断号进行重新编排， | 123,448 1271×76 |  |
| st_11 | 静态文本 | 凭证类型： | 146,180 361×64 |  |
| st_2 | 静态文本 | 在断号后面的凭证编号将按顺序编号提前 | 283,536 997×76 |  |
| st_3 | 静态文本 | 年份： | 128,48 261×64 |  |
| st_6 | 静态文本 | 月 | 1019,48 165×68 |  |
| st_7 | 静态文本 | 年 | 681,48 101×64 |  |

- 窗口事件/函数：
  - `open`：读写表 pzlx

### w_pz_flxx1 — 分录信息

- 类型：模态对话框；尺寸：1632×1736 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzedit_b` 的 事件 u_flxx；`w_pz_pzedit_bak` 的 事件 u_flxx；`w_pz_pzedit_mb` 的 事件 u_flxx；`w_pz_pzedit` 的 事件 u_flxx

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 613,1480 384×100 |  |
| gb_1 | 分组框 | 分录信息 | 32,28 1550×1428 |  |
| st_001 | 静态文本 | 科目编码： | 69,244 421×96 |  |
| st_1 | 静态文本 | 一级科目： | 69,352 421×96 |  |
| st_10 | 静态文本 | 个人编码： | 69,1324 421×96 |  |
| st_11 | 静态文本 | 分录摘要： | 69,136 421×96 |  |
| st_2 | 静态文本 | 二级科目： | 69,460 421×96 |  |
| st_3 | 静态文本 | 三级科目： | 69,568 421×96 |  |
| st_4 | 静态文本 | 四级科目： | 69,676 421×96 |  |
| st_5 | 静态文本 | 五级科目： | 69,784 421×96 |  |
| st_6 | 静态文本 | 六级科目： | 69,888 421×96 |  |
| st_7 | 静态文本 | 项目编码： | 69,1000 421×96 |  |
| st_8 | 静态文本 | 客户编码： | 69,1108 421×96 |  |
| st_9 | 静态文本 | 部门编码： | 69,1216 421×96 |  |
| st_bm | 静态文本 |  | 480,1204 1024×88 |  |
| st_dw | 静态文本 |  | 480,1096 1024×88 |  |
| st_gr | 静态文本 |  | 480,1312 1024×88 |  |
| st_km1 | 静态文本 |  | 480,340 1024×88 |  |
| st_km2 | 静态文本 |  | 480,448 1024×88 |  |
| st_km3 | 静态文本 |  | 480,556 1024×88 |  |
| st_km4 | 静态文本 |  | 480,664 1024×88 |  |
| st_km5 | 静态文本 |  | 480,772 1024×88 |  |
| st_km6 | 静态文本 |  | 480,876 1024×88 |  |
| st_kmbm | 静态文本 |  | 480,232 1024×88 |  |
| st_xm | 静态文本 |  | 480,988 1024×88 |  |

- 窗口事件/函数：
  - `open`：读写表 bmk、dwk、grk、kmbm、xmk

### w_pz_get — 凭证导入

- 类型：模态对话框；尺寸：2139×1928 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzxsb_bak` 的 事件 ue_action_get；`w_pz_pzxsb_see` 的 事件 ue_action_get；`w_pz_pzxsb` 的 事件 ue_action_get

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 取消 | 1056,1588 361×144 |  |
| cb_2 | 按钮 | 确定 | 512,1588 361×144 | clicked 读写表 kmbm、pz、pzdj |
| cb_3 | 按钮 | 查找... | 1705,108 178×84 |  |
| cb_4 | 按钮 | 确定 | 663,260 457×128 |  |
| cb_5 | 按钮 | 确定 | 663,1024 457×128 |  |
| cbx_1 | 复选框 | 保留原凭证日（年和月由下面凭证日期选项所决定） | 201,844 1385×80 |  |
| ddlb_2 | 下拉列表 |  | 489,1176 471×924 |  |
| dw_1 | 数据窗口 |  | 3986,252 1248×768 | 数据窗口 `dw_pz_saveas`（表 pz、pzdj）；列：nf、yf、pzlx、pzbh、pz_xh、kmbm、pz_zy、pz_jf、pz_df、pz_wb、pz_hl、pz_sl、pz_dj、jslb、pz_ph、jzbz、xmbm、dwbm、bmbm、grbm、bz、dw、pzdj_pzdj_fds、pzdj_pzdj_bz、pzdj_pzdj_zdr、pzdj_pzdj_shr、pzdj_pzdj_jzr、pzdj_pzdj_rq、pzdj_pzdj_shrq、pzdj_pzdj_jzrq…… |
| em_1 | 格式输入 |  | 1312,1176 434×92 |  |
| em_2 | 格式输入 |  | 640,696 302×92 |  |
| em_3 | 格式输入 |  | 1083,696 320×92 |  |
| em_5 | 格式输入 |  | 827,1428 274×96 |  |
| em_lx | 格式输入 |  | 640,564 279×92 |  |
| em_ny | 格式输入 |  | 640,424 338×92 |  |
| gb_1 | 分组框 | 转入本系统的凭证设置： | 41,1072 1915×476 |  |
| gb_2 | 分组框 |  | 23,12 1915×236 |  |
| gb_3 | 分组框 | 对凭证库里的凭证符合以下条件的才转入本系统： | 27,320 1906×696 |  |
| rb_1 | 单选按钮 | 编号自动从最大号开始 | 274,1308 713×72 |  |
| rb_2 | 单选按钮 | 手工输入编号  从 | 274,1440 512×72 |  |
| sle_1 | 单行输入 |  | 581,104 1106×84 |  |
| st_1 | 静态文本 | 凭证类型： | 133,1176 370×72 |  |
| st_18 | 静态文本 | (0000-00 为不限制) | 1024,432 489×80 |  |
| st_2 | 静态文本 | 凭证日期： | 955,1176 370×72 |  |
| st_3 | 静态文本 | 凭证序号从： | 192,696 457×92 |  |
| st_4 | 静态文本 | 到 | 942,696 137×92 |  |
| st_5 | 静态文本 | 号 | 1431,696 123×92 |  |
| st_50 | 静态文本 | 转入凭证库文件名： | 69,116 503×84 |  |
| st_6 | 静态文本 | 年月 | 357,428 283×92 |  |
| st_7 | 静态文本 | 凭证类型 | 338,572 325×92 |  |
| st_8 | 静态文本 | (0 为不限制) | 1024,572 480×80 |  |
| st_9 | 静态文本 | 开始 | 1129,1436 146×80 |  |

- 窗口事件/函数：
  - `open`：读写表 pzlx

- 提示与校验（12 条）：
  - [cb_2.clicked]「请输入路径！」（条件：`parent.sle_1.text = "" or isnull(parent.sle_1.text = "")`）
  - [cb_2.clicked]「路径文件不存在或读入错！」（条件：`filehand = -1`）
  - [cb_2.clicked]「该范围内没有数据！」（条件：`r = 0`）
  - [cb_2.clicked]「凭证日期超过了时钟版的截至日期!」（条件：`long(string(gd_tt,"yyyymm")) < (nf * 100 + yf)`）
  - [cb_2.clicked]「手工录入的凭证编号过大！」（条件：`pz > 10000`）
  - [cb_2.clicked]「已审核记帐，不能生成！」（条件：`pzbz = "1" or pzbz = "2"`）
  - [cb_2.clicked]「已有号凭证,需要刷新？」（条件：`pzbz = "1" or pzbz = "2"`）
  - [cb_2.clicked]「在转入数据里，有科目，本套账里不存在或者是非明细科目！~r系统将此科目先调整成，请转入后再修改！」（条件：`yjd <> "1" or j = 100`）
  - [cb_2.clicked]「数据错误过多，请重新调整后再转入！」（条件：`i_err > 100`）
  - [cb_2.clicked]「已有小错误, 是否转入？」（条件：`errorcode = "1"`）
  - [cb_2.clicked]「转入成功！本次共转入张凭证！」
  - [cb_3.clicked]「文件不存在！」（条件：`i <> 1`）

### w_pz_get_bak — 凭证导入

- 类型：模态对话框；尺寸：2030×1748 PBU；库：rhzw8_1.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 取消 | 1056,1476 361×144 |  |
| cb_2 | 按钮 | 确定 | 512,1476 361×144 | clicked 读写表 kmbm、pz、pzdj |
| cb_3 | 按钮 | 查找... | 1705,632 178×80 |  |
| cbx_1 | 复选框 | 保留原凭证日（年和月由上面凭证日期选项所决定） | 201,1280 1385×80 |  |
| ddlb_2 | 下拉列表 |  | 471,136 471×924 |  |
| dw_1 | 数据窗口 |  | 2423,168 1248×768 | 数据窗口 `dw_pz_saveas`（表 pz、pzdj）；列：nf、yf、pzlx、pzbh、pz_xh、kmbm、pz_zy、pz_jf、pz_df、pz_wb、pz_hl、pz_sl、pz_dj、jslb、pz_ph、jzbz、xmbm、dwbm、bmbm、grbm、bz、dw、pzdj_pzdj_fds、pzdj_pzdj_bz、pzdj_pzdj_zdr、pzdj_pzdj_shr、pzdj_pzdj_jzr、pzdj_pzdj_rq、pzdj_pzdj_shrq、pzdj_pzdj_jzrq…… |
| em_1 | 格式输入 |  | 1294,136 434×92 |  |
| em_2 | 格式输入 |  | 640,1132 302×96 |  |
| em_3 | 格式输入 |  | 1083,1132 302×100 |  |
| em_5 | 格式输入 |  | 809,388 274×96 |  |
| em_lx | 格式输入 |  | 640,1000 279×96 |  |
| em_ny | 格式输入 |  | 640,860 338×92 |  |
| gb_1 | 分组框 | 转入本系统的凭证设置： | 23,32 1915×476 |  |
| gb_2 | 分组框 | 转入凭证 | 23,536 1915×920 |  |
| gb_3 | 分组框 | 对凭证库里的凭证符合以下条件的才转入本系统： | 27,756 1906×696 |  |
| rb_1 | 单选按钮 | 编号自动从最大号开始 | 256,268 713×72 |  |
| rb_2 | 单选按钮 | 手工输入编号  从 | 256,400 512×72 |  |
| sle_1 | 单行输入 |  | 581,628 1106×96 |  |
| st_1 | 静态文本 | 凭证类型： | 114,136 370×72 |  |
| st_18 | 静态文本 | (0000-00 为不限制) | 1024,868 489×80 |  |
| st_2 | 静态文本 | 凭证日期： | 937,136 370×72 |  |
| st_3 | 静态文本 | 凭证序号从： | 192,1132 457×100 |  |
| st_4 | 静态文本 | 到 | 942,1132 137×100 |  |
| st_5 | 静态文本 | 号 | 1431,1132 123×100 |  |
| st_50 | 静态文本 | 转入凭证库文件名： | 69,640 503×100 |  |
| st_6 | 静态文本 | 年月 | 357,864 283×80 |  |
| st_7 | 静态文本 | 凭证类型 | 338,1008 325×80 |  |
| st_8 | 静态文本 | (0 为不限制) | 1024,1008 480×80 |  |
| st_9 | 静态文本 | 开始 | 1111,396 146×80 |  |

- 窗口事件/函数：
  - `open`：读写表 pzlx

- 提示与校验（12 条）：
  - [cb_2.clicked]「请输入路径！」（条件：`parent.sle_1.text = "" or isnull(parent.sle_1.text = "")`）
  - [cb_2.clicked]「路径文件不存在或读入错！」（条件：`filehand = -1`）
  - [cb_2.clicked]「该范围内没有数据！」（条件：`r = 0`）
  - [cb_2.clicked]「凭证日期超过了时钟版的截至日期!」（条件：`long(string(gd_tt,"yyyymm")) < (nf * 100 + yf)`）
  - [cb_2.clicked]「手工录入的凭证编号过大！」（条件：`pz > 10000`）
  - [cb_2.clicked]「已审核记帐，不能生成！」（条件：`pzbz = "1" or pzbz = "2"`）
  - [cb_2.clicked]「已有号凭证,需要刷新？」（条件：`pzbz = "1" or pzbz = "2"`）
  - [cb_2.clicked]「在转入数据里，有科目，本套账里不存在或者是非明细科目！~r系统将此科目先调整成，请转入后再修改！」（条件：`yjd <> "1" or j = 100`）
  - [cb_2.clicked]「数据错误过多，请重新调整后再转入！」（条件：`i_err > 100`）
  - [cb_2.clicked]「已有小错误, 是否转入？」（条件：`errorcode = "1"`）
  - [cb_2.clicked]「转入成功！本次共转入张凭证！」
  - [cb_3.clicked]「文件不存在！」（条件：`i <> 1`）

### w_pz_get_bb — 凭证导入

- 类型：模态对话框；尺寸：2030×1748 PBU；库：rhzw8_1.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 取消 | 1056,1476 361×144 |  |
| cb_2 | 按钮 | 确定 | 512,1476 361×144 | clicked 读写表 kmbm、pz、pzdj |
| cb_3 | 按钮 | 查找... | 1705,632 178×80 |  |
| cbx_1 | 复选框 | 保留原凭证日（年和月由上面凭证日期选项所决定） | 201,1280 1385×80 |  |
| ddlb_2 | 下拉列表 |  | 471,136 471×924 |  |
| dw_1 | 数据窗口 |  | 2423,168 1248×768 | 数据窗口 `dw_pz_saveas`（表 pz、pzdj）；列：nf、yf、pzlx、pzbh、pz_xh、kmbm、pz_zy、pz_jf、pz_df、pz_wb、pz_hl、pz_sl、pz_dj、jslb、pz_ph、jzbz、xmbm、dwbm、bmbm、grbm、bz、dw、pzdj_pzdj_fds、pzdj_pzdj_bz、pzdj_pzdj_zdr、pzdj_pzdj_shr、pzdj_pzdj_jzr、pzdj_pzdj_rq、pzdj_pzdj_shrq、pzdj_pzdj_jzrq…… |
| em_1 | 格式输入 |  | 1294,136 434×92 |  |
| em_2 | 格式输入 |  | 640,1132 302×96 |  |
| em_3 | 格式输入 |  | 1083,1132 302×100 |  |
| em_5 | 格式输入 |  | 809,388 274×96 |  |
| em_lx | 格式输入 |  | 640,1000 279×96 |  |
| em_ny | 格式输入 |  | 640,860 338×92 |  |
| gb_1 | 分组框 | 转入本系统的凭证设置： | 23,32 1915×476 |  |
| gb_2 | 分组框 | 转入凭证 | 23,536 1915×920 |  |
| gb_3 | 分组框 | 对凭证库里的凭证符合以下条件的才转入本系统： | 27,756 1906×696 |  |
| rb_1 | 单选按钮 | 编号自动从最大号开始 | 256,268 713×72 |  |
| rb_2 | 单选按钮 | 手工输入编号  从 | 256,400 512×72 |  |
| sle_1 | 单行输入 |  | 581,628 1106×96 |  |
| st_1 | 静态文本 | 凭证类型： | 114,136 370×72 |  |
| st_18 | 静态文本 | (0000-00 为不限制) | 1024,868 489×80 |  |
| st_2 | 静态文本 | 凭证日期： | 937,136 370×72 |  |
| st_3 | 静态文本 | 凭证序号从： | 192,1132 457×100 |  |
| st_4 | 静态文本 | 到 | 942,1132 137×100 |  |
| st_5 | 静态文本 | 号 | 1431,1132 123×100 |  |
| st_50 | 静态文本 | 转入凭证库文件名： | 69,640 503×100 |  |
| st_6 | 静态文本 | 年月 | 357,864 283×80 |  |
| st_7 | 静态文本 | 凭证类型 | 338,1008 325×80 |  |
| st_8 | 静态文本 | (0 为不限制) | 1024,1008 480×80 |  |
| st_9 | 静态文本 | 开始 | 1111,396 146×80 |  |

- 窗口事件/函数：
  - `open`：读写表 pzlx

- 提示与校验（12 条）：
  - [cb_2.clicked]「请输入路径！」（条件：`parent.sle_1.text = "" or isnull(parent.sle_1.text = "")`）
  - [cb_2.clicked]「路径文件不存在或读入错！」（条件：`filehand = -1`）
  - [cb_2.clicked]「该范围内没有数据！」（条件：`r = 0`）
  - [cb_2.clicked]「凭证日期超过了时钟版的截至日期!」（条件：`long(string(gd_tt,"yyyymm")) < (nf * 100 + yf)`）
  - [cb_2.clicked]「手工录入的凭证编号过大！」（条件：`pz > 10000`）
  - [cb_2.clicked]「已审核记帐，不能生成！」（条件：`pzbz = "1" or pzbz = "2"`）
  - [cb_2.clicked]「已有号凭证,需要刷新？」（条件：`pzbz = "1" or pzbz = "2"`）
  - [cb_2.clicked]「在转入数据里，有科目，本套账里不存在或者是非明细科目！~r系统将此科目先调整成，请转入后再修改！」（条件：`yjd <> "1" or j = 100`）
  - [cb_2.clicked]「数据错误过多，请重新调整后再转入！」（条件：`i_err > 100`）
  - [cb_2.clicked]「已有小错误, 是否转入？」（条件：`errorcode = "1"`）
  - [cb_2.clicked]「转入成功！本次共转入张凭证！」
  - [cb_3.clicked]「文件不存在！」（条件：`i <> 1`）

### w_pz_jccx — 凭证辅助项交叉查询

- 类型：模态对话框；尺寸：1728×1148 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzxsb_bak` 的 事件 ue_action_query2；`w_pz_pzxsb_see` 的 事件 ue_action_query2；`w_pz_pzxsb` 的 事件 ue_action_query2

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 471,864 274×108 | clicked 读写表 kmbm |
| cb_2 | 按钮 | 取消 | 974,864 274×108 |  |
| cb_3 | 按钮 | 搜索 | 1472,296 142×84 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| cbx_1 | 复选框 | 包括未过账凭证 | 832,412 585×72 |  |
| ddlb_hx | 下拉列表 |  | 645,676 334×424 |  |
| ddlb_zx | 下拉列表 |  | 645,556 334×424 |  |
| em_1 | 格式输入 |  | 933,140 224×92 |  |
| em_2 | 格式输入 |  | 1326,140 224×92 |  |
| em_nf | 格式输入 |  | 306,140 306×92 |  |
| sle_1 | 下拉列表 |  | 293,296 1175×948 |  |
| st_1 | 静态文本 | 科目 | 91,296 174×72 |  |
| st_2 | 静态文本 | 横向核算类型 | 210,680 370×84 |  |
| st_3 | 静态文本 | 月份从 | 654,148 261×72 |  |
| st_4 | 静态文本 | 到 | 1175,148 123×72 |  |
| st_5 | 静态文本 | 纵向核算类型 | 210,556 370×84 |  |
| st_nf | 静态文本 | 会计年度 | 73,148 229×72 |  |

- 提示与校验（4 条）：
  - [cb_1.clicked]「科目不存在！」（条件：`i <> 1`）
  - [cb_1.clicked]「纵向核算类型必须选择！」（条件：`trim(xt_cs5) = ""`）
  - [cb_1.clicked]「横向核算类型必须选择！」（条件：`trim(xt_cs6) = ""`）
  - [cb_1.clicked]「纵向和横向的核算类型不能一样！」（条件：`xt_cs5 = xt_cs6`）

### w_pz_jccx_1 — 辅助项交叉查询汇总表

- 类型：主窗口（默认）；尺寸：3045×1792 PBU；继承：`wroot_single_1`；菜单：`m_work_zw_01`；库：rhzw8_1.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 361,196 631×676 | 数据窗口 `dw_zc_slz`（表 slz）；列：yf（月）、rq（日）、pzlx、pzbh、pz_xh、pz_zh（凭证字号）、pz_zy（凭证摘要）、kmbm、dfkm_mc（对方科目）、jslb、pz_ph、pjdh（银行票据）、jf（借方发生额）、df（贷方发生额）、ye、pzrq、xmbm、xm_mc、nf、pzdj_bz、xh |
| uo_1 | u_toolbar |  | , 544×200 |  |
| dw_1 | 数据窗口 |  | 14,204 2821×1348 |  |
| dw_2 | 数据窗口 |  | 955,1056 1477×480 |  |

- 窗口事件/函数：
  - `open`：读写表 bmk、dwk、grk、xmk
  - `wf_get`：读写表 bmk、dwk、grk、kmbm、xmk

- 提示与校验（5 条）：
  - [窗口事件 open]「建立数据窗口不成功！~r 可能是下级科目太多，内存不足！」（条件：`i = -1`）
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_refresh]「是否包含所有单据?」（条件：`this.is_sm_bz = "1"`）
  - [窗口事件 ue_action_refresh]「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」

### w_pz_km_find — 科目查找

- 类型：模态对话框；尺寸：3630×1860 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_fx_km` 的 cb_3.clicked；`w_fx_nd` 的 cb_3.clicked；`w_fx_yd` 的 cb_3.clicked；`w_fx_zl` 的 cb_3.clicked；`w_pz_jccx` 的 cb_3.clicked；`w_pz_pzedit_b` 的 dw_master.itemchanged；`w_pz_pzedit_b` 的 事件 u_cn_get；`w_pz_pzedit_b` 的 事件 u_find；`w_pz_pzedit_bak` 的 dw_master.itemchanged；`w_pz_pzedit_bak` 的 事件 u_cn_get；`w_pz_pzedit_bak` 的 事件 u_find；`w_pz_pzedit_mb` 的 dw_master.itemchanged……（共 57 处）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 开始搜索 | 937,1616 398×108 |  |
| cb_2 | 按钮 | 确定 | 1527,1616 398×108 | clicked 读写表 kmbm |
| dw_1 | 数据窗口 |  | ,4 3593×1436 | 数据窗口 `dw_xt_km_help`（表 kmbm）；列：kmbm（科目编码）、km_mc（科目名称）、kmqc、fbs、sls、yefx |
| sle_1 | 单行输入 |  | 1061,1488 1038×88 |  |
| st_1 | 静态文本 | 搜索内容： | 699,1496 379×72 |  |
| st_2 | 静态文本 | 键盘操作说明： | 2290,1472 526×68 |  |
| st_3 | 静态文本 | 1）按上下箭头选择科目 | 2350,1552 585×76 |  |
| st_4 | 静态文本 | 2）找到后按回车确认（或者鼠标双击） | 2359,1640 969×76 |  |

- 提示与校验（2 条）：
  - [cb_2.clicked]「科目不是明细科目，不可选。」（条件：`xx <> "1"`）
  - [cb_2.clicked]「未搜索到结果，请重新填写搜索内容！」（条件：`xx <> "1"`）

### w_pz_kmhz — 凭证汇总

- 类型：模态对话框；尺寸：1819×1424 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_main1` 的 st_1_km.clicked；`w_main1` 的 tab_1/tabpage_1/p_t_1_km.clicked；`w_pz_pzxsb_bak` 的 事件 ue_action_hz；`w_pz_pzxsb_see` 的 事件 ue_action_hz；`w_pz_pzxsb` 的 事件 ue_action_hz

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 汇总 | 302,1192 306×100 | clicked → `w_pz_kmhz1`「凭证汇总」 |
| cb_2 | 按钮 | 退出 | 987,1192 306×100 |  |
| ddlb_1 | 下拉列表 |  | 475,884 585×512 |  |
| ddlb_2 | 下拉列表 |  | 475,1008 585×512 |  |
| ddlb_pzlx1 | 下拉列表 |  | 1230,124 434×792 | selectionchanged 读写表 pzdj |
| dw_1 | 数据窗口 |  | 14,236 2875×1420 | 数据窗口 `dw_pz_kmhz`（表 dba.pzhz）；列：kmbm（科目编码）、bz（币  种）、jfwb（借方外币）、jf（借方金额）、dfwb（贷方外币）、df（贷方金额）、kmqc（科目名称） |
| em_1 | 格式输入 |  | 475,260 293×96 |  |
| em_2 | 格式输入 |  | 901,260 293×96 |  |
| em_3 | 格式输入 |  | 475,124 352×100 | modified 读写表 pzdj |
| gb_1 | 分组框 | 范围： | 1088,392 613×440 |  |
| gb_2 | 分组框 | 外币 | 87,392 517×440 |  |
| gb_3 | 分组框 | 汇总 | 581,392 517×440 |  |
| gb_4 | 分组框 | 选项 | 23,28 1746×1120 |  |
| rb_1 | 单选按钮 | 全部凭证 | 1211,504 402×76 |  |
| rb_2 | 单选按钮 | 未过帐凭证 | 1211,688 475×76 |  |
| rb_3 | 单选按钮 | 已过帐凭证 | 1211,596 448×76 |  |
| rb_4 | 单选按钮 | 不含外币 | 178,504 402×72 |  |
| rb_5 | 单选按钮 | 外币汇总 | 174,688 402×72 |  |
| rb_6 | 单选按钮 | 一级科目 | 663,504 402×72 |  |
| rb_7 | 单选按钮 | 明细科目 | 663,688 402×72 |  |
| st_1 | 静态文本 | 凭证号： | 119,272 361×76 |  |
| st_2 | 静态文本 | 至 | 773,264 128×92 |  |
| st_3 | 静态文本 | 凭证年月： | 101,136 379×72 |  |
| st_4 | 静态文本 | 凭证类型： | 855,136 379×76 |  |
| st_5 | 静态文本 | 会计主管： | 101,896 379×80 |  |
| st_6 | 静态文本 | 审核人： | 101,1012 379×80 |  |

- 窗口事件/函数：
  - `open`：读写表 b_user、pzdj、pzlx

### w_pz_kmhz1 — 凭证汇总

- 类型：弹出窗口；尺寸：2926×1880 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_kmhz` 的 cb_1.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 预览 | 1102,1668 224×96 | clicked → `w_preview`「打印预览」 |
| cb_2 | 按钮 | 打印 | 1797,1668 224×96 | clicked → `w_print`「账册打印」 |
| cb_3 | 按钮 | 退出 | 2144,1668 224×96 |  |
| cb_4 | 按钮 | 另存 | 1449,1668 224×96 |  |
| dw_1 | 数据窗口 |  | 14,236 2875×1420 | 数据窗口 `dw_pz_kmhz`（表 dba.pzhz）；列：kmbm（科目编码）、bz（币  种）、jfwb（借方外币）、jf（借方金额）、dfwb（贷方外币）、df（贷方金额）、kmqc（科目名称） |
| st_11 | 静态文本 | none | 96,24 2231×72 |  |
| st_13 | 静态文本 | none | 96,128 2231×72 |  |

- 窗口事件/函数：
  - `open`：读写表 dba、kmbm、pz、pzdj

### w_pz_modify — 修改制单人

- 类型：模态对话框；尺寸：1495×1032 PBU；库：rhzw8_1.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 311,780 302×108 | clicked 读写表 pzdj |
| cb_2 | 按钮 | 取消 | 777,780 302×108 |  |
| ddlb_1 | 下拉列表 |  | 489,488 475×532 |  |
| em_1 | 格式输入 |  | 489,356 357×80 |  |
| em_4 | 格式输入 |  | 489,604 306×80 |  |
| em_5 | 格式输入 |  | 937,604 306×80 |  |
| gb_1 | 分组框 | 修改凭证范围： | 37,268 1394×456 |  |
| st_10 | 静态文本 | 号 | 1253,612 101×64 |  |
| st_11 | 静态文本 | 凭证类型： | 110,488 361×64 |  |
| st_2 | 静态文本 | 仅对下列范围未审核过账的凭证的有效！ | 50,144 1339×80 |  |
| st_3 | 静态文本 | 凭证年月： | 187,364 283×64 |  |
| st_8 | 静态文本 | 凭证号从： | 110,612 361×64 |  |
| st_9 | 静态文本 | 到 | 805,612 128×64 |  |

- 窗口事件/函数：
  - `open`：读写表 pzlx

### w_pz_plxg — 凭证批量修改

- 类型：模态对话框；尺寸：1531×1608 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzxsb_bak` 的 事件 ue_action_plxg；`w_pz_pzxsb_see` 的 事件 ue_action_plxg；`w_pz_pzxsb` 的 事件 ue_action_plxg

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 306,1380 302×108 | clicked 读写表 b_rights、pz、pzdj、xt |
| cb_2 | 按钮 | 取消 | 773,1380 302×108 |  |
| cbx_1 | 复选框 | 仅修改年月，日不修改 | 434,928 704×80 |  |
| ddlb_1 | 下拉列表 |  | 489,404 475×532 |  |
| ddlb_2 | 下拉列表 |  | 709,1156 475×532 |  |
| em_1 | 格式输入 |  | 462,280 402×80 |  |
| em_4 | 格式输入 |  | 489,520 306×80 |  |
| em_5 | 格式输入 |  | 937,520 306×80 |  |
| em_pzrq | 格式输入 |  | 704,832 425×96 |  |
| gb_1 | 分组框 | 修改凭证范围： | 37,172 1394×524 |  |
| gb_2 | 分组框 | 修改内容： | 37,736 1394×572 |  |
| rb_1 | 单选按钮 | 修改凭证日期为 | 178,840 503×80 |  |
| rb_2 | 单选按钮 | 修改制单人为 | 178,1044 896×80 |  |
| rb_3 | 单选按钮 | 修改凭证类型为 | 178,1156 521×80 |  |
| st_1 | 静态文本 | 说明：此功能仅能修改以下范围内未过账审核的凭证！ | 73,52 1381×80 |  |
| st_10 | 静态文本 | 号 | 1253,528 101×64 |  |
| st_11 | 静态文本 | 凭证类型： | 110,404 361×64 |  |
| st_3 | 静态文本 | 年月： | 128,280 261×64 |  |
| st_8 | 静态文本 | 凭证号从： | 110,528 361×64 |  |
| st_9 | 静态文本 | 到 | 805,528 128×64 |  |

- 窗口事件/函数：
  - `open`：读写表 pzlx

- 提示与校验（7 条）：
  - [cb_1.clicked]「再次确认已经选择好修改的内容？」
  - [cb_1.clicked]「您在【套账信息】处设置了不允许修改删除别人的凭证，此功能不能使用！」（条件：`s_delbz = "1"`）
  - [cb_1.clicked]「修改的凭证日期不能小于」（条件：`s_rq < xt_jzyf`）
  - [cb_1.clicked]「请先到【系统管理】菜单下的【套账信息】，将 凭证编号设置 由【计算机编号】修改为【手工编号】」（条件：`i = 0`）
  - [cb_1.clicked]「修改日期将会影响凭证编号，是否允许系统自动将【套账信息】里的 凭证编号设置 由【计算机编号】修改为【手工编号】？」（条件：`i = 0`）
  - [cb_1.clicked]「修改前后的凭证类型是一致的，不需要修改！」（条件：`n_pzlx = pzlx`）
  - [cb_1.clicked]「修改凭证类型将会影响凭证编号，是否允许系统自动将【套账信息】里的 凭证编号设置 由【计算机编号】修改为【手工编号】？」（条件：`i = 0`）

### w_pz_prn_1 — 打印凭证-1

- 类型：弹出窗口；尺寸：5120×1760 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzedit_b` 的 事件 u_print；`w_pz_pzedit_bak` 的 事件 u_print；`w_pz_pzedit_mb` 的 事件 u_print；`w_pz_pzedit` 的 事件 u_print

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 上页 | 2405,12 178×96 |  |
| cb_16 | 按钮 | 打印当前页 | 3195,12 306×96 |  |
| cb_17 | 按钮 | > | 590,24 78×72 |  |
| cb_2 | 按钮 | 下页 | 2583,12 178×96 |  |
| cb_26 | 按钮 | < | 343,24 78×72 |  |
| cb_3 | 按钮 | 关闭 | 4041,12 219×96 |  |
| cb_4 | 按钮 | 打印机... | 2757,12 265×96 |  |
| cb_6 | 按钮 | 打印 | 3022,12 174×96 |  |
| cbx_1 | 复选框 | 标尺 | 1275,24 201×76 |  |
| cbx_2 | 复选框 | 横向打印 | 1504,24 334×76 |  |
| ddlb_1 | 下拉列表 | 100 | 1024,24 219×920 |  |
| dw_1 | 数据窗口 |  | 18,136 2976×1336 | 数据窗口 `dw_pz_prn_1`；列：a |
| em_1 | 格式输入 | 1 | 3817,20 160×84 |  |
| em_2 | 格式输入 | 100 | 334,20 338×84 |  |
| em_hs | 格式输入 |  | 2139,24 229×76 | modified 读写表 xt |
| st_1 | 静态文本 | 打印份数： | 3511,36 311×52 |  |
| st_12 | 静态文本 | 打印比例： | 18,32 311×60 |  |
| st_2 | 静态文本 | 屏幕缩放： | 713,28 320×64 |  |
| st_3 | 静态文本 | 每页行数 | 1879,28 251×68 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_pz_prn_x1`、`dw_pz_prn_x1_sz`、`dw_pz_prn_x1_xzsy`、`dw_pz_prn_x1_zy`、`dw_pz_prn_x2`、`dw_pz_prn_x2_sz`、`dw_pz_prn_x2_zy`、`dw_pz_prn_x3`；读写表 kmbm、xt
  - `closequery`：读写表 xt
  - `f_inst`：读写表 bmk、dwk、grk、kmbm、xmk、xt

### w_pz_prn_1_a4 — 打印凭证-1

- 类型：弹出窗口；尺寸：5102×1600 PBU；库：rhzw8_1.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 上页 | 2405,12 178×96 |  |
| cb_16 | 按钮 | 打印当前页 | 3182,12 311×96 |  |
| cb_17 | 按钮 | > | 1147,24 78×72 |  |
| cb_2 | 按钮 | 下页 | 2578,12 178×96 |  |
| cb_26 | 按钮 | < | 901,24 78×72 |  |
| cb_3 | 按钮 | 关闭 | 4041,12 219×96 |  |
| cb_4 | 按钮 | 打印设置 | 2752,12 261×96 |  |
| cb_6 | 按钮 | 打印 | 3008,12 178×96 |  |
| cbx_1 | 复选框 | 标尺 | 1275,24 201×76 |  |
| cbx_2 | 复选框 | 横向打印 | 1504,24 334×76 |  |
| ddlb_1 | 下拉列表 | 100 | 338,28 219×920 |  |
| dw_1 | 数据窗口 |  | 18,136 2976×1336 | 数据窗口 `dw_pz_prn_1`；列：a |
| em_1 | 格式输入 | 1 | 3817,20 160×84 |  |
| em_2 | 格式输入 | 100 | 891,20 338×84 |  |
| em_hs | 格式输入 |  | 2135,24 229×76 |  |
| st_1 | 静态文本 | 打印份数： | 3511,36 311×52 |  |
| st_12 | 静态文本 | 打印比例： | 576,32 311×60 |  |
| st_2 | 静态文本 | 缩放比例： | 27,28 320×64 |  |
| st_3 | 静态文本 | 每页行数 | 1879,28 251×68 |  |

- 窗口事件/函数：
  - `open`：读写表 kmbm、xt
  - `closequery`：读写表 xt
  - `f_inst`：读写表 bmk、dwk、grk、kmbm、xmk、xt

### w_pz_prn_1_bak — 打印凭证-1

- 类型：弹出窗口；尺寸：5102×1600 PBU；库：rhzw8_1.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 上页 | 2405,12 178×96 |  |
| cb_16 | 按钮 | 打印当前页 | 3182,12 311×96 |  |
| cb_17 | 按钮 | > | 1147,24 78×72 |  |
| cb_2 | 按钮 | 下页 | 2578,12 178×96 |  |
| cb_26 | 按钮 | < | 901,24 78×72 |  |
| cb_3 | 按钮 | 关闭 | 4041,12 219×96 |  |
| cb_4 | 按钮 | 打印设置 | 2752,12 261×96 |  |
| cb_6 | 按钮 | 打印 | 3008,12 178×96 |  |
| cbx_1 | 复选框 | 标尺 | 1275,24 201×76 |  |
| cbx_2 | 复选框 | 横向打印 | 1504,24 334×76 |  |
| ddlb_1 | 下拉列表 | 100 | 338,28 219×920 |  |
| dw_1 | 数据窗口 |  | 18,136 2976×1336 | 数据窗口 `dw_pz_prn_1`；列：a |
| em_1 | 格式输入 | 1 | 3817,20 160×84 |  |
| em_2 | 格式输入 | 100 | 891,20 338×84 |  |
| em_hs | 格式输入 |  | 2135,24 229×76 | modified 读写表 xt |
| st_1 | 静态文本 | 打印份数： | 3511,36 311×52 |  |
| st_12 | 静态文本 | 打印比例： | 576,32 311×60 |  |
| st_2 | 静态文本 | 缩放比例： | 27,28 320×64 |  |
| st_3 | 静态文本 | 每页行数 | 1879,28 251×68 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_pz_prn_x1`、`dw_pz_prn_x1_sz`、`dw_pz_prn_x1_zy`、`dw_pz_prn_x2`、`dw_pz_prn_x2_sz`、`dw_pz_prn_x2_zy`、`dw_pz_prn_x3`、`dw_pz_prn_x4`；读写表 xt
  - `closequery`：读写表 xt
  - `f_inst`：读写表 bmk、dwk、grk、kmbm、xmk、xt

### w_pz_prn_2 — 凭证连续打印

- 类型：弹出窗口；尺寸：1934×1180 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzxsb_bak` 的 事件 ue_action_print；`w_pz_pzxsb_see` 的 事件 ue_action_print；`w_pz_pzxsb` 的 事件 ue_action_print

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_3 | 按钮 | 取消 | 1490,832 329×100 |  |
| cb_6 | 按钮 | 打印 | 1106,832 329×100 | clicked 读写表 pzdj、xt |
| ddlb_1 | 下拉列表 |  | 1179,328 526×580 |  |
| dw_1 | 数据窗口 |  | 5, 1947×1200 | 数据窗口 `dw_pz_prn_1`；列：a |
| em_1 | 格式输入 |  | 430,320 352×96 |  |
| em_2 | 格式输入 |  | 430,460 352×96 |  |
| em_3 | 格式输入 |  | 1111,464 352×92 |  |
| em_4 | 格式输入 | 1 | 1573,672 210×92 |  |
| gb_1 | 分组框 |  | 32,232 1865×400 |  |
| gb_2 | 分组框 | 打印选择 | 32,644 923×188 |  |
| gb_3 | 分组框 | 打印范围 | 32,8 1865×192 |  |
| rb_1 | 单选按钮 | 连续打印 | 101,720 402×72 |  |
| rb_2 | 单选按钮 | 每页暂停 | 567,716 357×80 |  |
| rb_pz1 | 单选按钮 | 按凭证顺序打印 | 251,88 507×76 |  |
| rb_pz2 | 单选按钮 | 按屏幕显示顺序打印 | 1083,88 635×76 |  |
| st_1 | 静态文本 | 凭证年月： | 101,340 325×60 |  |
| st_2 | 静态文本 | 凭证类型： | 850,340 325×60 |  |
| st_3 | 静态文本 | 凭证编号： | 101,480 325×60 |  |
| st_4 | 静态文本 | 到 | 873,480 110×56 |  |
| st_5 | 静态文本 | 打印份数： | 1257,688 320×60 |  |
| st_6 | 静态文本 | 请先在一张凭证的预览里调整好位置！ | 27,860 974×72 |  |

- 窗口事件/函数：
  - `open`：读写表 pzlx、xt
  - `wf_pz`：数据窗口 `dw_pz_prn_x1`、`dw_pz_prn_x1_sz`、`dw_pz_prn_x1_zy`、`dw_pz_prn_x2`、`dw_pz_prn_x2_sz`、`dw_pz_prn_x2_zy`、`dw_pz_prn_x3`、`dw_pz_prn_x4`；读写表 bmk、dwk、grk、kmbm、pz、pzlx、xmk、xt

- 提示与校验（2 条）：
  - [窗口事件 wf_pz]「下面打印」（条件：`this.rb_2.checked = true`）
  - [rb_pz2.clicked]「选用此模式，请先将要打印的凭证查询出来！~r( 在凭证序时簿界面使用查询功能 )」

### w_pz_prn_3 — 凭证合并打印

- 类型：弹出窗口；尺寸：1961×1444 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzxsb_bak` 的 事件 ue_action_preview；`w_pz_pzxsb_see` 的 事件 ue_action_preview；`w_pz_pzxsb` 的 事件 ue_action_preview

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_3 | 按钮 | 取消 | 1051,1212 329×100 |  |
| cb_6 | 按钮 | 打印 | 667,1216 329×100 | clicked 读写表 pzdj、pzlx、xt |
| ddlb_1 | 下拉列表 |  | 1184,644 526×580 |  |
| dw_1 | 数据窗口 |  | 1970,36 1925×1304 | 数据窗口 `dw_pz_prn_1`；列：a |
| em_1 | 格式输入 |  | 430,640 352×84 |  |
| em_2 | 格式输入 |  | 430,780 352×88 |  |
| em_3 | 格式输入 |  | 1111,780 352×88 |  |
| em_4 | 格式输入 | 1 | 1335,972 183×92 |  |
| em_jg | 格式输入 | 500 | 1399,1068 270×92 |  |
| gb_1 | 分组框 |  | 32,536 1865×400 |  |
| gb_2 | 分组框 | 打印选择 | 32,956 923×188 |  |
| gb_3 | 分组框 | 打印范围 | 32,312 1865×192 |  |
| rb_1 | 单选按钮 | 连续打印 | 101,1032 402×72 |  |
| rb_2 | 单选按钮 | 每张暂停 | 567,1028 357×80 |  |
| rb_pz1 | 单选按钮 | 按凭证顺序打印 | 251,392 507×76 |  |
| rb_pz2 | 单选按钮 | 按屏幕显示顺序打印 | 1083,392 635×76 |  |
| st_1 | 静态文本 | 凭证年月： | 101,644 325×76 |  |
| st_15 | 静态文本 | 2页之间间隔 | 1019,1084 320×60 |  |
| st_2 | 静态文本 | 凭证类型： | 850,644 325×60 |  |
| st_3 | 静态文本 | 凭证编号： | 101,784 325×80 |  |
| st_4 | 静态文本 | 到 | 873,784 110×80 |  |
| st_5 | 静态文本 | 打印份数： | 1019,988 320×60 |  |
| st_6 | 静态文本 | 2) 请先在凭证预览里调整好位置！(每页行数为6,且只占用纸张一半) | 18,116 1920×72 |  |
| st_7 | 静态文本 | 3) 系统计算打印位置比较复杂，等待时间稍长 | 18,196 1920×80 |  |
| st_8 | 静态文本 | 1) 本模块功能是将2页凭证合并成一页进行输出打印 | 18,28 1920×80 |  |

- 窗口事件/函数：
  - `open`：读写表 kmbm、pzlx、xt
  - `wf_get_pzgs`：读写表 kmbm、pz
  - `wf_pz`：读写表 bmk、dwk、grk、kmbm、pz、xmk
  - `wf_pz0`：数据窗口 `dw_pz_prn_x1`、`dw_pz_prn_x1_sz`、`dw_pz_prn_x1_xzsy`、`dw_pz_prn_x1_zy`、`dw_pz_prn_x2`、`dw_pz_prn_x2_sz`、`dw_pz_prn_x2_zy`、`dw_pz_prn_x3`；读写表 bmk、dwk、grk、kmbm、pz、pzlx、xmk、xt

- 提示与校验（2 条）：
  - [窗口事件 wf_pz0]「下面打印年月第号凭证」（条件：`this.rb_2.checked = true`）
  - [rb_pz2.clicked]「选用此模式，请先将要打印的凭证查询出来！~r( 在凭证序时簿界面使用查询功能 )」

### w_pz_pzedit — 凭证录入

- 类型：主窗口（默认）；尺寸：4421×2536 PBU；继承：`wroot_share`；菜单：`m_work_pz_pzedit`；库：rhzw8_1.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw_share_detail |  | 55,1916 3909×404 | 数据窗口 `dw_pz_edit_1`（表 pz、kmbm）；列：pz_zy、kmbm、pz_jf、pz_df、pz_wb（外币金额：）、pz_hl（汇　　率：）、pz_sl（数量：）、pz_dj（单价：）、pz_ph（银行单号）、jzbz、xmbm（核算项目：）、dwbm（客供编码：）、bmbm（部门编码：）、grbm（个人编码：）、bz（币种：）、dw、pzbh、pz_xh、bz1、jslb（结算类别：）、xjbm（现金流向：）、kmbm_kmqc、htbh、hg_qdh、hg_dh、hg_zl、hg_bz、nf、yf、pzlx；itemchanged → `w_xt_xm_sc`「项目查找」、`w_xt_dw_sc`「客户查找」、`w_xt_bm_sc`「部门查找」、`w_xt_gr_sc`「人员查找」、`w_xt_ht_sc`「合同查找」；itemchanged 读写表 bmk、cn_mx、dba、dwk、fbgl、grk、htda、xmk；doubleclicked → `w_xt_bm_sc`「部门查找」、`w_xt_xm_sc`「项目查找」、`w_xt_gr_sc`「人员查找」、`w_xt_dw_sc`「客户查找」、`w_xt_ht_sc`「合同查找」 |
| dw_master | uo_dw_share_master |  | 5,500 4023×1268 | 数据窗口 `dw_pz_edit`（表 pz、kmbm）；列：pz_zy（分录摘要）、kmbm（科目编码）、pz_jf（借方金额）、pz_df（贷方金额）、pz_wb、pz_hl、pz_sl、pz_dj、pz_ph、jzbz、xmbm、dwbm、km_1、grbm、bz、dw、pzbh、pz_xh、bz1、jslb、xjbm、kmbm_kmqc、htbh、hg_qdh、hg_dh、hg_zl、hg_bz、nf、yf、pzlx；itemchanged → `w_pz_km_find`「科目查找」；itemchanged 读写表 cn_mx、fbgl、kmbm；doubleclicked → `w_xt_zy`「摘要管理」；clicked 读写表 kmbm |
| uo_1 | u_toolbar |  | 32, 3890×200 |  |
| cb_1 | 按钮 | 借 | 3653,2008 151×80 | clicked 读写表 cn_mx |
| cb_2 | 按钮 | 贷 | 3822,2008 151×80 | clicked 读写表 cn_mx |
| ddlb_pzlx | 下拉列表 |  | 439,380 421×464 |  |
| em_fds | 格式输入 |  | 3250,360 311×96 |  |
| em_pzbh | 格式输入 |  | 1947,368 311×96 | modified 读写表 pzdj |
| em_pzrq | 格式输入 |  | 443,268 421×96 |  |
| gb_1 | 分组框 |  | ,1864 4037×480 |  |
| st_fds | 静态文本 | 附单: | 2917,376 251×88 |  |
| st_jzr_n | 静态文本 | 记账人: | 1266,1796 293×84 |  |
| st_pzbh | 静态文本 | 凭证编号: | 1499,380 361×88 |  |
| st_pzlx | 静态文本 | 凭证类型: | 32,380 370×84 |  |
| st_pzlx_name | 静态文本 | 记账凭证 | 1289,216 1381×104 |  |
| st_pzrq | 静态文本 | 凭证日期: | 37,276 370×84 |  |
| st_shr_n | 静态文本 | 审核人: | 82,1796 283×84 |  |
| st_zdr_n | 静态文本 | 制单人: | 2459,1796 288×84 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_pz_edit`、`dw_pz_edit0`；读写表 kmbm、pzdj、pzlx、xt
  - `u_befo`：读写表 pzdj
  - `u_copy`：打开 `w_pzedit_copy`「复制凭证」；读写表 kmbm、pz
  - `u_end`：读写表 pzdj
  - `u_fc`：打开 `w_pzedit_fc`「反冲凭证」；读写表 kmbm、pz
  - `u_find`：打开 `w_pz_km_find`「科目查找」；读写表 kmbm
  - `u_flxx`：打开 `w_pz_flxx1`「分录信息」
  - `u_hlgl`：打开 `w_xt_fbwh`「外币管理」、`w_pzedit_hlgl_rq`「汇兑损益」；读写表 fbgl、hz、kmbm、nc、pzdj
  - `u_next`：读写表 pzdj
  - `u_open`：读写表 pzdj、pzlx、xt
  - `u_print`：打开 `w_pz_prn_1`「打印凭证-1」；读写表 kmbm
  - `u_pzclock`：读写表 kmbm、pz、pzdj、xjll_xm
  - `u_pzsave`：读写表 bmk、cn_mx、dwk、from、g_fp_mx、g_fp_mx_2、grk、htda、kmbm、pjnr1、pz、pzdj、xjll_xm、xmk、xt
  - `u_pzxxbz`：打开 `w_xt_zy`「摘要管理」、`w_xt_kmwh`「科目维护」、`w_xt_xmwh`「核算项目」、`w_xt_dwwh`「客供维护（运行时设置）」、`w_xt_bmwh`「部门管理」、`w_xt_grwh`「人员管理」、`w_ht_htda`「合同档案管理」；读写表 kmbm
  - `u_first`：读写表 pzdj
  - `u_mb`：打开 `w_pz_pzmb_xz`「读入凭证模版」；读写表 kmbm、pzmb_pz
  - `u_mb1`：打开 `w_pz_pzmb_add`「增加凭证模版」
  - `u_calc`：打开 `w_calc`「简易计算器」
  - `u_cn_get`：打开 `w_pz_pzedit_cn_get`「出纳数据引入」、`w_pz_km_find`「科目查找」；读写表 kmbm
  - `ue_action_preview`：打开 `w_bb_pjnr_gs`「特殊打印选择」
  - `wf_getbh`：读写表 pzdj
  - `wf_pzmb_save`：读写表 bmk、dwk、grk、kmbm、pzmb、pzmb_pz、xjll_xm、xmk、xt
  - `wf_xjll`：读写表 kmbm
  - `wf_zy`：读写表 zyk

- 提示与校验（82 条）：
  - [窗口事件 closequery]「是否存储所作的修改？」（条件：`this.dw_master.modifiedcount() <> 0 and this.xg_bz = "1"`）
  - [窗口事件 u_copy]「原凭证不存在」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 u_find]「科目不是明细科目，不可选。」（条件：`mm_zy <> "1"`）
  - [窗口事件 u_hlgl]「生成汇兑损益前，需要先到【外币类型】处填写正确期末汇率！~r     您已经填写好了吗(Y/N)？」
  - [窗口事件 u_hlgl]「需要到【外币类型】处填写期末汇率吗(Y/N)？」（条件：`i0 > 0`）
  - [窗口事件 u_hlgl]「还有未过帐凭证！」（条件：`i > 0`）
  - [窗口事件 u_new]「是否删除此凭证，并重新输入？」
  - [窗口事件 u_pzclock]「第  行需输入现金流量！」（条件：`isnull(xjbm) or len(xjbm) = 0`）
  - [窗口事件 u_pzclock]「第  行的现金流量方向有错误！        是否重新输入?」（条件：`jd = "0" and mm_df <> 0`）
  - [窗口事件 u_pzclock]「第  行不需输入现金流量！」（条件：`len(xjbm) > 0`）
  - [窗口事件 u_pzclock]「审核人和制单人相同不能审核！」（条件：`this.st_zdr1.text = u_name`）
  - [窗口事件 u_pzclock]「此凭证已经审核，您是要取消此凭证的审核吗？」
  - [窗口事件 u_pzsave]「凭证日期超出当前日期太久，不能存盘!」（条件：`(this.nf * 100 + this.yf) > (r1 + 12)`）
  - [窗口事件 u_pzsave]「凭证日期超出当前日期，请确认一下凭证日期是否正确!」（条件：`(this.nf * 100 + this.yf) > r1`）
  - [窗口事件 u_pzsave]「凭证日期超出本版本程序允许范围，不能存盘! ~r    请进行软件升级!」（条件：`isnull(this.nf) or isnull(this.yf) or (this.nf * 100 + this.yf) < 198001 or (this.nf * 100 + this.yf) > 204912`）
  - [窗口事件 u_pzsave]「凭证日期超过了时钟版的截至日期，不能存盘!」（条件：`long(string(gd_tt,"yyyymm")) < (this.nf * 100 + this.yf)`）
  - [窗口事件 u_pzsave]「凭证类型错误，不能存盘!」（条件：`isnull(this.pzlx)`）
  - [窗口事件 u_pzsave]「请重新输入凭证编号!」（条件：`isnull(this.pzbh)`）
  - [窗口事件 u_pzsave]「第  行分录科目录入信息不完全！是否重输？」（条件：`isnull(mm_kmbm) or len(righttrim(lefttrim(mm_kmbm))) = 0`）
  - [窗口事件 u_pzsave]「第  行的现金流向错误!」（条件：`r1 = -1`）
  - [窗口事件 u_pzsave]「第  行分录的现金流向方向有错误！        是否重新输入?」（条件：`jd = "0" and mm_df <> 0`）
  - [窗口事件 u_pzsave]「第  行的现金流向方向有错误！        是否重新输入?」（条件：`jd = "1" and mm_jf <> 0`）
  - [窗口事件 u_pzsave]「请确定一下 第  行合同编号是否正确！正确的合同编号应该录入在现金或者银行存款的条目上！」（条件：`pos(mm_kmmc,"现金") > 0 or pos(mm_kmmc,"银行存款") > 0 or pos(mm_kmmc,"其他货币资金") > 0 or pos(mm_kmmc,"应收票据") > 0 or pos(mm_kmmc,`）
  - [窗口事件 u_pzsave]「第  行分录项目编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 u_pzsave]「第  行分录项目编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 u_pzsave]「第  行分录项目编码不存在！」（条件：`choice = 0`）
  - [窗口事件 u_pzsave]「第  行分录客户编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 u_pzsave]「第  行分录客户编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 u_pzsave]「第  行分录客户编码不存在！」（条件：`choice = 0`）
  - [窗口事件 u_pzsave]「第  行分录部门编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 u_pzsave]「第  行分录部门编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 u_pzsave]「第  行分录部门编码不存在！」（条件：`choice = 0`）
  - [窗口事件 u_pzsave]「第  行分录个人编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 u_pzsave]「第  行分录个人编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 u_pzsave]「第  行分录个人编码不存在！」（条件：`choice = 0`）
  - [窗口事件 u_pzsave]「第  行分录数量未输入！是否重输？」（条件：`isnull(mm_pz_sl) or mm_pz_sl = 0`）
  - [窗口事件 u_pzsave]「第  行分录外币金额未输入！是否重输？」（条件：`isnull(mm_pz_wb) or mm_pz_wb = 0`）
  - [窗口事件 u_pzsave]「第  行分录的合同不存在!」（条件：`j = 100`）
  - [窗口事件 u_pzsave]「第  行分录的合同的借贷方向有错误！        是否重新输入?」（条件：`lx = "0" and mm_jf <> 0`）
  - [窗口事件 u_pzsave]「第  行分录的合同客户和凭证客户不一致！        是否重新输入?」（条件：`mm_dwbm <> "" and khbh <> mm_dwbm`）
  - ……另有 42 条，见 rules.md

### w_pz_pzedit_b — 凭证修改（运行时设置）

- 类型：主窗口（默认）；尺寸：5253×2920 PBU；继承：`w_pz_pzedit`；菜单：`m_work_pz_pzedit`；库：rhzw8_1.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw_share_detail |  | 146,2148 4567×424 | 数据窗口 `dw_pz_edit_1_b`（表 pz、kmbm）；列：pz_zy、kmbm、pz_jf、pz_df、pz_wb（外币金额）、pz_hl（汇　　率）、pz_sl（数量）、pz_dj（单价）、pz_ph（银行单号）、jzbz、xmbm（核算项目）、dwbm（客供编码）、bmbm（部门编码）、grbm（个人编码）、bz（币种）、dw、pzbh、pz_xh、bz1、jslb（结算类别）、xjbm（现金流向）、kmbm_kmqc、htbh、hg_qdh、hg_dh、hg_zl、hg_bz、nf、yf、pzlx；itemchanged → `w_xt_xm_sc`「项目查找」、`w_xt_dw_sc`「客户查找」、`w_xt_bm_sc`「部门查找」、`w_xt_gr_sc`「人员查找」、`w_xt_ht_sc`「合同查找」；itemchanged 读写表 bmk、cn_mx、dba、dwk、fbgl、grk、htda、xmk；doubleclicked → `w_xt_bm_sc`「部门查找」、`w_xt_xm_sc`「项目查找」、`w_xt_gr_sc`「人员查找」、`w_xt_dw_sc`「客户查找」、`w_xt_ht_sc`「合同查找」 |
| dw_master | uo_dw_share_master |  | 5,540 4731×1412 | 数据窗口 `dw_pz_edit_b`（表 pz、kmbm）；列：pz_zy（分录摘要）、kmbm（科目编码）、pz_jf（借方金额）、pz_df（贷方金额）、pz_wb、pz_hl、pz_sl、pz_dj、pz_ph、jzbz、xmbm、dwbm、km_1、grbm、bz、dw、pzbh、pz_xh、bz1、jslb、xjbm、kmbm_kmqc、htbh、hg_qdh、hg_dh、hg_zl、hg_bz、nf、yf、pzlx；itemchanged → `w_pz_km_find`「科目查找」；itemchanged 读写表 cn_mx、fbgl、kmbm；doubleclicked → `w_xt_zy`「摘要管理」；clicked 读写表 kmbm |
| uo_1 | u_toolbar |  | 32, 3538×200 |  |
| cb_1 | 按钮 | 借 | 4247,2336 165×96 | clicked 读写表 cn_mx |
| cb_2 | 按钮 | 贷 | 4425,2336 165×96 | clicked 读写表 cn_mx |
| ddlb_pzlx | 下拉列表 |  | 439,420 539×464 |  |
| em_fds | 格式输入 |  | 4073,408 411×104 |  |
| em_pzbh | 格式输入 |  | 2391,408 407×104 | modified 读写表 pzdj |
| em_pzrq | 格式输入 |  | 443,264 544×104 |  |
| gb_1 | 分组框 |  | 55,2088 4759×532 |  |
| st_fds | 静态文本 | 附单: | 3739,416 251×88 |  |
| st_jzr_n | 静态文本 | 记账人: | 1833,1980 293×84 |  |
| st_pzbh | 静态文本 | 凭证编号: | 1970,416 361×88 |  |
| st_pzlx | 静态文本 | 凭证类型: | 32,420 370×84 |  |
| st_pzlx_name | 静态文本 | 记账凭证 | 1760,216 1381×136 |  |
| st_pzrq | 静态文本 | 凭证日期: | 37,276 370×84 |  |
| st_shr_n | 静态文本 | 审核人: | 192,1980 370×84 |  |
| st_zdr_n | 静态文本 | 制单人: | 3397,1980 288×84 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_pz_edit0_b`、`dw_pz_edit_b`；读写表 kmbm、pzdj、pzlx、xt
  - `u_befo`：读写表 pzdj
  - `u_copy`：打开 `w_pzedit_copy`「复制凭证」；读写表 kmbm、pz
  - `u_end`：读写表 pzdj
  - `u_fc`：打开 `w_pzedit_fc`「反冲凭证」；读写表 kmbm、pz
  - `u_find`：打开 `w_pz_km_find`「科目查找」；读写表 kmbm
  - `u_flxx`：打开 `w_pz_flxx1`「分录信息」
  - `u_hlgl`：打开 `w_xt_fbwh`「外币管理」、`w_pzedit_hlgl_rq`「汇兑损益」；读写表 fbgl、hz、kmbm、nc、pzdj
  - `u_next`：读写表 pzdj
  - `u_open`：读写表 pzdj、pzlx、xt
  - `u_print`：打开 `w_pz_prn_1`「打印凭证-1」；读写表 kmbm
  - `u_pzclock`：读写表 kmbm、pz、pzdj、xjll_xm
  - `u_pzsave`：读写表 bmk、cn_mx、dwk、from、g_fp_mx、g_fp_mx_2、grk、htda、kmbm、pjnr1、pz、pzdj、xjll_xm、xmk、xt
  - `u_pzxxbz`：打开 `w_xt_zy`「摘要管理」、`w_xt_kmwh`「科目维护」、`w_xt_xmwh`「核算项目」、`w_xt_dwwh`「客供维护（运行时设置）」、`w_xt_bmwh`「部门管理」、`w_xt_grwh`「人员管理」、`w_ht_htda`「合同档案管理」；读写表 kmbm
  - `u_first`：读写表 pzdj
  - `u_mb`：打开 `w_pz_pzmb_xz`「读入凭证模版」；读写表 kmbm、pzmb_pz
  - `u_mb1`：打开 `w_pz_pzmb_add`「增加凭证模版」
  - `u_calc`：打开 `w_calc`「简易计算器」
  - `u_cn_get`：打开 `w_pz_pzedit_cn_get`「出纳数据引入」、`w_pz_km_find`「科目查找」；读写表 kmbm
  - `ue_action_preview`：打开 `w_bb_pjnr_gs`「特殊打印选择」
  - `wf_getbh`：读写表 pzdj
  - `wf_pzmb_save`：读写表 bmk、dwk、grk、kmbm、pzmb、pzmb_pz、xjll_xm、xmk、xt
  - `wf_xjll`：读写表 kmbm
  - `wf_zy`：读写表 zyk

- 提示与校验（82 条）：
  - [窗口事件 closequery]「是否存储所作的修改？」（条件：`this.dw_master.modifiedcount() <> 0 and this.xg_bz = "1"`）
  - [窗口事件 u_copy]「原凭证不存在」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 u_find]「科目不是明细科目，不可选。」（条件：`mm_zy <> "1"`）
  - [窗口事件 u_hlgl]「生成汇兑损益前，需要先到【外币类型】处填写正确期末汇率！~r     您已经填写好了吗(Y/N)？」
  - [窗口事件 u_hlgl]「需要到【外币类型】处填写期末汇率吗(Y/N)？」（条件：`i0 > 0`）
  - [窗口事件 u_hlgl]「还有未过帐凭证！」（条件：`i > 0`）
  - [窗口事件 u_new]「是否删除此凭证，并重新输入？」
  - [窗口事件 u_pzclock]「第  行需输入现金流量！」（条件：`isnull(xjbm) or len(xjbm) = 0`）
  - [窗口事件 u_pzclock]「第  行的现金流量方向有错误！        是否重新输入?」（条件：`jd = "0" and mm_df <> 0`）
  - [窗口事件 u_pzclock]「第  行不需输入现金流量！」（条件：`len(xjbm) > 0`）
  - [窗口事件 u_pzclock]「审核人和制单人相同不能审核！」（条件：`this.st_zdr1.text = u_name`）
  - [窗口事件 u_pzclock]「此凭证已经审核，您是要取消此凭证的审核吗？」
  - [窗口事件 u_pzsave]「凭证日期超出当前日期太久，不能存盘!」（条件：`(this.nf * 100 + this.yf) > (r1 + 12)`）
  - [窗口事件 u_pzsave]「凭证日期超出当前日期，请确认一下凭证日期是否正确!」（条件：`(this.nf * 100 + this.yf) > r1`）
  - [窗口事件 u_pzsave]「凭证日期超出本版本程序允许范围，不能存盘! ~r    请进行软件升级!」（条件：`isnull(this.nf) or isnull(this.yf) or (this.nf * 100 + this.yf) < 198001 or (this.nf * 100 + this.yf) > 204912`）
  - [窗口事件 u_pzsave]「凭证日期超过了时钟版的截至日期，不能存盘!」（条件：`long(string(gd_tt,"yyyymm")) < (this.nf * 100 + this.yf)`）
  - [窗口事件 u_pzsave]「凭证类型错误，不能存盘!」（条件：`isnull(this.pzlx)`）
  - [窗口事件 u_pzsave]「请重新输入凭证编号!」（条件：`isnull(this.pzbh)`）
  - [窗口事件 u_pzsave]「第  行分录科目录入信息不完全！是否重输？」（条件：`isnull(mm_kmbm) or len(righttrim(lefttrim(mm_kmbm))) = 0`）
  - [窗口事件 u_pzsave]「第  行的现金流向错误!」（条件：`r1 = -1`）
  - [窗口事件 u_pzsave]「第  行分录的现金流向方向有错误！        是否重新输入?」（条件：`jd = "0" and mm_df <> 0`）
  - [窗口事件 u_pzsave]「第  行的现金流向方向有错误！        是否重新输入?」（条件：`jd = "1" and mm_jf <> 0`）
  - [窗口事件 u_pzsave]「请确定一下 第  行合同编号是否正确！正确的合同编号应该录入在现金或者银行存款的条目上！」（条件：`pos(mm_kmmc,"现金") > 0 or pos(mm_kmmc,"银行存款") > 0 or pos(mm_kmmc,"其他货币资金") > 0 or pos(mm_kmmc,"应收票据") > 0 or pos(mm_kmmc,`）
  - [窗口事件 u_pzsave]「第  行分录项目编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 u_pzsave]「第  行分录项目编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 u_pzsave]「第  行分录项目编码不存在！」（条件：`choice = 0`）
  - [窗口事件 u_pzsave]「第  行分录客户编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 u_pzsave]「第  行分录客户编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 u_pzsave]「第  行分录客户编码不存在！」（条件：`choice = 0`）
  - [窗口事件 u_pzsave]「第  行分录部门编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 u_pzsave]「第  行分录部门编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 u_pzsave]「第  行分录部门编码不存在！」（条件：`choice = 0`）
  - [窗口事件 u_pzsave]「第  行分录个人编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 u_pzsave]「第  行分录个人编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 u_pzsave]「第  行分录个人编码不存在！」（条件：`choice = 0`）
  - [窗口事件 u_pzsave]「第  行分录数量未输入！是否重输？」（条件：`isnull(mm_pz_sl) or mm_pz_sl = 0`）
  - [窗口事件 u_pzsave]「第  行分录外币金额未输入！是否重输？」（条件：`isnull(mm_pz_wb) or mm_pz_wb = 0`）
  - [窗口事件 u_pzsave]「第  行分录的合同不存在!」（条件：`j = 100`）
  - [窗口事件 u_pzsave]「第  行分录的合同的借贷方向有错误！        是否重新输入?」（条件：`lx = "0" and mm_jf <> 0`）
  - [窗口事件 u_pzsave]「第  行分录的合同客户和凭证客户不一致！        是否重新输入?」（条件：`mm_dwbm <> "" and khbh <> mm_dwbm`）
  - ……另有 42 条，见 rules.md

### w_pz_pzedit_bak — 凭证录入

- 类型：主窗口（默认）；尺寸：4421×2536 PBU；继承：`wroot_share`；菜单：`m_work_pz_pzedit`；库：rhzw8_1.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw_share_detail |  | 55,1916 3909×404 | 数据窗口 `dw_pz_edit_1`（表 pz、kmbm）；列：pz_zy、kmbm、pz_jf、pz_df、pz_wb（外币金额：）、pz_hl（汇　　率：）、pz_sl（数量：）、pz_dj（单价：）、pz_ph（银行单号）、jzbz、xmbm（核算项目：）、dwbm（客供编码：）、bmbm（部门编码：）、grbm（个人编码：）、bz（币种：）、dw、pzbh、pz_xh、bz1、jslb（结算类别：）、xjbm（现金流向：）、kmbm_kmqc、htbh、hg_qdh、hg_dh、hg_zl、hg_bz、nf、yf、pzlx；itemchanged → `w_xt_xm_sc`「项目查找」、`w_xt_dw_sc`「客户查找」、`w_xt_bm_sc`「部门查找」、`w_xt_gr_sc`「人员查找」、`w_xt_ht_sc`「合同查找」；itemchanged 读写表 bmk、cn_mx、dba、dwk、fbgl、grk、htda、xmk；doubleclicked → `w_xt_bm_sc`「部门查找」、`w_xt_xm_sc`「项目查找」、`w_xt_gr_sc`「人员查找」、`w_xt_dw_sc`「客户查找」、`w_xt_ht_sc`「合同查找」 |
| dw_master | uo_dw_share_master |  | 5,500 4023×1268 | 数据窗口 `dw_pz_edit`（表 pz、kmbm）；列：pz_zy（分录摘要）、kmbm（科目编码）、pz_jf（借方金额）、pz_df（贷方金额）、pz_wb、pz_hl、pz_sl、pz_dj、pz_ph、jzbz、xmbm、dwbm、km_1、grbm、bz、dw、pzbh、pz_xh、bz1、jslb、xjbm、kmbm_kmqc、htbh、hg_qdh、hg_dh、hg_zl、hg_bz、nf、yf、pzlx；itemchanged → `w_pz_km_find`「科目查找」；itemchanged 读写表 cn_mx、fbgl、kmbm；doubleclicked → `w_xt_zy`「摘要管理」；clicked 读写表 kmbm |
| uo_1 | u_toolbar |  | 32, 3890×200 |  |
| cb_1 | 按钮 | 借 | 3653,2008 151×80 | clicked 读写表 cn_mx |
| cb_2 | 按钮 | 贷 | 3822,2008 151×80 | clicked 读写表 cn_mx |
| ddlb_pzlx | 下拉列表 |  | 439,380 421×464 |  |
| em_fds | 格式输入 |  | 3250,360 311×96 |  |
| em_pzbh | 格式输入 |  | 1947,368 311×96 | modified 读写表 pzdj |
| em_pzrq | 格式输入 |  | 443,268 421×96 |  |
| gb_1 | 分组框 |  | ,1864 4037×480 |  |
| st_fds | 静态文本 | 附单: | 2917,376 251×88 |  |
| st_jzr_n | 静态文本 | 记账人: | 1266,1796 293×84 |  |
| st_pzbh | 静态文本 | 凭证编号: | 1499,380 361×88 |  |
| st_pzlx | 静态文本 | 凭证类型: | 32,380 370×84 |  |
| st_pzlx_name | 静态文本 | 记账凭证 | 1289,216 1381×104 |  |
| st_pzrq | 静态文本 | 凭证日期: | 37,276 370×84 |  |
| st_shr_n | 静态文本 | 审核人: | 82,1796 283×84 |  |
| st_zdr_n | 静态文本 | 制单人: | 2459,1796 288×84 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_pz_edit`、`dw_pz_edit0`；读写表 kmbm、pzdj、pzlx、xt
  - `u_befo`：读写表 pzdj
  - `u_copy`：打开 `w_pzedit_copy`「复制凭证」；读写表 kmbm、pz
  - `u_end`：读写表 pzdj
  - `u_fc`：打开 `w_pzedit_fc`「反冲凭证」；读写表 kmbm、pz
  - `u_find`：打开 `w_pz_km_find`「科目查找」；读写表 kmbm
  - `u_flxx`：打开 `w_pz_flxx1`「分录信息」
  - `u_hlgl`：打开 `w_xt_fbwh`「外币管理」、`w_pzedit_hlgl_rq`「汇兑损益」；读写表 fbgl、hz、kmbm、nc、pzdj
  - `u_next`：读写表 pzdj
  - `u_open`：读写表 pzdj、pzlx
  - `u_print`：打开 `w_pz_prn_1`「打印凭证-1」；读写表 kmbm
  - `u_pzclock`：读写表 kmbm、pz、pzdj、xjll_xm
  - `u_pzsave`：读写表 bmk、cn_mx、dwk、from、grk、htda、kmbm、pz、pzdj、xjll_xm、xmk、xt
  - `u_pzxxbz`：打开 `w_xt_zy`「摘要管理」、`w_xt_kmwh`「科目维护」、`w_xt_xmwh`「核算项目」、`w_xt_dwwh`「客供维护（运行时设置）」、`w_xt_bmwh`「部门管理」、`w_xt_grwh`「人员管理」、`w_ht_htda`「合同档案管理」；读写表 kmbm
  - `u_first`：读写表 pzdj
  - `u_mb`：打开 `w_pz_pzmb_xz`「读入凭证模版」；读写表 kmbm、pzmb_pz
  - `u_mb1`：打开 `w_pz_pzmb_add`「增加凭证模版」
  - `u_calc`：打开 `w_calc`「简易计算器」
  - `u_cn_get`：打开 `w_pz_pzedit_cn_get`「出纳数据引入」、`w_pz_km_find`「科目查找」；读写表 kmbm
  - `ue_action_preview`：打开 `w_bb_pjnr_gs`「特殊打印选择」
  - `wf_getbh`：读写表 pzdj
  - `wf_pzmb_save`：读写表 bmk、dwk、grk、kmbm、pzmb、pzmb_pz、xjll_xm、xmk、xt
  - `wf_zy`：读写表 zyk

- 提示与校验（81 条）：
  - [窗口事件 closequery]「是否存储所作的修改？」（条件：`this.dw_master.modifiedcount() <> 0 and this.xg_bz = "1"`）
  - [窗口事件 u_copy]「原凭证不存在」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 u_find]「科目不是明细科目，不可选。」（条件：`mm_zy <> "1"`）
  - [窗口事件 u_hlgl]「生成汇兑损益前，需要先到【外币类型】处填写正确期末汇率！~r     您已经填写好了吗(Y/N)？」
  - [窗口事件 u_hlgl]「需要到【外币类型】处填写期末汇率吗(Y/N)？」（条件：`i0 > 0`）
  - [窗口事件 u_hlgl]「还有未过帐凭证！」（条件：`i > 0`）
  - [窗口事件 u_new]「是否删除此凭证，并重新输入？」
  - [窗口事件 u_pzclock]「第  行需输入现金流量！」（条件：`isnull(xjbm) or len(xjbm) = 0`）
  - [窗口事件 u_pzclock]「第  行的现金流量方向有错误！        是否重新输入?」（条件：`jd = "0" and mm_df <> 0`）
  - [窗口事件 u_pzclock]「第  行不需输入现金流量！」（条件：`len(xjbm) > 0`）
  - [窗口事件 u_pzclock]「审核人和制单人相同不能审核！」（条件：`this.st_zdr1.text = u_name`）
  - [窗口事件 u_pzclock]「此凭证已经审核，您是要取消此凭证的审核吗？」
  - [窗口事件 u_pzsave]「凭证日期超出当前日期太久，不能存盘!」（条件：`(this.nf * 100 + this.yf) > (r1 + 12)`）
  - [窗口事件 u_pzsave]「凭证日期超出当前日期，请确认一下凭证日期是否正确!」（条件：`(this.nf * 100 + this.yf) > r1`）
  - [窗口事件 u_pzsave]「凭证日期超出本版本程序允许范围，不能存盘! ~r    请进行软件升级!」（条件：`isnull(this.nf) or isnull(this.yf) or (this.nf * 100 + this.yf) < 198001 or (this.nf * 100 + this.yf) > 205012`）
  - [窗口事件 u_pzsave]「凭证日期超过了时钟版的截至日期，不能存盘!」（条件：`long(string(gd_tt,"yyyymm")) < (this.nf * 100 + this.yf)`）
  - [窗口事件 u_pzsave]「凭证类型错误，不能存盘!」（条件：`isnull(this.pzlx)`）
  - [窗口事件 u_pzsave]「请重新输入凭证编号!」（条件：`isnull(this.pzbh)`）
  - [窗口事件 u_pzsave]「第  行分录科目录入信息不完全！是否重输？」（条件：`isnull(mm_kmbm) or len(righttrim(lefttrim(mm_kmbm))) = 0`）
  - [窗口事件 u_pzsave]「第  行分录需输入现金流向！~r如果你不需要现金流量核算，请到【套账信息】处取消现金流量核算标志！」（条件：`isnull(xjbm) or len(xjbm) = 0`）
  - [窗口事件 u_pzsave]「第  行的现金流向错误!」（条件：`r1 = -1`）
  - [窗口事件 u_pzsave]「第  行分录的现金流向方向有错误！        是否重新输入?」（条件：`jd = "0" and mm_df <> 0`）
  - [窗口事件 u_pzsave]「第  行的现金流向方向有错误！        是否重新输入?」（条件：`jd = "1" and mm_jf <> 0`）
  - [窗口事件 u_pzsave]「第  行分录项目编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 u_pzsave]「第  行分录项目编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 u_pzsave]「第  行分录项目编码不存在！」（条件：`choice = 0`）
  - [窗口事件 u_pzsave]「第  行分录客户编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 u_pzsave]「第  行分录客户编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 u_pzsave]「第  行分录客户编码不存在！」（条件：`choice = 0`）
  - [窗口事件 u_pzsave]「第  行分录部门编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 u_pzsave]「第  行分录部门编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 u_pzsave]「第  行分录部门编码不存在！」（条件：`choice = 0`）
  - [窗口事件 u_pzsave]「第  行分录个人编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 u_pzsave]「第  行分录个人编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 u_pzsave]「第  行分录个人编码不存在！」（条件：`choice = 0`）
  - [窗口事件 u_pzsave]「第  行分录数量未输入！是否重输？」（条件：`isnull(mm_pz_sl) or mm_pz_sl = 0`）
  - [窗口事件 u_pzsave]「第  行分录外币金额未输入！是否重输？」（条件：`isnull(mm_pz_wb) or mm_pz_wb = 0`）
  - [窗口事件 u_pzsave]「第  行分录的合同不存在!」（条件：`j = 100`）
  - [窗口事件 u_pzsave]「第  行分录的合同的借贷方向有错误！        是否重新输入?」（条件：`lx = "0" and mm_jf <> 0`）
  - [窗口事件 u_pzsave]「第  行分录的合同客户和凭证客户不一致！        是否重新输入?」（条件：`mm_dwbm <> "" and khbh <> mm_dwbm`）
  - ……另有 41 条，见 rules.md

### w_pz_pzedit_cn_get — 出纳数据引入

- 类型：模态对话框；尺寸：3168×2332 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzedit_b` 的 事件 u_cn_get；`w_pz_pzedit_bak` 的 事件 u_cn_get；`w_pz_pzedit_mb` 的 事件 u_cn_get；`w_pz_pzedit` 的 事件 u_cn_get

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 查找 | 2473,28 325×108 |  |
| ddlb_1 | 下拉列表 |  | 174,48 1760×1220 |  |
| dw_1 | 数据窗口 |  | 5,344 3113×1836 | 数据窗口 `dw_pz_edit_cn`（表 cn_mx）；列：dd（日）、zy（摘要）、jf（借方）、df（贷方）、lrr（录入人）、kmbm、nf、yf、xh、bz、bz1（选择）、bz2（已转凭证）；doubleclicked 读写表 cn_mx、fbgl、kmbm |
| em_1 | 格式输入 |  | 2126,40 334×96 |  |
| sle_1 | 单行输入 |  | 325,148 1170×84 |  |
| st_1 | 静态文本 | 账户 | 23,48 142×80 |  |
| st_2 | 静态文本 | 年月 | 1943,48 174×80 |  |
| st_3 | 静态文本 | 提示：先选择账户，再按【查找】，找到需要内容后，双击引入，也可以多选，在选择处  | 23,248 2697×80 |  |
| st_4 | 静态文本 | 搜索条件 | 23,148 274×80 |  |

- 窗口事件/函数：
  - `open`：读写表 cn_nc

### w_pz_pzedit_mb — 凭证模版

- 类型：主窗口（默认）；尺寸：5563×2800 PBU；继承：`w_pz_pzedit`；菜单：`m_work_pz_pzedit_mb`；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzmb_main` 的 cb_7.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_detail | uo_dw_share_detail |  | 160,1916 3753×404 | 数据窗口 `dw_pz_edit_mb_1`（表 pzmb_pz、kmbm）；列：pz_zy、kmbm、pz_jf、pz_df、pz_wb（外币金额：）、pz_hl（汇　　率：）、pz_sl（数量：）、pz_dj（单价：）、pz_ph（银行单号）、jzbz、xmbm（核算项目：）、dwbm（客供编码：）、bmbm（部门编码：）、grbm（个人编码：）、bz（币种：）、dw、pzbh、pz_xh、bz1、jslb（结算类别：）、xjbm（现金流向：）、kmbm_kmqc、htbh、hg_dh、hg_zl、hg_bz；itemchanged → `w_xt_xm_sc`「项目查找」、`w_xt_dw_sc`「客户查找」、`w_xt_bm_sc`「部门查找」、`w_xt_gr_sc`「人员查找」、`w_xt_ht_sc`「合同查找」；itemchanged 读写表 bmk、cn_mx、dba、dwk、fbgl、grk、htda、xmk；doubleclicked → `w_xt_bm_sc`「部门查找」、`w_xt_xm_sc`「项目查找」、`w_xt_gr_sc`「人员查找」、`w_xt_dw_sc`「客户查找」、`w_xt_ht_sc`「合同查找」 |
| dw_master | uo_dw_share_master |  | 5,500 4023×1268 | 数据窗口 `dw_pz_edit_mb`（表 pzmb_pz、kmbm）；列：pzmb_pz_pz_zy、pzmb_pz_kmbm、pz_jf（借方金额）、pz_df（贷方金额）、pz_wb、pz_hl、pz_sl、pz_dj、pz_ph、jzbz、xmbm、dwbm、km_1、grbm、bz、dw、pzbh、pz_xh、bz1、jslb、xjbm、kmbm_kmqc、htbh、hg_dh、hg_zl、hg_bz；itemchanged → `w_pz_km_find`「科目查找」；itemchanged 读写表 cn_mx、fbgl、kmbm；doubleclicked → `w_xt_zy`「摘要管理」；clicked 读写表 kmbm |
| uo_1 | u_toolbar |  | 32, 3890×200 |  |
| cb_1 | 按钮 | 借 | 3653,2008 151×80 | clicked 读写表 cn_mx |
| cb_2 | 按钮 | 贷 | 3822,2008 151×80 | clicked 读写表 cn_mx |
| ddlb_pzlx | 下拉列表 |  | 4974,428 421×464 |  |
| em_fds | 格式输入 |  | 4946,620 311×96 |  |
| em_pzbh | 格式输入 |  | 5157,816 311×96 | modified 读写表 pzdj |
| em_pzrq | 格式输入 |  | 4978,316 421×96 |  |
| gb_1 | 分组框 |  | ,1848 3995×512 |  |
| st_fds | 静态文本 | 附单: | 4613,636 251×88 |  |
| st_jzr_n | 静态文本 | 记账人: | 4795,1672 293×84 |  |
| st_pzbh | 静态文本 | 凭证编号: | 4709,828 361×88 |  |
| st_pzlx | 静态文本 | 凭证类型: | 4567,428 370×84 |  |
| st_pzlx_name | 静态文本 | 凭证模版 | 1289,184 1381×124 |  |
| st_pzrq | 静态文本 | 凭证日期: | 4571,324 370×84 |  |
| st_shr_n | 静态文本 | 审核人: | 4713,1340 283×84 |  |
| st_zdr_n | 静态文本 | 制单人: | 4878,1536 288×84 |  |

- 窗口事件/函数：
  - `open`：读写表 xt
  - `closequery`：打开 `w_pz_pzmb_main`「凭证模版维护」
  - `u_befo`：读写表 pzdj
  - `u_copy`：打开 `w_pzedit_copy`「复制凭证」；读写表 kmbm、pz
  - `u_end`：读写表 pzdj
  - `u_fc`：打开 `w_pzedit_fc`「反冲凭证」；读写表 kmbm、pz
  - `u_find`：打开 `w_pz_km_find`「科目查找」；读写表 kmbm
  - `u_flxx`：打开 `w_pz_flxx1`「分录信息」
  - `u_hlgl`：打开 `w_xt_fbwh`「外币管理」、`w_pzedit_hlgl_rq`「汇兑损益」；读写表 fbgl、hz、kmbm、nc、pzdj
  - `u_next`：读写表 pzdj
  - `u_open`：读写表 pzdj、pzlx、xt
  - `u_print`：打开 `w_pz_prn_1`「打印凭证-1」；读写表 kmbm
  - `u_pzclock`：读写表 kmbm、pz、pzdj、xjll_xm
  - `u_pzxxbz`：打开 `w_xt_zy`「摘要管理」、`w_xt_kmwh`「科目维护」、`w_xt_xmwh`「核算项目」、`w_xt_dwwh`「客供维护（运行时设置）」、`w_xt_bmwh`「部门管理」、`w_xt_grwh`「人员管理」、`w_ht_htda`「合同档案管理」；读写表 kmbm
  - `u_first`：读写表 pzdj
  - `u_mb`：打开 `w_pz_pzmb_xz`「读入凭证模版」；读写表 kmbm、pzmb_pz
  - `u_mb1`：打开 `w_pz_pzmb_add`「增加凭证模版」
  - `u_calc`：打开 `w_calc`「简易计算器」
  - `u_cn_get`：打开 `w_pz_pzedit_cn_get`「出纳数据引入」、`w_pz_km_find`「科目查找」；读写表 kmbm
  - `ue_action_preview`：打开 `w_bb_pjnr_gs`「特殊打印选择」
  - `wf_getbh`：读写表 pzdj
  - `wf_pzmb_save`：读写表 bmk、dwk、grk、kmbm、pzmb、pzmb_pz、xjll_xm、xmk、xt
  - `wf_xjll`：读写表 kmbm
  - `wf_zy`：读写表 zyk

- 提示与校验（47 条）：
  - [窗口事件 u_befo]「是否存储所作的修改？」（条件：`this.dw_master.modifiedcount() <> 0 and this.xg_bz = "1"`）
  - [窗口事件 u_copy]「原凭证不存在」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 u_find]「科目不是明细科目，不可选。」（条件：`mm_zy <> "1"`）
  - [窗口事件 u_hlgl]「生成汇兑损益前，需要先到【外币类型】处填写正确期末汇率！~r     您已经填写好了吗(Y/N)？」
  - [窗口事件 u_hlgl]「需要到【外币类型】处填写期末汇率吗(Y/N)？」（条件：`i0 > 0`）
  - [窗口事件 u_hlgl]「还有未过帐凭证！」（条件：`i > 0`）
  - [窗口事件 u_new]「是否删除此凭证，并重新输入？」
  - [窗口事件 u_pzclock]「第  行需输入现金流量！」（条件：`isnull(xjbm) or len(xjbm) = 0`）
  - [窗口事件 u_pzclock]「第  行的现金流量方向有错误！        是否重新输入?」（条件：`jd = "0" and mm_df <> 0`）
  - [窗口事件 u_pzclock]「第  行不需输入现金流量！」（条件：`len(xjbm) > 0`）
  - [窗口事件 u_pzclock]「审核人和制单人相同不能审核！」（条件：`this.st_zdr1.text = u_name`）
  - [窗口事件 u_pzclock]「此凭证已经审核，您是要取消此凭证的审核吗？」
  - [窗口事件 u_pzxxbz]「科目已经停用，不可选。」（条件：`mm_sybz = "1"`）
  - [窗口事件 u_mb]「模版不存在」（条件：`sqlca.sqlcode <> 0`）
  - [窗口事件 u_cn_get]「出纳数据的日期小于结账日期！」（条件：`string(date(xt_cs7),"yyyy.mm") < xt_jzyf`）
  - [窗口事件 u_cn_get]「由于您的凭证日期和出纳数据日期不一致，~r 系统将你录入的凭证日期修改为了出纳数据的日期！       敬请留意！」（条件：`string(date(xt_cs7),"yyyy.mm") < xt_jzyf`）
  - [窗口事件 wf_pzmb_save]「第  行科目录入信息不完全！是否重输？」（条件：`isnull(mm_kmbm) or len(righttrim(lefttrim(mm_kmbm))) = 0`）
  - [窗口事件 wf_pzmb_save]「第  行需输入现金流向！~r如果你不需要现金流量核算，请到【套账信息】处取消现金流量核算标志！」（条件：`isnull(xjbm) or len(xjbm) = 0`）
  - [窗口事件 wf_pzmb_save]「第  行的现金流向错误!」（条件：`r1 = -1`）
  - [窗口事件 wf_pzmb_save]「第  行的现金流向方向有错误！        是否重新输入?」（条件：`jd = "0" and mm_df <> 0`）
  - [窗口事件 wf_pzmb_save]「第  行项目编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 wf_pzmb_save]「第  行项目编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 wf_pzmb_save]「第  行项目编码不存在！」（条件：`choice = 0`）
  - [窗口事件 wf_pzmb_save]「第  行客户编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 wf_pzmb_save]「第  行客户编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 wf_pzmb_save]「第  行客户编码不存在！」（条件：`choice = 0`）
  - [窗口事件 wf_pzmb_save]「第  行部门编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 wf_pzmb_save]「第  行部门编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 wf_pzmb_save]「第  行部门编码不存在！」（条件：`choice = 0`）
  - [窗口事件 wf_pzmb_save]「第  行个人编码未输入！是否重输？」（条件：`fz_bz = "0"`）
  - [窗口事件 wf_pzmb_save]「第  行个人编码未输入,请输入!」（条件：`choice = 1`）
  - [窗口事件 wf_pzmb_save]「第  行个人编码不存在！」（条件：`choice = 0`）
  - [窗口事件 wf_pzmb_save]「第  行 数量未输入！是否重输？」（条件：`isnull(mm_pz_sl) or mm_pz_sl = 0`）
  - [窗口事件 wf_pzmb_save]「第  行 外币金额未输入！是否重输？」（条件：`isnull(mm_pz_wb) or mm_pz_wb = 0`）
  - [dw_detail.constructor]「Not found dw_master」（条件：`not isvalid(this.dw_master)`）
  - [dw_detail.itemchanged]「此分录为出纳系统读入，如果修改将取消和出纳系统的挂接，是否修改？」（条件：`s_cn <> ""`）
  - [dw_detail.itemchanged]「一般情况下，结转是不选的,除非您是在手工做月度结转凭证！」（条件：`xx = "1"`）
  - [dw_detail.itemchanged]「此项目非明细不能选择！」（条件：`xx1 <> "1"`）
  - [dw_master.itemchanged]「如果需要修改凭证，请到【凭证录入】里点【修改】按钮！」（条件：`parent.pz_cs1 > "2"`）
  - [dw_master.constructor]「Not found dw_detail」（条件：`not isvalid(this.dw_detail)`）
  - ……另有 7 条，见 rules.md

### w_pz_pzmb_add — 增加凭证模版

- 类型：模态对话框；尺寸：1531×692 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzedit_b` 的 事件 u_mb1；`w_pz_pzedit_bak` 的 事件 u_mb1；`w_pz_pzedit_mb` 的 事件 u_mb1；`w_pz_pzedit` 的 事件 u_mb1；`w_pz_pzmb_main` 的 cb_1.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_cancel | 按钮 | 取消 | 850,420 297×108 |  |
| cb_ok | 按钮 | 确定 | 389,416 297×108 | clicked 读写表 pzmb |
| em_1 | 格式输入 |  | 462,92 247×84 |  |
| ole_1 | olecustomcontrol |  | 599,76 1829×800 |  |
| sle_name | 单行输入 |  | 462,248 933×84 |  |
| st_1 | 静态文本 | 模版名称： | 82,252 379×76 |  |
| st_4 | 静态文本 | 模版编码： | 78,92 379×76 |  |
| st_5 | 静态文本 | （编码最多4位） | 713,96 741×76 |  |

- 提示与校验（3 条）：
  - [cb_ok.clicked]「没有输入模版编码!」（条件：`len(mbbh) = 0`）
  - [cb_ok.clicked]「模版编码重复！」（条件：`i > 0`）
  - [cb_ok.clicked]「没有输入模版名称!」（条件：`len(mbmc) = 0`）

### w_pz_pzmb_main — 凭证模版维护

- 类型：弹出窗口；尺寸：2112×1616 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：菜单「I 基础档案 › 凭证模版」（19 个菜单中）；`w_pz_pzedit_mb` 的 事件 closequery

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 增加 | 1783,808 270×108 | clicked → `w_pz_pzmb_add`「增加凭证模版」；clicked 读写表 pzmb |
| cb_12 | 按钮 | 搜索 | 1376,20 210×104 |  |
| cb_17 | 按钮 | 存盘 | 1783,1156 274×108 |  |
| cb_2 | 按钮 | 编号修改 | 1783,692 270×120 | clicked → `w_xt_wh`「修改编号」 |
| cb_3 | 按钮 | 删除 | 1783,924 274×108 | clicked 读写表 pzmb、pzmb_pz |
| cb_4 | 按钮 | 关闭 | 1783,1272 274×108 |  |
| cb_5 | 按钮 | 显示 | 1509,1568 274×108 |  |
| cb_7 | 按钮 | 修改 | 1783,1040 274×108 | clicked → `w_pz_pzedit_mb`「凭证模版」 |
| dw_1 | 数据窗口 |  | 78,208 1614×1256 | 数据窗口 `dw_pz_pzmb`（表 pzmb）；列：mbbh（编号）、mbmc（模版名称） |
| gb_1 | 分组框 | 模版： | 32,132 1701×1372 |  |
| sle_1 | 单行输入 |  | 347,20 1015×100 |  |
| st_1 | 静态文本 | 搜索条件： | 23,28 311×80 |  |

- 窗口事件/函数：
  - `open`：读写表 pzmb_pz
  - `wf_login`：打开 `w_main1`「主窗口」
  - `wf_sj`：读写表 bbml

- 提示与校验（5 条）：
  - [cb_17.clicked]「必须输入模版编号！」（条件：`isnull(mbbh) or len(mbbh) = 0`）
  - [cb_17.clicked]「必须输入模版名称！」（条件：`isnull(mbmc) or len(mbmc) = 0`）
  - [cb_3.clicked]「是否删除      ？」（条件：`parent.dw_1.rowcount() = 0`）
  - [dw_1.dberror]「编码重复！是否重输？」（条件：`sqldbcode = -196`）
  - [dw_1.dberror]「数据窗口出错！」（条件：`i = 1`）

### w_pz_pzmb_xz — 读入凭证模版

- 类型：模态对话框；尺寸：1705×1460 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzedit_b` 的 事件 u_mb；`w_pz_pzedit_bak` 的 事件 u_mb；`w_pz_pzedit_mb` 的 事件 u_mb；`w_pz_pzedit` 的 事件 u_mb

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 320,1200 306×104 |  |
| cb_2 | 按钮 | 取消 | 805,1200 306×104 |  |
| cb_3 | 按钮 | 搜索 | 1376,16 210×104 |  |
| dw_1 | 数据窗口 |  | ,148 1605×1036 | 数据窗口 `dw_pz_pzmb`（表 pzmb）；列：mbbh（编号）、mbmc（模版名称） |
| sle_1 | 单行输入 |  | 347,20 1015×100 |  |
| st_1 | 静态文本 | 搜索条件： | 23,28 311×80 |  |

### w_pz_pzxsb — 凭证序时簿

- 类型：主窗口（默认）；尺寸：3680×1748 PBU；继承：`wroot_single_1`；菜单：`m_work_pz_pzxsb`；库：rhzw8_1.pbd（账务主程序）
- 打开入口：菜单「O日常业务 › 凭证管理 › 凭证输入」（19 个菜单中）；`w_main1` 的 st_1_pz.clicked；`w_main1` 的 tab_1/tabpage_1/p_t_1_lr.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,324 3470×1056 | 数据窗口 `dw_pz_xsb`（表 pz、kmbm、pzdj）；列：nf（年）、yf（月）、pzlx（类型）、pzbh（编号）、kmbm（科目编码）、kmbm_kmqc（科目名称）、pz_zy（分录摘要）、pz_jf（借方金额）、pz_df（贷方金额）、pz_xh、xmbm（项目）、dwbm（客供）、bmbm（部门）、grbm（人员）、bz、pzdj_bz、pzdj_zdr（制单人）、pzdj_rq（凭证日期）、pzdj_fds（附单数）、pzdj_shr（审核人）、pzdj_jzr（记账人） |
| uo_1 | u_toolbar |  | , 3410×200 |  |
| cb_1 | 按钮 | 快速搜索 | 2341,216 343×92 |  |
| cb_2 | 按钮 | 恢复凭证排列 | 3365,216 375×92 |  |
| cb_3 | 按钮 | 新增凭证 | 114,204 475×104 |  |
| cbx_1 | 复选框 | 未审核凭证 | 2775,216 457×92 |  |
| dw_12 | 数据窗口 |  | 2642,432 494×360 | 数据窗口 `dw_pz_saveas0`（表 pz、pzdj）；列：pz_nf（年份）、pz_yf（月份）、pz_pzlx（凭证类型）、pz_pzbh（凭证编号）、pz_dd（日）、pzdj_pzdj_fds（附单数）、pzdj_pzdj_zdr（制单人）、pzdj_pzdj_shr（审核人）、pzdj_pzdj_jzr（记账人）、pz_pz_xh（序号）、pz_kmbm（科目编码）、pz_pz_zy（摘要）、pz_pz_jf（借方）、pz_pz_df（贷方）、pz_pz_wb（外币金额）、pz_bz（币种）、pz_pz_hl（汇率）、pz_pz_sl（数量）、pz_pz_dj（单价）、pz_jslb（结算类别）、pz_pz_ph（票号）、pz_jzbz（结转标志）、pz_xmbm（项目编码）、pz_dwbm（客户编码）、pz_bmbm（部门编码）、pz_grbm（人员编码）、pz_xjbm（现金流量编码）、pz_htbh（合同编号） |
| dw_13 | 数据窗口 |  | 2478,144 494×360 | 数据窗口 `dw_pz_saveas0`（表 pz、pzdj）；列：pz_nf（年份）、pz_yf（月份）、pz_pzlx（凭证类型）、pz_pzbh（凭证编号）、pz_dd（日）、pzdj_pzdj_fds（附单数）、pzdj_pzdj_zdr（制单人）、pzdj_pzdj_shr（审核人）、pzdj_pzdj_jzr（记账人）、pz_pz_xh（序号）、pz_kmbm（科目编码）、pz_pz_zy（摘要）、pz_pz_jf（借方）、pz_pz_df（贷方）、pz_pz_wb（外币金额）、pz_bz（币种）、pz_pz_hl（汇率）、pz_pz_sl（数量）、pz_pz_dj（单价）、pz_jslb（结算类别）、pz_pz_ph（票号）、pz_jzbz（结转标志）、pz_xmbm（项目编码）、pz_dwbm（客户编码）、pz_bmbm（部门编码）、pz_grbm（人员编码）、pz_xjbm（现金流量编码）、pz_htbh（合同编号） |
| dw_2 | 数据窗口 |  | 2501,672 494×360 | 数据窗口 `dw_pz_saveas`（表 pz、pzdj）；列：nf、yf、pzlx、pzbh、pz_xh、kmbm、pz_zy、pz_jf、pz_df、pz_wb、pz_hl、pz_sl、pz_dj、jslb、pz_ph、jzbz、xmbm、dwbm、bmbm、grbm、bz、dw、pzdj_pzdj_fds、pzdj_pzdj_bz、pzdj_pzdj_zdr、pzdj_pzdj_shr、pzdj_pzdj_jzr、pzdj_pzdj_rq、pzdj_pzdj_shrq、pzdj_pzdj_jzrq…… |
| dw_3 | 数据窗口 |  | 2501,672 494×360 | 数据窗口 `dw_pz_saveas`（表 pz、pzdj）；列：nf、yf、pzlx、pzbh、pz_xh、kmbm、pz_zy、pz_jf、pz_df、pz_wb、pz_hl、pz_sl、pz_dj、jslb、pz_ph、jzbz、xmbm、dwbm、bmbm、grbm、bz、dw、pzdj_pzdj_fds、pzdj_pzdj_bz、pzdj_pzdj_zdr、pzdj_pzdj_shr、pzdj_pzdj_jzr、pzdj_pzdj_rq、pzdj_pzdj_shrq、pzdj_pzdj_jzrq…… |
| dw_save | 数据窗口 |  | 1979,264 686×500 |  |
| sle_1 | 单行输入 |  | 1161,208 1161×100 |  |
| st_1 | 静态文本 | 搜索条件 | 859,212 297×88 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_pz_xsb`、`dw_pz_xsb_b`；读写表 pzdj
  - `ue_action_print`：打开 `w_pz_prn_2`「凭证连续打印」
  - `ue_action_hz`：打开 `w_pz_kmhz`「凭证汇总」
  - `ue_action_sh`：读写表 pzdj
  - `ue_action_ps`：打开 `w_pz_tjsh`「批量审核」
  - `ue_action_zhu`：打开 `w_pz_ttsee`「丁字帐户」
  - `ue_action_query1`：打开 `w_pz_zhcx`「综合查询（继承自祖先）」
  - `ue_action_bh`：打开 `w_pz_bhzl`「凭证编号重新整理」
  - `ue_action_insert`：读写表 cn_mx、g_fp_mx、g_fp_mx_2、pjnr1、pz、pzdj、pzlx
  - `ue_action_qxsh`：读写表 pz、pzdj、pzlx
  - `ue_action_plxg`：打开 `w_pz_plxg`「凭证批量修改」
  - `ue_action_query2`：打开 `w_pz_jccx`「凭证辅助项交叉查询」
  - `ue_action_plsh`：读写表 kmbm、pz、pzdj、pzlx、xt
  - `ue_action_mxz`：读写表 kmbm
  - `ue_action_get`：打开 `w_pz_get`「凭证导入」
  - `ue_action_del`：打开 `w_pz_tjdel`「凭证删除」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_preview`：打开 `w_pz_prn_3`「凭证合并打印」

- 提示与校验（17 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_out]「是否提换现有的文件？」（条件：`i = 1`）
  - [窗口事件 ue_action_out]「导出成功！」
  - [窗口事件 ue_action_insert]「已结账，不能插入凭证！」（条件：`(year(date(xt_jzyf + ".01")) * 100 + month(date(xt_jzyf + ".01"))) > (nf * 100 + yf)`）
  - [窗口事件 ue_action_insert]「是否要在年月第号凭证前插入一张凭证？~r     （之后的凭证编号自动加一）」（条件：`(year(date(xt_jzyf + ".01")) * 100 + month(date(xt_jzyf + ".01"))) > (nf * 100 + yf)`）
  - [窗口事件 ue_action_plsh]「请先将需要审核的凭证查询出来！~r  请问已经查询出来了吗(Y/N)？」（条件：`r < 1`）
  - [窗口事件 ue_action_plsh]「年月第号凭证未设置现金流量!  	是否继续?」（条件：`isnull(xjbm) or len(xjbm) = 0`）
  - [窗口事件 ue_action_plsh]「本次审核共成功审核张凭证!~r有张凭证由于和制单人相同，未能审核！~r       建议操作易人后再进行审核！」（条件：`r > 0`）
  - [窗口事件 ue_action_plsh]「本次审核共成功审核张凭证!」（条件：`r > 0`）
  - [窗口事件 ue_action_mxz]「科目不存在！」（条件：`isnull(i) or i = 0`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「此凭证为其他系统转入，要求不能修改！」（条件：`left(s_qx,1) <> "1"`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）

### w_pz_pzxsb_bak — 凭证序时簿

- 类型：主窗口（默认）；尺寸：2642×1748 PBU；继承：`wroot_single_1`；菜单：`m_work_pz_pzxsb`；库：rhzw8_1.pbd（账务主程序）

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,212 2414×1056 | 数据窗口 `dw_pz_xsb`（表 pz、kmbm、pzdj）；列：nf（年）、yf（月）、pzlx（类型）、pzbh（编号）、kmbm（科目编码）、kmbm_kmqc（科目名称）、pz_zy（分录摘要）、pz_jf（借方金额）、pz_df（贷方金额）、pz_xh、xmbm（项目）、dwbm（客供）、bmbm（部门）、grbm（人员）、bz、pzdj_bz、pzdj_zdr（制单人）、pzdj_rq（凭证日期）、pzdj_fds（附单数）、pzdj_shr（审核人）、pzdj_jzr（记账人） |
| uo_1 | u_toolbar |  | , 544×200 |  |
| dw_2 | 数据窗口 |  | 1216,68 494×360 | 数据窗口 `dw_pz_saveas`（表 pz、pzdj）；列：nf、yf、pzlx、pzbh、pz_xh、kmbm、pz_zy、pz_jf、pz_df、pz_wb、pz_hl、pz_sl、pz_dj、jslb、pz_ph、jzbz、xmbm、dwbm、bmbm、grbm、bz、dw、pzdj_pzdj_fds、pzdj_pzdj_bz、pzdj_pzdj_zdr、pzdj_pzdj_shr、pzdj_pzdj_jzr、pzdj_pzdj_rq、pzdj_pzdj_shrq、pzdj_pzdj_jzrq…… |
| dw_3 | 数据窗口 |  | 384,64 494×360 | 数据窗口 `dw_pz_saveas`（表 pz、pzdj）；列：nf、yf、pzlx、pzbh、pz_xh、kmbm、pz_zy、pz_jf、pz_df、pz_wb、pz_hl、pz_sl、pz_dj、jslb、pz_ph、jzbz、xmbm、dwbm、bmbm、grbm、bz、dw、pzdj_pzdj_fds、pzdj_pzdj_bz、pzdj_pzdj_zdr、pzdj_pzdj_shr、pzdj_pzdj_jzr、pzdj_pzdj_rq、pzdj_pzdj_shrq、pzdj_pzdj_jzrq…… |
| dw_save | 数据窗口 |  | 457,56 686×500 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_pz_xsb`、`dw_pz_xsb_b`
  - `ue_action_print`：打开 `w_pz_prn_2`「凭证连续打印」
  - `ue_action_hz`：打开 `w_pz_kmhz`「凭证汇总」
  - `ue_action_sh`：读写表 pzdj
  - `ue_action_ps`：打开 `w_pz_tjsh`「批量审核」
  - `ue_action_zhu`：打开 `w_pz_ttsee`「丁字帐户」
  - `ue_action_query1`：打开 `w_pz_zhcx`「综合查询（继承自祖先）」
  - `ue_action_bh`：打开 `w_pz_bhzl`「凭证编号重新整理」
  - `ue_action_insert`：读写表 pz、pzdj、pzlx
  - `ue_action_qxsh`：读写表 pz、pzdj、pzlx
  - `ue_action_plxg`：打开 `w_pz_plxg`「凭证批量修改」
  - `ue_action_query2`：打开 `w_pz_jccx`「凭证辅助项交叉查询」
  - `ue_action_get`：打开 `w_pz_get`「凭证导入」
  - `ue_action_del`：打开 `w_pz_tjdel`「凭证删除」
  - `ue_action_modify`：读写表 b_rights、pz、pzdj
  - `ue_action_preview`：打开 `w_pz_prn_3`「凭证合并打印」

- 提示与校验（9 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_out]「是否提换现有的文件？」（条件：`i = 1`）
  - [窗口事件 ue_action_out]「导出成功！」
  - [窗口事件 ue_action_insert]「已结账，不能插入凭证！」（条件：`(year(date(xt_jzyf + ".01")) * 100 + month(date(xt_jzyf + ".01"))) > (nf * 100 + yf)`）
  - [窗口事件 ue_action_insert]「是否要在年月第号凭证前插入一张凭证？~r     （之后的凭证编号自动加一）」（条件：`(year(date(xt_jzyf + ".01")) * 100 + month(date(xt_jzyf + ".01"))) > (nf * 100 + yf)`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）

### w_pz_pzxsb_see — 凭证查询

- 类型：主窗口（默认）；尺寸：3680×1748 PBU；继承：`w_pz_pzxsb`；菜单：`m_work_pz_pzxsb`；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_see` 的 cb_2.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| dw_master | uo_dw_single |  | 23,324 3470×1056 | 数据窗口 `dw_pz_xsb_s`（表 pz、kmbm、pzdj）；列：nf（年）、yf（月）、pzlx（类型）、pzbh（编号）、kmbm（科目编码）、kmbm_kmqc（科目名称）、pz_zy（分录摘要）、pz_jf（借方金额）、pz_df（贷方金额）、pz_xh、xmbm（项目）、dwbm（客供）、bmbm（部门）、grbm（人员）、bz、pzdj_bz、pzdj_zdr（制单人）、pzdj_rq（凭证日期）、pzdj_fds（附单数）、pzdj_shr（审核人）、pzdj_jzr（记账人） |
| uo_1 | u_toolbar |  | , 3410×200 |  |
| cb_1 | 按钮 | 快速搜索 | 2341,212 343×96 |  |
| cb_2 | 按钮 | 恢复凭证排列 | 3365,216 375×92 |  |
| cb_3 | 按钮 | 新增凭证 | 114,204 475×104 |  |
| cbx_1 | 复选框 | 未审核凭证 | 2775,216 457×92 |  |
| dw_12 | 数据窗口 |  | 2642,432 494×360 | 数据窗口 `dw_pz_saveas0`（表 pz、pzdj）；列：pz_nf（年份）、pz_yf（月份）、pz_pzlx（凭证类型）、pz_pzbh（凭证编号）、pz_dd（日）、pzdj_pzdj_fds（附单数）、pzdj_pzdj_zdr（制单人）、pzdj_pzdj_shr（审核人）、pzdj_pzdj_jzr（记账人）、pz_pz_xh（序号）、pz_kmbm（科目编码）、pz_pz_zy（摘要）、pz_pz_jf（借方）、pz_pz_df（贷方）、pz_pz_wb（外币金额）、pz_bz（币种）、pz_pz_hl（汇率）、pz_pz_sl（数量）、pz_pz_dj（单价）、pz_jslb（结算类别）、pz_pz_ph（票号）、pz_jzbz（结转标志）、pz_xmbm（项目编码）、pz_dwbm（客户编码）、pz_bmbm（部门编码）、pz_grbm（人员编码）、pz_xjbm（现金流量编码）、pz_htbh（合同编号） |
| dw_13 | 数据窗口 |  | 2478,144 494×360 | 数据窗口 `dw_pz_saveas0`（表 pz、pzdj）；列：pz_nf（年份）、pz_yf（月份）、pz_pzlx（凭证类型）、pz_pzbh（凭证编号）、pz_dd（日）、pzdj_pzdj_fds（附单数）、pzdj_pzdj_zdr（制单人）、pzdj_pzdj_shr（审核人）、pzdj_pzdj_jzr（记账人）、pz_pz_xh（序号）、pz_kmbm（科目编码）、pz_pz_zy（摘要）、pz_pz_jf（借方）、pz_pz_df（贷方）、pz_pz_wb（外币金额）、pz_bz（币种）、pz_pz_hl（汇率）、pz_pz_sl（数量）、pz_pz_dj（单价）、pz_jslb（结算类别）、pz_pz_ph（票号）、pz_jzbz（结转标志）、pz_xmbm（项目编码）、pz_dwbm（客户编码）、pz_bmbm（部门编码）、pz_grbm（人员编码）、pz_xjbm（现金流量编码）、pz_htbh（合同编号） |
| dw_2 | 数据窗口 |  | 2501,672 494×360 | 数据窗口 `dw_pz_saveas`（表 pz、pzdj）；列：nf、yf、pzlx、pzbh、pz_xh、kmbm、pz_zy、pz_jf、pz_df、pz_wb、pz_hl、pz_sl、pz_dj、jslb、pz_ph、jzbz、xmbm、dwbm、bmbm、grbm、bz、dw、pzdj_pzdj_fds、pzdj_pzdj_bz、pzdj_pzdj_zdr、pzdj_pzdj_shr、pzdj_pzdj_jzr、pzdj_pzdj_rq、pzdj_pzdj_shrq、pzdj_pzdj_jzrq…… |
| dw_3 | 数据窗口 |  | 2501,672 494×360 | 数据窗口 `dw_pz_saveas`（表 pz、pzdj）；列：nf、yf、pzlx、pzbh、pz_xh、kmbm、pz_zy、pz_jf、pz_df、pz_wb、pz_hl、pz_sl、pz_dj、jslb、pz_ph、jzbz、xmbm、dwbm、bmbm、grbm、bz、dw、pzdj_pzdj_fds、pzdj_pzdj_bz、pzdj_pzdj_zdr、pzdj_pzdj_shr、pzdj_pzdj_jzr、pzdj_pzdj_rq、pzdj_pzdj_shrq、pzdj_pzdj_jzrq…… |
| dw_save | 数据窗口 |  | 1979,264 686×500 |  |
| sle_1 | 单行输入 |  | 1161,212 1161×96 |  |
| st_1 | 静态文本 | 搜索条件 | 859,212 297×88 |  |

- 窗口事件/函数：
  - `open`：数据窗口 `dw_pz_xsb_s`、`dw_pz_xsb_s_b`
  - `ue_action_print`：打开 `w_pz_prn_2`「凭证连续打印」
  - `ue_action_hz`：打开 `w_pz_kmhz`「凭证汇总」
  - `ue_action_sh`：读写表 pzdj
  - `ue_action_ps`：打开 `w_pz_tjsh`「批量审核」
  - `ue_action_zhu`：打开 `w_pz_ttsee`「丁字帐户」
  - `ue_action_query1`：打开 `w_pz_zhcx`「综合查询（继承自祖先）」
  - `ue_action_bh`：打开 `w_pz_bhzl`「凭证编号重新整理」
  - `ue_action_insert`：读写表 cn_mx、g_fp_mx、g_fp_mx_2、pjnr1、pz、pzdj、pzlx
  - `ue_action_qxsh`：读写表 pz、pzdj、pzlx
  - `ue_action_plxg`：打开 `w_pz_plxg`「凭证批量修改」
  - `ue_action_query2`：打开 `w_pz_jccx`「凭证辅助项交叉查询」
  - `ue_action_plsh`：读写表 kmbm、pz、pzdj、pzlx、xt
  - `ue_action_mxz`：读写表 kmbm
  - `ue_action_get`：打开 `w_pz_get`「凭证导入」
  - `ue_action_del`：打开 `w_pz_tjdel`「凭证删除」
  - `ue_action_modify`：读写表 pz、pzdj、xt
  - `ue_action_preview`：打开 `w_pz_prn_3`「凭证合并打印」

- 提示与校验（17 条）：
  - [窗口事件 ue_action_setdw]「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_getdw]「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」
  - [窗口事件 ue_action_out]「是否提换现有的文件？」（条件：`i = 1`）
  - [窗口事件 ue_action_out]「导出成功！」
  - [窗口事件 ue_action_insert]「已结账，不能插入凭证！」（条件：`(year(date(xt_jzyf + ".01")) * 100 + month(date(xt_jzyf + ".01"))) > (nf * 100 + yf)`）
  - [窗口事件 ue_action_insert]「是否要在年月第号凭证前插入一张凭证？~r     （之后的凭证编号自动加一）」（条件：`(year(date(xt_jzyf + ".01")) * 100 + month(date(xt_jzyf + ".01"))) > (nf * 100 + yf)`）
  - [窗口事件 ue_action_plsh]「请先将需要审核的凭证查询出来！~r  请问已经查询出来了吗(Y/N)？」（条件：`r < 1`）
  - [窗口事件 ue_action_plsh]「年月第号凭证未设置现金流量!  	是否继续?」（条件：`isnull(xjbm) or len(xjbm) = 0`）
  - [窗口事件 ue_action_plsh]「本次审核共成功审核张凭证!~r有张凭证由于和制单人相同，未能审核！~r       建议操作易人后再进行审核！」（条件：`r > 0`）
  - [窗口事件 ue_action_plsh]「本次审核共成功审核张凭证!」（条件：`r > 0`）
  - [窗口事件 ue_action_mxz]「科目不存在！」（条件：`isnull(i) or i = 0`）
  - [窗口事件 ue_action_modify]「您没有凭证录入权限，只能用查看方式打开凭证」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「您不能修改别人做的凭证！」（条件：`zdr <> u_name`）
  - [窗口事件 ue_action_modify]「此凭证为其他系统转入，要求不能修改！」（条件：`left(s_qx,1) <> "1"`）
  - [窗口事件 ue_action_modify]「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」（条件：`xx = "2"`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」（条件：`i0 = 0`）
  - [窗口事件 ue_action_modify]「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」（条件：`i0 = 0`）

### w_pz_see — 凭证浏览查看

- 类型：模态对话框；尺寸：1509×772 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：菜单「O日常业务 › 凭证管理 › 浏览查询」（19 个菜单中）；`w_main1` 的 st_1_cx.clicked；`w_main1` 的 tab_1/tabpage_1/p_t_1_cx.clicked

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 取消 | 878,524 306×104 |  |
| cb_2 | 按钮 | 确定 | 311,524 306×104 | clicked → `w_pz_pzxsb_see`「凭证查询」 |
| ddlb_2 | 下拉列表 |  | 475,212 731×564 |  |
| em_1 | 格式输入 |  | 480,88 343×84 |  |
| em_2 | 格式输入 |  | 480,312 343×84 |  |
| em_3 | 格式输入 |  | 960,312 343×84 |  |
| em_4 | 格式输入 |  | 960,88 343×84 |  |
| gb_1 | 分组框 | 选项 | 37,8 1422×464 |  |
| st_1 | 静态文本 | 凭证类型： | 119,212 361×56 |  |
| st_2 | 静态文本 | 凭证年月： | 119,100 361×56 |  |
| st_3 | 静态文本 | 凭证号从： | 119,324 361×56 |  |
| st_4 | 静态文本 | 到 | 823,324 137×56 |  |
| st_5 | 静态文本 | 号 | 1303,324 87×56 |  |
| st_6 | 静态文本 | 到 | 823,100 137×56 |  |

- 窗口事件/函数：
  - `open`：读写表 pzlx

### w_pz_tjdel — 凭证删除

- 类型：模态对话框；尺寸：1490×1048 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzxsb_bak` 的 事件 ue_action_del；`w_pz_pzxsb_see` 的 事件 ue_action_del；`w_pz_pzxsb` 的 事件 ue_action_del

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 293,796 302×108 | clicked 读写表 cn_mx、g_fp_mx、g_fp_mx_2、pjnr1、pz、pz_fj、pzdj、xt |
| cb_2 | 按钮 | 取消 | 759,796 302×108 |  |
| ddlb_1 | 下拉列表 |  | 489,388 475×532 |  |
| em_1 | 格式输入 |  | 389,132 261×80 |  |
| em_2 | 格式输入 |  | 393,256 183×80 |  |
| em_3 | 格式输入 |  | 818,256 183×80 |  |
| em_4 | 格式输入 |  | 489,504 306×80 |  |
| em_5 | 格式输入 |  | 937,504 306×80 |  |
| gb_1 | 分组框 | 范围 | 37,20 1394×620 |  |
| st_1 | 静态文本 | 说明：此功能仅能删除上面范围内未过账审核的凭证 | 73,680 1335×80 |  |
| st_10 | 静态文本 | 号 | 1253,512 101×64 |  |
| st_11 | 静态文本 | 凭证类型： | 110,388 361×64 |  |
| st_3 | 静态文本 | 年份： | 128,140 261×64 |  |
| st_4 | 静态文本 | 月 到 | 581,260 224×72 |  |
| st_5 | 静态文本 | 从： | 187,264 178×64 |  |
| st_6 | 静态文本 | 月 | 1019,264 165×68 |  |
| st_7 | 静态文本 | 年 | 681,140 101×64 |  |
| st_8 | 静态文本 | 凭证号从： | 110,512 361×64 |  |
| st_9 | 静态文本 | 到 | 805,512 128×64 |  |

- 窗口事件/函数：
  - `open`：读写表 pzlx

- 提示与校验（4 条）：
  - [cb_1.clicked]「是否删除选定的凭证？」（条件：`s_delbz <> "1" or isnull(s_delbz)`）
  - [cb_1.clicked]「系统采用计算机编号，只能删除同月同类型的凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`parent.ddlb_1.text = "全部类型" or yf1 <> yf2`）
  - [cb_1.clicked]「系统采用计算机编号，只能删除最大号的凭证! ~r如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」（条件：`i > 0`）
  - [cb_1.clicked]「是否将后面凭证的编号进行整理，使其编号连续？」（条件：`yf1 = yf2`）

### w_pz_tjsh — 批量审核

- 类型：模态对话框；尺寸：1458×1092 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：菜单「O日常业务 › 凭证管理 › 凭证审核」（19 个菜单中）；菜单「S系统管理 › 反审核」（19 个菜单中）；`w_main1` 的 st_1_sh.clicked；`w_main1` 的 tab_1/tabpage_1/p_t_1_sh.clicked；`w_pz_pzxsb_bak` 的 事件 ue_action_ps；`w_pz_pzxsb_see` 的 事件 ue_action_ps；`w_pz_pzxsb` 的 事件 ue_action_ps

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 确定 | 782,764 288×168 | clicked 读写表 kmbm、pz、pzdj、pzlx、xt |
| cb_2 | 按钮 | 取消 | 1079,764 288×168 |  |
| ddlb_1 | 下拉列表 |  | 453,396 475×472 |  |
| em_1 | 格式输入 |  | 453,112 261×96 |  |
| em_2 | 格式输入 |  | 453,256 183×96 |  |
| em_3 | 格式输入 |  | 896,256 183×96 |  |
| em_4 | 格式输入 |  | 453,520 279×96 |  |
| em_5 | 格式输入 |  | 919,520 279×96 |  |
| gb_1 | 分组框 | 范围 | 37,24 1353×668 |  |
| gb_2 | 分组框 |  | 37,696 718×156 |  |
| rb_1 | 单选按钮 | 审核 | 119,756 247×72 |  |
| rb_2 | 单选按钮 | 取消审核 | 389,760 347×72 |  |
| st_1 | 静态文本 | 审核人： | 18,892 270×56 |  |
| st_10 | 静态文本 | 号 | 1211,540 169×56 |  |
| st_11 | 静态文本 | 凭证类型： | 96,404 375×56 |  |
| st_3 | 静态文本 | 年份： | 178,132 261×56 |  |
| st_4 | 静态文本 | 月 到: | 635,268 270×56 |  |
| st_5 | 静态文本 | 从： | 261,268 178×56 |  |
| st_6 | 静态文本 | 月 | 1102,268 165×56 |  |
| st_7 | 静态文本 | 年 | 777,132 183×56 |  |
| st_8 | 静态文本 | 凭证号从： | 96,540 375×56 |  |
| st_9 | 静态文本 | 到 | 731,540 183×56 |  |

- 窗口事件/函数：
  - `open`：读写表 pzdj、pzlx

- 提示与校验（6 条）：
  - [窗口事件 open]「没有需要审核的凭证！」（条件：`nf = 0 and yf = 0 and xt_cs10 <> "fsh"`）
  - [cb_1.clicked]「请选择[审核][取消审核].」（条件：`(not parent.rb_1.checked) and (not parent.rb_2.checked)`）
  - [cb_1.clicked]「年月第号凭证未设置现金流量!  	是否继续?」（条件：`isnull(xjbm) or len(xjbm) = 0`）
  - [cb_1.clicked]「本次审核共成功审核张凭证!~r有张凭证由于和制单人相同，未能审核！~r       建议更换用户后再进行审核！」（条件：`r > 0`）
  - [cb_1.clicked]「本次审核共成功审核张凭证!~r  您选择范围内的所有凭证已经全部审核完毕!」（条件：`r > 0`）
  - [cb_1.clicked]「本次共成功取消张凭证的审核!」（条件：`sqlca.sqlcode = -1`）

### w_pz_ttsee — 丁字帐户

- 类型：弹出窗口；尺寸：2359×1416 PBU；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzxsb_bak` 的 事件 ue_action_zhu；`w_pz_pzxsb_see` 的 事件 ue_action_zhu；`w_pz_pzxsb` 的 事件 ue_action_zhu

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | 取消 | 1166,992 334×108 |  |
| cb_2 | 按钮 | 确定 | 635,992 334×108 |  |
| cb_3 | 按钮 | 打印 | 2048,436 247×108 |  |
| cb_4 | 按钮 | 重选 | 2048,852 247×108 |  |
| cb_5 | 按钮 | 退出 | 2048,1060 247×108 |  |
| cb_6 | 按钮 | 另存 | 2048,644 247×108 |  |
| ddlb_1 | 下拉列表 |  | 672,84 1193×764 |  |
| ddlb_2 | 下拉列表 |  | 672,460 517×456 |  |
| dw_1 | 数据窗口 |  | 32,24 1984×1268 | 数据窗口 `dw_pz_dzzh`（表 pz、pzdj）；列：pzdj_pzdj_rq（制单日期）、pz_pzlx（类型）、pz_pzbh（编号）、pz_pz_jf（借方金额）、pz_pz_df（贷方金额）、pz_pz_wb |
| em_1 | 格式输入 |  | 672,272 366×96 |  |
| em_2 | 格式输入 |  | 672,648 256×96 |  |
| em_3 | 格式输入 |  | 1170,644 256×96 |  |
| p_1 | 图片 | m_exit.bmp | 1865,84 73×88 | clicked → `w_pz_km_find`「科目查找」；clicked 读写表 kmbm |
| st_1 | 静态文本 | 凭证类型: | 302,472 361×84 |  |
| st_2 | 静态文本 | 凭证年月: | 302,284 361×84 |  |
| st_3 | 静态文本 | 凭证号从: | 302,660 361×84 |  |
| st_4 | 静态文本 | 到 | 955,660 183×84 |  |
| st_5 | 静态文本 | 号 | 1477,660 174×84 |  |
| st_6 | 静态文本 | 科目选择: | 302,96 361×84 |  |

- 窗口事件/函数：
  - `open`：读写表 kmbm、pzlx

- 提示与校验（2 条）：
  - [cb_2.clicked]「没有选择科目！」（条件：`righttrim(parent.ddlb_1.text) = "" or isnull(parent.ddlb_1.text)`）
  - [cb_2.clicked]「该条件范围内没有单据输入！」（条件：`parent.dw_1.rowcount() = 0`）

### w_pz_zhcx — 综合查询（继承自祖先）

- 类型：主窗口（默认）；尺寸：3077×1648 PBU；继承：`wroot_query`；库：rhzw8_1.pbd（账务主程序）
- 打开入口：`w_pz_pzxsb_bak` 的 事件 ue_action_query1；`w_pz_pzxsb_see` 的 事件 ue_action_query1；`w_pz_pzxsb` 的 事件 ue_action_query1

| 控件 | 类型 | 文字 | 位置/大小 | 数据与动作 |
|---|---|---|---|---|
| cb_1 | 按钮 | &S.另存 | 2487,920 256×108 |  |
| cb_exec | 按钮 | &Z.执行 | 2487,1036 256×108 |  |
| cb_exit | 按钮 | &F.返回 | 2487,1268 256×108 |  |
| cb_print | 按钮 | &D.打印 | 2487,1152 256×108 |  |
| cbx_1 | 复选框 | 重复内容不显示 | 101,800 471×80 |  |
| dw_column | 数据窗口 |  | 37,80 713×700 | 数据窗口 `dw_column_set_pz`；列：hz、yw、type、table |
| dw_result | uo_dw | 共查询到0条记录 | 786,12 1929×880 |  |
| dw_sort1 | 数据窗口 |  | 55,1000 1038×456 | 数据窗口 `d_sort1`；列：col_name、lenth |
| dw_sort2 | 数据窗口 |  | 1175,1000 1221×456 | 数据窗口 `d_sort2`；列：sortcol、sortype |
| dw_tab | uo_tab |  | 27,900 2446×604 | 数据窗口 `d_tab2`；列：tab1（查询条件）、tab2（排列顺序）、tab3、tab4、tab5、tab6、tab7、tab8、tab9、tab10、tab11、tab12、tab13、tab14、tab15 |
| dw_where | 数据窗口 |  | 55,1000 2341×456 | 数据窗口 `d_where`；列：precol、column1（字   段   名）、operator（操作符）、value（字    段    值）、logical（逻辑符） |
| lb_syntax | 列表框 |  | 50,996 2341×456 |  |
| sle_join | 单行输入 | pzdj.nf=pz.nf and pzdj.yf=pz.yf and pzdj | 521,412 1641×132 |  |
| sle_table | 单行输入 | pz,pzlx,kmbm,xmk,dwk,bmk,grk,xjll_xm,pzd | 517,248 1641×124 |  |
| st_1 | 静态文本 | 请选择待显示列 | 73,8 603×72 |  |
| uo_1 | uo_getjoins |  | 2633,412 192×128 |  |

- 提示与校验（5 条）：
  - [dw_where.ue_where]「,请改正；  否则，所有查询条件将被忽略。」（条件：`i > 0`）
  - [dw_where.ue_where]「不是字符型,不能使用<含有>或<不含有>操作符,  请改正; 否则，所有查询条件将被忽略。」（条件：`trim(soper) = "like" or trim(soper) = "not like"`）
  - [dw_where.ue_where]「的值应为数字型,请改正；  否则，所有查询条件将被忽略。」（条件：`isnumber(svalue)`）
  - [dw_where.ue_where]「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」（条件：`not isdate(svalue)`）
  - [dw_where.ue_where]「这个数据类型未在本模块中定义。」
