# 轻松会计 · 出纳模块 — 业务规则与提示语（按窗口）

从 MessageBox 调用提取。“条件”取提示语之前最近的 if 条件，是静态近似；嵌套分支需对照源码复核。这类提示通常表示操作被阻止或需要用户确认。

## 出纳

### `w_cn_cx`「出纳单据综合查询」

- 「当前查询本模块不支持，请修改查询条件。  需要此功能者，请直接与开发商联系。」　条件：`parent.dw_result.create(sqlca.syntaxfromsql(syntax_str,"style(type = Grid)",err)) = -1` <sub>cb_exec.clicked</sub>
- 「,请改正；  否则，所有查询条件将被忽略。」　条件：`i > 0` <sub>dw_where.ue_where</sub>
- 「不是字符型,不能使用<含有>或<不含有>操作符,  请改正; 否则，所有查询条件将被忽略。」　条件：`trim(soper) = "like" or trim(soper) = "not like"` <sub>dw_where.ue_where</sub>
- 「的值应为数字型,请改正；  否则，所有查询条件将被忽略。」　条件：`isnumber(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,请改正；  否则，所有查询条件将被忽略。」　条件：`not isdate(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期时间型,请改正；  否则，所有查询条件将被忽略。」　条件：`svalue = "error"` <sub>dw_where.ue_where</sub>
- 「这个数据类型未在本模块中定义。」 <sub>dw_where.ue_where</sub>

### `w_cn_dz`「主从式应用示例」

- 「请选择需要取消勾账凭证！」　条件：`r < 1` <sub>窗口事件 ue_action_newcopy</sub>
- 「您选择的凭证还没有勾账！」　条件：`bz2 <> "1"` <sub>窗口事件 ue_action_newcopy</sub>
- 「勾账码错误！」　条件：`gzm <= 0` <sub>窗口事件 ue_action_newcopy</sub>
- 「勾账金额不等，可能是误删除了已经勾账的凭证！」　条件：`abs(this.id_cn - this.id_zw) > 0.005` <sub>窗口事件 ue_action_newcopy</sub>
- 「是否需要取消勾账(Y/N)?」　条件：`abs(this.id_cn - this.id_zw) > 0.005` <sub>窗口事件 ue_action_newcopy</sub>
- 「出纳和账务的勾账金额不一致，无法勾账！」　条件：`abs(this.id_zw - this.id_cn) > 0.005` <sub>窗口事件 ue_action_del</sub>
- 「是否确认此次勾账(Y/N)?」　条件：`abs(this.id_zw - this.id_cn) > 0.005` <sub>窗口事件 ue_action_del</sub>
- 「系统将按照日期顺序，将金额一致的单据进行勾销！~r~r        是否执行 （Ｙ / Ｎ）？」 <sub>cb_4.clicked</sub>
- 「账务系统还未结账，无本年的年初数！」　条件：`r = 0` <sub>cb_5.clicked</sub>

### `w_cn_hz_1`「汇总余额表」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_cn_km_find`「科目查找」

- 「科目不是明细科目，不可选。」　条件：`xx <> "1"` <sub>cb_2.clicked</sub>

### `w_cn_kmsz`「自动生成对方科目参数设置」

- 「应收账款科目未选择正确！」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「应收账款科目没有下级科目，你不能选择【自动增加下级科目】的方式！」　条件：`xx = "1"` <sub>cb_ok.clicked</sub>
- 「应收账款科目是非明细科目，你不能选择【所有客户都使用此科目】的方式！」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「应付账款科目未选择正确！」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「应付账款科目没有下级科目，你不能选择【自动增加下级科目】的方式！」　条件：`xx = "1"` <sub>cb_ok.clicked</sub>
- 「应付账款科目是非明细科目，你不能选择【所有供应商都使用此科目】的方式！」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「临时自动匹配科目未选择正确！」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「临时自动匹配科目必须是明细科目！」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「财务费用-利息收入科目未选择正确！」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「财务费用-利息收入科目必须是明细科目！」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「财务费用-手续费科目未选择正确！」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「财务费用-手续费科目必须是明细科目！」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>

### `w_cn_ll`「单据浏览」

- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>

### `w_cn_lr`「单据录入」

- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「请先选择账户!」　条件：`this.ddlb_1.text = ""` <sub>窗口事件 ue_action_get2</sub>
- 「再次确认删除 从  到  的单据（Y/N）? ~r    删除后单据将无法恢复！！！」　条件：`xt_cs10 = "2"` <sub>窗口事件 ue_action_del_all</sub>
- 「是否要将排序方法由按金额改为按录入顺序？」　条件：`gs_cn_sort = "1"` <sub>窗口事件 ue_action_sort</sub>
- 「是否要将排序方法由按录入顺序改为按金额？」　条件：`messagebox(sappname,"是否要将排序方法由按金额改为按录入顺序？",question!,yesno!,2) = 1` <sub>窗口事件 ue_action_sort</sub>
- 「此凭证已经删除！」 <sub>窗口事件 ue_action_pz_del</sub>
- 「此凭证已经审核，不能删除！」 <sub>窗口事件 ue_action_pz_del</sub>
- 「未生成凭证，不需要删除！」 <sub>窗口事件 ue_action_pz_del</sub>
- 「请先选择 账册！」　条件：`trim(xx) = "" or isnull(xx)` <sub>窗口事件 ue_action_new</sub>
- 「是否重新显示账册(Y/N)?」　条件：`xt_cs10 = "2"` <sub>窗口事件 ue_action_new</sub>
- 「已经勾账，不能删除！」　条件：`bz1 = "1"` <sub>窗口事件 ue_action_del</sub>
- 「已经结账，不能删除！」　条件：`string(rq,"yyyy-mm-dd") < (xt_jzyf + "-01")` <sub>窗口事件 ue_action_del</sub>
- 「已经生成凭证，不能删除！」　条件：`bz1 = "1"` <sub>窗口事件 ue_action_del</sub>
- 「此记录是其他系统转入，不能删除！」　条件：`bz1 = "1"` <sub>窗口事件 ue_action_del</sub>
- 「删除本条数据，请确认。」　条件：`bz1 = "1"` <sub>窗口事件 ue_action_del</sub>
- 「是否重新显示账册(Y/N)?」　条件：`messagebox("删除记录","删除本条数据，请确认。",question!,yesno!,2) = 1` <sub>窗口事件 ue_action_del</sub>
- 「已经勾账，不能修改！」　条件：`bz1 = "1"` <sub>窗口事件 ue_action_modify</sub>
- 「已经结账，不能修改！」　条件：`string(rq,"yyyy-mm-dd") < (xt_jzyf + "-01")` <sub>窗口事件 ue_action_modify</sub>
- 「此记录是其他系统转入，不能修改！」　条件：`bz1 = "1"` <sub>窗口事件 ue_action_modify</sub>
- 「已经生成凭证，不能直接修改！~r 如果要修改，请先点【删凭证】按钮，将生成凭证删除」　条件：`bz1 = "1"` <sub>窗口事件 ue_action_modify</sub>
- 「从当前位置往下搜索，没有发现符合条件的内容！」　条件：`r = 0` <sub>dw_master.ue_action_query</sub>

### `w_cn_lr_add`「增加单据」

- 「日期小于结账月份！~r日期不能小于-01」　条件：`string(rq,"yyyy-mm-dd") < (xt_jzyf + "-01")` <sub>cb_1.clicked</sub>
- 「日期过大，请仔细检查一下!」　条件：`string(rq,"yyyy-mm-dd") > string(d1,"yyyy-mm-dd")` <sub>cb_1.clicked</sub>
- 「请输入金额！」　条件：`isnull(je) or abs(je) < 0.005` <sub>cb_1.clicked</sub>
- 「对方科目需要填写为明细科目！」　条件：`yjd <> "1"` <sub>cb_1.clicked</sub>
- 「继续录入(Y/N)?」　条件：`parent.is_lx = "1"` <sub>cb_1.clicked</sub>

### `w_cn_lr_get1`「从账务系统转入」

- 「日期小于结账月份！~r日期不能小于」　条件：`parent.em_nf.text < xt_jzyf` <sub>cb_1.clicked</sub>
- 「本次共转入  条记录！」　条件：`i_1 > 0` <sub>cb_1.clicked</sub>
- 「未能转入，请检查转入条件是否正确！」　条件：`i_1 > 0` <sub>cb_1.clicked</sub>

### `w_cn_lr_qc`「单据录入」

- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>

### `w_cn_lr_qc_nf`「选择年份」

- 「小于开帐年份!」　条件：`nf < nf0` <sub>cb_1.clicked</sub>
- 「年期初数还没有建立，您需要做【结账】，一直到」　条件：`xt_cs1 > left(xt_jzyf,4)` <sub>cb_1.clicked</sub>

### `w_cn_preview_zc`「帐册打印」

- 「DW考贝出错！」　条件：`j = -1` <sub>窗口事件 f_inst</sub>
- 「没有内容！」　条件：`pub_print_dw.rowcount() < 0` <sub>窗口事件 wf_open</sub>

### `w_cn_pz`「凭证生成」

- 「应收账款科目未选择正确！」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「应收账款科目没有下级科目，你不能选择【自动增加下级科目】的方式！」　条件：`xx = "1"` <sub>cb_ok.clicked</sub>
- 「应收账款科目是非明细科目，你不能选择【所有客户都使用此科目】的方式！」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「应付账款科目未选择正确！」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「应付账款科目没有下级科目，你不能选择【自动增加下级科目】的方式！」　条件：`xx = "1"` <sub>cb_ok.clicked</sub>
- 「应付账款科目是非明细科目，你不能选择【所有供应商都使用此科目】的方式！」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「临时自动匹配科目未选择正确！」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「临时自动匹配科目必须是明细科目！」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「财务费用-利息收入科目未选择正确！」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「财务费用-利息收入科目必须是明细科目！」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「财务费用-手续费科目未选择正确！」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「财务费用-手续费科目必须是明细科目！」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「本级科目数量已经满，请到【套账信息】里增加本级的科目位数！」　条件：`kmbm = "error"` <sub>cb_ok.clicked</sub>
- 「是否增加科目 ?」　条件：`s_1 = "0"` <sub>cb_ok.clicked</sub>
- 「是否以后增加科目不再提醒?」　条件：`messagebox(sappname,"是否增加科目" + kmbm + " " + khmc + "?",question!,yesno!,2) = 2` <sub>cb_ok.clicked</sub>
- 「本月不存在需要生成凭证的出纳数据！」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_ok.clicked</sub>
- 「无数据，不能转帐！」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_save.clicked</sub>
- 「已有重复凭证，不能生成!」　条件：`r1 > 0` <sub>cb_save.clicked</sub>
- 「号凭证 借贷不平！(」　条件：`abs(jf - df) > 0.005` <sub>cb_save.clicked</sub>
- 「凭证科目不存在！」　条件：`isnull(yjd)` <sub>cb_save.clicked</sub>
- 「凭证非明细科目！」　条件：`yjd <> "1"` <sub>cb_save.clicked</sub>
- 「借贷不平！」　条件：`abs(jf - df) > 0.005` <sub>cb_save.clicked</sub>
- 「数据更新失败，不能生成!」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_save.clicked</sub>
- 「凭证生成完成！」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_save.clicked</sub>
- 「您现在采用的是计算机编号，不能进行此项选择！~r~r如果您一定要选择，请先到[套账信息]处修改凭证编号方法！」　条件：`xt_bhsz = "1"` <sub>cbx_1.clicked</sub>
- 「凭证日期不能小于」　条件：`d1 < parent.id_zw_jzrq` <sub>em_2.modified</sub>

### `w_cn_slz_1`「出纳日记账」

- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>

### `w_cn_wbhz_1`「汇总余额表」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_cn_xtcsh`「出纳初始化」

- 「初始化后，出纳部分的数据将被删除，请确定！」 <sub>cb_1.clicked</sub>
- 「出纳部分初始化完成！~r 请录入期初数！」 <sub>cb_1.clicked</sub>

## 登录

### `w_login`「用户登录」

- 「套账数量超过此版本允许的套，不能运行！」　条件：`xt_zt0 = 5 and i > (gl_tzsl + 1)` <sub>窗口事件 open</sub>
- 「需选择套账！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「此套账不存在！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「非法的操作日期！」　条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"` <sub>cb_ok.clicked</sub>
- 「操作日期小于开帐日期！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「此套账数据量超过试用版容量，请向润衡服务中心购买正式版本！~r      本套账数据会自动平移到正版软件中继续使用。~r      QQ：800003004 ；电话/微信：13312858385 ~r ~r若您已购买正版，可能是加密锁没插好或电脑USB口接触不好 ~r      请换个USB口插并重启电脑后再试试！」　条件：`i > 500` <sub>cb_ok.clicked</sub>

### `w_login_oem`「用户登录」

- 「套账数量超过此版本允许的套，不能运行！」　条件：`xt_zt0 = 5 and i > (gl_tzsl + 1)` <sub>窗口事件 open</sub>
- 「您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。」　条件：`xt_zt0 = 2` <sub>窗口事件 open</sub>
- 「您的系统已经有最新版本,是否升级?~r(升级将不会影响现有的数据!)~r升级程序运行过程中，如果杀毒软件提示，一定要允许操作!!!」　条件：`messagebox(sappname,"您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。",question!,yesno!,1) = 1` <sub>窗口事件 open</sub>
- 「需选择套账！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「此套账不存在！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「非法的操作日期！」　条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"` <sub>cb_ok.clicked</sub>
- 「操作日期小于开帐日期！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「此套账数据量超过本版本容量，请向润衡服务中心购买正式版本！~r      本套账数据会自动平移到正式版本软件中继续使用。」　条件：`i > 500` <sub>cb_ok.clicked</sub>
- 「是否套账名称是乱码，需要解决？」 <sub>ddlb_1.rbuttondown</sub>

## 其他系统窗口（登录、备份恢复、打印、杂项）

### `w_bb_def_cn0_bak`「格式定义」

- 「第行的日期」　条件：`string(d1,"yyyy-mm-dd") < (xt_jzyf + "-01")` <sub>窗口事件 ue_action_get</sub>
- 「本次共转入」　条件：`s_b1 = "1"` <sub>窗口事件 ue_action_get</sub>
- 「没有符合条件的数据被转入！」　条件：`s_b1 = "1"` <sub>窗口事件 ue_action_get</sub>
- 「请先确认文件是否存在(Y/N)?」 <sub>窗口事件 ue_action_read</sub>
- 「文件  不存在或读入错！」　条件：`ftp = -1` <sub>窗口事件 wf_open</sub>

### `w_bb_saveas`「数据导出」

- 「第行的日期」　条件：`string(d1,"yyyy-mm-dd") < (xt_jzyf + "-01")` <sub>窗口事件 wf_get_cn_lr</sub>
- 「第行的日期」　条件：`string(d1,"yyyy-mm-dd") > string(d2,"yyyy-mm-dd")` <sub>窗口事件 wf_get_cn_lr</sub>
- 「本次共转入条对账单数据！」　条件：`s_b1 = "1"` <sub>窗口事件 wf_get_cn_lr</sub>
- 「没有符合条件的数据被转入！」　条件：`s_b1 = "1"` <sub>窗口事件 wf_get_cn_lr</sub>

### `w_err_view`「错误查看」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_frame`「Frame」

- 「结束 ? ~r ~r温馨提示：为了保护您的数据安全，日常工作中建议您做好数据备份。」 <sub>窗口事件 closequery</sub>

### `w_main1_cn`「主窗口」

- 「请先做系统初始化!」　条件：`kg_bz = "2"` <sub>st_1_dz.clicked</sub>

### `w_module`「模块维护」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_pass`「自改密码」

- 「启用新密码, 请牢记」 <sub>cb_ok.clicked</sub>

### `w_users`「用户/组维护」

- 「此处数据错误，请重新输入。」　条件：`this.dw_detail.accepttext() = -1` <sub>窗口事件 ue_action_save</sub>
- 「数据还没有存盘，刷新前是否存盘?」　条件：`this.ib_save = false` <sub>窗口事件 ue_action_refresh</sub>
- 「删除本条数据，请确认。」　条件：`l_status = new!` <sub>窗口事件 ue_action_del</sub>
- 「存入失败，数据没有删除。」 <sub>窗口事件 ue_action_del</sub>
- 「开始打印吗?」 <sub>窗口事件 ue_display_print</sub>
- 「共享DataWindow的数据源可能不一致，请检查。」　条件：`this.dw_master.sharedata(this.dw_detail) = -1` <sub>窗口事件 open</sub>
- 「有数据未存盘, 退出前是否存盘 ?」　条件：`not this.ib_save` <sub>窗口事件 closequery</sub>

### `w_xt_zy_cn`「摘要管理」

- 「摘要编码重复！是否重输？」　条件：`i = -1` <sub>cb_4.clicked</sub>

### `w_xtzc_1`「系统注册」

- 「校验码错误！」　条件：`mod(r1 * 508,10000) <> r2 and r2 <> 630510` <sub>cb_1.clicked</sub>

### `wroot_dw_query`「定位查询」

- 「,请改正」　条件：`i > 0` <sub>dw_where.ue_where</sub>
- 「不是字符型,不能使用<含有>或<不含有>操作符」　条件：`trim(soper) = "like" or trim(soper) = "not like"` <sub>dw_where.ue_where</sub>
- 「的值应为数字型,请改正」　条件：`isnumber(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,请改正」　条件：`not isdate(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期时间型,请改正」　条件：`svalue = "error"` <sub>dw_where.ue_where</sub>
- 「这个数据类型未在本模块中定义。」 <sub>dw_where.ue_where</sub>

### `wroot_dw_query_lr`「定位查询」

- 「,请改正」　条件：`i > 0` <sub>dw_where.ue_where</sub>
- 「不是字符型,不能使用<含有>或<不含有>操作符」　条件：`trim(soper) = "like" or trim(soper) = "not like"` <sub>dw_where.ue_where</sub>
- 「的值应为数字型,请改正」　条件：`isnumber(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,请改正」　条件：`not isdate(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期时间型,请改正」　条件：`svalue = "error"` <sub>dw_where.ue_where</sub>
- 「这个数据类型未在本模块中定义。」 <sub>dw_where.ue_where</sub>

### `wroot_fix_query`「固定查询及统计」

- 「程序员: 请修改下面打开的Window的Title.」　条件：`this.title = "固定查询及统计"` <sub>窗口事件 open</sub>
- 「开始打印吗?」 <sub>cb_print.clicked</sub>

### `wroot_md`「主从式应用示例」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`not this.ib_save` <sub>窗口事件 closequery</sub>
- 「删除本条数据，请确认。」　条件：`this.ib_edit` <sub>窗口事件 ue_action_del</sub>
- 「存入失败，数据不能从库中删除。」 <sub>窗口事件 ue_action_del</sub>
- 「数据还没有存盘，刷新前是否存盘?」　条件：`this.ib_save = false` <sub>窗口事件 ue_action_refresh</sub>
- 「主表此处数据错误，请重新输入。」　条件：`this.dw_master.accepttext() = -1` <sub>窗口事件 ue_action_save</sub>
- 「从表此处数据错误，请重新输入。」　条件：`this.dw_detail.accepttext() = -1` <sub>窗口事件 ue_action_save</sub>

### `wroot_md2`「wroot_sheet（继承自祖先）」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`not this.ib_save` <sub>窗口事件 closequery</sub>

### `wroot_md2_1`「wroot_sheet（继承自祖先）」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`not this.ib_save` <sub>窗口事件 closequery</sub>

### `wroot_md_2`「主从式应用示例」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`not this.ib_save` <sub>窗口事件 closequery</sub>
- 「删除本条数据，请确认。」　条件：`this.ib_edit` <sub>窗口事件 ue_action_del</sub>
- 「存入失败，数据不能从库中删除。」 <sub>窗口事件 ue_action_del</sub>
- 「数据还没有存盘，刷新前是否存盘?」　条件：`this.ib_save = false` <sub>窗口事件 ue_action_refresh</sub>
- 「主表此处数据错误，请重新输入。」　条件：`this.dw_master.accepttext() = -1` <sub>窗口事件 ue_action_save</sub>
- 「从表此处数据错误，请重新输入。」　条件：`this.dw_detail.accepttext() = -1` <sub>窗口事件 ue_action_save</sub>

### `wroot_mds`「共享式 + 主从式应用示例」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`not this.ib_save` <sub>窗口事件 closequery</sub>
- 「删除本条数据，请确认。」　条件：`this.ib_edit` <sub>窗口事件 ue_action_del</sub>
- 「存入失败，数据不能从库中删除。」 <sub>窗口事件 ue_action_del</sub>
- 「数据还没有存盘，刷新前是否存盘?」　条件：`this.ib_save = false` <sub>窗口事件 ue_action_refresh</sub>
- 「主表此处数据错误，请重新输入。」　条件：`this.dw_detail.accepttext() = -1` <sub>窗口事件 ue_action_save</sub>
- 「从表此处数据错误，请重新输入。」　条件：`this.dw_sublist.accepttext() = -1` <sub>窗口事件 ue_action_save</sub>

### `wroot_query`「综合查询」

- 「当前查询本模块不支持，请修改查询条件。  需要此功能者，请直接与开发商联系。」　条件：`parent.dw_result.create(sqlca.syntaxfromsql(syntax_str,"style(type = Grid)",err)) = -1` <sub>cb_exec.clicked</sub>
- 「,请改正；  否则，所有查询条件将被忽略。」　条件：`i > 0` <sub>dw_where.ue_where</sub>
- 「不是字符型,不能使用<含有>或<不含有>操作符,  请改正; 否则，所有查询条件将被忽略。」　条件：`trim(soper) = "like" or trim(soper) = "not like"` <sub>dw_where.ue_where</sub>
- 「的值应为数字型,请改正；  否则，所有查询条件将被忽略。」　条件：`isnumber(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,请改正；  否则，所有查询条件将被忽略。」　条件：`not isdate(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期时间型,请改正；  否则，所有查询条件将被忽略。」　条件：`svalue = "error"` <sub>dw_where.ue_where</sub>
- 「这个数据类型未在本模块中定义。」 <sub>dw_where.ue_where</sub>

### `wroot_share`「共享式应用」

- 「共享DataWindow的数据源可能不一致，请检查。」　条件：`this.dw_master.sharedata(this.dw_detail) = -1` <sub>窗口事件 open</sub>
- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>

### `wroot_share_tab`「共享式应用(TAB)」

- 「共享DataWindow的数据源可能不一致，请检查。」　条件：`this.dw_master.sharedata(this.dw_detail) = -1` <sub>窗口事件 open</sub>
- 「有数据未存盘, 退出前是否存盘 ?」　条件：`not this.ib_save` <sub>窗口事件 closequery</sub>
- 「删除本条数据，请确认。」　条件：`l_status = new!` <sub>窗口事件 ue_action_del</sub>
- 「存入失败，数据没有删除。」 <sub>窗口事件 ue_action_del</sub>
- 「开始打印吗?」 <sub>窗口事件 ue_action_print</sub>
- 「数据还没有存盘，刷新前是否存盘?」　条件：`this.ib_save = false` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」　条件：`message.returnvalue = 1` <sub>窗口事件 ue_action_refresh</sub>
- 「此处数据错误，请重新输入。」　条件：`this.dw_detail.accepttext() = -1` <sub>窗口事件 ue_action_save</sub>
- 「数据还没有存盘，刷新前是否存盘?」　条件：`ib_save = false` <sub>tab_1/tabpage_1/dw_master.ue_action_refresh</sub>

### `wroot_single`「单一式应用」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `wroot_single_1`「单一式应用」

- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>

## 打印预览

### `w_preview`「打印预览」

- 「没有记录，无法显示及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 open</sub>
- 「DW考贝出错！」　条件：`errorcode = -1` <sub>窗口事件 open</sub>

### `w_preview_cn`「打印预览」

- 「没有记录，无法显示及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 open</sub>
- 「DW考贝出错！」　条件：`errorcode = -1` <sub>窗口事件 open</sub>

## 打印设置

### `w_print`「打印」

- 「打印范围无效。」　条件：`(not isnumber(stmp)) or stmp = "" or isnull(stmp)` <sub>cb_ok.clicked</sub>

### `w_print_1`「打印」

- 「打印范围无效。」　条件：`(not isnumber(stmp)) or stmp = "" or isnull(stmp)` <sub>cb_ok.clicked</sub>

### `w_print_2`「打印」

- 「打印范围无效。」　条件：`(not isnumber(stmp)) or stmp = "" or isnull(stmp)` <sub>cb_ok.clicked</sub>

## 全局函数中的提示

### 全局函数 `f_bb_get_pos_cn`

- 「报表格式文件错误！」　条件：`isnull(ret) or ret < 50`
- 「报表格式文件错误！」　条件：`left(as_indicator,8) <> "c:\temp\"`

### 全局函数 `f_bb_save_pos_cn`

- 「报表文件不存在！」　条件：`fileexists(ls_filename) = false`

### 全局函数 `f_check_required`

- 「为空值, 请输入数据」　条件：`row <> 0`

### 全局函数 `f_next_code`

- 「错误: old_code的长度超过了code_len，返回空串。」　条件：`len(string(double(old_code))) > code_len`

### 全局函数 `f_sa_conn_info`

- 「declare c」　条件：`sqlca.sqlcode <> 0`

### 全局函数 `f_save`

- 「是否提换现有的文件？」　条件：`i = 1`
