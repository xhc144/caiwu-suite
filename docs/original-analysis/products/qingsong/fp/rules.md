# 轻松会计 · 发票/进销存模块 — 业务规则与提示语（按窗口）

从 MessageBox 调用提取。“条件”取提示语之前最近的 if 条件，是静态近似；嵌套分支需对照源码复核。这类提示通常表示操作被阻止或需要用户确认。

## 发票

### `w_fp_cx`「销项发票综合查询」

- 「当前查询本模块不支持，请修改查询条件。  需要此功能者，请直接与开发商联系。」　条件：`parent.dw_result.create(sqlca.syntaxfromsql(syntax_str,"style(type = Grid)",err)) = -1` <sub>cb_exec.clicked</sub>
- 「,请改正；  否则，所有查询条件将被忽略。」　条件：`i > 0` <sub>dw_where.ue_where</sub>
- 「不是字符型,不能使用<含有>或<不含有>操作符,  请改正; 否则，所有查询条件将被忽略。」　条件：`trim(soper) = "like" or trim(soper) = "not like"` <sub>dw_where.ue_where</sub>
- 「的值应为数字型,请改正；  否则，所有查询条件将被忽略。」　条件：`isnumber(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`not isdate(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`svalue = "error"` <sub>dw_where.ue_where</sub>
- 「这个数据类型未在本模块中定义。」 <sub>dw_where.ue_where</sub>

### `w_fp_cx_2`「进项发票综合查询」

- 「当前查询本模块不支持，请修改查询条件。  需要此功能者，请直接与开发商联系。」　条件：`parent.dw_result.create(sqlca.syntaxfromsql(syntax_str,"style(type = Grid)",err)) = -1` <sub>cb_exec.clicked</sub>
- 「,请改正；  否则，所有查询条件将被忽略。」　条件：`i > 0` <sub>dw_where.ue_where</sub>
- 「不是字符型,不能使用<含有>或<不含有>操作符,  请改正; 否则，所有查询条件将被忽略。」　条件：`trim(soper) = "like" or trim(soper) = "not like"` <sub>dw_where.ue_where</sub>
- 「的值应为数字型,请改正；  否则，所有查询条件将被忽略。」　条件：`isnumber(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`not isdate(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`svalue = "error"` <sub>dw_where.ue_where</sub>
- 「这个数据类型未在本模块中定义。」 <sub>dw_where.ue_where</sub>

### `w_fp_fjz`「反结账」

- 「已经到开账日期了，不能再反结账了！」　条件：`xx < xx1` <sub>窗口事件 open</sub>

### `w_fp_hz`「发票汇总」

- 「销项税科目非明细科目！~r请到【参数设置】处重新设置」　条件：`xx <> "1"` <sub>窗口事件 open</sub>
- 「进项税科目非明细科目！~r请到【参数设置】处重新设置」　条件：`xx <> "1"` <sub>窗口事件 open</sub>
- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_fp_hz_1_bak`「发票季度汇总」

- 「本季度还未结账，不能生成凭证！」　条件：`xx >= xt_jzyf` <sub>cb_1.clicked</sub>

### `w_fp_hz_bak`「发票汇总」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>
- 「本季度还未结账，不能生成凭证！」　条件：`xx >= xt_jzyf` <sub>窗口事件 u_pz</sub>
- 「生成凭证的金额为零，不需要生成凭证！」　条件：`abs(je1) < 0.005 and abs(je2) < 0.005` <sub>窗口事件 u_pz</sub>

### `w_fp_khhz`「客户汇总」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_fp_khhz_2`「供应商汇总」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_fp_lr_1`「销项发票录入」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>
- 「已经审核，不能删除！」　条件：`sh_bz = "1"` <sub>窗口事件 ue_action_del</sub>
- 「已经后续处理，不能删除！」　条件：`sh_bz <> "0"` <sub>窗口事件 ue_action_del</sub>
- 「已经结账，不能删除！」　条件：`string(rq,"yyyy-mm-dd") < (xt_jzyf + "-01")` <sub>窗口事件 ue_action_del</sub>
- 「删除本条数据，请确认。」　条件：`string(rq,"yyyy-mm-dd") < (xt_jzyf + "-01")` <sub>窗口事件 ue_action_del</sub>
- 「此处数据错误，请重新输入。」　条件：`this.dw_master.accepttext() = -1` <sub>窗口事件 ue_action_save</sub>
- 「第行未输入发票号码！~r请输入后再存盘！」　条件：`trim(fphm) = ""` <sub>窗口事件 ue_action_save</sub>
- 「第行发票日期小于已经结账日期，不能存盘！」　条件：`string(d_d1,"yyyy-mm-dd") < (xt_jzyf + "-01")` <sub>窗口事件 ue_action_save</sub>
- 「第行发票日期超过试用日期，不能存盘！」　条件：`string(d_d1,"yyyy-mm-dd") >= string(gd_tt,"yyyy-mm-dd")` <sub>窗口事件 ue_action_save</sub>
- 「第行 金额不等于数量乘单价！」　条件：`abs(sl * dj - je0) >= 0.01` <sub>窗口事件 ue_action_save</sub>
- 「第行 税额不等于金额乘税率！」　条件：`abs(se - je0 * slv) >= 0.02` <sub>窗口事件 ue_action_save</sub>
- 「有数据未存盘, 导入前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 ue_action_get2</sub>
- 「请先将需要删除的发票，用【查询】功能查询到当前界面上！」 <sub>窗口事件 ue_action_del_all</sub>
- 「请确定是否要删除以下发票？」　条件：`this.dw_master.rowcount() = 0` <sub>窗口事件 ue_action_del_all</sub>
- 「再次确认，是否要删除以下发票？」　条件：`messagebox(sappname,"请确定是否要删除以下发票？",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del_all</sub>
- 「由于发票已经审核、已经生成凭证或者已经结账导致有条发票未能删除！」　条件：`r0 > 0` <sub>窗口事件 ue_action_del_all</sub>
- 「是否删除发票生成的凭证？」　条件：`pz_bz = "1"` <sub>窗口事件 ue_action_pz_del</sub>
- 「此凭证已经审核，不能删除！」 <sub>窗口事件 ue_action_pz_del</sub>
- 「是否删除发票生成的出库单？」　条件：`pz_bz = "2"` <sub>窗口事件 ue_action_pz_del</sub>
- 「未生成凭证，无须删除！」　条件：`ckbh = "fp"` <sub>窗口事件 ue_action_pz_del</sub>
- 「数据还没有存盘，刷新前是否存盘?」　条件：`this.ib_need_save` <sub>dw_master.ue_action_refresh</sub>

### `w_fp_lr_2`「进项发票录入」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>
- 「已经审核，不能删除！」　条件：`sh_bz = "1"` <sub>窗口事件 ue_action_del</sub>
- 「已经后续处理，不能删除！」　条件：`sh_bz <> "0"` <sub>窗口事件 ue_action_del</sub>
- 「已经结账，不能删除！」　条件：`string(rq,"yyyy-mm-dd") < (xt_jzyf + "-01")` <sub>窗口事件 ue_action_del</sub>
- 「删除本条数据，请确认。」　条件：`string(rq,"yyyy-mm-dd") < (xt_jzyf + "-01")` <sub>窗口事件 ue_action_del</sub>
- 「此处数据错误，请重新输入。」　条件：`this.dw_master.accepttext() = -1` <sub>窗口事件 ue_action_save</sub>
- 「第行未输入发票号码！~r请输入后再存盘！」　条件：`trim(fphm) = ""` <sub>窗口事件 ue_action_save</sub>
- 「第行认证日期小于已经结账日期，不能存盘！」　条件：`string(d_d1,"yyyy-mm-dd") < (xt_jzyf + "-01")` <sub>窗口事件 ue_action_save</sub>
- 「第行认证日期超过试用日期，不能存盘！」　条件：`string(d_d1,"yyyy-mm-dd") >= string(gd_tt,"yyyy-mm-dd")` <sub>窗口事件 ue_action_save</sub>
- 「第行发票日期小于已经结账日期，不能存盘！」　条件：`string(d_d1,"yyyy-mm-dd") < (xt_jzyf + "-01")` <sub>窗口事件 ue_action_save</sub>
- 「第行发票日期超过试用日期，不能存盘！」　条件：`string(d_d1,"yyyy-mm-dd") >= string(gd_tt,"yyyy-mm-dd")` <sub>窗口事件 ue_action_save</sub>
- 「有数据未存盘, 导入前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 ue_action_get2</sub>
- 「请先将需要删除的发票，用【查询】功能查询到当前界面上！」 <sub>窗口事件 ue_action_del_all</sub>
- 「请确定是否要删除以下发票？」　条件：`this.dw_master.rowcount() = 0` <sub>窗口事件 ue_action_del_all</sub>
- 「再次确认，是否要删除以下发票？」　条件：`messagebox(sappname,"请确定是否要删除以下发票？",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del_all</sub>
- 「由于发票已经审核、已经生成凭证或者已经结账导致有条发票未能删除！」　条件：`r0 > 0` <sub>窗口事件 ue_action_del_all</sub>
- 「此凭证已经审核，不能删除！」 <sub>窗口事件 ue_action_pz_del</sub>
- 「未生成凭证，无须删除！」 <sub>窗口事件 ue_action_pz_del</sub>

### `w_fp_preview`「打印预览」

- 「没有记录，无法显示及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 open</sub>
- 「DW考贝出错！」　条件：`errorcode = -1` <sub>窗口事件 open</sub>

### `w_fp_pz`「凭证生成」

- 「销货收入科目非明细科目！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「服务收入科目非明细科目！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「销项税科目非明细科目！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「应收账款科目未选择正确！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「应收账款科目没有下级科目，你不能选择【自动增加下级科目】的方式！~r请到【销项发票参数设置】处重新设置」　条件：`xx = "1"` <sub>cb_ok.clicked</sub>
- 「应收账款科目是非明细科目，你不能选择【所有客户都使用此科目】的方式！~r请到【销项发票参数设置】处重新设置」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「销售成本科目非明细科目！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「原材料科目非明细科目！~r请到【进项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「进项税科目非明细科目！~r请到【进项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「应付账款科目未选择正确！~r请到【进项发票参数设置】处重新设置」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「应付账款科目没有下级科目，你不能选择【自动增加下级科目】的方式！~r请到【进项发票参数设置】处重新设置」　条件：`xx = "1"` <sub>cb_ok.clicked</sub>
- 「应付账款科目是非明细科目，你不能选择【所有供应商都使用此科目】的方式！~r请到【进项发票参数设置】处重新设置」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「本级科目数量已经满，请到【套账信息】里增加本级的科目位数！」　条件：`kmbm = "error"` <sub>cb_ok.clicked</sub>
- 「是否增加科目 ?」　条件：`s_1 = "0"` <sub>cb_ok.clicked</sub>
- 「是否以后增加科目不再提醒?」　条件：`messagebox(sappname,"是否增加科目" + kmbm + " " + khmc + "?",question!,yesno!,2) = 2` <sub>cb_ok.clicked</sub>
- 「本月不存在需要生成凭证的销项发票」　条件：`parent.rb_kj.checked` <sub>cb_ok.clicked</sub>
- 「本月不存在需要生成凭证的进项发票」　条件：`parent.rb_kj.checked` <sub>cb_ok.clicked</sub>
- 「无数据，不能转帐！」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_save.clicked</sub>
- 「已有重复凭证，不能生成!」　条件：`r1 > 0` <sub>cb_save.clicked</sub>
- 「借贷不平！(」　条件：`abs(jf - df) > 0.005` <sub>cb_save.clicked</sub>
- 「第行科目不存在！」　条件：`isnull(yjd)` <sub>cb_save.clicked</sub>
- 「第行非明细科目！」　条件：`yjd <> "1"` <sub>cb_save.clicked</sub>
- 「借贷不平！」　条件：`abs(jf - df) > 0.005` <sub>cb_save.clicked</sub>
- 「数据更新失败，不能生成!」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_save.clicked</sub>
- 「凭证生成完成！」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_save.clicked</sub>
- 「您现在采用的是计算机编号，不能进行此项选择！~r~r如果您一定要选择，请先到[套账信息]处修改凭证编号方法！」　条件：`xt_bhsz = "1"` <sub>cbx_1.clicked</sub>
- 「日期不能小于」　条件：`d1 < parent.id_zw_jzrq` <sub>em_2.modified</sub>

### `w_fp_pz_bak`「凭证生成」

- 「仓库模块当月已经结账，不能增加出库单！」　条件：`date(this.i_nf,this.i_yf,1) < d_rq` <sub>窗口事件 wf_ckd</sub>
- 「是否增加产品   ?」　条件：`s_1 = "0"` <sub>窗口事件 wf_ckd</sub>
- 「是否以后增加产品不再提醒?」　条件：`messagebox(sappname,"是否增加产品" + cpbh + " " + cpmc + " " + gg + " " + jldw + "?",question!,yesno!,2) = 2` <sub>窗口事件 wf_ckd</sub>
- 「本级科目数量已经满，请到【套账信息】里增加本级的科目位数！」　条件：`kmbm = "error"` <sub>窗口事件 wf_ckd</sub>
- 「是否增加科目 ?」　条件：`s_1 = "0"` <sub>窗口事件 wf_ckd</sub>
- 「是否以后增加科目不再提醒?」　条件：`messagebox(sappname,"是否增加科目" + kmbm + " " + khmc + "?",question!,yesno!,2) = 2` <sub>窗口事件 wf_ckd</sub>
- 「本月不存在需要生成出库单的销项发票」　条件：`this.dw_1.rowcount() = 0` <sub>窗口事件 wf_ckd</sub>
- 「出库单生成完毕！」 <sub>窗口事件 wf_into_ckd</sub>
- 「销货收入科目非明细科目！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「服务收入科目非明细科目！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「销项税科目非明细科目！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「应收账款科目未选择正确！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「应收账款科目没有下级科目，你不能选择【自动增加下级科目】的方式！~r请到【销项发票参数设置】处重新设置」　条件：`xx = "1"` <sub>cb_ok.clicked</sub>
- 「应收账款科目是非明细科目，你不能选择【所有客户都使用此科目】的方式！~r请到【销项发票参数设置】处重新设置」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「销售成本科目非明细科目！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「原材料科目非明细科目！~r请到【进项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「进项税科目非明细科目！~r请到【进项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「应付账款科目未选择正确！~r请到【进项发票参数设置】处重新设置」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「应付账款科目没有下级科目，你不能选择【自动增加下级科目】的方式！~r请到【进项发票参数设置】处重新设置」　条件：`xx = "1"` <sub>cb_ok.clicked</sub>
- 「应付账款科目是非明细科目，你不能选择【所有供应商都使用此科目】的方式！~r请到【进项发票参数设置】处重新设置」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「本月不存在需要生成凭证的销项发票」　条件：`parent.rb_kj.checked` <sub>cb_ok.clicked</sub>
- 「本月不存在需要生成凭证的进项发票」　条件：`parent.rb_kj.checked` <sub>cb_ok.clicked</sub>
- 「无数据，不能转帐！」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_save.clicked</sub>
- 「已有重复凭证，不能生成!」　条件：`r1 > 0` <sub>cb_save.clicked</sub>
- 「借贷不平！(」　条件：`abs(jf - df) > 0.005` <sub>cb_save.clicked</sub>
- 「第行科目不存在！」　条件：`isnull(yjd)` <sub>cb_save.clicked</sub>
- 「第行非明细科目！」　条件：`yjd <> "1"` <sub>cb_save.clicked</sub>
- 「借贷不平！」　条件：`abs(jf - df) > 0.005` <sub>cb_save.clicked</sub>
- 「数据更新失败，不能生成!」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_save.clicked</sub>
- 「凭证生成完成！」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_save.clicked</sub>
- 「您现在采用的是计算机编号，不能进行此项选择！~r~r如果您一定要选择，请先到[套账信息]处修改凭证编号方法！」　条件：`xt_bhsz = "1"` <sub>cbx_1.clicked</sub>
- 「日期不能小于」　条件：`d1 < parent.id_zw_jzrq` <sub>em_2.modified</sub>

### `w_fp_pz_ckd`「出库单生成」

- 「仓库模块当月已经结账，不能增加出库单！」　条件：`date(this.ii_nf,this.ii_yf,1) < gd_cb_jzrq` <sub>窗口事件 wf_ckd</sub>
- 「是否增加产品   ?」　条件：`s_1 = "0"` <sub>窗口事件 wf_ckd</sub>
- 「是否以后增加产品不再提醒?」　条件：`messagebox(sappname,"是否增加产品" + cpbh + " " + cpmc + " " + gg + " " + jldw + "?",question!,yesno!,2) = 2` <sub>窗口事件 wf_ckd</sub>
- 「本级科目数量已经满，请到【套账信息】里增加本级的科目位数！」　条件：`kmbm = "error"` <sub>窗口事件 wf_ckd</sub>
- 「是否增加科目 ?」　条件：`s_1 = "0"` <sub>窗口事件 wf_ckd</sub>
- 「是否以后增加科目不再提醒?」　条件：`messagebox(sappname,"是否增加科目" + kmbm + " " + khmc + "?",question!,yesno!,2) = 2` <sub>窗口事件 wf_ckd</sub>
- 「本月不存在需要生成出库单的销项发票」　条件：`this.dw_1.rowcount() = 0` <sub>窗口事件 wf_ckd</sub>
- 「出库单生成完毕！」 <sub>窗口事件 wf_into_ckd</sub>
- 「应收账款科目未选择正确！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「应收账款科目没有下级科目，你不能选择【自动增加下级科目】的方式！~r请到【销项发票参数设置】处重新设置」　条件：`xx = "1"` <sub>cb_ok.clicked</sub>
- 「应收账款科目是非明细科目，你不能选择【所有客户都使用此科目】的方式！~r请到【销项发票参数设置】处重新设置」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「销售成本科目非明细科目！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「您现在采用的是计算机编号，不能进行此项选择！~r~r如果您一定要选择，请先到[套账信息]处修改凭证编号方法！」　条件：`xt_bhsz = "1"` <sub>cbx_1.clicked</sub>
- 「日期不能小于」　条件：`d1 < parent.id_zw_jzrq` <sub>em_2.modified</sub>

### `w_fp_pz_hz`「季度凭证生成」

- 「营业外收入科目非明细科目！~r请到【参数设置】处重新设置」　条件：`xx <> "1"` <sub>窗口事件 open</sub>
- 「营业税金及附加科目非明细科目！~r请到【参数设置】处重新设置」　条件：`xx <> "1"` <sub>窗口事件 open</sub>
- 「应交税金-城建税科目非明细科目！~r请到【参数设置】处重新设置」　条件：`xx <> "1"` <sub>窗口事件 open</sub>
- 「应交税金-教育费附加科目非明细科目！~r请到【参数设置】处重新设置」　条件：`xx <> "1"` <sub>窗口事件 open</sub>
- 「应交税金-地方教育费附加科目非明细科目！~r请到【参数设置】处重新设置」　条件：`xx <> "1"` <sub>窗口事件 open</sub>
- 「销项税科目非明细科目！~r请到【参数设置】处重新设置」　条件：`xx <> "1"` <sub>窗口事件 open</sub>
- 「无数据，不能转帐！」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_save.clicked</sub>
- 「已有重复凭证，不能生成!」　条件：`r1 > 0` <sub>cb_save.clicked</sub>
- 「借贷不平！(」　条件：`abs(jf - df) > 0.005` <sub>cb_save.clicked</sub>
- 「第行科目不存在！」　条件：`isnull(yjd)` <sub>cb_save.clicked</sub>
- 「第行非明细科目！」　条件：`yjd <> "1"` <sub>cb_save.clicked</sub>
- 「借贷不平！」　条件：`abs(jf - df) > 0.005` <sub>cb_save.clicked</sub>
- 「数据更新失败，不能生成!」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_save.clicked</sub>
- 「凭证生成完成！」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_save.clicked</sub>
- 「日期不能小于」　条件：`d1 < parent.id_zw_jzrq` <sub>em_2.modified</sub>

### `w_fp_pz_sz`「凭证生成」

- 「仓库模块当月已经结账，不能增加出库单！」　条件：`date(this.i_nf,this.i_yf,1) < d_rq` <sub>窗口事件 wf_ckd</sub>
- 「是否增加产品   ?」　条件：`s_1 = "0"` <sub>窗口事件 wf_ckd</sub>
- 「是否以后增加产品不再提醒?」　条件：`messagebox(sappname,"是否增加产品" + cpbh + " " + cpmc + " " + gg + " " + jldw + "?",question!,yesno!,2) = 2` <sub>窗口事件 wf_ckd</sub>
- 「本级科目数量已经满，请到【套账信息】里增加本级的科目位数！」　条件：`kmbm = "error"` <sub>窗口事件 wf_ckd</sub>
- 「是否增加科目 ?」　条件：`s_1 = "0"` <sub>窗口事件 wf_ckd</sub>
- 「是否以后增加科目不再提醒?」　条件：`messagebox(sappname,"是否增加科目" + kmbm + " " + khmc + "?",question!,yesno!,2) = 2` <sub>窗口事件 wf_ckd</sub>
- 「本月不存在需要生成出库单的销项发票」　条件：`this.dw_1.rowcount() = 0` <sub>窗口事件 wf_ckd</sub>
- 「出库单生成完毕！」 <sub>窗口事件 wf_into_ckd</sub>
- 「销货收入科目非明细科目！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「服务收入科目非明细科目！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「销项税科目非明细科目！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「应收账款科目未选择正确！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「应收账款科目没有下级科目，你不能选择【自动增加下级科目】的方式！~r请到【销项发票参数设置】处重新设置」　条件：`xx = "1"` <sub>cb_ok.clicked</sub>
- 「应收账款科目是非明细科目，你不能选择【所有客户都使用此科目】的方式！~r请到【销项发票参数设置】处重新设置」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「销售成本科目非明细科目！~r请到【销项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「原材料科目非明细科目！~r请到【进项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「进项税科目非明细科目！~r请到【进项发票参数设置】处重新设置」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「应付账款科目未选择正确！~r请到【进项发票参数设置】处重新设置」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「应付账款科目没有下级科目，你不能选择【自动增加下级科目】的方式！~r请到【进项发票参数设置】处重新设置」　条件：`xx = "1"` <sub>cb_ok.clicked</sub>
- 「应付账款科目是非明细科目，你不能选择【所有供应商都使用此科目】的方式！~r请到【进项发票参数设置】处重新设置」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>
- 「本月不存在需要生成凭证的销项发票」　条件：`parent.rb_kj.checked` <sub>cb_ok.clicked</sub>
- 「本月不存在需要生成凭证的进项发票」　条件：`parent.rb_kj.checked` <sub>cb_ok.clicked</sub>
- 「无数据，不能转帐！」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_save.clicked</sub>
- 「已有重复凭证，不能生成!」　条件：`r1 > 0` <sub>cb_save.clicked</sub>
- 「借贷不平！(」　条件：`abs(jf - df) > 0.005` <sub>cb_save.clicked</sub>
- 「第行科目不存在！」　条件：`isnull(yjd)` <sub>cb_save.clicked</sub>
- 「第行非明细科目！」　条件：`yjd <> "1"` <sub>cb_save.clicked</sub>
- 「借贷不平！」　条件：`abs(jf - df) > 0.005` <sub>cb_save.clicked</sub>
- 「数据更新失败，不能生成!」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_save.clicked</sub>
- 「凭证生成完成！」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_save.clicked</sub>
- 「您现在采用的是计算机编号，不能进行此项选择！~r~r如果您一定要选择，请先到[套账信息]处修改凭证编号方法！」　条件：`xt_bhsz = "1"` <sub>cbx_1.clicked</sub>
- 「日期不能小于」　条件：`d1 < parent.id_zw_jzrq` <sub>em_2.modified</sub>

### `w_fp_sz`「销项发票参数设置」

- 「销货收入科目非明细科目！」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「服务收入科目非明细科目！」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「销项税科目非明细科目！」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「应收账款科目未选择正确！」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「应收账款科目没有下级科目，你不能选择【自动增加下级科目】的方式！」　条件：`xx = "1"` <sub>cb_ok.clicked</sub>
- 「应收账款科目是非明细科目，你不能选择【所有客户都使用此科目】的方式！」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>

### `w_fp_sz_2`「进项发票参数设置」

- 「原材料科目非明细科目！」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「进项税科目非明细科目！」　条件：`xx <> "1"` <sub>cb_ok.clicked</sub>
- 「应付账款科目未选择正确！」　条件：`xx <> "1" and xx <> "0"` <sub>cb_ok.clicked</sub>
- 「应付账款科目没有下级科目，你不能选择【自动增加下级科目】的方式！」　条件：`xx = "1"` <sub>cb_ok.clicked</sub>
- 「应付账款科目是非明细科目，你不能选择【所有客户都使用此科目】的方式！」　条件：`xx = "0"` <sub>cb_ok.clicked</sub>

### `w_fp_xtcsh`「发票初始化」

- 「初始化后，发票部分的数据将被删除，请确定！」 <sub>cb_1.clicked</sub>
- 「发票模块初始化完成！~r 请进行发票参数设置！」　条件：`xt_dlrq < xt_kzrq` <sub>cb_1.clicked</sub>

### `w_fp_zzs_hz`「增值税比对」

- 「销项税科目非明细科目！~r请到【参数设置】处重新设置」　条件：`xx <> "1"` <sub>窗口事件 open</sub>
- 「进项税科目非明细科目！~r请到【参数设置】处重新设置」　条件：`xx <> "1"` <sub>窗口事件 open</sub>
- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

## 登录

### `w_login`「用户登录」

- 「套账数量超过此版本允许的套，不能运行！」　条件：`xt_zt0 = 5 and i > (gl_tzsl + 1)` <sub>窗口事件 open</sub>
- 「需选择套账！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「此套账不存在！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「非法的操作日期！」　条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"` <sub>cb_ok.clicked</sub>
- 「操作日期小于开帐日期！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>

### `w_login_oem`「用户登录」

- 「套账数量超过此版本允许的套，不能运行！」　条件：`i > (gl_tzsl + 1)` <sub>窗口事件 open</sub>
- 「您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。」　条件：`xt_zt0 = 2` <sub>窗口事件 open</sub>
- 「您的系统已经有最新版本,是否升级?~r(升级将不会影响现有的数据!)~r升级程序运行过程中，如果杀毒软件提示，一定要允许操作!!!」　条件：`messagebox(sappname,"您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。",question!,yesno!,1) = 1` <sub>窗口事件 open</sub>
- 「需选择套账！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「此套账不存在！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「非法的操作日期！」　条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"` <sub>cb_ok.clicked</sub>
- 「操作日期小于开帐日期！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「是否套账名称是乱码，需要解决？」 <sub>ddlb_1.rbuttondown</sub>

### `w_login_qhmk`「用户登录」

- 「套账数量超过此版本允许的套，不能运行！」　条件：`xt_zt0 = 5 and i > (gl_tzsl + 1)` <sub>窗口事件 open</sub>
- 「您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。」　条件：`xt_zt0 = 2` <sub>窗口事件 open</sub>
- 「您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）」　条件：`messagebox(sappname,"您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。",question!,yesno!,1) = 1` <sub>窗口事件 open</sub>
- 「需选择套账！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「此套账不存在！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「非法的操作日期！」　条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"` <sub>cb_ok.clicked</sub>
- 「操作日期小于开帐日期！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「此套账数据量超过试用版容量，请向润衡服务中心购买正式版本！~r      本套账数据会自动平移到正版软件中继续使用。~r      QQ：800003004 ；电话/微信：13312858385 ~r ~r若您已购买正版，可能是加密锁没插好或电脑USB口接触不好 ~r      请换个USB口插并重启电脑后再试试！」　条件：`i > 500` <sub>cb_ok.clicked</sub>

## 工作台

### `w_main1`「主窗口」

- 「请您插入移动端功能所绑定的加密狗，再使用本功能！~r若您的加密狗未绑定，请先到【套账信息】-【移动端设置】开通绑定后再使用。」　条件：`s_no <> gs_no` <sub>st_2.clicked</sub>
- 「您非系统管理员，不能进入操作员管理！~r请使用MANAGER用户登录后再进入此模块！」　条件：`upper(sename) <> "MANAGER" and upper(sename) <> "RUNSOFT"` <sub>st_3_cz.clicked</sub>
- 「您非系统管理员，不能进入套账管理！~r请使用MANAGER用户登录后再进入此模块！」　条件：`upper(sename) <> "MANAGER" and upper(sename) <> "RUNSOFT"` <sub>st_3_gl.clicked</sub>
- 「您非系统管理员，不能进入套帐管理！~r请使用MANAGER用户登录后再进入此模块！」　条件：`upper(sename) <> "MANAGER" and upper(sename) <> "RUNSOFT"` <sub>tab_1/tabpage_3/p_t_3_tz.clicked</sub>

### `w_main1_cb`「主窗口」

- 「第一次使用本模块需要先做系统初始化!」　条件：`kg_bz = "2"` <sub>st_1_cb.clicked</sub>
- 「您非系统管理员，不能进行系统初始化！~r请使用MANAGER用户登录后再做！」　条件：`upper(sename) <> "MANAGER"` <sub>st_1_cb.clicked</sub>
- 「请先做系统初始化!」　条件：`kg_bz = "2"` <sub>st_1_mxz.clicked</sub>

### `w_main1_fp`「主窗口」

- 「请先做系统初始化!」　条件：`kg_bz = "2"` <sub>st_1_cx.clicked</sub>

### `w_main1_gz`「主窗口」

- 「第一次使用本模块需要先做系统初始化!」　条件：`kg_bz = "2"` <sub>st_1_gz.clicked</sub>
- 「您非系统管理员，不能进行系统初始化！~r请使用MANAGER用户登录后再做！」　条件：`upper(sename) <> "MANAGER"` <sub>st_1_gz.clicked</sub>
- 「请先做系统初始化!」　条件：`kg_bz = "2"` <sub>tab_1/tabpage_3/p_t_3_bm.clicked</sub>

### `w_main1_zc`「主窗口」

- 「第一次使用本模块需要先做系统初始化!」　条件：`kg_bz = "2"` <sub>st_1_cx.clicked</sub>
- 「您非系统管理员，不能进行系统初始化！~r请使用MANAGER用户登录后再做！」　条件：`upper(sename) <> "MANAGER"` <sub>st_1_cx.clicked</sub>
- 「请先指定具体的固定资产，再点菜单【统计报表】-【打印资产标签】」 <sub>st_1_fb.clicked</sub>
- 「请先指定具体的固定资产，再点菜单【统计报表】-【附属设备表】」 <sub>st_1_fz.clicked</sub>
- 「请先做系统初始化!」　条件：`kg_bz = "2"` <sub>tab_1/tabpage_3/p_t_3_bm.clicked</sub>

## 其他系统窗口（登录、备份恢复、打印、杂项）

### `w_bb_saveas`「数据导出」

- 「本次共转入」 <sub>窗口事件 ue_action_get</sub>
- 「由于错误，未转入条固定资产数据！」　条件：`r1 > 0` <sub>窗口事件 ue_action_get</sub>
- 「如果出现重复编号部门，是否覆盖(Y/N)?」　条件：`this.is_lx = "bmk"` <sub>窗口事件 ue_action_get</sub>
- 「由于编号重复，未转入条部门档案数据！」　条件：`r1 > 0` <sub>窗口事件 ue_action_get</sub>
- 「如果出现重复编号，是否覆盖(Y/N)?」　条件：`this.is_lx = "grk"` <sub>窗口事件 ue_action_get</sub>
- 「如果出现重复编号，是否覆盖(Y/N)?」　条件：`this.is_lx = "xmk"` <sub>窗口事件 ue_action_get</sub>
- 「由于编号重复，未转入条项目档案数据！」　条件：`r1 > 0` <sub>窗口事件 ue_action_get</sub>
- 「如果出现重复编号，是否覆盖(Y/N)?」　条件：`this.is_lx = "dwk"` <sub>窗口事件 ue_action_get</sub>
- 「由于编号重复，未转入条客户档案数据！」　条件：`r1 > 0` <sub>窗口事件 ue_action_get</sub>
- 「本次共转入条数据！」　条件：`s_bz = "1"` <sub>窗口事件 ue_action_get</sub>
- 「出现重复编号，是否覆盖(Y/N)?」　条件：`this.is_lx = "cbkj_cpda"` <sub>窗口事件 ue_action_get</sub>
- 「本次共转入条产品档案数据！」 <sub>窗口事件 ue_action_get</sub>
- 「由于错误，未转入条产品档案数据！」　条件：`r1 > 0` <sub>窗口事件 ue_action_get</sub>
- 「本次共转入条产品期初数据！」 <sub>窗口事件 ue_action_get</sub>
- 「由于错误，未转入条产品期初数据！」　条件：`r1 > 0` <sub>窗口事件 ue_action_get</sub>
- 「出现重复编号，是否覆盖(Y/N)?」　条件：`this.is_lx = "zw_htda"` <sub>窗口事件 ue_action_get</sub>
- 「本次共转入条合同档案数据！」 <sub>窗口事件 ue_action_get</sub>
- 「由于错误，未转入条合同档案数据！」　条件：`r1 > 0` <sub>窗口事件 ue_action_get</sub>
- 「导入完成！~r 请仔细检查导入的数据，然后【存盘】」 <sub>窗口事件 wf_get_fp_lr</sub>
- 「长度不符合规定！」　条件：`i = (xt_len0 + 1)` <sub>窗口事件 wf_get_kmbm</sub>
- 「的上级科目不存在！」　条件：`i2 = 0` <sub>窗口事件 wf_get_kmbm</sub>
- 「没有同级科目，请先增加后再转此科目！」　条件：`i = 0` <sub>窗口事件 wf_get_kmbm</sub>
- 「本次共转入条科目！」　条件：`sqlca.sqlcode = -1` <sub>窗口事件 wf_get_kmbm</sub>
- 「没有符合条件的科目被导入！」　条件：`sqlca.sqlcode = -1` <sub>窗口事件 wf_get_kmbm</sub>
- 「需要转入的凭证数据有错误(错误显示在审核人处)，是否继续转入(Y/N)?」　条件：`s_bz = "1"` <sub>窗口事件 wf_get_pz</sub>
- 「共转入条凭证分录！」　条件：`l1 > 0` <sub>窗口事件 wf_get_pz</sub>

### `w_err_view`「错误查看」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_frame`「Frame」

- 「结束 ? ~r ~r温馨提示：为了保护您的数据安全，日常工作中建议您做好数据备份。」 <sub>窗口事件 closequery</sub>

### `w_module`「模块维护」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_print_2`「打印」

- 「打印范围无效。」　条件：`(not isnumber(stmp)) or stmp = "" or isnull(stmp)` <sub>cb_ok.clicked</sub>

### `w_xt_dwwh`「客供维护（运行时设置）」

- 「共享DataWindow的数据源可能不一致，请检查。」　条件：`this.dw_master.sharedata(this.dw_detail) = -1` <sub>窗口事件 open</sub>
- 「有数据未存盘, 退出前是否存盘 ?」　条件：`not this.ib_save` <sub>窗口事件 closequery</sub>
- 「是否删除?」　条件：`r < 1` <sub>窗口事件 ue_action_del</sub>
- 「有期初数，不能删除！」　条件：`l > 0` <sub>窗口事件 ue_action_del</sub>
- 「有凭证已使用，不能删除！」　条件：`l > 0` <sub>窗口事件 ue_action_del</sub>
- 「存入失败，数据没有删除。」　条件：`this.dw_master.update() = 1` <sub>窗口事件 ue_action_del</sub>
- 「开始打印吗?」 <sub>窗口事件 ue_action_print</sub>
- 「数据还没有存盘，刷新前是否存盘?」　条件：`this.ib_save = false` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」　条件：`message.returnvalue = 1` <sub>窗口事件 ue_action_refresh</sub>
- 「此处数据错误，请重新输入。」　条件：`this.dw_detail.accepttext() = -1` <sub>窗口事件 ue_action_save</sub>
- 「您的编码长度不符合规则！」　条件：`ret = -1` <sub>窗口事件 wf_itemchanged</sub>
- 「数据还没有存盘，刷新前是否存盘?」　条件：`ib_save = false` <sub>tab_1/tabpage_1/dw_master.ue_action_refresh</sub>

### `wroot_dw_query`「条件搜索」

- 「,请改正」　条件：`i > 0` <sub>dw_where.ue_where</sub>
- 「不是字符型,不能使用<含有>或<不含有>操作符」　条件：`trim(soper) = "like" or trim(soper) = "not like"` <sub>dw_where.ue_where</sub>
- 「的值应为数字型,请改正」　条件：`isnumber(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`not isdate(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`svalue = "error"` <sub>dw_where.ue_where</sub>
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
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`not isdate(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`svalue = "error"` <sub>dw_where.ue_where</sub>
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

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>

## 打印预览

### `w_preview_fp`「打印预览」

- 「没有记录，无法显示及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 open</sub>
- 「DW考贝出错！」　条件：`errorcode = -1` <sub>窗口事件 open</sub>

## 全局函数中的提示

### 全局函数 `f_bb_get`

- 「报表格式文件错误！」　条件：`isnull(ret) or ret < 50`
- 「报表格式文件错误！」　条件：`left(as_indicator,8) <> "c:\temp\"`

### 全局函数 `f_bb_get_1`

- 「报表格式文件错误!」　条件：`isnull(ret) or ret < 50`
- 「报表格式文件错误!」　条件：`left(as_indicator,8) <> "c:\temp\"`

### 全局函数 `f_bb_get_cn`

- 「报表格式文件错误！」　条件：`isnull(ret) or ret < 50`
- 「报表格式文件错误！」　条件：`left(as_indicator,8) <> "c:\temp\"`

### 全局函数 `f_bb_get_gs`

- 「报表格式文件错误！」　条件：`isnull(ret) or ret < 50`
- 「报表格式文件错误！」　条件：`left(as_indicator,8) <> "c:\temp\"`

### 全局函数 `f_bb_get_pos`

- 「报表格式文件错误！」　条件：`isnull(ret) or ret < 50`
- 「报表格式文件错误！」　条件：`left(as_indicator,8) <> "c:\temp\"`

### 全局函数 `f_bb_get_tz`

- 「报表格式文件错误！」　条件：`isnull(ret) or ret < 50`
- 「报表格式文件错误！」　条件：`left(as_indicator,8) <> "c:\temp\"`

### 全局函数 `f_bb_save`

- 「报表文件不存在！」　条件：`fileexists(ls_filename) = false`

### 全局函数 `f_bb_save_01`

- 「报表文件不存在！」　条件：`fileexists(ls_filename) = false`

### 全局函数 `f_bb_save_bak`

- 「报表文件不存在！」　条件：`fileexists(ls_filename) = false`

### 全局函数 `f_bb_save_cn`

- 「报表文件不存在！」　条件：`fileexists(ls_filename) = false`

### 全局函数 `f_bb_save_gs`

- 「报表文件不存在！」　条件：`fileexists(ls_filename) = false`

### 全局函数 `f_bb_save_gs_bak`

- 「报表文件不存在！」　条件：`fileexists(ls_filename) = false`

### 全局函数 `f_bb_save_pos`

- 「报表文件不存在！」　条件：`fileexists(ls_filename) = false`

### 全局函数 `f_bbh_pd`

- 「版本低，请先升级软件！~r当前软件的版本是：」　条件：`r > 365`

### 全局函数 `f_check_required`

- 「为空值, 请输入数据」　条件：`row <> 0`

### 全局函数 `f_get_101`

- 「您的加密锁没有插好或者损坏！」　条件：`res = 4294967295`

### 全局函数 `f_getaccountlist`

- 「行业科目库未指定！」　条件：`isnull(li_filenum)`
- 「行业科目库无内容！」
- 「行业科目库打开出错，错误代码：」
- 「行业科目库打开出错，错误代码：」

### 全局函数 `f_ini_account`

- 「读取档案文件出错,错误代码：」　条件：`sqlca.sqlcode = -1`
- 「读取档案文件出错,错误代码：」　条件：`sqlca.sqlcode = -1`
- 「读取档案文件出错,错误代码：」　条件：`sqlca.sqlcode = -1`
- 「读取档案文件出错,错误代码：」　条件：`sqlca.sqlcode = -1`
- 「读取档案文件出错,错误代码：」　条件：`sqlca.sqlcode = -1`
- 「读取档案文件出错,错误代码：」　条件：`sqlca.sqlcode = -1`

### 全局函数 `f_ini_account_bak`

- 「读取档案文件出错,错误代码：」　条件：`sqlca.sqlcode = -1`
- 「读取档案文件出错,错误代码：」　条件：`sqlca.sqlcode = -1`
- 「读取档案文件出错,错误代码：」　条件：`sqlca.sqlcode = -1`
- 「读取档案文件出错,错误代码：」　条件：`sqlca.sqlcode = -1`
- 「读取档案文件出错,错误代码：」　条件：`sqlca.sqlcode = -1`
- 「读取档案文件出错,错误代码：」　条件：`sqlca.sqlcode = -1`

### 全局函数 `f_next_code`

- 「错误: old_code的长度超过了code_len，返回空串。」　条件：`len(string(double(old_code))) > code_len`

### 全局函数 `f_pzbh_zl`

- 「编号整理后将不能再恢复，是否进行?」
- 「无此类型凭证，不需要重新排号！」　条件：`ret = 0`

### 全局函数 `f_sa_conn_info`

- 「declare c」　条件：`sqlca.sqlcode <> 0`

### 全局函数 `f_save`

- 「是否提换现有的文件？」　条件：`i = 1`

### 全局函数 `f_saveas`

- 「是否提换现有的文件？」　条件：`i = 1`

### 全局函数 `f_system_backup`

- 「数据未能转出，请查看数据源是否在本地的机器上！」　条件：`fileexists("c:\temp\temp.txt")`
- 「数据备份过程有疑问！~r请确认是否在数据库安装的机器中进行备份~r是否继续备份？」　条件：`r = (2 * r0)`
- 「备份未完成！」　条件：`tz_bz = "1"`
- 「压缩文件太大，请备份到其他盘上！」　条件：`upper(left(as_filename,2)) = "A:" and r > 1440000`

### 全局函数 `f_x_pz_cy`

- 「财务部分金额不等于预算部分金额，是否确认？」　条件：`bz1 = "0"`
- 「财务收入金额不等于预算收入金额，是否确认？」　条件：`bz1 = "0"`
- 「财务支出金额不等于预算支出金额，是否确认？」　条件：`bz1 = "0"`

### 全局函数 `f_x_pz_cy_bak`

- 「财务部分金额不等于预算部分金额，是否确认？」　条件：`bz1 = "0"`

### 全局函数 `f_ydjz_1_bak`

- 「结转类型定义有误！转入科目数不等于 1 个！」　条件：`i <> 1`
- 「结转类型定义有误！转出科目数小于 1 个！」　条件：`i < 1`
- 「结转类型定义有误！转入科目数为非明细科目！」　条件：`yjd <> "1"`

### 全局函数 `f_ydjz_1_bak1`

- 「结转类型定义有误！转入科目数不等于 1 个！」　条件：`i <> 1`
- 「结转类型定义有误！转出科目数小于 1 个！」　条件：`i < 1`
- 「结转类型定义有误！转入科目数为非明细科目！」　条件：`yjd <> "1"`

### 全局函数 `f_ydjz_1_new_bak`

- 「结转类型定义有误！转入科目数不等于 1 个！」　条件：`i <> 1`
- 「结转类型定义有误！转出科目数小于 1 个！」　条件：`i < 1`
- 「结转类型定义有误！转入科目数为非明细科目！」　条件：`yjd <> "1"`

### 全局函数 `f_zw_gdzc_jz`

- 「固定资产模块计提折旧仅到~r     是否继续进行？」　条件：`(i_nf * 100 + i_yf) < (nf * 100 + yf)`
- 「账务模块的固定资产原值和固定资产模块的原值不一致！~r【账务原值：」　条件：`abs(d_1 - d_yz) > 0.005`
- 「账务模块的累计折旧和固定资产模块的累计折旧不一致！~r【账务折旧：」　条件：`abs(d_2 - d_ljzj) > 0.005`
