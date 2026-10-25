# 民非企 · 账务主程序（民非专版） — 业务规则与提示语（按窗口）

从 MessageBox 调用提取。“条件”取提示语之前最近的 if 条件，是静态近似；嵌套分支需对照源码复核。这类提示通常表示操作被阻止或需要用户确认。

## 报表

### `w_bb_add`「增加报表」

- 「分套帐100以内的报表由主套帐设定！」　条件：`xh < 100` <sub>cb_ok.clicked</sub>
- 「报表编码应当小于1000！」　条件：`xh >= 1000` <sub>cb_ok.clicked</sub>
- 「报表编码重复！」　条件：`i > 0` <sub>cb_ok.clicked</sub>
- 「没有输入表名!」　条件：`len(trim(parent.sle_name.text)) = 0` <sub>cb_ok.clicked</sub>
- 「文件  不存在或读入错！」　条件：`ftp = -1` <sub>cb_ok.clicked</sub>
- 「行数和列数不能为零!」 <sub>cb_ok.clicked</sub>
- 「最大列数为 250 !」　条件：`integer(this.text) > 250` <sub>em_col.modified</sub>
- 「最大行数为 999 !」　条件：`integer(this.text) > 999` <sub>em_row.modified</sub>

### `w_bb_add_gs`「增加打印格式」

- 「格式编码应当小于100！」　条件：`xh >= 100` <sub>cb_ok.clicked</sub>
- 「格式编码重复！」　条件：`i > 0` <sub>cb_ok.clicked</sub>
- 「没有输入名称!」　条件：`len(trim(parent.sle_name.text)) = 0` <sub>cb_ok.clicked</sub>
- 「文件  不存在或读入错！」　条件：`ftp = -1` <sub>cb_ok.clicked</sub>
- 「行数和列数不能为零!」 <sub>cb_ok.clicked</sub>
- 「最大列数为 250 !」　条件：`integer(this.text) > 250` <sub>em_col.modified</sub>
- 「最大行数为 999 !」　条件：`integer(this.text) > 999` <sub>em_row.modified</sub>

### `w_bb_copy`「报表复制」

- 「分套账100以内的报表由主套帐设定！」　条件：`xh < 100` <sub>cb_ok.clicked</sub>
- 「报表编码应当小于1000！」　条件：`xh >= 1000` <sub>cb_ok.clicked</sub>
- 「报表编码重复!」　条件：`i > 0` <sub>cb_ok.clicked</sub>
- 「没有选择源表!」　条件：`len(trim(parent.ddlb_bb.text)) = 0` <sub>cb_ok.clicked</sub>
- 「没有输入表名!」　条件：`len(trim(parent.sle_name.text)) = 0` <sub>cb_ok.clicked</sub>
- 「套账的报表没有在数据库里！~r请切换到套账，看一下报表是否存在！」　条件：`bz1 = "0" or r = 0` <sub>cb_ok.clicked</sub>
- 「第张报表没有在数据库里，无法复制！」　条件：`bz1 = "0" or r = 0` <sub>cb_ok.clicked</sub>
- 「请选择套帐！」　条件：`isnull(id) or id = ""` <sub>ddlb_1.selectionchanged</sub>

### `w_bb_copy_gs`「打印格式复制」

- 「格式编码应当小于100！」　条件：`xh >= 100` <sub>cb_ok.clicked</sub>
- 「编码重复!」　条件：`i > 0` <sub>cb_ok.clicked</sub>
- 「没有选择格式!」　条件：`len(trim(parent.ddlb_bb.text)) = 0` <sub>cb_ok.clicked</sub>
- 「没有输入名称!」　条件：`len(trim(parent.sle_name.text)) = 0` <sub>cb_ok.clicked</sub>
- 「套账的报表没有在数据库里，请切换到套账，看一下报表是否存在！」　条件：`bz1 = "0" or r = 0` <sub>cb_ok.clicked</sub>
- 「第张报表没有在数据库里，无法复制！」　条件：`bz1 = "0" or r = 0` <sub>cb_ok.clicked</sub>
- 「请选择套帐！」　条件：`isnull(id) or id = ""` <sub>ddlb_1.selectionchanged</sub>

### `w_bb_def`「报表定义」

- 「是否保存所作的修改？」　条件：`this.ib_1 = true` <sub>窗口事件 u_open</sub>
- 「是否提换现有的文件？」　条件：`i = 1` <sub>窗口事件 u_save_as</sub>
- 「打印标题已清除！」 <sub>窗口事件 u_clearprinttitle</sub>
- 「请打开【深圳国税报税接口标准报表】报表，再进入报税接口！」　条件：`bbtext <> "深圳国税报税接口标准报表"` <sub>窗口事件 u_jk</sub>
- 「请先生成报表，再进入报税接口！」　条件：`this.zh_bz <> "2"` <sub>窗口事件 u_jk</sub>
- 「上报的财务报表已经生成：」 <sub>窗口事件 u_jk</sub>
- 「其他会计准则的上报格式正在测试中！」 <sub>窗口事件 u_jk</sub>
- 「是否保存所作的修改？」　条件：`this.zh_bz <> "1"` <sub>窗口事件 closequery</sub>
- 「文件  不存在或读入错！」　条件：`ftp = -1` <sub>窗口事件 wf_open</sub>
- 「请再按左上角菜单栏 【生成】 按钮！」　条件：`this.ib_1 = false and this.zh_bz = "1"` <sub>窗口事件 wf_open</sub>
- 「是否保存所作的修改？」　条件：`parent.ib_1 = true` <sub>ddlb_bb.selectionchanged</sub>

### `w_bb_def_cn`「格式定义」

- 「第行的日期」　条件：`string(d1,"yyyy-mm-dd") < (xt_jzyf + "-01")` <sub>窗口事件 ue_action_get</sub>
- 「本次共转入」　条件：`s_b1 = "1"` <sub>窗口事件 ue_action_get</sub>
- 「没有符合条件的数据被转入！」　条件：`s_b1 = "1"` <sub>窗口事件 ue_action_get</sub>
- 「请先确认文件是否存在(Y/N)?」 <sub>窗口事件 ue_action_read</sub>
- 「本次共转入条部门信息！」　条件：`s_b1 = "1"` <sub>窗口事件 wf_get_bmk</sub>
- 「没有符合条件的部门信息被导入！」　条件：`s_b1 = "1"` <sub>窗口事件 wf_get_bmk</sub>
- 「本次共转入条产品信息！」　条件：`s_b1 = "1"` <sub>窗口事件 wf_get_cpda</sub>
- 「没有符合条件的产品信息被导入！」　条件：`s_b1 = "1"` <sub>窗口事件 wf_get_cpda</sub>
- 「本次共转入条客户信息！」　条件：`s_b1 = "1"` <sub>窗口事件 wf_get_dwk</sub>
- 「没有符合条件的客户信息被导入！」　条件：`s_b1 = "1"` <sub>窗口事件 wf_get_dwk</sub>
- 「本次共转入条人员信息！」　条件：`s_b1 = "1"` <sub>窗口事件 wf_get_grk</sub>
- 「没有符合条件的人员信息被导入！」　条件：`s_b1 = "1"` <sub>窗口事件 wf_get_grk</sub>
- 「长度不符合规定！」　条件：`i = 7` <sub>窗口事件 wf_get_kmbm</sub>
- 「的上级科目不存在！」　条件：`i2 = 0` <sub>窗口事件 wf_get_kmbm</sub>
- 「没有同级科目，请先增加后再转此科目！」　条件：`i = 0` <sub>窗口事件 wf_get_kmbm</sub>
- 「本次共转入条科目！」　条件：`sqlca.sqlcode = -1` <sub>窗口事件 wf_get_kmbm</sub>
- 「没有符合条件的科目被导入！」　条件：`sqlca.sqlcode = -1` <sub>窗口事件 wf_get_kmbm</sub>
- 「本次共转入条项目信息！」　条件：`s_b1 = "1"` <sub>窗口事件 wf_get_xmk</sub>
- 「没有符合条件的项目信息被导入！」　条件：`s_b1 = "1"` <sub>窗口事件 wf_get_xmk</sub>
- 「文件  不存在或读入错！」　条件：`ftp = -1` <sub>窗口事件 wf_open</sub>

### `w_bb_def_gs`「打印格式定义」

- 「是否保存所作的修改？」　条件：`xt_cs3 = "1"` <sub>窗口事件 u_open</sub>
- 「是否保存所作的修改？」 <sub>窗口事件 closequery</sub>
- 「文件  不存在或读入错！」　条件：`ftp = -1` <sub>窗口事件 wf_open</sub>

### `w_bb_def_help`「报表函数向导」

- 「报表函数缺 ')' !」　条件：`position <> 0` <sub>窗口事件 fun_v</sub>
- 「括号不匹配!」　条件：`j > this.point` <sub>窗口事件 fun_v</sub>
- 「计算项之间无运算符!」　条件：`pp > this.point` <sub>窗口事件 fun_v</sub>
- 「计算项之间无运算符!」 <sub>窗口事件 fun_v</sub>
- 「报表函数不存在」　条件：`this.token[i] > "9" or this.token[i] < "0"` <sub>窗口事件 getdata</sub>
- 「计算项之间无运算符」　条件：`this.toktmp[pp] = "-"` <sub>窗口事件 qutproc</sub>
- 「括号不匹配」　条件：`ep > this.point` <sub>窗口事件 qutproc</sub>
- 「校验正确!」　条件：`i = 0` <sub>cb_3.clicked</sub>
- 「11」 <sub>mle_1.u_key</sub>

### `w_bb_get`「报表引入向导」

- 「请按【查找备份文件...】搜索以前做的备份文件！」　条件：`isnull(ls_filename) or trim(ls_filename) = ""` <sub>cb_1.clicked</sub>
- 「分套账100以内的报表由主套帐设定！」　条件：`xh < 100` <sub>cb_ok.clicked</sub>
- 「报表编码应当小于1000！」　条件：`xh >= 1000` <sub>cb_ok.clicked</sub>
- 「报表编码重复!」　条件：`i > 0` <sub>cb_ok.clicked</sub>
- 「没有选择源表!」　条件：`len(trim(parent.ddlb_bb.text)) = 0` <sub>cb_ok.clicked</sub>
- 「没有输入表名!」　条件：`len(trim(parent.sle_name.text)) = 0` <sub>cb_ok.clicked</sub>
- 「数据错误001，无法引入！」　条件：`bz1 = "0" or r = 0` <sub>cb_ok.clicked</sub>
- 「数据错误002，无法引入！」　条件：`r < 1` <sub>cb_ok.clicked</sub>
- 「报表引入成功！~r是否继续引入(Y/N)?」　条件：`s_bz = "0"` <sub>cb_ok.clicked</sub>

### `w_bb_htpj_gs`「特殊打印」

- 「文件  不存在或读入错！」　条件：`ftp = -1` <sub>窗口事件 open</sub>
- 「报表函数缺 ')' !」　条件：`this.c00 >= 26` <sub>窗口事件 formuproc</sub>
- 「除数为零!」　条件：`this.c00 >= 26` <sub>窗口事件 formuproc</sub>
- 「计算项之间无运算符」　条件：`this.c00 >= 26` <sub>窗口事件 formuproc</sub>

### `w_bb_main`「报表管理」

- 「100以内的报表由主套帐确定，不能删除！」　条件：`bbindex < 100` <sub>cb_3.clicked</sub>
- 「是否删除  ？」　条件：`bbindex < 100` <sub>cb_3.clicked</sub>
- 「100以内的报表由主套帐确定，不能修改！」　条件：`bbindex < 100` <sub>cb_7.clicked</sub>
- 「编码重复！是否重输？」　条件：`sqldbcode = -196` <sub>dw_1.dberror</sub>
- 「数据窗口出错！」　条件：`i = 1` <sub>dw_1.dberror</sub>

### `w_bb_main_bhxg`「修改编号」

- 「编号重复！」　条件：`i > 0` <sub>cb_1.clicked</sub>

### `w_bb_main_gs`「特殊打印格式管理」

- 「是否删除  ？」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_3.clicked</sub>

### `w_bb_proc`「报表生成」

- 「公式错误」　条件：`this.c00 > 26` <sub>窗口事件 formuproc</sub>
- 「报表函数缺 ')' !」　条件：`this.c00 > 26` <sub>窗口事件 formuproc</sub>
- 「除数为零!」　条件：`this.c00 > 26` <sub>窗口事件 formuproc</sub>
- 「计算项之间无运算符」　条件：`this.c00 > 26` <sub>窗口事件 formuproc</sub>

### `w_bb_proc_gs`「报表生成」

- 「报表函数缺 ')' !」　条件：`this.c00 >= 26` <sub>窗口事件 formuproc</sub>
- 「除数为零!」　条件：`this.c00 >= 26` <sub>窗口事件 formuproc</sub>
- 「计算项之间无运算符」　条件：`this.c00 >= 26` <sub>窗口事件 formuproc</sub>

### `w_bb_proc_pos_bak`「报表生成」

- 「报表函数缺 ')' !」　条件：`this.c00 >= 26` <sub>窗口事件 formuproc</sub>
- 「除数为零!」　条件：`this.c00 >= 26` <sub>窗口事件 formuproc</sub>
- 「计算项之间无运算符」　条件：`this.c00 >= 26` <sub>窗口事件 formuproc</sub>

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

## 数据备份

### `w_bf`「数据备份」

- 「压缩文件太大，请备份到其他盘上！」　条件：`upper(left(as_filename,2)) = "A:" and r > 1440000` <sub>窗口事件 wf_bf</sub>
- 「请选择备份文件名字！」　条件：`isnull(as_filename) or trim(as_filename) = ""` <sub>cb_1.clicked</sub>
- 「报表文件不存在！」　条件：`fileexists(ls_filename) = false` <sub>cb_1.clicked</sub>
- 「打印格式文件不存在！」　条件：`fileexists(ls_filename) = false` <sub>cb_1.clicked</sub>
- 「打印格式文件不存在！」　条件：`gs_cp = "成本会计" or gs_cp = "基建财务"` <sub>cb_1.clicked</sub>
- 「备份完毕！」　条件：`parent.inv_comp.of_writefile(as_filename,lbl_ok) < 0` <sub>cb_1.clicked</sub>
- 「是否提换现有的文件？」　条件：`i = 1` <sub>cb_3.clicked</sub>

### `w_bf_98001`「审计导出」

- 「需要导出的会计年度 小于 系统的开账日期！」　条件：`nf < year(xt_kzrq)` <sub>cb_1.clicked</sub>
- 「系统自动建立导出审计资料文件夹失败！请手工添加文件夹：」　条件：`not ll.uf_directory_isavailable(path)` <sub>cb_1.clicked</sub>
- 「导出完毕！」 <sub>cb_1.clicked</sub>
- 「连接Excel表出错,请重新选择」　条件：`ll_rtn <> 0` <sub>cb_4.clicked</sub>
- 「报表文件不存在！」　条件：`fileexists(ls_filename) = false` <sub>cb_4.clicked</sub>
- 「报表格式文件错误！」　条件：`isnull(r) or r < 50` <sub>cb_4.clicked</sub>
- 「报表格式文件错误！」　条件：`left(as_indicator,8) <> "c:\temp\"` <sub>cb_4.clicked</sub>

### `w_bf_98001_bak`「审计接口」

- 「需要导出的会计年度 小于 系统的开账日期！」　条件：`nf < year(xt_kzrq)` <sub>窗口事件 wf_out_2010</sub>
- 「系统自动建立导出审计资料文件夹失败！请手工添加文件夹：」　条件：`not ll.uf_directory_isavailable(path)` <sub>窗口事件 wf_out_2010</sub>
- 「导出完毕！」 <sub>窗口事件 wf_out_2010</sub>
- 「连接Excel表出错,请重新选择」　条件：`ll_rtn <> 0` <sub>窗口事件 wf_out_dxr</sub>
- 「报表文件不存在！」　条件：`fileexists(ls_filename) = false` <sub>窗口事件 wf_out_dxr</sub>
- 「报表格式文件错误！」　条件：`isnull(r) or r < 50` <sub>窗口事件 wf_out_dxr</sub>
- 「报表格式文件错误！」　条件：`left(as_indicator,8) <> "c:\temp\"` <sub>窗口事件 wf_out_dxr</sub>

## 财务分析

### `w_fx_copy`「报表复制」

- 「请选择套帐！」　条件：`isnull(tzh) or tzh = ""` <sub>cb_ok.clicked</sub>
- 「财务分析编码重复!」　条件：`i > 0` <sub>cb_ok.clicked</sub>
- 「没有选择源表!」　条件：`len(trim(parent.ddlb_bb.text)) = 0` <sub>cb_ok.clicked</sub>
- 「没有输入表名!」　条件：`len(trim(parent.sle_name.text)) = 0` <sub>cb_ok.clicked</sub>
- 「请选择套帐！」　条件：`isnull(id) or id = ""` <sub>ddlb_1.selectionchanged</sub>

### `w_fx_def`「财务分析定义」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>
- 「此处数据错误，请重新输入。」　条件：`this.accepttext() = -1` <sub>dw_master.ue_action_save</sub>

### `w_fx_demo`「财务分析」

- 「数据错误，基数为零！」　条件：`err_bz = "0"` <sub>窗口事件 open</sub>
- 「报表函数缺 ')' !===」　条件：`position <> 0` <sub>窗口事件 formuproc</sub>
- 「除数为零!」 <sub>窗口事件 formuproc</sub>
- 「计算项之间无运算符==」　条件：`this.token[pp] = "-"` <sub>窗口事件 formuproc</sub>
- 「计算项之间无运算符==」　条件：`this.toktmp[pp] = "-"` <sub>窗口事件 qutproc</sub>

### `w_fx_demo_tx`「图形分析」

- 「是否彩色打印机？」 <sub>cb_2.clicked</sub>

### `w_fx_km`「财务分析表」

- 「此科目不存在！」　条件：`i = 0` <sub>cb_1.clicked</sub>

### `w_fx_main`「财务分析」

- 「财务分析系统建立失败！」　条件：`i = -1` <sub>窗口事件 open</sub>
- 「是否删除  ？」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_3.clicked</sub>

### `w_fx_nd`「年度分析表」

- 「此科目不存在！」　条件：`i = 0` <sub>cb_1.clicked</sub>

### `w_fx_nd_1`「年度分析表」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_fx_yd`「月度分析表」

- 「此科目不存在！」　条件：`i = 0` <sub>cb_1.clicked</sub>

### `w_fx_yd_1`「年度分析表」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

## 工资

### `w_gz_bmwh`「部门维护」

- 「该部门已使用，不能被删除！」　条件：`isnull(bmbm) = false` <sub>cb_2.clicked</sub>
- 「删除该部门吗？」　条件：`isnull(bmbm) = false` <sub>cb_2.clicked</sub>
- 「数据更数失败!」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_3.clicked</sub>

### `w_gz_edit_set`「统一置数」

- 「设置完毕！」 <sub>cb_3.clicked</sub>

### `w_gz_gzgl`「工资管理」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>
- 「2018年10月开始，个税起征点已经提高到了5000元了。~r您设置的仅仅为」　条件：`xt_jsje < 5000` <sub>窗口事件 ue_action_com</sub>
- 「2011年9月开始，个税起征点已经提高到了3500元了。~r您设置的仅仅为」　条件：`xt_jsje < 3500` <sub>窗口事件 ue_action_com</sub>
- 「2011年9月之前，个税起征点还没有提高到3500元了。~r您现在设置的是」　条件：`xt_jsje >= 3500` <sub>窗口事件 ue_action_com</sub>
- 「2018年10月之前，个税起征点还没有提高到5000元了。~r您现在设置的是」　条件：`xt_jsje >= 5000` <sub>窗口事件 ue_action_com</sub>
- 「计算个所得税的公式只能有一条，请检查公式！」　条件：`i > 1` <sub>窗口事件 ue_action_com</sub>
- 「请先在套帐信息处设置个税起征点！」　条件：`xt_jsje = 0` <sub>窗口事件 ue_action_com</sub>
- 「语法错」　条件：`sqlca.sqlcode = -1` <sub>窗口事件 ue_action_com</sub>
- 「语法错today函数少')'!」　条件：`j = 0` <sub>窗口事件 ue_action_com</sub>
- 「语法错today函数少'('!」　条件：`k = 0 or k > j` <sub>窗口事件 ue_action_com</sub>
- 「语法错daybefore函数少')'!」　条件：`j = 0` <sub>窗口事件 ue_action_com</sub>
- 「语法错daybefore函数少'('!」　条件：`k = 0 or k > j` <sub>窗口事件 ue_action_com</sub>
- 「语法错daybefore函数少','!」　条件：`pos(gsmc,",",i) = 0 or pos(gsmc,",",i) > j or pos(gsmc,",",i) < k` <sub>窗口事件 ue_action_com</sub>
- 「语法错daybefore函数少参数!」　条件：`trim(mid(gsmc,k + 1,l - k - 1)) = "" or trim(mid(gsmc,l + 1,j - l - 1)) = ""` <sub>窗口事件 ue_action_com</sub>
- 「语法错monthbefore函数少')'!」　条件：`j = 0` <sub>窗口事件 ue_action_com</sub>
- 「语法错monthbefore函数少'('!」　条件：`k = 0 or k > j` <sub>窗口事件 ue_action_com</sub>
- 「语法错monthbefore函数少','!」　条件：`pos(gsmc,",",i) = 0 or pos(gsmc,",",i) > j or pos(gsmc,",",i) < k` <sub>窗口事件 ue_action_com</sub>
- 「语法错monthbefore函数少参数!」　条件：`trim(mid(gsmc,k + 1,l - 1)) = "" or trim(mid(gsmc,l + 1,j - 1)) = ""` <sub>窗口事件 ue_action_com</sub>
- 「是否删除  ?」　条件：`l = 0` <sub>dw_master.ue_action_del</sub>
- 「存入失败，数据没有删除。」　条件：`this.update() = 1` <sub>dw_master.ue_action_del</sub>

### `w_gz_prt_gzb`「打印工资表」

- 「没有数据选中！请重选」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_1.u_1</sub>

### `w_gz_prt_pm`「票面计算」

- 「语法错」　条件：`sqlca.sqlcode = -1` <sub>cb_1.clicked</sub>

### `w_gz_qxfz`「取消结帐」

- 「已到初始开帐日期，无需反过账！」　条件：`xt_jzyf <= string(xt_kzrq,"yyyy.mm")` <sub>窗口事件 open</sub>

### `w_gz_rsgl`「人事管理」

- 「是否删除  ?」　条件：`l = 0` <sub>dw_master.ue_action_del</sub>
- 「存入失败，数据没有删除。」　条件：`this.update() = 1` <sub>dw_master.ue_action_del</sub>

### `w_gz_rsgl_ins`「增加员工」

- 「人员编号未输入！」　条件：`isnull(xx) or xx = ""` <sub>cb_2.clicked</sub>
- 「编号重复！」　条件：`l > 0` <sub>cb_2.clicked</sub>
- 「姓名未输入！」　条件：`isnull(xx) or xx = ""` <sub>cb_2.clicked</sub>

### `w_gz_rsgl_xg`「修改编号」

- 「编号重复！」　条件：`i > 0` <sub>cb_1.clicked</sub>

### `w_gz_zhcx`「工资综合查询」

- 「,请改正；  否则，所有查询条件将被忽略。」　条件：`i > 0` <sub>dw_where.ue_where</sub>
- 「不是字符型,不能使用<含有>或<不含有>操作符,  请改正; 否则，所有查询条件将被忽略。」　条件：`trim(soper) = "like" or trim(soper) = "not like"` <sub>dw_where.ue_where</sub>
- 「的值应为数字型,请改正；  否则，所有查询条件将被忽略。」　条件：`isnumber(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`not isdate(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`svalue = "error"` <sub>dw_where.ue_where</sub>
- 「这个数据类型未在本模块中定义。」 <sub>dw_where.ue_where</sub>

## 辅助核算/往来

### `w_ht_htda`「合同档案管理」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>
- 「需要本人来取消审核！」　条件：`shr = u_name or shr = ""` <sub>窗口事件 ue_action_sh</sub>
- 「此处数据错误，请重新输入。」　条件：`this.accepttext() = -1` <sub>dw_master.ue_action_save</sub>
- 「存入失败，数据没有删除。」　条件：`this.update() = 1` <sub>dw_master.ue_action_del</sub>
- 「此合同已经使用，不能删除！」　条件：`r > 0` <sub>dw_master.ue_action_del</sub>
- 「删除本条数据，请确认。」　条件：`r > 0` <sub>dw_master.ue_action_del</sub>

## 登录

### `w_login`「用户登录」

- 「套账数量超过此版本允许的套，不能运行！」　条件：`xt_zt0 = 5 and i > (gl_tzsl + 1)` <sub>窗口事件 open</sub>
- 「您的系统已经有新版本,是否升级?」　条件：`d_1 <= today()` <sub>窗口事件 open</sub>
- 「需选择套账！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「此套账不存在！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「非法的操作日期！」　条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"` <sub>cb_ok.clicked</sub>
- 「操作日期小于开帐日期！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「此套账数据量超过试用版容量，请向润衡服务中心购买正式版本！~r      本套账数据会自动平移到正版软件中继续使用。~r   QQ：800003004 ；电话/微信：13312858385/13725250021 ~r ~r若您已购买正版，可能是加密锁没插好或电脑USB口接触不好 ~r      请换个USB口插并重启电脑后再试试！」　条件：`i > 500` <sub>cb_ok.clicked</sub>
- 「此套账不含固定资产系统！是否建立？」　条件：`i = 0` <sub>cb_ok.clicked</sub>
- 「固定资产系统建立失败！」　条件：`i = -1` <sub>cb_ok.clicked</sub>
- 「操作日期小于开帐日期！开帐日期:」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「操作日期小于结帐日期！结帐日期:」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「未结转」　条件：`left(parent.em_1.text,4) <> left(xt_jzyf,4) or mid(parent.em_1.text,6,2) <> mid(xt_jzyf,6,2)` <sub>cb_ok.clicked</sub>
- 「此套账数据量超过本版本容量，请向润衡服务中心购买正式版本！~r      本套账数据会自动平移到正式版本软件中继续使用。~r      QQ：160239242 ；值班电话：13312858385」　条件：`i > 500` <sub>cb_ok.clicked</sub>
- 「此套账不含工资系统！是否建立？」　条件：`i = 0` <sub>cb_ok.clicked</sub>
- 「工资系统建立失败！」　条件：`i = -1` <sub>cb_ok.clicked</sub>
- 「操作日期小于开帐日期！~r开帐日期:」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「操作日期小于结帐日期！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「才结转」　条件：`integer(left(parent.em_1.text,4)) <> (integer(left(xt_jzyf,4)) + 1) or integer(mid(parent.em_1.text,6,2)) <> 1` <sub>cb_ok.clicked</sub>
- 「未结转」　条件：`month(xt_dlrq) <> (integer(mid(xt_jzyf,6,2)) + 1) or left(parent.em_1.text,4) <> left(xt_jzyf,4)` <sub>cb_ok.clicked</sub>
- 「您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。」　条件：`xt_zt0 = 2` <sub>cb_sj.clicked</sub>
- 「您的系统已经有新版本,是否升级?~r    (升级将不会影响现有的数据!)~r升级程序运行过程中，如果杀毒软件提示，一定要允许操作!!!」　条件：`messagebox(sappname,"您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。",question!,yesno!,1) = 1` <sub>cb_sj.clicked</sub>
- 「恭喜您，您的版本是最新版本，无需升级！」　条件：`messagebox(sappname,"  您的系统已经有新版本,是否升级?~r    (升级将不会影响现有的数据!)~r升级程序运行过程中，如果杀毒软件提示，一定要允许操作!!!",question!,yesno!,2) = 1` <sub>cb_sj.clicked</sub>
- 「是否套账名称是乱码，需要解决？」 <sub>ddlb_1.rbuttondown</sub>

### `w_login_1`「切换用户」

- 「操作易人成功！~r现在操作员为」 <sub>cb_ok.clicked</sub>
- 「是否套账名称是乱码，需要解决？」 <sub>sle_id.rbuttondown</sub>

### `w_login_oem`「用户登录」

- 「套账数量超过此版本允许的套，不能运行！」　条件：`i > (gl_tzsl + 1)` <sub>窗口事件 open</sub>
- 「需选择套账！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「此套账不存在！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「非法的操作日期！」　条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"` <sub>cb_ok.clicked</sub>
- 「操作日期小于开帐日期！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「此套账数据量超过本版本容量，请向购买正式版本！~r      本套账数据会自动平移到正式版本软件中继续使用。~r      ；」　条件：`i > 500` <sub>cb_ok.clicked</sub>
- 「是否套账名称是乱码，需要解决？」 <sub>ddlb_1.rbuttondown</sub>

### `w_login_qhmk`「用户登录（继承自祖先）」

- 「非法的操作日期！」　条件：`string(xt_dlrq,"yyyy.mm.dd") = "1900.01.01"` <sub>cb_ok.clicked</sub>
- 「操作日期小于开帐日期！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「此套账的数据量超过试用版的要求，请购买正式版本！」　条件：`i > 500` <sub>cb_ok.clicked</sub>
- 「此套账不含固定资产系统！是否建立？」　条件：`i = 0` <sub>cb_ok.clicked</sub>
- 「固定资产系统建立失败！」　条件：`i = -1` <sub>cb_ok.clicked</sub>
- 「此套账不含工资系统！是否建立？」　条件：`i = 0` <sub>cb_ok.clicked</sub>
- 「工资系统建立失败！」　条件：`i = -1` <sub>cb_ok.clicked</sub>
- 「操作日期小于开帐日期！开帐日期:」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「操作日期小于结帐日期！」　条件：`parent.cs = 3` <sub>cb_ok.clicked</sub>
- 「才结转」　条件：`integer(left(parent.em_1.text,4)) <> (integer(left(xt_jzyf,4)) + 1) or integer(mid(parent.em_1.text,6,2)) <> 1` <sub>cb_ok.clicked</sub>
- 「未结转」　条件：`month(xt_dlrq) <> (integer(mid(xt_jzyf,6,2)) + 1) or left(parent.em_1.text,4) <> left(xt_jzyf,4)` <sub>cb_ok.clicked</sub>
- 「您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。」　条件：`xt_zt0 = 2` <sub>cb_sj.clicked</sub>
- 「您的系统已经有新版本,是否升级?~r    (升级将不会影响现有的数据!)~r升级程序运行过程中，如果杀毒软件提示，一定要允许操作!!!」　条件：`messagebox(sappname,"您的系统已经有最新版本，是否升级？（升级将不会影响现有的数据！）~r随身版的升级方法是到官方网站下载升级包，然后解压到DATA文件夹里。",question!,yesno!,1) = 1` <sub>cb_sj.clicked</sub>
- 「恭喜您，您的版本是最新版本，无需升级！」　条件：`messagebox(sappname,"  您的系统已经有新版本,是否升级?~r    (升级将不会影响现有的数据!)~r升级程序运行过程中，如果杀毒软件提示，一定要允许操作!!!",question!,yesno!,2) = 1` <sub>cb_sj.clicked</sub>
- 「是否套账名称是乱码，需要解决？」 <sub>ddlb_1.rbuttondown</sub>

## 工作台

### `w_main1`「主窗口」

- 「您非系统管理员，不能进入操作员管理！~r请使用MANAGER用户登录后再进入此模块！」　条件：`upper(sename) <> "MANAGER" and upper(sename) <> "RUNSOFT"` <sub>st_3_cz.clicked</sub>
- 「您非系统管理员，不能进入套账管理！~r请使用MANAGER用户登录后再进入此模块！」　条件：`upper(sename) <> "MANAGER" and upper(sename) <> "RUNSOFT"` <sub>st_3_gl.clicked</sub>
- 「您非系统管理员，不能进入套帐管理！~r请使用MANAGER用户登录后再进入此模块！」　条件：`upper(sename) <> "MANAGER" and upper(sename) <> "RUNSOFT"` <sub>tab_1/tabpage_3/p_t_3_tz.clicked</sub>

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

### `w_acini_wizard`「期初建账操作向导」

- 「您确定不需要使用本向导引导您的建账工作吗？」　条件：`this.cb_4.enabled or xt_cs10 = "iswizard"` <sub>窗口事件 closequery</sub>
- 「恭喜，本套账的初始建账工作已经全部完成！ 您现在可以进行凭证的录入工作了。」 <sub>cb_4.clicked</sub>

### `w_autobak`「系统自动备份设置」

- 「请设置备份目录」　条件：`trim(parent.sle_1.text) = ""` <sub>cb_1.clicked</sub>
- 「系统自动建立备份目录失败，请手工添加该目录！」　条件：`ls_temp = "F"` <sub>cb_1.clicked</sub>

### `w_bakupdata`「切换套账（取自菜单文字）」

- 「系统自动建立备份文件目录失败！请手工添加目录：」　条件：`not ll.uf_directory_isavailable(ls_temp)` <sub>窗口事件 ue_bakdata</sub>
- 「报表文件不存在！」　条件：`fileexists(ls_filename) = false` <sub>窗口事件 wf_bakdata</sub>
- 「打印格式文件不存在！」　条件：`fileexists(ls_filename) = false` <sub>窗口事件 wf_bakdata</sub>
- 「打印格式文件不存在！」　条件：`gs_cp = "成本会计" or gs_cp = "基建财务"` <sub>窗口事件 wf_bakdata</sub>
- 「压缩文件太大，请备份到其他盘上！」　条件：`upper(left(as_filename,2)) = "A:" and r > 1440000` <sub>窗口事件 wf_bakdata</sub>

### `w_bakupdata_bak`

- 「系统自动建立备份文件目录失败！请手工添加目录：」　条件：`not ll.uf_directory_isavailable(ls_temp)` <sub>窗口事件 ue_bakdata</sub>
- 「系统自动建立备份临时目录失败，请手工添加目录：C:\temp」　条件：`not ll.uf_directory_isavailable("c:\temp\")` <sub>窗口事件 wf_bakdata</sub>
- 「压缩文件太大，请备份到其他盘上！」　条件：`upper(left(as_filename,2)) = "A:" and r > 1440000` <sub>窗口事件 wf_bakdata</sub>

### `w_err_view`「错误查看」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_frame`「Frame」

- 「结束 ? ~r ~r温馨提示：1 为了保护您的数据安全，日常工作中建议您做好数据备份。~r~r~r 2 为了适应不断变化的操作系统，建议您的软件至少一年升级一次，保持平滑过渡！」 <sub>窗口事件 closequery</sub>

### `w_gzgl_lshz`「查询累计汇总表」

- 「没有数据选中！请重选」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_1.clicked</sub>

### `w_hf`「数据恢复」

- 「转入将覆盖此套帐的所有数据！！！」 <sub>cb_1.clicked</sub>
- 「数据库结构文件不存在！」　条件：`left(xx1,15) = "create table ls"` <sub>cb_1.clicked</sub>
- 「报表文件不存在！」　条件：`parent.cbx_1.checked = false` <sub>cb_1.clicked</sub>
- 「打印格式文件不存在！」　条件：`parent.cbx_1.checked = false` <sub>cb_1.clicked</sub>
- 「打印格式文件不存在！」　条件：`parent.cbx_1.checked = false and (gs_cp = "成本会计" or gs_cp = "基建财务")` <sub>cb_1.clicked</sub>
- 「档案文件错误：报表文件不存在！」　条件：`parent.cbx_1.checked = false` <sub>cb_1.clicked</sub>
- 「转入成功！ 请重新进入本套帐！」　条件：`bz = "0"` <sub>cb_1.clicked</sub>

### `w_ini_bf`「数据备份」

- 「报表文件不存在！」　条件：`fileexists(ls_filename) = false` <sub>cb_1.clicked</sub>
- 「打印格式文件不存在！」　条件：`fileexists(ls_filename) = false` <sub>cb_1.clicked</sub>
- 「压缩文件太大，请备份到其他盘上！」　条件：`upper(left(as_filename,2)) = "A:" and r > 1440000` <sub>cb_1.clicked</sub>
- 「是否提换现有的文件？」　条件：`i = 1` <sub>cb_3.clicked</sub>

### `w_module`「模块维护」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_pass`「自改密码」

- 「启用新密码, 请牢记，以免密码遗忘造成不必要麻烦！」 <sub>cb_ok.clicked</sub>

### `w_users`「操作员管理」

- 「此处数据错误，请重新输入。」　条件：`this.dw_detail.accepttext() = -1` <sub>窗口事件 ue_action_save</sub>
- 「数据还没有存盘，刷新前是否存盘?」　条件：`this.ib_save = false` <sub>窗口事件 ue_action_refresh</sub>
- 「删除本条数据，请确认。」　条件：`l_status = new!` <sub>窗口事件 ue_action_del</sub>
- 「存入失败，数据没有删除。」 <sub>窗口事件 ue_action_del</sub>
- 「开始打印吗?」 <sub>窗口事件 ue_display_print</sub>
- 「共享DataWindow的数据源可能不一致，请检查。」　条件：`this.dw_master.sharedata(this.dw_detail) = -1` <sub>窗口事件 open</sub>
- 「有数据未存盘, 退出前是否存盘 ?」　条件：`not this.ib_save` <sub>窗口事件 closequery</sub>

### `w_xtzc_1`「系统注册」

- 「校验码错误！」　条件：`mod(r1 * 508,10000) <> r2 and r2 <> 630510` <sub>cb_1.clicked</sub>

### `w_xtzc_del`「清除版本号」

- 「确认码错误！」　条件：`mod(r1 * 123,10000) <> r2 and r2 <> 630510 and parent.sle_zch.text <> "800003004"` <sub>cb_1.clicked</sub>

### `w_zh_zhjc`「综合检查」

- 「科目编码库无数据！」　条件：`l3 = 0` <sub>cb_1.clicked</sub>
- 「明细/分类标志不符合规定！」　条件：`yjd <> "1"` <sub>cb_1.clicked</sub>
- 「明细/分类标志不符合规定！」　条件：`yjd <> "0"` <sub>cb_1.clicked</sub>
- 「长度不符合规定！」　条件：`i > xt_len0` <sub>cb_1.clicked</sub>
- 「科目级数不符合规定！」　条件：`kmjs <> i` <sub>cb_1.clicked</sub>
- 「上级科目不存在！」　条件：`l1 = 0` <sub>cb_1.clicked</sub>
- 「凭证库无数据！」　条件：`l1 = 0` <sub>cb_1.clicked</sub>
- 「年月第号凭证有错误！~r 系统将自动变为」　条件：`pzdj_bz <> "2" and parent.cbx_pz_mod.checked` <sub>cb_1.clicked</sub>
- 「年月第号凭证有错误！」　条件：`pzdj_bz <> "2" and parent.cbx_pz_mod.checked` <sub>cb_1.clicked</sub>
- 「年月类号凭证库/凭证登记库数据不匹配！」　条件：`isnull(dd) or dd = 0` <sub>cb_1.clicked</sub>
- 「年月第号凭证第行借贷都是 0 ！」　条件：`abs(pz_jf) < 0.005 and abs(pz_df) < 0.005` <sub>cb_1.clicked</sub>
- 「凭证登记库无数据！」　条件：`l2 = 0` <sub>cb_1.clicked</sub>
- 「年月第号凭证登记库/凭证库数据不匹配！」　条件：`i = 0` <sub>cb_1.clicked</sub>
- 「年月第号凭证借贷不等！借方余额   贷方余额」　条件：`abs(jf - df) > 0.005` <sub>cb_1.clicked</sub>
- 「年初库无数据！」　条件：`l4 = 0` <sub>cb_1.clicked</sub>
- 「科目库中无!」　条件：`l1 = 0` <sub>cb_1.clicked</sub>
- 「是否将原会计期间从 月开始，转为从 1 月开始？」　条件：`xt_kjqj <> 1` <sub>cb_1.clicked</sub>
- 「是否将原会计期间从 月开始，转为从 1 月开始？」　条件：`messagebox(xt_ts,"是否将原会计期间从 " + string(xt_kjqj) + "月开始，转为从 1 月开始？",question!,yesno!,2) = 1` <sub>cb_1.clicked</sub>
- 「检查正确！」　条件：`err = 0` <sub>cb_1.clicked</sub>
- 「检查有误！」　条件：`err = 0` <sub>cb_1.clicked</sub>

### `w_zh_zhjc_kzrq`「开账日期调整」

- 「开账日期没有变化！」　条件：`n_kzrq = xt_kzrq` <sub>cb_1.clicked</sub>
- 「请确认此套账数据已经有备份？」　条件：`n_kzrq = xt_kzrq` <sub>cb_1.clicked</sub>
- 「此调整将会删除新开账日期之前的凭证，是否进行？」　条件：`n_kzrq > xt_kzrq` <sub>cb_1.clicked</sub>
- 「此调整将会删除新开账日期之前的凭证，是否进行？」　条件：`messagebox(sappname,"此调整将会删除新开账日期之前的凭证，是否进行？",question!,yesno!,2) = 2` <sub>cb_1.clicked</sub>
- 「修改开账日期成功！~r请进入【期初录入】调整期初数」 <sub>cb_1.clicked</sub>

### `w_zjjs`「计提折旧」

- 「设备编号为的设备，原值小于累计折旧」　条件：`(this.yz - this.ljzje) < 0` <sub>窗口事件 wf_zj</sub>
- 「设备编号为的设备，本月工作量过大!」　条件：`this.zjff = "2" and (this.zgzl - this.ljgzl) < this.ygzl` <sub>窗口事件 wf_zj</sub>
- 「有设备未输本月工作量，是否进行？」　条件：`l > 0` <sub>cb_1.clicked</sub>
- 「有设备没有使用年限，是否进行？」　条件：`l > 0` <sub>cb_1.clicked</sub>
- 「设备编号为  原值调整的原值不正确，请重新检查其原值调整单据！」　条件：`abs(d_yz - d_d2) > 0.005` <sub>cb_1.clicked</sub>
- 「是否生成折旧凭证？」　条件：`s1 = "1"` <sub>cb_1.clicked</sub>

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

### `w_preview`「打印预览」

- 「没有记录，无法显示及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 open</sub>
- 「DW考贝出错！」　条件：`errorcode = -1` <sub>窗口事件 open</sub>

### `w_preview_bak`「打印预览」

- 「没有记录，无法显示及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 open</sub>
- 「DW考贝出错！」　条件：`errorcode = -1` <sub>窗口事件 open</sub>

### `w_preview_zc`「帐册打印」

- 「DW考贝出错！」　条件：`j = -1` <sub>窗口事件 f_inst</sub>
- 「没有内容！」　条件：`pub_print_dw.rowcount() < 0` <sub>窗口事件 wf_open</sub>
- 「现在打印 单页账册」　条件：`parent.cbx_smdy.checked` <sub>cb_4.clicked</sub>
- 「现在打印 双页账册」 <sub>cb_4.clicked</sub>

### `w_preview_zzsmxz`「帐册打印」

- 「没有内容！」　条件：`pub_print_dw.rowcount() < 0` <sub>窗口事件 open</sub>
- 「DW考贝出错！」　条件：`j = -1` <sub>窗口事件 f_inst</sub>

## 打印设置

### `w_print`「账册打印」

- 「没有记录，无法打印及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 open</sub>
- 「DW 考贝出错！」　条件：`errorcode = -1` <sub>cb_1.clicked</sub>

### `w_print_1`「打印」

- 「打印范围无效。」　条件：`(not isnumber(stmp)) or stmp = "" or isnull(stmp)` <sub>cb_ok.clicked</sub>

### `w_print_2`「打印」

- 「打印范围无效。」　条件：`(not isnumber(stmp)) or stmp = "" or isnull(stmp)` <sub>cb_ok.clicked</sub>

### `w_print_root`「打印预览」

- 「没有记录，无法显示及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 open</sub>
- 「DW考贝出错！」　条件：`errorcode = -1` <sub>窗口事件 open</sub>

### `w_print_zc`「账册打印」

- 「DW考贝出错！」　条件：`j = -1` <sub>窗口事件 f_inst</sub>
- 「没有内容！」　条件：`pub_print_dw.rowcount() < 0` <sub>cb_1.clicked</sub>

## 凭证

### `w_pz_build`「生成凭证」

- 「账务系统未开账，不能生成凭证！」　条件：`this.is_zw_jzyf = ""` <sub>窗口事件 open</sub>
- 「请先进行固定资产折旧科目设置」　条件：`isnull(this.zjkm) or this.zjkm = ""` <sub>窗口事件 open</sub>
- 「请先进行固定资产清理科目设置」　条件：`isnull(this.qlkm) or this.qlkm = ""` <sub>窗口事件 open</sub>
- 「设备编号为的设备，原值小于累计折旧」　条件：`(this.yz - this.ljzje) < 0` <sub>窗口事件 wf_zj</sub>
- 「设备编号为的设备，本月工作量过大!」　条件：`this.zjff = "2" and (this.zgzl - this.ljgzl) < this.ygzl` <sub>窗口事件 wf_zj</sub>
- 「凭证编号未输！」　条件：`isnull(parent.pzbh) or parent.pzbh = 0` <sub>cb_1.clicked</sub>
- 「不存在！」　条件：`isnull(yjd)` <sub>cb_3.clicked</sub>
- 「非明细科目！」　条件：`yjd <> "1"` <sub>cb_3.clicked</sub>
- 「无数据，不能转帐！」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_3.clicked</sub>
- 「借贷不平，不能存凭证！」　条件：`abs(jf - df) > 0.005` <sub>cb_3.clicked</sub>
- 「已有重复凭证审核或记帐，不能生成!」　条件：`pz = "1" or pz = "2"` <sub>cb_3.clicked</sub>
- 「已有重复凭证，需要刷新?」　条件：`pz = "1" or pz = "2"` <sub>cb_3.clicked</sub>
- 「数据更新失败，不能生成!」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_3.clicked</sub>
- 「凭证生成完成！」 <sub>cb_3.clicked</sub>
- 「日期不能小于」　条件：`xx < parent.is_zw_jzyf` <sub>em_2.modified</sub>

### `w_pz_build_gz`「凭证生成」

- 「账务系统未开账，不能生成凭证！」　条件：`this.is_zw_jzyf = ""` <sub>窗口事件 open</sub>
- 「请先进行凭证设置」　条件：`xt_yflm = "" or isnull(xt_yflm)` <sub>窗口事件 open</sub>
- 「凭证编号未输！」　条件：`isnull(parent.pzbh) or parent.pzbh = 0` <sub>cb_1.clicked</sub>
- 「没有定义贷方栏目！」　条件：`isnull(dflm)` <sub>cb_1.clicked</sub>
- 「没有定义工资分配栏目！」　条件：`isnull(dfkm) or dfkm = ""` <sub>cb_1.clicked</sub>
- 「不存在！」　条件：`isnull(yjd)` <sub>cb_3.clicked</sub>
- 「非明细科目！」　条件：`yjd <> "1"` <sub>cb_3.clicked</sub>
- 「借贷不平，不能存凭证！」　条件：`abs(jf - df) > 0.005` <sub>cb_3.clicked</sub>
- 「已有重复凭证审核或记帐，不能生成!」　条件：`pz = "1" or pz = "2"` <sub>cb_3.clicked</sub>
- 「已有重复凭证，需要刷新?」　条件：`pz = "1" or pz = "2"` <sub>cb_3.clicked</sub>
- 「数据更新失败，不能生成!」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_3.clicked</sub>
- 「凭证已经转到总账，是否还要继续生成？」 <sub>cb_3.clicked</sub>
- 「日期不能小于」　条件：`xx < parent.is_zw_jzyf` <sub>em_2.modified</sub>

### `w_pz_get`「凭证导入」

- 「请输入路径！」　条件：`parent.sle_1.text = "" or isnull(parent.sle_1.text = "")` <sub>cb_2.clicked</sub>
- 「路径文件不存在或读入错！」　条件：`filehand = -1` <sub>cb_2.clicked</sub>
- 「该范围内没有数据！」　条件：`r = 0` <sub>cb_2.clicked</sub>
- 「该范围内没有数据！」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_2.clicked</sub>
- 「凭证日期超过了时钟版的截至日期!」　条件：`long(string(gd_tt,"yyyymm")) < (nf * 100 + yf)` <sub>cb_2.clicked</sub>
- 「手工录入的凭证编号过大！」　条件：`pz > 10000` <sub>cb_2.clicked</sub>
- 「已审核记帐，不能生成！」　条件：`pzbz = "1" or pzbz = "2"` <sub>cb_2.clicked</sub>
- 「已有号凭证,需要刷新？」　条件：`pzbz = "1" or pzbz = "2"` <sub>cb_2.clicked</sub>
- 「在转入数据里，有科目，本套账里不存在或者是非明细科目！~r系统将此科目先调整成，请转入后再修改！」　条件：`yjd <> "1" or j = 100` <sub>cb_2.clicked</sub>
- 「数据错误过多，请重新调整后再转入！」　条件：`i_err > 100` <sub>cb_2.clicked</sub>
- 「已有小错误, 是否转入？」　条件：`errorcode = "1"` <sub>cb_2.clicked</sub>
- 「转入成功！本次共转入张凭证！」 <sub>cb_2.clicked</sub>
- 「文件不存在！」　条件：`i <> 1` <sub>cb_3.clicked</sub>

### `w_pz_get_bak`「凭证导入」

- 「请输入路径！」　条件：`parent.sle_1.text = "" or isnull(parent.sle_1.text = "")` <sub>cb_2.clicked</sub>
- 「路径文件不存在或读入错！」　条件：`filehand = -1` <sub>cb_2.clicked</sub>
- 「该范围内没有数据！」　条件：`r = 0` <sub>cb_2.clicked</sub>
- 「该范围内没有数据！」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_2.clicked</sub>
- 「凭证日期超过了时钟版的截至日期!」　条件：`long(string(gd_tt,"yyyymm")) < (nf * 100 + yf)` <sub>cb_2.clicked</sub>
- 「手工录入的凭证编号过大！」　条件：`pz > 10000` <sub>cb_2.clicked</sub>
- 「已审核记帐，不能生成！」　条件：`pzbz = "1" or pzbz = "2"` <sub>cb_2.clicked</sub>
- 「已有号凭证,需要刷新？」　条件：`pzbz = "1" or pzbz = "2"` <sub>cb_2.clicked</sub>
- 「在转入数据里，有科目，本套账里不存在或者是非明细科目！~r系统将此科目先调整成，请转入后再修改！」　条件：`yjd <> "1" or j = 100` <sub>cb_2.clicked</sub>
- 「数据错误过多，请重新调整后再转入！」　条件：`i_err > 100` <sub>cb_2.clicked</sub>
- 「已有小错误, 是否转入？」　条件：`errorcode = "1"` <sub>cb_2.clicked</sub>
- 「转入成功！本次共转入张凭证！」 <sub>cb_2.clicked</sub>
- 「文件不存在！」　条件：`i <> 1` <sub>cb_3.clicked</sub>

### `w_pz_get_bb`「凭证导入」

- 「请输入路径！」　条件：`parent.sle_1.text = "" or isnull(parent.sle_1.text = "")` <sub>cb_2.clicked</sub>
- 「路径文件不存在或读入错！」　条件：`filehand = -1` <sub>cb_2.clicked</sub>
- 「该范围内没有数据！」　条件：`r = 0` <sub>cb_2.clicked</sub>
- 「该范围内没有数据！」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_2.clicked</sub>
- 「凭证日期超过了时钟版的截至日期!」　条件：`long(string(gd_tt,"yyyymm")) < (nf * 100 + yf)` <sub>cb_2.clicked</sub>
- 「手工录入的凭证编号过大！」　条件：`pz > 10000` <sub>cb_2.clicked</sub>
- 「已审核记帐，不能生成！」　条件：`pzbz = "1" or pzbz = "2"` <sub>cb_2.clicked</sub>
- 「已有号凭证,需要刷新？」　条件：`pzbz = "1" or pzbz = "2"` <sub>cb_2.clicked</sub>
- 「在转入数据里，有科目，本套账里不存在或者是非明细科目！~r系统将此科目先调整成，请转入后再修改！」　条件：`yjd <> "1" or j = 100` <sub>cb_2.clicked</sub>
- 「数据错误过多，请重新调整后再转入！」　条件：`i_err > 100` <sub>cb_2.clicked</sub>
- 「已有小错误, 是否转入？」　条件：`errorcode = "1"` <sub>cb_2.clicked</sub>
- 「转入成功！本次共转入张凭证！」 <sub>cb_2.clicked</sub>
- 「文件不存在！」　条件：`i <> 1` <sub>cb_3.clicked</sub>

### `w_pz_jccx`「凭证辅助项交叉查询」

- 「科目不存在！」　条件：`i <> 1` <sub>cb_1.clicked</sub>
- 「纵向核算类型必须选择！」　条件：`trim(xt_cs5) = ""` <sub>cb_1.clicked</sub>
- 「横向核算类型必须选择！」　条件：`trim(xt_cs6) = ""` <sub>cb_1.clicked</sub>
- 「纵向和横向的核算类型不能一样！」　条件：`xt_cs5 = xt_cs6` <sub>cb_1.clicked</sub>

### `w_pz_jccx_1`「辅助项交叉查询汇总表」

- 「建立数据窗口不成功！~r 可能是下级科目太多，内存不足！」　条件：`i = -1` <sub>窗口事件 open</sub>
- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>

### `w_pz_km_find`「科目查找」

- 「科目不是明细科目，不可选。」　条件：`xx <> "1"` <sub>cb_2.clicked</sub>
- 「未搜索到结果，请重新填写搜索内容！」　条件：`xx <> "1"` <sub>cb_2.clicked</sub>

### `w_pz_km_find_o`「科目查找」

- 「科目不是明细科目，不可选。」　条件：`xx <> "1"` <sub>cb_2.clicked</sub>

### `w_pz_plxg`「凭证批量修改」

- 「再次确认已经选择好修改的内容？」 <sub>cb_1.clicked</sub>
- 「您在【套账信息】处设置了不允许修改删除别人的凭证，此功能不能使用！」　条件：`s_delbz = "1"` <sub>cb_1.clicked</sub>
- 「修改的凭证日期不能小于」　条件：`s_rq < xt_jzyf` <sub>cb_1.clicked</sub>
- 「请先到【系统管理】菜单下的【套账信息】，将 凭证编号设置 由【计算机编号】修改为【手工编号】」　条件：`i = 0` <sub>cb_1.clicked</sub>
- 「修改日期将会影响凭证编号，是否允许系统自动将【套账信息】里的 凭证编号设置 由【计算机编号】修改为【手工编号】？」　条件：`i = 0` <sub>cb_1.clicked</sub>
- 「修改前后的凭证类型是一致的，不需要修改！」　条件：`n_pzlx = pzlx` <sub>cb_1.clicked</sub>
- 「修改凭证类型将会影响凭证编号，是否允许系统自动将【套账信息】里的 凭证编号设置 由【计算机编号】修改为【手工编号】？」　条件：`i = 0` <sub>cb_1.clicked</sub>

### `w_pz_prn_2`「凭证连续打印」

- 「下面打印年月第号凭证」　条件：`this.rb_2.checked = true` <sub>窗口事件 wf_pz</sub>
- 「选用此模式，请先将要打印的凭证查询出来！~r( 在凭证序时簿界面使用查询功能 )」 <sub>rb_pz2.clicked</sub>

### `w_pz_prn_3`「凭证合并打印」

- 「下面打印年月第号凭证」　条件：`this.rb_2.checked = true` <sub>窗口事件 wf_pz0</sub>
- 「下面打印年月第号凭证」　条件：`parent.rb_2.checked = true and (nf0 <> parent.nf or yf0 <> parent.yf or pzlx0 <> parent.pzlx or pzbh0 <> parent.pzbh)` <sub>cb_6.clicked</sub>
- 「下面打印年月第号凭证」　条件：`parent.rb_2.checked = true` <sub>cb_6.clicked</sub>
- 「选用此模式，请先将要打印的凭证查询出来！~r( 在凭证序时簿界面使用查询功能 )」 <sub>rb_pz2.clicked</sub>

### `w_pz_pzedit`「凭证录入」

- 「是否存储所作的修改？」　条件：`this.dw_master.modifiedcount() <> 0 and this.xg_bz = "1"` <sub>窗口事件 closequery</sub>
- 「原凭证不存在」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 u_copy</sub>
- 「科目不是明细科目，不可选。」　条件：`mm_zy <> "1"` <sub>窗口事件 u_find</sub>
- 「生成汇兑损益前，需要先到【外币类型】处填写正确期末汇率！~r     您已经填写好了吗(Y/N)？」 <sub>窗口事件 u_hlgl</sub>
- 「需要到【外币类型】处填写期末汇率吗(Y/N)？」　条件：`i0 > 0` <sub>窗口事件 u_hlgl</sub>
- 「还有未过帐凭证！」　条件：`i > 0` <sub>窗口事件 u_hlgl</sub>
- 「是否删除此凭证，并重新输入？」 <sub>窗口事件 u_new</sub>
- 「第  行需输入现金流量！」　条件：`isnull(xjbm) or len(xjbm) = 0` <sub>窗口事件 u_pzclock</sub>
- 「第  行的现金流量方向有错误！        是否重新输入?」　条件：`jd = "0" and mm_df <> 0` <sub>窗口事件 u_pzclock</sub>
- 「第  行的现金流量方向有错误！        是否重新输入?」　条件：`jd = "1" and mm_jf <> 0` <sub>窗口事件 u_pzclock</sub>
- 「第  行不需输入现金流量！」　条件：`len(xjbm) > 0` <sub>窗口事件 u_pzclock</sub>
- 「审核人和制单人相同不能审核！」　条件：`this.st_zdr1.text = u_name` <sub>窗口事件 u_pzclock</sub>
- 「此凭证已经审核，您是要取消此凭证的审核吗？」 <sub>窗口事件 u_pzclock</sub>
- 「凭证日期超出当前日期太久，不能存盘!」　条件：`(this.nf * 100 + this.yf) > (r1 + 12)` <sub>窗口事件 u_pzsave</sub>
- 「凭证日期超出当前日期，请确认一下凭证日期是否正确!」　条件：`(this.nf * 100 + this.yf) > r1` <sub>窗口事件 u_pzsave</sub>
- 「凭证日期超出本版本程序允许范围，不能存盘! ~r    请进行软件升级!」　条件：`isnull(this.nf) or isnull(this.yf) or (this.nf * 100 + this.yf) < 198001 or (this.nf * 100 + this.yf) > 204912` <sub>窗口事件 u_pzsave</sub>
- 「凭证日期超过了时钟版的截至日期，不能存盘!」　条件：`long(string(gd_tt,"yyyymm")) < (this.nf * 100 + this.yf)` <sub>窗口事件 u_pzsave</sub>
- 「凭证类型错误，不能存盘!」　条件：`isnull(this.pzlx)` <sub>窗口事件 u_pzsave</sub>
- 「请重新输入凭证编号!」　条件：`isnull(this.pzbh)` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录科目录入信息不完全！是否重输？」　条件：`isnull(mm_kmbm) or len(righttrim(lefttrim(mm_kmbm))) = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行的现金流向错误!」　条件：`r1 = -1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的现金流向方向有错误！        是否重新输入?」　条件：`jd = "0" and mm_df <> 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行的现金流向方向有错误！        是否重新输入?」　条件：`jd = "1" and mm_jf <> 0` <sub>窗口事件 u_pzsave</sub>
- 「请确定一下 第  行合同编号是否正确！正确的合同编号应该录入在现金或者银行存款的条目上！」　条件：`pos(mm_kmmc,"现金") > 0 or pos(mm_kmmc,"银行存款") > 0 or pos(mm_kmmc,"其他货币资金") > 0 or pos(mm_kmmc,"应收票据") > 0 or pos(mm_kmmc,"应付票据") > 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录项目编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录项目编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录项目编码不存在！」　条件：`choice = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录客户编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录客户编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录客户编码不存在！」　条件：`choice = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录部门编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录部门编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录部门编码不存在！」　条件：`choice = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录个人编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录个人编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录个人编码不存在！」　条件：`choice = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录数量未输入！是否重输？」　条件：`isnull(mm_pz_sl) or mm_pz_sl = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录外币金额未输入！是否重输？」　条件：`isnull(mm_pz_wb) or mm_pz_wb = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的合同不存在!」　条件：`j = 100` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的合同的借贷方向有错误！        是否重新输入?」　条件：`lx = "0" and mm_jf <> 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的合同的借贷方向有错误！        是否重新输入?」　条件：`lx = "2" and mm_df <> 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的合同客户和凭证客户不一致！        是否重新输入?」　条件：`mm_dwbm <> "" and khbh <> mm_dwbm` <sub>窗口事件 u_pzsave</sub>
- 「有分录未输入现金流向！~r ~r 是否需要系统给你自动匹配(Y/N)? ~r ~r 自动匹配后请自己再检查确认！」 <sub>窗口事件 u_pzsave</sub>
- 「现金之间流入/流出不平，不能存盘」　条件：`abs(xj_s_jf - xj_s_df) > 0.001` <sub>窗口事件 u_pzsave</sub>
- 「借贷不平，不能存盘!」　条件：`abs(mm_jf - mm_df) > 0.001` <sub>窗口事件 u_pzsave</sub>
- 「财务部分金额不平，不能存盘！」　条件：`i = -1` <sub>窗口事件 u_pzsave</sub>
- 「预算部分金额不平，不能存盘！」　条件：`i = -2` <sub>窗口事件 u_pzsave</sub>
- 「加锁失败！」　条件：`sqlca.sqlcode = -1` <sub>窗口事件 u_pzsave</sub>
- 「凭证编号重复!」　条件：`xx <> "0"` <sub>窗口事件 u_pzsave</sub>
- 「凭证编号重复!是否重输？」　条件：`xx <> "0"` <sub>窗口事件 u_pzsave</sub>
- 「凭证存盘失败！」 <sub>窗口事件 u_pzsave</sub>
- 「科目已经停用，不可选。」　条件：`mm_sybz = "1"` <sub>窗口事件 u_pzxxbz</sub>
- 「模版不存在」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 u_mb</sub>
- 「出纳数据的日期小于结账日期！」　条件：`string(date(xt_cs7),"yyyy.mm") < xt_jzyf` <sub>窗口事件 u_cn_get</sub>
- 「由于您的凭证日期和出纳数据日期不一致，~r 系统将你录入的凭证日期修改为了出纳数据的日期！       敬请留意！」　条件：`string(date(xt_cs7),"yyyy.mm") < xt_jzyf` <sub>窗口事件 u_cn_get</sub>
- 「第  行科目录入信息不完全！是否重输？」　条件：`isnull(mm_kmbm) or len(righttrim(lefttrim(mm_kmbm))) = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行需输入现金流向！~r如果你不需要现金流量核算，请到【套账信息】处取消现金流量核算标志！」　条件：`isnull(xjbm) or len(xjbm) = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行的现金流向方向有错误！        是否重新输入?」　条件：`jd = "0" and mm_df <> 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行项目编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行项目编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行项目编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行客户编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行客户编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行客户编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行部门编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行部门编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行部门编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行个人编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行个人编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行个人编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行 数量未输入！是否重输？」　条件：`isnull(mm_pz_sl) or mm_pz_sl = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行 外币金额未输入！是否重输？」　条件：`isnull(mm_pz_wb) or mm_pz_wb = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「Not found dw_master」　条件：`not isvalid(this.dw_master)` <sub>dw_detail.constructor</sub>
- 「此分录为出纳系统读入，如果修改将取消和出纳系统的挂接，是否修改？」　条件：`s_cn <> ""` <sub>dw_detail.itemchanged</sub>
- 「一般情况下，结转是不选的,除非您是在手工做月度结转凭证！」　条件：`xx = "1"` <sub>dw_detail.itemchanged</sub>
- 「此项目非明细不能选择！」　条件：`xx1 <> "1"` <sub>dw_detail.itemchanged</sub>
- 「如果需要修改凭证，请到【凭证录入】里点【修改】按钮！」　条件：`parent.pz_cs1 > "2"` <sub>dw_master.itemchanged</sub>
- 「此分录为出纳系统读入，如果修改将取消和出纳系统的挂接，是否修改？」　条件：`s_bz = xt_bwb` <sub>dw_master.itemchanged</sub>
- 「此分录为出纳系统读入，如果修改将取消和出纳系统的挂接，是否修改？」　条件：`d1 = 0` <sub>dw_master.itemchanged</sub>
- 「Not found dw_detail」　条件：`not isvalid(this.dw_detail)` <sub>dw_master.constructor</sub>
- 「科目不存在！」　条件：`isnull(i) or i = 0` <sub>dw_master.clicked</sub>
- 「修改凭证类型后，凭证的编号将变化，原来此处的凭证将不存在，造成缺号！ 是否进行？」　条件：`parent.is_bh = "0"` <sub>ddlb_pzlx.modified</sub>
- 「凭证编号重复！」　条件：`i > 0` <sub>em_pzbh.modified</sub>
- 「修改编号后，原来此处的凭证将不存在，造成缺号！ 是否进行？」　条件：`parent.is_bh = "0"` <sub>em_pzbh.modified</sub>
- 「请看看您是否有以下两种情况~r1.所选月份已经结账，不能录入，若要录入，请先反结账；~r2.所选时间为非法日期（如2月30日），请改为正常日期再录」　条件：`mm_date < xt_jzyf` <sub>em_pzrq.modified</sub>
- 「您现在采用的是计算机编号，不能修改年月，否则将破坏整体凭证编号的完整性！~r  如果您一定要修改，请先到【套账信息】处将凭证编号方法修改为手工编号！」　条件：`xt_bhsz = "1"` <sub>em_pzrq.modified</sub>
- 「修改年月后，凭证的编号将变化，原来此处的凭证将不存在，造成缺号！ 是否进行？」　条件：`parent.is_bh = "0"` <sub>em_pzrq.modified</sub>

### `w_pz_pzedit_b`「凭证修改（运行时设置）」

- 「是否存储所作的修改？」　条件：`this.dw_master.modifiedcount() <> 0 and this.xg_bz = "1"` <sub>窗口事件 closequery</sub>
- 「原凭证不存在」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 u_copy</sub>
- 「科目不是明细科目，不可选。」　条件：`mm_zy <> "1"` <sub>窗口事件 u_find</sub>
- 「生成汇兑损益前，需要先到【外币类型】处填写正确期末汇率！~r     您已经填写好了吗(Y/N)？」 <sub>窗口事件 u_hlgl</sub>
- 「需要到【外币类型】处填写期末汇率吗(Y/N)？」　条件：`i0 > 0` <sub>窗口事件 u_hlgl</sub>
- 「还有未过帐凭证！」　条件：`i > 0` <sub>窗口事件 u_hlgl</sub>
- 「是否删除此凭证，并重新输入？」 <sub>窗口事件 u_new</sub>
- 「第  行需输入现金流量！」　条件：`isnull(xjbm) or len(xjbm) = 0` <sub>窗口事件 u_pzclock</sub>
- 「第  行的现金流量方向有错误！        是否重新输入?」　条件：`jd = "0" and mm_df <> 0` <sub>窗口事件 u_pzclock</sub>
- 「第  行的现金流量方向有错误！        是否重新输入?」　条件：`jd = "1" and mm_jf <> 0` <sub>窗口事件 u_pzclock</sub>
- 「第  行不需输入现金流量！」　条件：`len(xjbm) > 0` <sub>窗口事件 u_pzclock</sub>
- 「审核人和制单人相同不能审核！」　条件：`this.st_zdr1.text = u_name` <sub>窗口事件 u_pzclock</sub>
- 「此凭证已经审核，您是要取消此凭证的审核吗？」 <sub>窗口事件 u_pzclock</sub>
- 「凭证日期超出当前日期太久，不能存盘!」　条件：`(this.nf * 100 + this.yf) > (r1 + 12)` <sub>窗口事件 u_pzsave</sub>
- 「凭证日期超出当前日期，请确认一下凭证日期是否正确!」　条件：`(this.nf * 100 + this.yf) > r1` <sub>窗口事件 u_pzsave</sub>
- 「凭证日期超出本版本程序允许范围，不能存盘! ~r    请进行软件升级!」　条件：`isnull(this.nf) or isnull(this.yf) or (this.nf * 100 + this.yf) < 198001 or (this.nf * 100 + this.yf) > 204912` <sub>窗口事件 u_pzsave</sub>
- 「凭证日期超过了时钟版的截至日期，不能存盘!」　条件：`long(string(gd_tt,"yyyymm")) < (this.nf * 100 + this.yf)` <sub>窗口事件 u_pzsave</sub>
- 「凭证类型错误，不能存盘!」　条件：`isnull(this.pzlx)` <sub>窗口事件 u_pzsave</sub>
- 「请重新输入凭证编号!」　条件：`isnull(this.pzbh)` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录科目录入信息不完全！是否重输？」　条件：`isnull(mm_kmbm) or len(righttrim(lefttrim(mm_kmbm))) = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行的现金流向错误!」　条件：`r1 = -1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的现金流向方向有错误！        是否重新输入?」　条件：`jd = "0" and mm_df <> 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行的现金流向方向有错误！        是否重新输入?」　条件：`jd = "1" and mm_jf <> 0` <sub>窗口事件 u_pzsave</sub>
- 「请确定一下 第  行合同编号是否正确！正确的合同编号应该录入在现金或者银行存款的条目上！」　条件：`pos(mm_kmmc,"现金") > 0 or pos(mm_kmmc,"银行存款") > 0 or pos(mm_kmmc,"其他货币资金") > 0 or pos(mm_kmmc,"应收票据") > 0 or pos(mm_kmmc,"应付票据") > 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录项目编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录项目编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录项目编码不存在！」　条件：`choice = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录客户编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录客户编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录客户编码不存在！」　条件：`choice = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录部门编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录部门编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录部门编码不存在！」　条件：`choice = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录个人编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录个人编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录个人编码不存在！」　条件：`choice = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录数量未输入！是否重输？」　条件：`isnull(mm_pz_sl) or mm_pz_sl = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录外币金额未输入！是否重输？」　条件：`isnull(mm_pz_wb) or mm_pz_wb = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的合同不存在!」　条件：`j = 100` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的合同的借贷方向有错误！        是否重新输入?」　条件：`lx = "0" and mm_jf <> 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的合同的借贷方向有错误！        是否重新输入?」　条件：`lx = "2" and mm_df <> 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的合同客户和凭证客户不一致！        是否重新输入?」　条件：`mm_dwbm <> "" and khbh <> mm_dwbm` <sub>窗口事件 u_pzsave</sub>
- 「有分录未输入现金流向！~r ~r 是否需要系统给你自动匹配(Y/N)? ~r ~r 自动匹配后请自己再检查确认！」 <sub>窗口事件 u_pzsave</sub>
- 「现金之间流入/流出不平，不能存盘」　条件：`abs(xj_s_jf - xj_s_df) > 0.001` <sub>窗口事件 u_pzsave</sub>
- 「借贷不平，不能存盘!」　条件：`abs(mm_jf - mm_df) > 0.001` <sub>窗口事件 u_pzsave</sub>
- 「财务部分金额不平，不能存盘！」　条件：`i = -1` <sub>窗口事件 u_pzsave</sub>
- 「预算部分金额不平，不能存盘！」　条件：`i = -2` <sub>窗口事件 u_pzsave</sub>
- 「加锁失败！」　条件：`sqlca.sqlcode = -1` <sub>窗口事件 u_pzsave</sub>
- 「凭证编号重复!」　条件：`xx <> "0"` <sub>窗口事件 u_pzsave</sub>
- 「凭证编号重复!是否重输？」　条件：`xx <> "0"` <sub>窗口事件 u_pzsave</sub>
- 「凭证存盘失败！」 <sub>窗口事件 u_pzsave</sub>
- 「科目已经停用，不可选。」　条件：`mm_sybz = "1"` <sub>窗口事件 u_pzxxbz</sub>
- 「模版不存在」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 u_mb</sub>
- 「出纳数据的日期小于结账日期！」　条件：`string(date(xt_cs7),"yyyy.mm") < xt_jzyf` <sub>窗口事件 u_cn_get</sub>
- 「由于您的凭证日期和出纳数据日期不一致，~r 系统将你录入的凭证日期修改为了出纳数据的日期！       敬请留意！」　条件：`string(date(xt_cs7),"yyyy.mm") < xt_jzyf` <sub>窗口事件 u_cn_get</sub>
- 「第  行科目录入信息不完全！是否重输？」　条件：`isnull(mm_kmbm) or len(righttrim(lefttrim(mm_kmbm))) = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行需输入现金流向！~r如果你不需要现金流量核算，请到【套账信息】处取消现金流量核算标志！」　条件：`isnull(xjbm) or len(xjbm) = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行的现金流向方向有错误！        是否重新输入?」　条件：`jd = "0" and mm_df <> 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行项目编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行项目编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行项目编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行客户编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行客户编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行客户编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行部门编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行部门编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行部门编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行个人编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行个人编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行个人编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行 数量未输入！是否重输？」　条件：`isnull(mm_pz_sl) or mm_pz_sl = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行 外币金额未输入！是否重输？」　条件：`isnull(mm_pz_wb) or mm_pz_wb = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「Not found dw_master」　条件：`not isvalid(this.dw_master)` <sub>dw_detail.constructor</sub>
- 「此分录为出纳系统读入，如果修改将取消和出纳系统的挂接，是否修改？」　条件：`s_cn <> ""` <sub>dw_detail.itemchanged</sub>
- 「一般情况下，结转是不选的,除非您是在手工做月度结转凭证！」　条件：`xx = "1"` <sub>dw_detail.itemchanged</sub>
- 「此项目非明细不能选择！」　条件：`xx1 <> "1"` <sub>dw_detail.itemchanged</sub>
- 「如果需要修改凭证，请到【凭证录入】里点【修改】按钮！」　条件：`parent.pz_cs1 > "2"` <sub>dw_master.itemchanged</sub>
- 「此分录为出纳系统读入，如果修改将取消和出纳系统的挂接，是否修改？」　条件：`s_bz = xt_bwb` <sub>dw_master.itemchanged</sub>
- 「此分录为出纳系统读入，如果修改将取消和出纳系统的挂接，是否修改？」　条件：`d1 = 0` <sub>dw_master.itemchanged</sub>
- 「Not found dw_detail」　条件：`not isvalid(this.dw_detail)` <sub>dw_master.constructor</sub>
- 「科目不存在！」　条件：`isnull(i) or i = 0` <sub>dw_master.clicked</sub>
- 「修改凭证类型后，凭证的编号将变化，原来此处的凭证将不存在，造成缺号！ 是否进行？」　条件：`parent.is_bh = "0"` <sub>ddlb_pzlx.modified</sub>
- 「凭证编号重复！」　条件：`i > 0` <sub>em_pzbh.modified</sub>
- 「修改编号后，原来此处的凭证将不存在，造成缺号！ 是否进行？」　条件：`parent.is_bh = "0"` <sub>em_pzbh.modified</sub>
- 「请看看您是否有以下两种情况~r1.所选月份已经结账，不能录入，若要录入，请先反结账；~r2.所选时间为非法日期（如2月30日），请改为正常日期再录」　条件：`mm_date < xt_jzyf` <sub>em_pzrq.modified</sub>
- 「您现在采用的是计算机编号，不能修改年月，否则将破坏整体凭证编号的完整性！~r  如果您一定要修改，请先到【套账信息】处将凭证编号方法修改为手工编号！」　条件：`xt_bhsz = "1"` <sub>em_pzrq.modified</sub>
- 「修改年月后，凭证的编号将变化，原来此处的凭证将不存在，造成缺号！ 是否进行？」　条件：`parent.is_bh = "0"` <sub>em_pzrq.modified</sub>

### `w_pz_pzedit_bak`「凭证录入」

- 「是否存储所作的修改？」　条件：`this.dw_master.modifiedcount() <> 0 and this.xg_bz = "1"` <sub>窗口事件 closequery</sub>
- 「原凭证不存在」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 u_copy</sub>
- 「科目不是明细科目，不可选。」　条件：`mm_zy <> "1"` <sub>窗口事件 u_find</sub>
- 「生成汇兑损益前，需要先到【外币类型】处填写正确期末汇率！~r     您已经填写好了吗(Y/N)？」 <sub>窗口事件 u_hlgl</sub>
- 「需要到【外币类型】处填写期末汇率吗(Y/N)？」　条件：`i0 > 0` <sub>窗口事件 u_hlgl</sub>
- 「还有未过帐凭证！」　条件：`i > 0` <sub>窗口事件 u_hlgl</sub>
- 「是否删除此凭证，并重新输入？」 <sub>窗口事件 u_new</sub>
- 「第  行需输入现金流量！」　条件：`isnull(xjbm) or len(xjbm) = 0` <sub>窗口事件 u_pzclock</sub>
- 「第  行的现金流量方向有错误！        是否重新输入?」　条件：`jd = "0" and mm_df <> 0` <sub>窗口事件 u_pzclock</sub>
- 「第  行的现金流量方向有错误！        是否重新输入?」　条件：`jd = "1" and mm_jf <> 0` <sub>窗口事件 u_pzclock</sub>
- 「第  行不需输入现金流量！」　条件：`len(xjbm) > 0` <sub>窗口事件 u_pzclock</sub>
- 「审核人和制单人相同不能审核！」　条件：`this.st_zdr1.text = u_name` <sub>窗口事件 u_pzclock</sub>
- 「此凭证已经审核，您是要取消此凭证的审核吗？」 <sub>窗口事件 u_pzclock</sub>
- 「凭证日期超出当前日期太久，不能存盘!」　条件：`(this.nf * 100 + this.yf) > (r1 + 12)` <sub>窗口事件 u_pzsave</sub>
- 「凭证日期超出当前日期，请确认一下凭证日期是否正确!」　条件：`(this.nf * 100 + this.yf) > r1` <sub>窗口事件 u_pzsave</sub>
- 「凭证日期超出本版本程序允许范围，不能存盘! ~r    请进行软件升级!」　条件：`isnull(this.nf) or isnull(this.yf) or (this.nf * 100 + this.yf) < 198001 or (this.nf * 100 + this.yf) > 205012` <sub>窗口事件 u_pzsave</sub>
- 「凭证日期超过了时钟版的截至日期，不能存盘!」　条件：`long(string(gd_tt,"yyyymm")) < (this.nf * 100 + this.yf)` <sub>窗口事件 u_pzsave</sub>
- 「凭证类型错误，不能存盘!」　条件：`isnull(this.pzlx)` <sub>窗口事件 u_pzsave</sub>
- 「请重新输入凭证编号!」　条件：`isnull(this.pzbh)` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录科目录入信息不完全！是否重输？」　条件：`isnull(mm_kmbm) or len(righttrim(lefttrim(mm_kmbm))) = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录需输入现金流向！~r如果你不需要现金流量核算，请到【套账信息】处取消现金流量核算标志！」　条件：`isnull(xjbm) or len(xjbm) = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行的现金流向错误!」　条件：`r1 = -1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的现金流向方向有错误！        是否重新输入?」　条件：`jd = "0" and mm_df <> 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行的现金流向方向有错误！        是否重新输入?」　条件：`jd = "1" and mm_jf <> 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录项目编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录项目编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录项目编码不存在！」　条件：`choice = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录客户编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录客户编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录客户编码不存在！」　条件：`choice = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录部门编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录部门编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录部门编码不存在！」　条件：`choice = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录个人编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录个人编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录个人编码不存在！」　条件：`choice = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录数量未输入！是否重输？」　条件：`isnull(mm_pz_sl) or mm_pz_sl = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录外币金额未输入！是否重输？」　条件：`isnull(mm_pz_wb) or mm_pz_wb = 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的合同不存在!」　条件：`j = 100` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的合同的借贷方向有错误！        是否重新输入?」　条件：`lx = "0" and mm_jf <> 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的合同的借贷方向有错误！        是否重新输入?」　条件：`lx = "2" and mm_df <> 0` <sub>窗口事件 u_pzsave</sub>
- 「第  行分录的合同客户和凭证客户不一致！        是否重新输入?」　条件：`mm_dwbm <> "" and khbh <> mm_dwbm` <sub>窗口事件 u_pzsave</sub>
- 「现金之间流入/流出不平，不能存盘」　条件：`abs(xj_s_jf - xj_s_df) > 0.001` <sub>窗口事件 u_pzsave</sub>
- 「借贷不平，不能存盘!」　条件：`abs(mm_jf - mm_df) > 0.001` <sub>窗口事件 u_pzsave</sub>
- 「财务部分金额不平，不能存盘！」　条件：`i = -1` <sub>窗口事件 u_pzsave</sub>
- 「预算部分金额不平，不能存盘！」　条件：`i = -2` <sub>窗口事件 u_pzsave</sub>
- 「加锁失败！」　条件：`sqlca.sqlcode = -1` <sub>窗口事件 u_pzsave</sub>
- 「凭证编号重复!」　条件：`xx <> "0"` <sub>窗口事件 u_pzsave</sub>
- 「凭证编号重复!是否重输？」　条件：`xx <> "0"` <sub>窗口事件 u_pzsave</sub>
- 「凭证存盘失败！」 <sub>窗口事件 u_pzsave</sub>
- 「科目已经停用，不可选。」　条件：`mm_sybz = "1"` <sub>窗口事件 u_pzxxbz</sub>
- 「模版不存在」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 u_mb</sub>
- 「出纳数据的日期小于结账日期！」　条件：`string(date(xt_cs7),"yyyy.mm") < xt_jzyf` <sub>窗口事件 u_cn_get</sub>
- 「由于您的凭证日期和出纳数据日期不一致，~r 系统将你录入的凭证日期修改为了出纳数据的日期！       敬请留意！」　条件：`string(date(xt_cs7),"yyyy.mm") < xt_jzyf` <sub>窗口事件 u_cn_get</sub>
- 「第  行科目录入信息不完全！是否重输？」　条件：`isnull(mm_kmbm) or len(righttrim(lefttrim(mm_kmbm))) = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行需输入现金流向！~r如果你不需要现金流量核算，请到【套账信息】处取消现金流量核算标志！」　条件：`isnull(xjbm) or len(xjbm) = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行的现金流向方向有错误！        是否重新输入?」　条件：`jd = "0" and mm_df <> 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行项目编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行项目编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行项目编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行客户编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行客户编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行客户编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行部门编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行部门编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行部门编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行个人编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行个人编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行个人编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行 数量未输入！是否重输？」　条件：`isnull(mm_pz_sl) or mm_pz_sl = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行 外币金额未输入！是否重输？」　条件：`isnull(mm_pz_wb) or mm_pz_wb = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「Not found dw_master」　条件：`not isvalid(this.dw_master)` <sub>dw_detail.constructor</sub>
- 「此分录为出纳系统读入，如果修改将取消和出纳系统的挂接，是否修改？」　条件：`s_cn <> ""` <sub>dw_detail.itemchanged</sub>
- 「一般情况下，结转是不选的,除非您是在手工做月度结转凭证！」　条件：`xx = "1"` <sub>dw_detail.itemchanged</sub>
- 「此项目非明细不能选择！」　条件：`xx1 <> "1"` <sub>dw_detail.itemchanged</sub>
- 「如果需要修改凭证，请到【凭证录入】里点【修改】按钮！」　条件：`parent.pz_cs1 > "2"` <sub>dw_master.itemchanged</sub>
- 「此分录为出纳系统读入，如果修改将取消和出纳系统的挂接，是否修改？」　条件：`s_bz = xt_bwb` <sub>dw_master.itemchanged</sub>
- 「此分录为出纳系统读入，如果修改将取消和出纳系统的挂接，是否修改？」　条件：`d1 = 0` <sub>dw_master.itemchanged</sub>
- 「Not found dw_detail」　条件：`not isvalid(this.dw_detail)` <sub>dw_master.constructor</sub>
- 「科目不存在！」　条件：`isnull(i) or i = 0` <sub>dw_master.clicked</sub>
- 「修改凭证类型后，凭证的编号将变化，原来此处的凭证将不存在，造成缺号！ 是否进行？」　条件：`parent.is_bh = "0"` <sub>ddlb_pzlx.modified</sub>
- 「凭证编号重复！」　条件：`i > 0` <sub>em_pzbh.modified</sub>
- 「修改编号后，原来此处的凭证将不存在，造成缺号！ 是否进行？」　条件：`parent.is_bh = "0"` <sub>em_pzbh.modified</sub>
- 「请看看您是否有以下两种情况~r1.所选月份已经结账，不能录入，若要录入，请先反结账；~r2.所选时间为非法日期（如2月30日），请改为正常日期再录」　条件：`mm_date < xt_jzyf` <sub>em_pzrq.modified</sub>
- 「您现在采用的是计算机编号，不能修改年月，否则将破坏整体凭证编号的完整性！~r  如果您一定要修改，请先到【套账信息】处将凭证编号方法修改为手工编号！」　条件：`xt_bhsz = "1"` <sub>em_pzrq.modified</sub>
- 「修改年月后，凭证的编号将变化，原来此处的凭证将不存在，造成缺号！ 是否进行？」　条件：`parent.is_bh = "0"` <sub>em_pzrq.modified</sub>

### `w_pz_pzedit_mb`「凭证模版」

- 「是否存储所作的修改？」　条件：`this.dw_master.modifiedcount() <> 0 and this.xg_bz = "1"` <sub>窗口事件 u_befo</sub>
- 「原凭证不存在」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 u_copy</sub>
- 「科目不是明细科目，不可选。」　条件：`mm_zy <> "1"` <sub>窗口事件 u_find</sub>
- 「生成汇兑损益前，需要先到【外币类型】处填写正确期末汇率！~r     您已经填写好了吗(Y/N)？」 <sub>窗口事件 u_hlgl</sub>
- 「需要到【外币类型】处填写期末汇率吗(Y/N)？」　条件：`i0 > 0` <sub>窗口事件 u_hlgl</sub>
- 「还有未过帐凭证！」　条件：`i > 0` <sub>窗口事件 u_hlgl</sub>
- 「是否删除此凭证，并重新输入？」 <sub>窗口事件 u_new</sub>
- 「第  行需输入现金流量！」　条件：`isnull(xjbm) or len(xjbm) = 0` <sub>窗口事件 u_pzclock</sub>
- 「第  行的现金流量方向有错误！        是否重新输入?」　条件：`jd = "0" and mm_df <> 0` <sub>窗口事件 u_pzclock</sub>
- 「第  行的现金流量方向有错误！        是否重新输入?」　条件：`jd = "1" and mm_jf <> 0` <sub>窗口事件 u_pzclock</sub>
- 「第  行不需输入现金流量！」　条件：`len(xjbm) > 0` <sub>窗口事件 u_pzclock</sub>
- 「审核人和制单人相同不能审核！」　条件：`this.st_zdr1.text = u_name` <sub>窗口事件 u_pzclock</sub>
- 「此凭证已经审核，您是要取消此凭证的审核吗？」 <sub>窗口事件 u_pzclock</sub>
- 「科目已经停用，不可选。」　条件：`mm_sybz = "1"` <sub>窗口事件 u_pzxxbz</sub>
- 「模版不存在」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 u_mb</sub>
- 「出纳数据的日期小于结账日期！」　条件：`string(date(xt_cs7),"yyyy.mm") < xt_jzyf` <sub>窗口事件 u_cn_get</sub>
- 「由于您的凭证日期和出纳数据日期不一致，~r 系统将你录入的凭证日期修改为了出纳数据的日期！       敬请留意！」　条件：`string(date(xt_cs7),"yyyy.mm") < xt_jzyf` <sub>窗口事件 u_cn_get</sub>
- 「第  行科目录入信息不完全！是否重输？」　条件：`isnull(mm_kmbm) or len(righttrim(lefttrim(mm_kmbm))) = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行需输入现金流向！~r如果你不需要现金流量核算，请到【套账信息】处取消现金流量核算标志！」　条件：`isnull(xjbm) or len(xjbm) = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行的现金流向错误!」　条件：`r1 = -1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行的现金流向方向有错误！        是否重新输入?」　条件：`jd = "0" and mm_df <> 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行的现金流向方向有错误！        是否重新输入?」　条件：`jd = "1" and mm_jf <> 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行项目编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行项目编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行项目编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行客户编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行客户编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行客户编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行部门编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行部门编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行部门编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行个人编码未输入！是否重输？」　条件：`fz_bz = "0"` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行个人编码未输入,请输入!」　条件：`choice = 1` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行个人编码不存在！」　条件：`choice = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行 数量未输入！是否重输？」　条件：`isnull(mm_pz_sl) or mm_pz_sl = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「第  行 外币金额未输入！是否重输？」　条件：`isnull(mm_pz_wb) or mm_pz_wb = 0` <sub>窗口事件 wf_pzmb_save</sub>
- 「Not found dw_master」　条件：`not isvalid(this.dw_master)` <sub>dw_detail.constructor</sub>
- 「此分录为出纳系统读入，如果修改将取消和出纳系统的挂接，是否修改？」　条件：`s_cn <> ""` <sub>dw_detail.itemchanged</sub>
- 「一般情况下，结转是不选的,除非您是在手工做月度结转凭证！」　条件：`xx = "1"` <sub>dw_detail.itemchanged</sub>
- 「此项目非明细不能选择！」　条件：`xx1 <> "1"` <sub>dw_detail.itemchanged</sub>
- 「如果需要修改凭证，请到【凭证录入】里点【修改】按钮！」　条件：`parent.pz_cs1 > "2"` <sub>dw_master.itemchanged</sub>
- 「此分录为出纳系统读入，如果修改将取消和出纳系统的挂接，是否修改？」　条件：`s_bz = xt_bwb` <sub>dw_master.itemchanged</sub>
- 「此分录为出纳系统读入，如果修改将取消和出纳系统的挂接，是否修改？」　条件：`d1 = 0` <sub>dw_master.itemchanged</sub>
- 「Not found dw_detail」　条件：`not isvalid(this.dw_detail)` <sub>dw_master.constructor</sub>
- 「科目不存在！」　条件：`isnull(i) or i = 0` <sub>dw_master.clicked</sub>
- 「修改凭证类型后，凭证的编号将变化，原来此处的凭证将不存在，造成缺号！ 是否进行？」　条件：`parent.is_bh = "0"` <sub>ddlb_pzlx.modified</sub>
- 「凭证编号重复！」　条件：`i > 0` <sub>em_pzbh.modified</sub>
- 「修改编号后，原来此处的凭证将不存在，造成缺号！ 是否进行？」　条件：`parent.is_bh = "0"` <sub>em_pzbh.modified</sub>
- 「请看看您是否有以下两种情况~r1.所选月份已经结账，不能录入，若要录入，请先反结账；~r2.所选时间为非法日期（如2月30日），请改为正常日期再录」　条件：`mm_date < xt_jzyf` <sub>em_pzrq.modified</sub>
- 「您现在采用的是计算机编号，不能修改年月，否则将破坏整体凭证编号的完整性！~r  如果您一定要修改，请先到【套账信息】处将凭证编号方法修改为手工编号！」　条件：`xt_bhsz = "1"` <sub>em_pzrq.modified</sub>
- 「修改年月后，凭证的编号将变化，原来此处的凭证将不存在，造成缺号！ 是否进行？」　条件：`parent.is_bh = "0"` <sub>em_pzrq.modified</sub>

### `w_pz_pzmb_add`「增加凭证模版」

- 「没有输入模版编码!」　条件：`len(mbbh) = 0` <sub>cb_ok.clicked</sub>
- 「模版编码重复！」　条件：`i > 0` <sub>cb_ok.clicked</sub>
- 「没有输入模版名称!」　条件：`len(mbmc) = 0` <sub>cb_ok.clicked</sub>

### `w_pz_pzmb_main`「凭证模版维护」

- 「必须输入模版编号！」　条件：`isnull(mbbh) or len(mbbh) = 0` <sub>cb_17.clicked</sub>
- 「必须输入模版名称！」　条件：`isnull(mbmc) or len(mbmc) = 0` <sub>cb_17.clicked</sub>
- 「是否删除      ？」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_3.clicked</sub>
- 「编码重复！是否重输？」　条件：`sqldbcode = -196` <sub>dw_1.dberror</sub>
- 「数据窗口出错！」　条件：`i = 1` <sub>dw_1.dberror</sub>

### `w_pz_pzxsb`「凭证序时簿」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否提换现有的文件？」　条件：`i = 1` <sub>窗口事件 ue_action_out</sub>
- 「导出成功！」 <sub>窗口事件 ue_action_out</sub>
- 「已结账，不能插入凭证！」　条件：`(year(date(xt_jzyf + ".01")) * 100 + month(date(xt_jzyf + ".01"))) > (nf * 100 + yf)` <sub>窗口事件 ue_action_insert</sub>
- 「是否要在年月第号凭证前插入一张凭证？~r     （之后的凭证编号自动加一）」　条件：`(year(date(xt_jzyf + ".01")) * 100 + month(date(xt_jzyf + ".01"))) > (nf * 100 + yf)` <sub>窗口事件 ue_action_insert</sub>
- 「请先将需要审核的凭证查询出来！~r  请问已经查询出来了吗(Y/N)？」　条件：`r < 1` <sub>窗口事件 ue_action_plsh</sub>
- 「年月第号凭证未设置现金流量!  	是否继续?」　条件：`isnull(xjbm) or len(xjbm) = 0` <sub>窗口事件 ue_action_plsh</sub>
- 「本次审核共成功审核张凭证!~r有张凭证由于和制单人相同，未能审核！~r       建议操作易人后再进行审核！」　条件：`r > 0` <sub>窗口事件 ue_action_plsh</sub>
- 「本次审核共成功审核张凭证!」　条件：`r > 0` <sub>窗口事件 ue_action_plsh</sub>
- 「科目不存在！」　条件：`isnull(i) or i = 0` <sub>窗口事件 ue_action_mxz</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「此凭证为其他系统转入，要求不能修改！」　条件：`left(s_qx,1) <> "1"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>

### `w_pz_pzxsb_bak`「凭证序时簿」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否提换现有的文件？」　条件：`i = 1` <sub>窗口事件 ue_action_out</sub>
- 「导出成功！」 <sub>窗口事件 ue_action_out</sub>
- 「已结账，不能插入凭证！」　条件：`(year(date(xt_jzyf + ".01")) * 100 + month(date(xt_jzyf + ".01"))) > (nf * 100 + yf)` <sub>窗口事件 ue_action_insert</sub>
- 「是否要在年月第号凭证前插入一张凭证？~r     （之后的凭证编号自动加一）」　条件：`(year(date(xt_jzyf + ".01")) * 100 + month(date(xt_jzyf + ".01"))) > (nf * 100 + yf)` <sub>窗口事件 ue_action_insert</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>

### `w_pz_pzxsb_see`「凭证查询」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否提换现有的文件？」　条件：`i = 1` <sub>窗口事件 ue_action_out</sub>
- 「导出成功！」 <sub>窗口事件 ue_action_out</sub>
- 「已结账，不能插入凭证！」　条件：`(year(date(xt_jzyf + ".01")) * 100 + month(date(xt_jzyf + ".01"))) > (nf * 100 + yf)` <sub>窗口事件 ue_action_insert</sub>
- 「是否要在年月第号凭证前插入一张凭证？~r     （之后的凭证编号自动加一）」　条件：`(year(date(xt_jzyf + ".01")) * 100 + month(date(xt_jzyf + ".01"))) > (nf * 100 + yf)` <sub>窗口事件 ue_action_insert</sub>
- 「请先将需要审核的凭证查询出来！~r  请问已经查询出来了吗(Y/N)？」　条件：`r < 1` <sub>窗口事件 ue_action_plsh</sub>
- 「年月第号凭证未设置现金流量!  	是否继续?」　条件：`isnull(xjbm) or len(xjbm) = 0` <sub>窗口事件 ue_action_plsh</sub>
- 「本次审核共成功审核张凭证!~r有张凭证由于和制单人相同，未能审核！~r       建议操作易人后再进行审核！」　条件：`r > 0` <sub>窗口事件 ue_action_plsh</sub>
- 「本次审核共成功审核张凭证!」　条件：`r > 0` <sub>窗口事件 ue_action_plsh</sub>
- 「科目不存在！」　条件：`isnull(i) or i = 0` <sub>窗口事件 ue_action_mxz</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「此凭证为其他系统转入，要求不能修改！」　条件：`left(s_qx,1) <> "1"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>

### `w_pz_sz`「制作凭证信息设置」

- 「应付工资栏目应取工资项！」　条件：`left(parent.ddlb_1.text,3) <> "g_l"` <sub>cb_1.clicked</sub>
- 「工资分配栏目应取基本项！」　条件：`left(parent.ddlb_3.text,3) <> "g_j"` <sub>cb_1.clicked</sub>
- 「数据更新失败！」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_1.clicked</sub>

### `w_pz_tjdel`「凭证删除」

- 「是否删除选定的凭证？」　条件：`s_delbz <> "1" or isnull(s_delbz)` <sub>cb_1.clicked</sub>
- 「系统采用计算机编号，只能删除同月同类型的凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`parent.ddlb_1.text = "全部类型" or yf1 <> yf2` <sub>cb_1.clicked</sub>
- 「系统采用计算机编号，只能删除最大号的凭证! ~r如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i > 0` <sub>cb_1.clicked</sub>
- 「是否将后面凭证的编号进行整理，使其编号连续？」　条件：`yf1 = yf2` <sub>cb_1.clicked</sub>

### `w_pz_tjsh`「批量审核」

- 「没有需要审核的凭证！」　条件：`nf = 0 and yf = 0 and xt_cs10 <> "fsh"` <sub>窗口事件 open</sub>
- 「请选择[审核][取消审核].」　条件：`(not parent.rb_1.checked) and (not parent.rb_2.checked)` <sub>cb_1.clicked</sub>
- 「年月第号凭证未设置现金流量!  	是否继续?」　条件：`isnull(xjbm) or len(xjbm) = 0` <sub>cb_1.clicked</sub>
- 「本次审核共成功审核张凭证!~r有张凭证由于和制单人相同，未能审核！~r       建议更换用户后再进行审核！」　条件：`r > 0` <sub>cb_1.clicked</sub>
- 「本次审核共成功审核张凭证!~r  您选择范围内的所有凭证已经全部审核完毕!」　条件：`r > 0` <sub>cb_1.clicked</sub>
- 「本次共成功取消张凭证的审核!」　条件：`sqlca.sqlcode = -1` <sub>cb_1.clicked</sub>

### `w_pz_ttsee`「丁字帐户」

- 「没有选择科目！」　条件：`righttrim(parent.ddlb_1.text) = "" or isnull(parent.ddlb_1.text)` <sub>cb_2.clicked</sub>
- 「该条件范围内没有单据输入！」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_2.clicked</sub>

### `w_pz_zhcx`「综合查询（继承自祖先）」

- 「,请改正；  否则，所有查询条件将被忽略。」　条件：`i > 0` <sub>dw_where.ue_where</sub>
- 「不是字符型,不能使用<含有>或<不含有>操作符,  请改正; 否则，所有查询条件将被忽略。」　条件：`trim(soper) = "like" or trim(soper) = "not like"` <sub>dw_where.ue_where</sub>
- 「的值应为数字型,请改正；  否则，所有查询条件将被忽略。」　条件：`isnumber(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`not isdate(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`svalue = "error"` <sub>dw_where.ue_where</sub>
- 「这个数据类型未在本模块中定义。」 <sub>dw_where.ue_where</sub>

## 套账管理

### `w_tzjl`「套帐管理」

- 「套账数量已经达到本版本的上限，不能再增加了！~r如果您一定要增加套账，请先删除一些不需要的套账后，再增加！」　条件：`i >= gl_tzsl` <sub>cb_1.clicked</sub>
- 「您目前还没有套账，所以无法根据目前套账的数据结构来建立新套账。~r  如果您要增加套账，请找到之前的备份文件，然后选择【引入】!」　条件：`i = 0` <sub>cb_1.clicked</sub>
- 「新增套帐成功，是否进行系统初始化？~r如果您增加套账的目的是为了恢复数据，则不需要初始化！」　条件：`xt_cs10 = "2"` <sub>cb_1.clicked</sub>
- 「是否要复制第套帐？」 <sub>cb_2.clicked</sub>
- 「请先进入其他套账，然后再删除本套账！」　条件：`tz_dm = tz0` <sub>cb_3.clicked</sub>
- 「是否删除第套帐？」　条件：`tz_dm = tz0` <sub>cb_3.clicked</sub>
- 「再次确认是否删除第套帐？~r删除后，此套帐的所有数据将无法恢复！」　条件：`xt_cs2 <> "1"` <sub>cb_3.clicked</sub>
- 「套帐删除时出现错误！」　条件：`sqlca.sqlcode = -1` <sub>cb_3.clicked</sub>
- 「套帐已删除！」　条件：`parent.is_cshbz <> "open"` <sub>cb_3.clicked</sub>

### `w_tzjl_1`「新建套帐」

- 「套账数量已经满了，请先删除部分套账再增加！」　条件：`r1 < 36 and r2 < 36` <sub>窗口事件 open</sub>
- 「不可以使用做套帐代码，请重新设置新增套帐代码！」　条件：`upper(tz0) = "ID" or upper(tz0) = "XL" or upper(tz0) = "ZC" or upper(tz0) = "CS"` <sub>cb_1.clicked</sub>
- 「套帐代码重复，请重新设置新增套帐代码！」　条件：`i > 0` <sub>cb_1.clicked</sub>
- 「需要取消新增套帐吗？」 <sub>cb_2.clicked</sub>

### `w_tzjl_1_new`「新建套帐」

- 「不可以使用做套帐代码，请重新设置新增套帐代码！」　条件：`upper(tz0) = "ID" or upper(tz0) = "XL" or upper(tz0) = "ZC" or upper(tz0) = "CS"` <sub>cb_1.clicked</sub>
- 「套帐代码重复，请重新设置新增套帐代码！」　条件：`i > 0` <sub>cb_1.clicked</sub>
- 「需要取消新增套帐吗？」 <sub>cb_2.clicked</sub>

### `w_tzjl_2`「套帐复制」

- 「不可以使用做套帐代码，请重新设置新增套帐代码！」　条件：`upper(tz0) = "ID" or upper(tz0) = "XL" or upper(tz0) = "ZC" or upper(tz0) = "CS"` <sub>cb_1.clicked</sub>
- 「套帐代码重复，请重新设置套帐代码！」　条件：`i > 0` <sub>cb_1.clicked</sub>
- 「套帐复制成功！」　条件：`sqlca.sqlcode = -1` <sub>cb_1.clicked</sub>

### `w_tzjl_2_bak`「套帐复制」

- 「不可以使用做套帐代码，请重新设置新增套帐代码！」　条件：`upper(tz0) = "ID" or upper(tz0) = "XL" or upper(tz0) = "ZC" or upper(tz0) = "CS"` <sub>cb_1.clicked</sub>
- 「套帐代码重复，请重新设置套帐代码！」　条件：`i > 0` <sub>cb_1.clicked</sub>
- 「套帐复制成功！」　条件：`sqlca.sqlcode = -1` <sub>cb_1.clicked</sub>

### `w_tzjl_get`「引入备份文件」

- 「套账数量已经满了，请先删除部分套账再增加！」　条件：`r1 < 36 and r2 < 36` <sub>窗口事件 open</sub>
- 「不可以使用做套帐代码，请重新设置新增套帐代码！」　条件：`upper(tz0) = "ID" or upper(tz0) = "XL" or upper(tz0) = "ZC" or upper(tz0) = "CS"` <sub>cb_1.clicked</sub>
- 「套帐代码重复，请重新设置新增套帐代码！」　条件：`i > 0` <sub>cb_1.clicked</sub>
- 「备份文件错误！」　条件：`i_bz0 < 0` <sub>cb_1.clicked</sub>
- 「数据库结构文件不存在！」　条件：`left(xx1,15) = "create table ls"` <sub>cb_1.clicked</sub>
- 「报表文件不存在！」　条件：`parent.cbx_1.checked = false` <sub>cb_1.clicked</sub>
- 「打印格式文件不存在！」　条件：`parent.cbx_1.checked = false` <sub>cb_1.clicked</sub>
- 「打印格式文件不存在！」　条件：`parent.cbx_1.checked = false and (gs_cp = "成本会计" or gs_cp = "基建财务")` <sub>cb_1.clicked</sub>
- 「档案文件错误：报表文件不存在！」　条件：`parent.cbx_1.checked = false` <sub>cb_1.clicked</sub>
- 「引入成功！」　条件：`parent.is_cshbz = "open"` <sub>cb_1.clicked</sub>
- 「引入成功！  请重新进入套帐！」 <sub>cb_1.clicked</sub>
- 「需要取消新增套帐吗？」 <sub>cb_2.clicked</sub>
- 「转入将覆盖此套帐的所有数据！！！」 <sub>cb_4.clicked</sub>
- 「转入成功！ 请重新进入本套帐！」　条件：`bz = "0"` <sub>cb_4.clicked</sub>

### `w_tzjl_get_all`「批量引入备份文件」

- 「不可以使用做套帐代码，请重新设置新增套帐代码！」　条件：`upper(tz0) = "ID" or upper(tz0) = "XL" or upper(tz0) = "ZC" or upper(tz0) = "CS"` <sub>窗口事件 wf_add_get</sub>
- 「套帐代码重复，请重新设置新增套帐代码！」　条件：`i > 0` <sub>窗口事件 wf_add_get</sub>
- 「备份文件错误！」　条件：`i_bz0 < 0` <sub>窗口事件 wf_add_get</sub>
- 「数据库结构文件不存在！」　条件：`left(xx1,15) = "create table ls"` <sub>窗口事件 wf_add_get</sub>
- 「报表文件不存在！」　条件：`this.cbx_1.checked = false` <sub>窗口事件 wf_add_get</sub>
- 「打印格式文件不存在！」　条件：`this.cbx_1.checked = false` <sub>窗口事件 wf_add_get</sub>
- 「打印格式文件不存在！」　条件：`this.cbx_1.checked = false and (gs_cp = "成本会计" or gs_cp = "基建财务")` <sub>窗口事件 wf_add_get</sub>
- 「档案文件错误：报表文件不存在！」　条件：`this.cbx_1.checked = false` <sub>窗口事件 wf_add_get</sub>
- 「报表文件不存在！」　条件：`parent.cbx_1.checked = false` <sub>cb_1.clicked</sub>
- 「打印格式文件不存在！」　条件：`parent.cbx_1.checked = false` <sub>cb_1.clicked</sub>
- 「打印格式文件不存在！」　条件：`parent.cbx_1.checked = false and (gs_cp = "成本会计" or gs_cp = "基建财务")` <sub>cb_1.clicked</sub>
- 「档案文件错误：报表文件不存在！」　条件：`parent.cbx_1.checked = false` <sub>cb_1.clicked</sub>
- 「引入成功！」　条件：`parent.is_cshbz = "open"` <sub>cb_1.clicked</sub>
- 「引入成功！  请重新进入套帐！」 <sub>cb_1.clicked</sub>
- 「需要取消新增套帐吗？」 <sub>cb_2.clicked</sub>
- 「转入将覆盖此套帐的所有数据！！！」 <sub>cb_4.clicked</sub>
- 「转入成功！ 请重新进入本套帐！」　条件：`bz = "0"` <sub>cb_4.clicked</sub>

### `w_tzjl_kl`「套帐删除--口令效验」

- 「请输入用户代码！」　条件：`e_n = ""` <sub>cb_1.clicked</sub>
- 「密码错误！」　条件：`upper(kl) <> pwd` <sub>cb_1.clicked</sub>

## 系统设置与初始化

### `w_xt_bmnc`「【（运行时设置）」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>
- 「是否删除-- 项?」　条件：`r = 0` <sub>窗口事件 ue_action_del</sub>
- 「不允许删除!」　条件：`i = 0` <sub>窗口事件 ue_action_del</sub>
- 「本年已经有过账，不能增加期初数!」　条件：`this.xgbz = "1"` <sub>窗口事件 ue_action_new</sub>
- 「请先选择要增加的部门!」　条件：`xmbm = "全部"` <sub>窗口事件 ue_action_new</sub>
- 「请先选择要增加的科目!」　条件：`kmbm = "全部"` <sub>窗口事件 ue_action_new</sub>
- 「已有此项目!」　条件：`i > 0` <sub>窗口事件 ue_action_new</sub>
- 「此科目非数量科目!」　条件：`sls = "0"` <sub>窗口事件 ue_action_new</sub>
- 「此科目非复币科目!」　条件：`fbs = "0"` <sub>窗口事件 ue_action_new</sub>
- 「是否删除所有损益科目的年初数？」　条件：`l > 0` <sub>窗口事件 u_hz</sub>

### `w_xt_bmwh`「部门管理」

- 「是否删除?」 <sub>cb_3.clicked</sub>
- 「已使用，不能删除！」　条件：`r > 0` <sub>cb_3.clicked</sub>
- 「请输入查找条件!」　条件：`isnull(xx) or xx = ""` <sub>cb_9.clicked</sub>
- 「您的编码长度不符合规则！」　条件：`ret = -1` <sub>dw_1.itemchanged</sub>

### `w_xt_dlxx`「操作日志」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>

### `w_xt_dwnc`「【（运行时设置）」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>
- 「是否删除--项?」　条件：`r = 0` <sub>窗口事件 ue_action_del</sub>
- 「不允许删除!」　条件：`i = 0` <sub>窗口事件 ue_action_del</sub>
- 「本年已经有过账，不能增加期初数!」　条件：`this.xgbz = "1"` <sub>窗口事件 ue_action_new</sub>
- 「请先选择要增加的客户!」　条件：`xmbm = "全部"` <sub>窗口事件 ue_action_new</sub>
- 「请先选择要增加的科目!」　条件：`kmbm = "全部"` <sub>窗口事件 ue_action_new</sub>
- 「已有此项目!」　条件：`i > 0` <sub>窗口事件 ue_action_new</sub>
- 「此科目非数量科目!」　条件：`sls = "0"` <sub>窗口事件 ue_action_new</sub>
- 「此科目非复币科目!」　条件：`fbs = "0"` <sub>窗口事件 ue_action_new</sub>
- 「是否删除所有损益科目的年初数？」　条件：`l > 0` <sub>窗口事件 u_hz</sub>

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

### `w_xt_fbwh`「外币管理」

- 「此项目为本位币，不能删除！」　条件：`bwbz = "1"` <sub>cb_3.clicked</sub>
- 「此币种已使用，不能删除！」　条件：`i > 0` <sub>cb_3.clicked</sub>
- 「是否删除？」　条件：`i > 0` <sub>cb_3.clicked</sub>

### `w_xt_grnc`「人员期初余额录入（运行时设置）」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>
- 「是否删除-- 项?」　条件：`r = 0` <sub>窗口事件 ue_action_del</sub>
- 「不允许删除!」　条件：`i = 0` <sub>窗口事件 ue_action_del</sub>
- 「本年已经有过账，不能增加期初数!」　条件：`this.xgbz = "1"` <sub>窗口事件 ue_action_new</sub>
- 「请先选择要增加的人员!」　条件：`xmbm = "全部"` <sub>窗口事件 ue_action_new</sub>
- 「请先选择要增加的科目!」　条件：`kmbm = "全部"` <sub>窗口事件 ue_action_new</sub>
- 「已有此项目!」　条件：`i > 0` <sub>窗口事件 ue_action_new</sub>
- 「此科目非数量科目!」　条件：`sls = "0"` <sub>窗口事件 ue_action_new</sub>
- 「此科目非复币科目!」　条件：`fbs = "0"` <sub>窗口事件 ue_action_new</sub>
- 「是否删除所有损益科目的年初数？」　条件：`l > 0` <sub>窗口事件 u_hz</sub>

### `w_xt_grwh`「人员管理」

- 「是否删除?」 <sub>cb_3.clicked</sub>
- 「已使用，不能删除！」　条件：`r > 0` <sub>cb_3.clicked</sub>
- 「请输入查找条件!」　条件：`isnull(xx) or xx = ""` <sub>cb_9.clicked</sub>
- 「您的编码长度不符合规则！」　条件：`ret = -1` <sub>dw_1.itemchanged</sub>

### `w_xt_gs_edit`「计算公式定义」

- 「没有输入公式名!」　条件：`isnull(gsmc) or gsmc = ""` <sub>cb_1.clicked</sub>
- 「没有输入来源项计算公式!」　条件：`isnull(gsmc) or gsmc = ""` <sub>cb_1.clicked</sub>
- 「没有输入目标项!」　条件：`isnull(gsmc) or gsmc = ""` <sub>cb_1.clicked</sub>
- 「语法错」　条件：`sqlca.sqlcode = -1` <sub>cb_1.clicked</sub>
- 「语法错today函数少')'!」　条件：`j = 0` <sub>cb_1.clicked</sub>
- 「语法错today函数少'('!」　条件：`k = 0 or k > j` <sub>cb_1.clicked</sub>
- 「语法错daybefore函数少')'!」　条件：`j = 0` <sub>cb_1.clicked</sub>
- 「语法错daybefore函数少'('!」　条件：`k = 0 or k > j` <sub>cb_1.clicked</sub>
- 「语法错daybefore函数少','!」　条件：`pos(gsmc,",",i) = 0 or pos(gsmc,",",i) > j or pos(gsmc,",",i) < k` <sub>cb_1.clicked</sub>
- 「语法错daybefore函数少参数!」　条件：`trim(mid(gsmc,k + 1,l - 1)) = "" or trim(mid(gsmc,l + 1,j - 1)) = ""` <sub>cb_1.clicked</sub>
- 「语法错monthbefore函数少')'!」　条件：`j = 0` <sub>cb_1.clicked</sub>
- 「语法错monthbefore函数少'('!」　条件：`k = 0 or k > j` <sub>cb_1.clicked</sub>
- 「语法错monthbefore函数少','!」　条件：`pos(gsmc,",",i) = 0 or pos(gsmc,",",i) > j or pos(gsmc,",",i) < k` <sub>cb_1.clicked</sub>
- 「语法错monthbefore函数少参数!」　条件：`trim(mid(gsmc,k + 1,l - 1)) = "" or trim(mid(gsmc,l + 1,j - 1)) = ""` <sub>cb_1.clicked</sub>
- 「数据更新失败!」　条件：`parent.dw_2.update(true,false) = -1` <sub>cb_1.clicked</sub>

### `w_xt_gssz`「计算公式定义」

- 「删除该计算公式吗？」 <sub>cb_4.clicked</sub>
- 「没有公式可修改！」　条件：`parent.dw_1.rowcount() = 0` <sub>cb_5.clicked</sub>

### `w_xt_jslb`「结算类别管理」

- 「不允许删空结算类别！」　条件：`i = 1` <sub>cb_3.clicked</sub>
- 「结算类别重复！是否重输？」　条件：`sqldbcode = -196` <sub>dw_1.dberror</sub>
- 「数据窗口出错！」　条件：`i = 1` <sub>dw_1.dberror</sub>

### `w_xt_jzwh`「结转类型维护」

- 「凭证类型不得为空，请选择凭证类型！」　条件：`xx = "" and xx1 <> ""` <sub>cb_4.clicked</sub>
- 「转入/转出科目重复！是否重输？」　条件：`i = -1` <sub>cb_4.clicked</sub>
- 「转入科目数不等于 1 个！是否重输？」　条件：`i <> 1` <sub>cb_4.clicked</sub>
- 「转出科目数小于 1 个！是否重输？」　条件：`i < 1` <sub>cb_4.clicked</sub>
- 「非明细科目，不能作为转入科目！」　条件：`yjd = "0"` <sub>dw_2.itemchanged</sub>

### `w_xt_kgzb`「系统初始化--口令验证」

- 「口令错误！」　条件：`xx <> upper(xx1)` <sub>cb_1.clicked</sub>

### `w_xt_kgzb_0`「系统初始化--向导选择」

- 「本功能只能在数据库服务器所在电脑上进行操作!」　条件：`xt_netbz = "T" and i = 1` <sub>cb_1.clicked</sub>

### `w_xt_kgzb_1`「系统初始化--信息确认」

- 「套账名称不得为空，请检查！」　条件：`isnull(xx) or xx = ""` <sub>cb_1.clicked</sub>
- 「使用单位名称不得为空，请检查！」　条件：`isnull(xx) or xx = ""` <sub>cb_1.clicked</sub>
- 「您的建账日期可能过小，请检查！」　条件：`date(parent.em_kzrq.text) < date("1949.01.01")` <sub>cb_1.clicked</sub>
- 「您必须选择一种会计制度，请检查！」　条件：`isnull(xx) or xx = ""` <sub>cb_1.clicked</sub>
- 「您选择的会计准则是 [用户自定义会计准则] ~r这样系统将不会自动生成任何会计科目~r系统已经预设了各个行业的会计准则，最好选择一下 ~r ~r确认不需要系统的预置会计科目吗？」　条件：`xx = "99"` <sub>cb_1.clicked</sub>
- 「请设定科目级数！」　条件：`kmjs < 1` <sub>cb_1.clicked</sub>
- 「第级科目长度不得为空！」　条件：`isnull(ln[i]) or ln[i] = 0` <sub>cb_1.clicked</sub>
- 「科目长度合计不能超过位字符！」　条件：`seg[i] > xt_km_cd` <sub>cb_1.clicked</sub>
- 「必需输入本位币！」　条件：`len(xx) = 0` <sub>cb_1.clicked</sub>
- 「您确认要放弃系统初始化吗？」 <sub>cb_2.clicked</sub>
- 「我国规定的会计期间都是从1月到12月！~r您确定要将会计期间从月开始吗？」　条件：`integer(xx) = 1` <sub>em_kjqj.modified</sub>

### `w_xt_kgzb_2`「系统初始化--执行操作」

- 「档案文件错误：报表文件不存在！」　条件：`fileexists(ls_filename) = false` <sub>窗口事件 wf_ini</sub>
- 「此套账为主套账，初始化后的科目体系将影响所有分套账，可能导致所有分套账都需要初始化。~r               是否执行？」　条件：`lx = "0" and tz_dm = "ZW00"` <sub>cb_1.clicked</sub>
- 「系统初始化将删除本套账现有的所有凭证，是否进行？」　条件：`isnull(rtn) or rtn > 0` <sub>cb_1.clicked</sub>
- 「系统初始化将删除本套账现有的所有凭证，是否进行？」　条件：`messagebox(xt_ts,"系统初始化将删除本套账现有的所有凭证，是否进行？",stopsign!,yesno!,2) = 2` <sub>cb_1.clicked</sub>
- 「确认要执行系统初始化吗？」　条件：`messagebox("再次确认","系统初始化将删除本套账现有的所有凭证，是否进行？",question!,yesno!,2) = 2` <sub>cb_1.clicked</sub>
- 「建立行业会计科目失败！」　条件：`rtn = -1` <sub>cb_1.clicked</sub>
- 「建立行业会计报表失败！」　条件：`rtn = -2` <sub>cb_1.clicked</sub>
- 「建立行业会计报表失败！」　条件：`rtn = -3` <sub>cb_1.clicked</sub>
- 「建立行业会计报表失败！」　条件：`rtn = -1` <sub>cb_1.clicked</sub>
- 「系统初始化完毕！」 <sub>cb_1.clicked</sub>
- 「您确认要放弃系统初始化吗？」 <sub>cb_2.clicked</sub>

### `w_xt_kgzb_3`「一键初始」

- 「档案文件错误：报表文件不存在！」　条件：`fileexists(ls_filename) = false` <sub>窗口事件 wf_ini</sub>
- 「套账名称不得为空，请检查！」　条件：`isnull(xx) or xx = ""` <sub>cb_1.clicked</sub>
- 「使用单位名称不得为空，请检查！」　条件：`isnull(xx) or xx = ""` <sub>cb_1.clicked</sub>
- 「您的建账日期可能过小，请检查！」　条件：`date(parent.em_kzrq.text) < date("1949-01-01")` <sub>cb_1.clicked</sub>
- 「您必须选择一种会计制度，请检查！」　条件：`isnull(xx) or xx = ""` <sub>cb_1.clicked</sub>
- 「您选择的会计准则是 [用户自定义会计准则] ~r这样系统将不会自动生成任何会计科目~r系统已经预设了各个行业的会计准则，最好选择一下 ~r ~r确认不需要系统的预置会计科目吗？」　条件：`xx = "99"` <sub>cb_1.clicked</sub>
- 「此套账为主套账，初始化后的科目体系将影响所有分套账，可能导致所有分套账都需要初始化。~r               是否执行？」　条件：`lx = "0" and tz_dm = "ZW00"` <sub>cb_1.clicked</sub>
- 「系统初始化将删除本套账现有的所有凭证并重建会计科目及报表 	请确认是否进行？」　条件：`isnull(rtn) or rtn > 0` <sub>cb_1.clicked</sub>
- 「系统初始化将删除本套账现有的所有凭证并重建会计科目及报表 	请确认是否进行？」　条件：`messagebox(xt_ts,"系统初始化将删除本套账现有的所有凭证并重建会计科目及报表~r~n~t请确认是否进行？",stopsign!,yesno!,2) <> 1` <sub>cb_1.clicked</sub>
- 「系统初始化将重建会计科目及报表，现有的会计科目及报表将被删除 	请确认是否进行？」　条件：`rtn > 0` <sub>cb_1.clicked</sub>
- 「确认要执行系统初始化吗？」　条件：`messagebox(xt_ts,"系统初始化将重建会计科目及报表，现有的会计科目及报表将被删除~r~n~t请确认是否进行？",stopsign!,yesno!,2) <> 1` <sub>cb_1.clicked</sub>
- 「建立行业会计科目失败！」　条件：`rtn = -1` <sub>cb_1.clicked</sub>
- 「建立行业会计报表失败！」　条件：`rtn = -2` <sub>cb_1.clicked</sub>
- 「建立行业会计报表失败！」　条件：`rtn = -3` <sub>cb_1.clicked</sub>
- 「系统初始化完毕！」 <sub>cb_1.clicked</sub>
- 「您确认要放弃系统初始化吗？」 <sub>cb_2.clicked</sub>

### `w_xt_kgzb_a1`「系统初始化--套账名称」

- 「是否退出系统初始化的进程？」 <sub>cb_2.clicked</sub>

### `w_xt_kgzb_a2`「系统初始化--行业选择」

- 「您必须选择一种会计制度，请检查！」　条件：`isnull(xx) or xx = ""` <sub>cb_1.clicked</sub>
- 「您选择的会计准则是 [用户自定义会计准则] ~r这样系统将不会自动生成任何会计科目~r系统已经预设了各个行业的会计准则，最好选择一下 ~r ~r确认不需要系统的预置会计科目吗？」　条件：`xx = "99"` <sub>cb_1.clicked</sub>
- 「是否退出系统初始化的进程？」 <sub>cb_2.clicked</sub>

### `w_xt_kgzb_a3`「系统初始化--科目设定」

- 「请设定科目级数！」　条件：`kmjs < 1` <sub>cb_1.clicked</sub>
- 「第级科目长度不得为空！」　条件：`isnull(ln[i]) or ln[i] = 0` <sub>cb_1.clicked</sub>
- 「科目长度合计不能超过位字符！」　条件：`seg[i] > xt_km_cd` <sub>cb_1.clicked</sub>
- 「是否退出系统初始化的进程？」 <sub>cb_2.clicked</sub>

### `w_xt_kgzb_a4`「系统初始化--外币设定」

- 「是否退出系统初始化的进程？」 <sub>cb_2.clicked</sub>

### `w_xt_kgzb_a5`「系统初始化--开账日期选择」

- 「我国规定的会计期间都是从1月到12月！~r您确定要将会计期间从月开始吗？」　条件：`integer(xx) = 1` <sub>cb_1.clicked</sub>
- 「是否退出系统初始化的进程？」 <sub>cb_2.clicked</sub>

### `w_xt_kgzb_gz`「人事工资系统初始化」

- 「口令错误！」　条件：`xx <> upper(left(xx1,8))` <sub>cb_1.clicked</sub>
- 「开工准备后所有数据将清除，并不可恢复！是否进行？」　条件：`xx <> upper(left(xx1,8))` <sub>cb_1.clicked</sub>
- 「工资初始化完成！」 <sub>cb_1.clicked</sub>

### `w_xt_kgzb_zc`「固定资产初始化」

- 「用户密码错误！」　条件：`xx <> upper(left(xx1,8))` <sub>cb_1.clicked</sub>
- 「系统初始化后所有固定资产数据将清除，并不可恢复！        是否进行？」　条件：`xx <> upper(left(xx1,8))` <sub>cb_1.clicked</sub>

### `w_xt_kmbm_edit`「修改科目编码」

- 「请注意，如果您使用的是网络版，进行该操作 时请将其他客户端的财务软件都退出，确保只 有本机在运行财务软件后再操作！ 	 要进行操作吗？」 <sub>pb_1.clicked</sub>
- 「请输入要修改的科目编码！」　条件：`isnull(o_km) or o_km = ""` <sub>pb_1.clicked</sub>
- 「请输入要修改的目标科目编码！」　条件：`isnull(n_km) or n_km = ""` <sub>pb_1.clicked</sub>
- 「原科目和目标科目编码相同，不能修改！」　条件：`o_km = n_km` <sub>pb_1.clicked</sub>
- 「原科目和目标科目编码长度不相同，不能修改！」　条件：`len(o_km) <> len(n_km)` <sub>pb_1.clicked</sub>
- 「要修改的科目编码不存在，请检查！」　条件：`i = 0` <sub>pb_1.clicked</sub>
- 「目标科目编码已经存在，请检查！」　条件：`i <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改失败，原因如下：」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改成功，是否继续修改其他科目？」 <sub>pb_1.clicked</sub>
- 「您输入的科目编码不存在，请检查！」　条件：`i = 0` <sub>sle_1.modified</sub>

### `w_xt_kmbm_edit_bak`「修改科目编码」

- 「请注意，如果您使用的是网络版，进行该操作 时请将其他客户端的财务软件都退出，确保只 有本机在运行财务软件后再操作！ 	 要进行操作吗？」 <sub>pb_1.clicked</sub>
- 「请输入要修改的科目编码！」　条件：`isnull(o_km) or o_km = ""` <sub>pb_1.clicked</sub>
- 「请输入要修改的目标科目编码！」　条件：`isnull(n_km) or n_km = ""` <sub>pb_1.clicked</sub>
- 「原科目和目标科目编码相同，不能修改！」　条件：`o_km = n_km` <sub>pb_1.clicked</sub>
- 「原科目和目标科目编码长度不相同，不能修改！」　条件：`len(o_km) <> len(n_km)` <sub>pb_1.clicked</sub>
- 「要修改的科目编码不存在，请检查！」　条件：`i = 0` <sub>pb_1.clicked</sub>
- 「目标科目编码已经存在，请检查！」　条件：`i <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改失败，原因如下：bmnc」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改失败，原因如下：dwnc」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改失败，原因如下：fbgl」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改失败，原因如下：grnc」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改失败，原因如下：hz」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改失败，原因如下：jzlx」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改失败，原因如下：nc」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改失败，原因如下：pz」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改失败，原因如下：xmnc」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改失败，原因如下：yhdzd」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改失败，原因如下：kmbm」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码修改成功，是否继续修改其他科目？」 <sub>pb_1.clicked</sub>
- 「您输入的科目编码不存在，请检查！」　条件：`i = 0` <sub>sle_1.modified</sub>

### `w_xt_kmbm_get`「导入科目」

- 「请输入需要引入的科目文件！」　条件：`parent.sle_1.text = "" or isnull(parent.sle_1.text = "")` <sub>cb_2.clicked</sub>
- 「路径文件不存在或读入错！」　条件：`filehand = -1` <sub>cb_2.clicked</sub>
- 「没有读入到数据！~r 请检查科目文件的格式是否正确！」　条件：`r = 0` <sub>cb_2.clicked</sub>
- 「科目编码库无数据！」　条件：`l3 = 0` <sub>cb_2.clicked</sub>
- 「长度不符合规定！」　条件：`i > xt_len0` <sub>cb_2.clicked</sub>
- 「上级科目不存在！」　条件：`l1 = 0` <sub>cb_2.clicked</sub>
- 「文件不存在！」　条件：`i <> 1` <sub>cb_3.clicked</sub>

### `w_xt_kmbm_len`「修改科目编码长度」

- 「此版本不能变更科目长度！」　条件：`tz_lx = "zgkj_jt"` <sub>窗口事件 open</sub>
- 「请先增加第级」　条件：`ilevel > (parent.i_kmjs + 1)` <sub>em_6.modified</sub>
- 「请注意，如果您使用的是网络版，进行该操作 时请将其他客户端的财务软件都退出，确保只 有本机在运行财务软件后再操作！ 	 要进行操作吗？」 <sub>pb_1.clicked</sub>
- 「无法识别正确的科目级数！」　条件：`isnull(i) or i = 0` <sub>pb_1.clicked</sub>
- 「请输入要修改的科目级数！」　条件：`isnull(ilevel) or ilevel = 0` <sub>pb_1.clicked</sub>
- 「科目级数必须在1至范围内！」　条件：`ilevel < 1 or ilevel > xt_len0` <sub>pb_1.clicked</sub>
- 「科目级数长度不能跨级调整！」　条件：`(ilevel - i) > 1` <sub>pb_1.clicked</sub>
- 「请输入要增加至的位数！」　条件：`isnull(add_len) or add_len = 0` <sub>pb_1.clicked</sub>
- 「科目总长度只能增加至位，请检查！」　条件：`(xt_seg[xt_len0] + add_len) > xt_km_cd` <sub>pb_1.clicked</sub>
- 「科目长度只能增加，您输入的增加至的位数不正确！」　条件：`add_len < 1` <sub>pb_1.clicked</sub>
- 「科目填充字符串长度不够！」　条件：`len(addstr) < add_len` <sub>pb_1.clicked</sub>
- 「增加的长度大于该级科目的原始长度，无法使用该科目的前位字符填充科目编码！」　条件：`add_len > km_len` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：xt」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更成功，是否继续增加？」 <sub>pb_1.clicked</sub>

### `w_xt_kmbm_len_bak`「修改科目编码长度」

- 「请先增加第级」　条件：`ilevel > (parent.i_kmjs + 1)` <sub>em_6.modified</sub>
- 「请注意，如果您使用的是网络版，进行该操作 时请将其他客户端的财务软件都退出，确保只 有本机在运行财务软件后再操作！ 	 要进行操作吗？」 <sub>pb_1.clicked</sub>
- 「无法识别正确的科目级数！」　条件：`isnull(i) or i = 0` <sub>pb_1.clicked</sub>
- 「请输入要修改的科目级数！」　条件：`isnull(ilevel) or ilevel = 0` <sub>pb_1.clicked</sub>
- 「科目级数必须在1至范围内！」　条件：`ilevel < 1 or ilevel > xt_len0` <sub>pb_1.clicked</sub>
- 「科目级数长度不能跨级调整！」　条件：`(ilevel - i) > 1` <sub>pb_1.clicked</sub>
- 「请输入要增加至的位数！」　条件：`isnull(add_len) or add_len = 0` <sub>pb_1.clicked</sub>
- 「科目总长度只能增加至位，请检查！」　条件：`(xt_seg[xt_len0] + add_len) > xt_km_cd` <sub>pb_1.clicked</sub>
- 「科目长度只能增加，您输入的增加至的位数不正确！」　条件：`add_len < 1` <sub>pb_1.clicked</sub>
- 「科目填充字符串长度不够！」　条件：`len(addstr) < add_len` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：bmnc」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：dwnc」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：fbgl」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：grnc」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：hz」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：jzlx」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：nc」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：pz」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：xmnc」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：yhdzd」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：cn_nc」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：cn_hz」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：cn_mx」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：kmbm」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「增加的长度大于该级科目的原始长度，无法使用该科目的前位字符填充科目编码！」　条件：`add_len > km_len` <sub>pb_1.clicked</sub>
- 「科目编码长度变更失败，原因如下：xt」　条件：`sqlca.sqlcode <> 0` <sub>pb_1.clicked</sub>
- 「科目编码长度变更成功，是否继续增加？」 <sub>pb_1.clicked</sub>

### `w_xt_kmbm_replace`「科目编码字符替换」

- 「请输入要修改的科目编码！」　条件：`isnull(o_km) or o_km = ""` <sub>窗口事件 wf_kmbm_replace</sub>
- 「请输入要修改的目标科目编码！」　条件：`isnull(n_km) or n_km = ""` <sub>窗口事件 wf_kmbm_replace</sub>
- 「原科目和目标科目编码相同，不能修改！」　条件：`o_km = n_km` <sub>窗口事件 wf_kmbm_replace</sub>
- 「原科目和目标科目编码长度不相同，不能修改！」　条件：`len(o_km) <> len(n_km)` <sub>窗口事件 wf_kmbm_replace</sub>
- 「要修改的科目编码不存在，请检查！」　条件：`i = 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「目标科目编码已经存在，请检查！」　条件：`i <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「请注意，如果您使用的是网络版，进行该操作 时请将其他客户端的财务软件都退出，确保只 有本机在运行财务软件后再操作！ 	 要进行操作吗？」 <sub>cb_1.clicked</sub>
- 「请输入要查找的字符！」　条件：`isnull(o_km) or o_km = ""` <sub>cb_1.clicked</sub>
- 「请输入要替换的字符！」　条件：`isnull(n_km) or n_km = ""` <sub>cb_1.clicked</sub>
- 「查找字符和替换字符相同！」　条件：`o_km = n_km` <sub>cb_1.clicked</sub>
- 「查找字符和替换字符长度不相同！」　条件：`len(o_km) <> len(n_km)` <sub>cb_1.clicked</sub>
- 「替换完成！」　条件：`ls_old_km <> ls_new_km` <sub>cb_1.clicked</sub>

### `w_xt_kmbm_replace_bak`「科目编码字符替换」

- 「请输入要修改的科目编码！」　条件：`isnull(o_km) or o_km = ""` <sub>窗口事件 wf_kmbm_replace</sub>
- 「请输入要修改的目标科目编码！」　条件：`isnull(n_km) or n_km = ""` <sub>窗口事件 wf_kmbm_replace</sub>
- 「原科目和目标科目编码相同，不能修改！」　条件：`o_km = n_km` <sub>窗口事件 wf_kmbm_replace</sub>
- 「原科目和目标科目编码长度不相同，不能修改！」　条件：`len(o_km) <> len(n_km)` <sub>窗口事件 wf_kmbm_replace</sub>
- 「要修改的科目编码不存在，请检查！」　条件：`i = 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「目标科目编码已经存在，请检查！」　条件：`i <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：bmnc」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：dwnc」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：fbgl」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：grnc」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：hz」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：jzlx」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：nc」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：pz」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：xmnc」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：yhdzd」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：cn_nc」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：cn_mx」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：cn_hz」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「科目编码修改失败，原因如下：kmbm」　条件：`sqlca.sqlcode <> 0` <sub>窗口事件 wf_kmbm_replace</sub>
- 「请注意，如果您使用的是网络版，进行该操作 时请将其他客户端的财务软件都退出，确保只 有本机在运行财务软件后再操作！ 	 要进行操作吗？」 <sub>cb_1.clicked</sub>
- 「请输入要查找的字符！」　条件：`isnull(o_km) or o_km = ""` <sub>cb_1.clicked</sub>
- 「请输入要替换的字符！」　条件：`isnull(n_km) or n_km = ""` <sub>cb_1.clicked</sub>
- 「查找字符和替换字符相同！」　条件：`o_km = n_km` <sub>cb_1.clicked</sub>
- 「查找字符和替换字符长度不相同！」　条件：`len(o_km) <> len(n_km)` <sub>cb_1.clicked</sub>
- 「替换完成！」　条件：`ls_old_km <> ls_new_km` <sub>cb_1.clicked</sub>

### `w_xt_kmbmchange`「科目编码调整」

- 「此版本不能变更科目！」　条件：`tz_lx = "zgkj_jt"` <sub>窗口事件 open</sub>
- 「您已经录入了凭证，不能再引入【科目】了！」　条件：`r > 1` <sub>cb_get.clicked</sub>
- 「凭证引入成功！」　条件：`xt_cs2 = "1"` <sub>cb_get.clicked</sub>
- 「凭证引入失败！」　条件：`xt_cs2 = "1"` <sub>cb_get.clicked</sub>

### `w_xt_kmwh`「科目维护」

- 「是否还要继续增加科目？」 <sub>cb_2.clicked</sub>
- 「本级科目只有一个，是否要删除它并且科目缩减一级？」　条件：`i = 2 and kmjs > 1` <sub>cb_3.clicked</sub>
- 「年初数(含辅助核算)不为零,不允许删除!」　条件：`nc_jf <> 0 or nc_df <> 0 or jq_jf <> 0 or jq_df <> 0` <sub>cb_3.clicked</sub>
- 「已有发生额,不允许删除!」　条件：`i > 0` <sub>cb_3.clicked</sub>
- 「是否删除科目?」　条件：`i > 0` <sub>cb_3.clicked</sub>
- 「科目全称整理完毕！」 <sub>cb_8.clicked</sub>
- 「请输入查找条件!」　条件：`isnull(xx) or xx = ""` <sub>cb_9.clicked</sub>

### `w_xt_kmwh_1`「科目修改」

- 「本级科目已满，请增加本级科目位数！」　条件：`r > kmws` <sub>窗口事件 wf_kmbm_add</sub>
- 「此科目编码已经存在!  是否重新输入？」　条件：`i > 0` <sub>cb_1.clicked</sub>
- 「科目编码长度不符合定义要求!您的科目编码规则是即第一级位,第二级位,以此类推    是否重新输入？」　条件：`kmjs = 0` <sub>cb_1.clicked</sub>
- 「此科目的上级科目不存在!  是否重新输入？」　条件：`i = 0` <sub>cb_1.clicked</sub>
- 「请确认此科目的余额方向是吗？」　条件：`kmjs = 1` <sub>cb_1.clicked</sub>
- 「请再次确认此科目的余额方向是吗？」　条件：`xx = "借"` <sub>cb_1.clicked</sub>
- 「此科目的余额方向和上级科目的不一致！~r请确认此科目的余额方向是吗？」　条件：`yefx <> xx2` <sub>cb_1.clicked</sub>
- 「非资产和负债科目一般不能有复币属性!~r请确定是要修改此科目的复币属性？」　条件：`left(parent.kmbm,1) > "2"` <sub>cb_1.clicked</sub>
- 「外币年初数不为零,不允许修改!」　条件：`nc_jf <> 0 or nc_df <> 0 or jq_jf <> 0 or jq_df <> 0` <sub>cb_1.clicked</sub>
- 「已有外币发生额,不允许修改!」　条件：`i <> 0` <sub>cb_1.clicked</sub>
- 「数量年初数不为零,不允许修改!」　条件：`nc_jf <> 0 or nc_df <> 0 or jq_jf <> 0 or jq_df <> 0` <sub>cb_1.clicked</sub>
- 「已有数量发生额,不允许修改!」　条件：`i <> 0` <sub>cb_1.clicked</sub>
- 「科目编码长度不符合定义要求!您的科目编码规则是即第一级位,第二级位,以此类推」　条件：`kmjs = 0` <sub>dw_1.itemchanged</sub>
- 「此科目的上级科目不存在!」　条件：`i = 0` <sub>dw_1.itemchanged</sub>
- 「只有库存现金、银行存款、其他货币资金科目才可以选择！」　条件：`pos(xx1,"现金") = 0 and pos(xx1,"银行") = 0 and pos(xx1,"货币资金") = 0` <sub>dw_1.itemchanged</sub>

### `w_xt_kmwh_cfjc`「科目名称重复性检查」

- 「结算类别重复！是否重输？」　条件：`sqldbcode = -196` <sub>dw_1.dberror</sub>
- 「数据窗口出错！」　条件：`i = 1` <sub>dw_1.dberror</sub>

### `w_xt_kmwh_copy`「从其他套帐转入科目」

- 「转入固定资产数据将删除本套帐原有数据！~r           是否进行(Y/N) ?」　条件：`parent.cbx_2.checked = true` <sub>cb_ok.clicked</sub>
- 「~r 请进行固定资产的初始化！」　条件：`sqlca.sqlcode = -1` <sub>cb_ok.clicked</sub>
- 「固定资产转入完毕」　条件：`sqlca.sqlcode = -1` <sub>cb_ok.clicked</sub>
- 「转入工资数据将删除本套帐原有数据！~r           是否进行(Y/N) ?」　条件：`parent.cbx_gz.checked = true` <sub>cb_ok.clicked</sub>
- 「工资系统转入完毕」　条件：`sqlca.sqlcode = -1` <sub>cb_ok.clicked</sub>
- 「二级及以后的科目长度不对，不能转入！」　条件：`len2 <> xt_len2 or len3 <> xt_len3 or len4 <> xt_len4 or len5 <> xt_len5 or len6 <> xt_len6` <sub>cb_ok.clicked</sub>
- 「您已经进行了过帐处理，不能再转入！」　条件：`r > 1` <sub>cb_ok.clicked</sub>
- 「请确认选择的科目无误，如果错误，将无法恢复！」　条件：`r > 1` <sub>cb_ok.clicked</sub>
- 「请再一次确认选择的科目无误，如果错误，将无法恢复！」　条件：`messagebox(xt_ts,"请确认选择的科目无误，如果错误，将无法恢复！",question!,yesno!,2) = 2` <sub>cb_ok.clicked</sub>
- 「您已经录入了二级科目，不能再转入！」　条件：`r > 1` <sub>cb_ok.clicked</sub>
- 「您已经录入了凭证，不能再转入！」　条件：`r > 1` <sub>cb_ok.clicked</sub>
- 「对于没有对应科目的凭证,系统将使用科目：」　条件：`parent.cbx_pz.checked` <sub>cb_ok.clicked</sub>
- 「您必须进行综合检查 科目编码和年初数！」　条件：`sqlca.sqlcode = -1` <sub>cb_ok.clicked</sub>

### `w_xt_pass0`「系统密码设定」

- 「新密码错误！」　条件：`mod(r1 * xt_kl_pass,10000) <> r2` <sub>cb_1.clicked</sub>

### `w_xt_pzlx`「凭证类型管理」

- 「不允许删空凭证类别！」　条件：`i = 1` <sub>cb_3.clicked</sub>
- 「是否删除?」　条件：`i = 1` <sub>cb_3.clicked</sub>
- 「凭证类别已经使用,不允许删！」　条件：`isnull(xx) or len(trim(xx)) = 0` <sub>cb_3.clicked</sub>

### `w_xt_pzlx_zj`「凭证类型增加」

- 「凭证类型代码重复！」　条件：`i > 0` <sub>cb_1.clicked</sub>

### `w_xt_szb_zc`「时钟版新用户注册」

- 「请输入姓名！」　条件：`isnull(xt_cs2) or xt_cs2 = ""` <sub>cb_1.clicked</sub>
- 「请输入QQ！」　条件：`isnull(xt_cs4) or xt_cs4 = ""` <sub>cb_1.clicked</sub>
- 「请输入手机！」　条件：`isnull(xt_cs5) or xt_cs5 = ""` <sub>cb_1.clicked</sub>
- 「请输入省份！」　条件：`isnull(xt_cs7) or xt_cs7 = ""` <sub>cb_1.clicked</sub>
- 「请输入城市！」　条件：`isnull(xt_cs8) or xt_cs8 = ""` <sub>cb_1.clicked</sub>
- 「不进行注册，软件将退出，是否退出？」　条件：`xt_zt0 = 5` <sub>cb_2.clicked</sub>

### `w_xt_user`「操作易人」

- 「???」　条件：`len(xlh) = 0 and cs_1 = 0` <sub>sle_password.rbuttondown</sub>

### `w_xt_users`「用户管理」

- 「MANAGER不能修改！」　条件：`upper(xx) = "MANAGER"` <sub>cb_2.clicked</sub>
- 「MANAGER不能删除！」　条件：`upper(xx2) = "MANAGER"` <sub>cb_3.clicked</sub>
- 「您不能不能删除自己！」　条件：`xx = suid` <sub>cb_3.clicked</sub>
- 「确实是否删除操作员：？」　条件：`xx = suid` <sub>cb_3.clicked</sub>
- 「是否清除操作员：的登录密码？」 <sub>cb_6.clicked</sub>
- 「MANAGER不能修改！」　条件：`upper(xt_cs2) = "MANAGER"` <sub>cb_7.clicked</sub>
- 「用户编码重复！是否重输？」　条件：`sqldbcode = -196` <sub>dw_1.dberror</sub>
- 「数据窗口出错！」　条件：`i = 1` <sub>dw_1.dberror</sub>

### `w_xt_uses_zj`「增加用户」

- 「登录代码重复！」　条件：`i > 0` <sub>cb_1.clicked</sub>

### `w_xt_wh`「修改编号」

- 「编号重复！」　条件：`i > 0` <sub>cb_1.clicked</sub>
- 「转换完毕！」 <sub>cb_1.clicked</sub>

### `w_xt_xmnc`「【（运行时设置）」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>
- 「是否删除-- 项?」　条件：`r = 0` <sub>窗口事件 ue_action_del</sub>
- 「不允许删除!」　条件：`i = 0` <sub>窗口事件 ue_action_del</sub>
- 「本年已经有过账，不能增加期初数!」　条件：`this.xgbz = "1"` <sub>窗口事件 ue_action_new</sub>
- 「请先选择要增加的项目!」　条件：`xmbm = "全部"` <sub>窗口事件 ue_action_new</sub>
- 「请先选择要增加的科目!」　条件：`kmbm = "全部"` <sub>窗口事件 ue_action_new</sub>
- 「已有此项目!」　条件：`i > 0` <sub>窗口事件 ue_action_new</sub>
- 「此科目非数量科目!」　条件：`sls = "0"` <sub>窗口事件 ue_action_new</sub>
- 「此科目非复币科目!」　条件：`fbs = "0"` <sub>窗口事件 ue_action_new</sub>
- 「是否删除所有损益科目的年初数？」　条件：`l > 0` <sub>窗口事件 u_hz</sub>

### `w_xt_xmwh`「核算项目」

- 「是否删除?」 <sub>cb_3.clicked</sub>
- 「已使用，不能删除！」　条件：`r > 0` <sub>cb_3.clicked</sub>
- 「请输入查找条件!」　条件：`isnull(xx) or xx = ""` <sub>cb_9.clicked</sub>
- 「您的编码长度不符合规则！」　条件：`ret = -1` <sub>dw_1.itemchanged</sub>

### `w_xt_ye`「期初余额录入」

- 「年期初库还未建立！」　条件：`f_xt_ncye(this.nf) = -1` <sub>窗口事件 open</sub>
- 「是否存储所作的修改？」　条件：`this.dw_master.modifiedcount() <> 0` <sub>窗口事件 close</sub>
- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>
- 「余额借贷不平！年初借方余额：」　条件：`string(xt_kzrq,"mm") = "01"` <sub>窗口事件 ue_action_save</sub>
- 「年初借方余额：」　条件：`string(xt_kzrq,"mm") = "01"` <sub>窗口事件 ue_action_save</sub>

### `w_xt_ye_nf`「选择年份」

- 「小于开帐年份!」　条件：`nf < nf0` <sub>cb_1.clicked</sub>

### `w_xt_zy`「摘要管理」

- 「摘要编码重复！是否重输？」　条件：`i = -1` <sub>cb_4.clicked</sub>

## 账册打印/输出

### `w_zc_dlz`「多栏账」

- 「无 此 科 目 !」　条件：`i = 100` <sub>cb_1.clicked</sub>
- 「此科目为明细科目，不能生成多栏明细帐！」　条件：`xx1 = "1"` <sub>cb_1.clicked</sub>
- 「此科目为明细科目，不能生成多栏明细帐！」　条件：`yjd = "1"` <sub>cb_3.clicked</sub>

### `w_zc_dlz_1`「多栏账」

- 「建立数据窗口不成功！~r 可能是下级科目太多，内存不足！」　条件：`i = -1` <sub>窗口事件 open</sub>
- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「没有记录，无法显示及预览！」　条件：`this.dw_1.rowcount() = 0` <sub>窗口事件 user_prt</sub>
- 「下面打印多栏帐正页！」　条件：`this.dw_1.rowcount() = 0` <sub>窗口事件 user_prt</sub>
- 「下面打印多栏帐附页！第  页」 <sub>窗口事件 user_prt</sub>
- 「没有记录，无法显示及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 ue_action_preview</sub>
- 「多栏账的列数超过248，无法另存！」　条件：`this.kmsl > 248` <sub>窗口事件 ue_action_saveas</sub>

### `w_zc_fhdlz`「辅助多栏账」

- 「无 此 科 目 !」　条件：`i = 100` <sub>cb_1.clicked</sub>
- 「此科目为明细科目，不能生成多栏明细帐！」　条件：`xx1 = "1"` <sub>cb_1.clicked</sub>
- 「此科目为明细科目，不能生成多栏明细帐！」　条件：`yjd = "1"` <sub>cb_3.clicked</sub>

### `w_zc_fhdlz_1`「多栏账」

- 「建立数据窗口不成功！~r 可能是下级科目太多，内存不足！」　条件：`this.i = -1` <sub>窗口事件 open</sub>
- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「没有记录，无法显示及预览！」　条件：`this.dw_1.rowcount() = 0` <sub>窗口事件 user_prt</sub>
- 「下面打印多栏帐正页！」　条件：`this.dw_1.rowcount() = 0` <sub>窗口事件 user_prt</sub>
- 「下面打印多栏帐附页！第  页」 <sub>窗口事件 user_prt</sub>
- 「没有记录，无法显示及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 ue_action_preview</sub>
- 「多栏账的列数超过248，无法另存！」　条件：`this.kmsl > 248` <sub>窗口事件 ue_action_saveas</sub>

### `w_zc_fhdlz_1_bak`「多栏账」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「没有记录，无法显示及预览！」　条件：`this.dw_1.rowcount() = 0` <sub>窗口事件 user_prt</sub>
- 「下面打印多栏帐正页！」　条件：`this.dw_1.rowcount() = 0` <sub>窗口事件 user_prt</sub>
- 「下面打印多栏帐附页！第  页」 <sub>窗口事件 user_prt</sub>
- 「没有记录，无法显示及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 ue_action_preview</sub>

### `w_zc_fhslz_1`「三栏明细账（继承自祖先）」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「是否导出?」 <sub>窗口事件 ue_saveas</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>

### `w_zc_fhslz_1_bak`「三栏明细账（继承自祖先）」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>

### `w_zc_fzslz_fb`「三栏复币明细账」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>

### `w_zc_fzslz_sl`「三栏明细账（继承自祖先）」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>

### `w_zc_sblb`「设备类别维护」

- 「科目不是明细科目，不可选。」　条件：`mm_zy <> "1"` <sub>dw_master.doubleclicked</sub>
- 「科目已经停用，不可选。」　条件：`mm_sybz = "1"` <sub>dw_master.doubleclicked</sub>

### `w_zc_sblb_bak`「设备类别」

- 「该类别已使用，不能被删除！」　条件：`l > 0` <sub>cb_2.clicked</sub>
- 「删除该 类别吗？」　条件：`l > 0` <sub>cb_2.clicked</sub>
- 「编号必须要输入!」　条件：`xx = ""` <sub>cb_3.clicked</sub>
- 「数据更数失败!」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_3.clicked</sub>

### `w_zc_sbyt`「用途维护」

- 「科目不是明细科目，不可选。」　条件：`mm_zy <> "1"` <sub>dw_master.doubleclicked</sub>
- 「科目已经停用，不可选。」　条件：`mm_sybz = "1"` <sub>dw_master.doubleclicked</sub>

### `w_zc_sbyt_bak`「用途维护」

- 「该用途已使用，不能被删除！」　条件：`l > 0` <sub>cb_2.clicked</sub>
- 「删除该 用途吗？」　条件：`l > 0` <sub>cb_2.clicked</sub>
- 「编号必须要输入!」　条件：`xx = ""` <sub>cb_3.clicked</sub>
- 「数据更数失败!」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_3.clicked</sub>

### `w_zc_sbzt_bak`「设备状态」

- 「该状态已使用，不能被删除！」　条件：`l > 0` <sub>cb_2.clicked</sub>
- 「删除该 状态吗？」　条件：`l > 0` <sub>cb_2.clicked</sub>
- 「编号必须要输入!」　条件：`xx = ""` <sub>cb_3.clicked</sub>
- 「数据更数失败!」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_3.clicked</sub>

### `w_zc_sbzx_bak`「设备状态」

- 「该注销原因已使用，不能被删除！」　条件：`l > 0` <sub>cb_2.clicked</sub>
- 「删除该 注销原因吗？」　条件：`l > 0` <sub>cb_2.clicked</sub>
- 「编号必须要输入!」　条件：`xx = ""` <sub>cb_3.clicked</sub>
- 「数据更数失败!」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_3.clicked</sub>

### `w_zc_slz`「明细账」

- 「科目不存在！」　条件：`i <> 1` <sub>cb_1.clicked</sub>

### `w_zc_slz_1`「三栏明细账」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>
- 「无符合条件的科目!」　条件：`this.kmbm_rowmax = 0` <sub>窗口事件 wf_open</sub>

### `w_zc_slz_1_bak`「三栏明细账」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「导出数据成功!」　条件：`dw2execl.uf_toexcel(this.dw_3,"三栏明细账","单位名称：" + xt_dwmc,"      期间：从" + string(this.yf1) + "月到" + string(this.yf2) + "月","主管：                       审核：          ` <sub>窗口事件 ue_saveas</sub>
- 「导出数据失败!」　条件：`dw2execl.uf_toexcel(this.dw_3,"三栏明细账","单位名称：" + xt_dwmc,"      期间：从" + string(this.yf1) + "月到" + string(this.yf2) + "月","主管：                       审核：          ` <sub>窗口事件 ue_saveas</sub>
- 「此凭证已经审核或者过账，不能修改！」　条件：`xx <> "0"` <sub>窗口事件 ue_action_modify</sub>
- 「无符合条件的科目!」　条件：`this.kmbm_rowmax = 0` <sub>窗口事件 wf_open</sub>

### `w_zc_slz_fb`「三栏明细账（继承自祖先）」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>
- 「无符合条件的科目!」　条件：`this.kmbm_rowmax = 0` <sub>窗口事件 wf_open</sub>

### `w_zc_slz_sl`「三栏明细账（继承自祖先）」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>
- 「无符合条件的科目!」　条件：`this.kmbm_rowmax = 0` <sub>窗口事件 wf_open</sub>

### `w_zc_slz_slfb`「三栏明细账（继承自祖先）」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>
- 「无符合条件的科目!」　条件：`this.kmbm_rowmax = 0` <sub>窗口事件 wf_open</sub>

### `w_zc_sydw_bak`「部门维护」

- 「该部门已使用，不能被删除！」　条件：`l = 0` <sub>cb_2.clicked</sub>
- 「删除该 部门吗？」　条件：`l = 0` <sub>cb_2.clicked</sub>
- 「编号必须要输入!」　条件：`xx = ""` <sub>cb_3.clicked</sub>
- 「数据更数失败!」　条件：`parent.dw_1.update(true,false) = -1` <sub>cb_3.clicked</sub>

### `w_zc_xjll_1`「现金流量试算平衡表」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>
- 「无符合条件的科目!」　条件：`this.kmbm_rowmax = 0` <sub>窗口事件 wf_open</sub>

### `w_zc_xjrjz`「日记账」

- 「科目不存在！」　条件：`i <> 1` <sub>cb_1.clicked</sub>

### `w_zc_xjrjz_1`「现金日记账」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>
- 「无符合条件的科目!」　条件：`this.kmbm_rowmax = 0` <sub>窗口事件 wf_open</sub>

### `w_zc_xjrjz_fb`「现金复币日记账」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>
- 「无符合条件的科目!」　条件：`this.kmbm_rowmax = 0` <sub>窗口事件 wf_open</sub>

### `w_zc_yhrjz`「银行日记帐」

- 「科目不存在！」　条件：`i <> 1` <sub>cb_1.clicked</sub>

### `w_zc_yhrjz_1`「银行日记账」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>
- 「无符合条件的科目!」　条件：`this.kmbm_rowmax = 0` <sub>窗口事件 wf_open</sub>

### `w_zc_yhrjz_fb`「银行复币日记账」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>
- 「无符合条件的科目!」　条件：`this.kmbm_rowmax = 0` <sub>窗口事件 wf_open</sub>

### `w_zc_zc`「总分类账」

- 「科目不存在！」　条件：`i <> 1` <sub>cb_1.clicked</sub>

### `w_zc_zc_1`「总分类账」

- 「无符合条件的科目!」　条件：`this.kmbm_rowmax = 0` <sub>窗口事件 open</sub>
- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>
- 「下面打印科目」　条件：`xz_bz = "1"` <sub>窗口事件 user_prt_lx</sub>
- 「您没有凭证录入权限，只能用查看方式打开凭证」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您不能修改别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已过帐，不能修改！~r您需要【反过帐】后才可以修改！」　条件：`xx = "2"` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您需要换一个有审核权限的用户进入，来取消审核！」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「第号凭证已做审核记帐，不能修改！~r您是否需要将此凭证取消审核后进行修改？」　条件：`i0 = 0` <sub>窗口事件 ue_action_modify</sub>
- 「您没有凭证删除权限」　条件：`i0 = 0` <sub>窗口事件 ue_action_del</sub>
- 「您不能删除别人做的凭证！」　条件：`zdr <> u_name` <sub>窗口事件 ue_action_del</sub>
- 「凭证已做审核，不能删除！」　条件：`xx > "0"` <sub>窗口事件 ue_action_del</sub>
- 「系统采用计算机编号，只能删除同月同类型的最大号凭证! ~r 如须删除非最大号凭证，请在【系统管理】菜单下【套帐信息】里将凭证编号方法改为手工编号。」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`i0 <> pzbh` <sub>窗口事件 ue_action_del</sub>
- 「是否删除号凭证？~r删除后此凭证将不能恢复！」　条件：`messagebox(sappname,"是否删除" + xx1 + "号凭证？~r删除后此凭证将不能恢复！",question!,yesno!,2) = 2` <sub>窗口事件 ue_action_del</sub>
- 「导出数据成功!」　条件：`dw2execl.uf_toexcel(this.dw_3,"总分类帐","单位名称：" + xt_dwmc,"      期间：从" + string(this.yf1) + "月到" + string(this.yf2) + "月","主管：                       审核：           ` <sub>窗口事件 ue_action_save</sub>
- 「导出数据失败!」　条件：`dw2execl.uf_toexcel(this.dw_3,"总分类帐","单位名称：" + xt_dwmc,"      期间：从" + string(this.yf1) + "月到" + string(this.yf2) + "月","主管：                       审核：           ` <sub>窗口事件 ue_action_save</sub>

### `w_zc_zcgl`「固定资产管理」

- 「此设备已提折旧，不允许删除！」　条件：`i > 0` <sub>窗口事件 ue_action_del</sub>
- 「是否删除」　条件：`i > 0` <sub>窗口事件 ue_action_del</sub>
- 「请先增加设备类别！」　条件：`r = 0` <sub>窗口事件 ue_action_new</sub>
- 「请先增加设备状态！」　条件：`r = 0` <sub>窗口事件 ue_action_new</sub>
- 「请先增加用途！」　条件：`r = 0` <sub>窗口事件 ue_action_new</sub>
- 「请先增加部门！」　条件：`r = 0` <sub>窗口事件 ue_action_new</sub>
- 「是否包括已注销的设备？」 <sub>窗口事件 ue_action_refresh</sub>
- 「存盘失败！」　条件：`i = 1` <sub>窗口事件 ue_action_save</sub>
- 「年度无资产减少!」　条件：`this.dw_master.rowcount() = 0` <sub>窗口事件 u_prt_ndjs</sub>
- 「此设备没有附属设备!」　条件：`r = 0` <sub>窗口事件 u_prt_fssb</sub>
- 「本功能将查询出来的设备重新按使用日期开始计算累计折旧~r之前的累计折旧将全部改写，按【存盘】后，将不可恢复！~r是否进行(Y/N)?」 <sub>窗口事件 ue_action_zjjs</sub>
- 「此处是填写设备的使用年限(按月计算)!~r 此设备是否只能使用个月? 请查证!」　条件：`r < 30` <sub>dw_master.itemchanged</sub>

## 固定资产

### `w_zcgl_delete`「注销设备」

- 「注销日期不能小于已经计提折旧日期！」　条件：`s1 < string(xt_dlrq,"yyyy-mm")` <sub>cb_1.clicked</sub>
- 「是否生成凭证?」　条件：`s1 = string(xt_dlrq,"yyyy-mm")` <sub>cb_1.clicked</sub>

### `w_zcgl_kp`「固定资产卡片」

- 「请输入设备编号!」　条件：`xx = ""` <sub>cb_1.clicked</sub>
- 「请输入设备名称!」　条件：`xx = ""` <sub>cb_1.clicked</sub>
- 「请输入状态!」　条件：`xx = ""` <sub>cb_1.clicked</sub>
- 「请输入类别!」　条件：`xx = ""` <sub>cb_1.clicked</sub>
- 「请输入折旧方法!」　条件：`xx = ""` <sub>cb_1.clicked</sub>
- 「请输入用途!」　条件：`xx = ""` <sub>cb_1.clicked</sub>
- 「请输入使用日期!」　条件：`dd1 = date(1900,1,1)` <sub>cb_1.clicked</sub>
- 「请输入原值!」　条件：`d1 = 0` <sub>cb_1.clicked</sub>
- 「请输入使用年限!」　条件：`d1 = 0` <sub>cb_1.clicked</sub>
- 「编号重复！」　条件：`i > 0` <sub>cb_1.clicked</sub>
- 「设备编号已被修改，系统将更改所有相关数据          是否进行？」　条件：`i > 0` <sub>cb_1.clicked</sub>
- 「设备编号已被修改，系统将更改所有相关数据                是否进行？」　条件：`parent.cx_bz = "2" and parent.bh <> parent.old_bh` <sub>cb_3.clicked</sub>
- 「此处是填写设备的使用年限(按月计算)!~r 此设备是否只能使用个月? 请查证!」　条件：`d2 < 30` <sub>dw_1.itemchanged</sub>

### `w_zcgl_kp_fssb`「附属设备清单」

- 「有不能为空数据项未输!」 <sub>dw_1.dberror</sub>
- 「数据提交出错，请检查!」 <sub>dw_1.dberror</sub>
- 「编号不能重复!」 <sub>dw_1.dberror</sub>

### `w_zcgl_label`「打印固定资产标签」

- 「没有记录，无法打印及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 open</sub>

### `w_zcgl_prtmxz`「打印固定资产明细帐」

- 「没有记录，无法打印及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 open</sub>

### `w_zcgl_prtmxz_bak`「打印固定资产明细帐」

- 「没有记录，无法打印及预览！」　条件：`pub_print_dw.rowcount() = 0` <sub>窗口事件 open</sub>

### `w_zcgl_yztz`「原值调整」

- 「调整后的原值和资产表的原值不一致！~r系统自动进行了调整，如果认可，点一下【确认】」　条件：`abs(d_d1 - this.id_yz) > 0.005` <sub>窗口事件 open</sub>
- 「是否删除此原值调整？」 <sub>cb_3.clicked</sub>

## 固定资产折旧

### `w_zjgl`「折旧查询」

- 「是否将窗口格式记录下来(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_setdw</sub>
- 「是否将窗口格式恢复成标准格式(Y/N)? ~r 退出软件重新进入后才生效!」 <sub>窗口事件 ue_action_getdw</sub>
- 「是否包含所有单据?」　条件：`this.is_sm_bz = "1"` <sub>窗口事件 ue_action_refresh</sub>
- 「数据量较大时刷新比较慢，可以采用定位查询！~r       是否进行?」 <sub>窗口事件 ue_action_refresh</sub>

### `w_zjgl_cx`「综合查询（继承自祖先）」

- 「,请改正；  否则，所有查询条件将被忽略。」　条件：`i > 0` <sub>dw_where.ue_where</sub>
- 「不是字符型,不能使用<含有>或<不含有>操作符,  请改正; 否则，所有查询条件将被忽略。」　条件：`trim(soper) = "like" or trim(soper) = "not like"` <sub>dw_where.ue_where</sub>
- 「的值应为数字型,请改正；  否则，所有查询条件将被忽略。」　条件：`isnumber(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`not isdate(svalue)` <sub>dw_where.ue_where</sub>
- 「的值应为日期型,格式不对，请改正!~r日期格式应当类似为 2018-01-20」　条件：`svalue = "error"` <sub>dw_where.ue_where</sub>
- 「这个数据类型未在本模块中定义。」 <sub>dw_where.ue_where</sub>

## 账务与账簿查询

### `w_zw_fgz`「反过账」

- 「请输入起止月份范围！」　条件：`trim(parent.em_1.text) = "" or trim(parent.em_2.text) = ""` <sub>cb_1.clicked</sub>
- 「月已经结帐，不能反过帐！」　条件：`(string(parent.nf,"0000") + "." + string(parent.yf,"00")) < xt_jzyf` <sub>cb_1.clicked</sub>

### `w_zw_fhslye`「辅助项目库存数量金额表」

- 「科目不存在！」　条件：`i <> 1` <sub>cb_1.clicked</sub>

### `w_zw_fhslye_1`「辅助项目库存数量金额表」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_zw_fhwbye`「辅助项目外币余额表」

- 「科目不存在！」　条件：`i <> 1` <sub>cb_1.clicked</sub>

### `w_zw_fhwbye_1`「辅助项目外币余额表」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_zw_fhye`「辅助项目余额表」

- 「科目不存在！」　条件：`i <> 1` <sub>cb_1.clicked</sub>

### `w_zw_fhye_1`「辅助项目余额表」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_zw_fhye_1_bak`「辅助汇总余额表(（运行时设置）」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_zw_fz`「结账」

- 「结账日期超过了时钟版的截至日期!」　条件：`long(string(gd_tt,"yyyymm")) < (parent.nf * 100 + parent.yf)` <sub>cb_1.clicked</sub>
- 「本月还有未过账凭证, 不能结账!」　条件：`i > 0` <sub>cb_1.clicked</sub>
- 「本月凭证编号不连续! ~r  缺少号凭证!~r是否由系统自动进行调整(Y/N)?」　条件：`pzbh = j` <sub>cb_1.clicked</sub>
- 「系统自动进行调整将改变后面的凭证编号~r将影响已经打印过的凭证和帐册!~r        是否进行(Y/N)?」　条件：`messagebox(sappname,"   本月凭证编号不连续! ~r" + "  缺少" + xx + string(j) + "号凭证!~r是否由系统自动进行调整(Y/N)?",question!,yesno!,2) = 1` <sub>cb_1.clicked</sub>
- 「系统自动调整完毕!~r请重新结帐!」　条件：`messagebox(sappname,"系统自动进行调整将改变后面的凭证编号~r将影响已经打印过的凭证和帐册!~r        是否进行(Y/N)?",question!,yesno!,2) = 1` <sub>cb_1.clicked</sub>
- 「凭证编号不连续! ~r  缺少号凭证!~r是否由系统自动进行调整(Y/N)?」　条件：`k = 0` <sub>cb_1.clicked</sub>
- 「系统自动进行调整将改变后面的凭证编号~r将影响已经打印过的凭证和帐册!~r       是否进行(Y/N)?」　条件：`messagebox(sappname,"   凭证编号不连续! ~r" + "  缺少" + xx + string(pzbh) + "号凭证!~r是否由系统自动进行调整(Y/N)?",question!,yesno!,2) = 1` <sub>cb_1.clicked</sub>
- 「系统自动调整完毕!~r请重新结帐!」　条件：`messagebox(sappname,"系统自动进行调整将改变后面的凭证编号~r将影响已经打印过的凭证和帐册!~r       是否进行(Y/N)?",question!,yesno!,2) = 1` <sub>cb_1.clicked</sub>

### `w_zw_jz`「凭证过账」

- 「没有需要过账的凭证！」　条件：`r = 0` <sub>窗口事件 open</sub>
- 「此月份已经结账了！」　条件：`xx < xt_jzyf` <sub>cb_1.clicked</sub>
- 「过账日期超过了时钟版的截至日期!」　条件：`long(string(gd_tt,"yyyymm")) < (parent.nf * 100 + parent.yf)` <sub>cb_1.clicked</sub>
- 「年初数不平，不能进行过帐处理！~r点[确定]进入[期初录入]进行修改！」　条件：`abs(s_nc_jf - s_nc_df) > 0.005 or abs(s_jq_jf - s_jq_df) > 0.005` <sub>cb_1.clicked</sub>
- 「未进行」　条件：`parent.nf > integer(left(xt_jzyf,4))` <sub>cb_1.clicked</sub>
- 「此月份已经结账了！」　条件：`parent.nf < integer(left(xt_jzyf,4))` <sub>cb_1.clicked</sub>
- 「请先录入期初数！」　条件：`l_row_nf = 0` <sub>cb_1.clicked</sub>
- 「未进行」　条件：`l_row_nf = 0` <sub>cb_1.clicked</sub>
- 「已经结帐，不能过帐！」　条件：`(string(parent.nf,"0000") + "." + string(parent.yf,"00")) < xt_jzyf` <sub>cb_1.clicked</sub>
- 「您的试用版数据量已经超过限定，不能过帐！」　条件：`i > 500` <sub>cb_1.clicked</sub>
- 「是否还要重新生成在运行【月度结转】时系统自动生成的凭证?」　条件：`xx0 = "0"` <sub>cb_1.clicked</sub>
- 「凭证汇总出错!」　条件：`i = -1` <sub>cb_1.clicked</sub>
- 「还有  张凭证因为未审核此次没有能够过账！~r 无法重新生成自动结转凭证 ~r 请重新审核过账后再运行【月度结转】」　条件：`i > 0` <sub>cb_1.clicked</sub>
- 「自动生成结转凭证出错!」　条件：`i = -1` <sub>cb_1.clicked</sub>
- 「凭证过账出错!」　条件：`i = -1` <sub>cb_1.clicked</sub>
- 「还有  张凭证因为未审核此次没有能够过账！」　条件：`i > 0` <sub>cb_1.clicked</sub>

### `w_zw_jz_pl`「凭证过帐」

- 「年初数不平，不能进行过帐处理！」　条件：`abs(s_nc_jf - s_nc_df) > 0.005 or abs(s_jq_jf - s_jq_df) > 0.005` <sub>窗口事件 open</sub>
- 「未进行上年度年终结转！」　条件：`parent.nf <> integer(left(xt_jzyf,4))` <sub>cb_1.clicked</sub>
- 「未进行上年度年终结转！」　条件：`parent.yf < xt_kjqj and parent.nf <> (bbnf + 1) or (parent.yf >= xt_kjqj and parent.nf <> bbnf)` <sub>cb_1.clicked</sub>
- 「已经结帐，不能过帐！」　条件：`(string(parent.nf,"0000") + "." + string(parent.yf,"00")) < xt_jzyf` <sub>cb_1.clicked</sub>
- 「您的试用版数据量已经超过限定，不能过帐！」　条件：`i > 500` <sub>cb_1.clicked</sub>
- 「是否还要重新自动生成结转凭证?」　条件：`i > 0` <sub>cb_1.clicked</sub>
- 「凭证汇总出错!」　条件：`i = -1` <sub>cb_1.clicked</sub>
- 「自动生成结转凭证出错!」　条件：`i = -1` <sub>cb_1.clicked</sub>

### `w_zw_qxfz`「反结账」

- 「已经反结账到了开账日期了！~r您的开账日期是」　条件：`i = nf1 and j = yf1` <sub>窗口事件 open</sub>
- 「系统反结帐将删除年的年初数！~r            是否执行(Y/N)?」　条件：`parent.yf > 1` <sub>cb_1.clicked</sub>

### `w_zw_slye`「库存数量金额表」

- 「科目不存在！」　条件：`i <> 1` <sub>cb_1.clicked</sub>

### `w_zw_slye_1`「库存数量金额表」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_zw_wbye`「外币余额表」

- 「科目不存在！」　条件：`i <> 1` <sub>cb_1.clicked</sub>

### `w_zw_wbye_1`「外币余额表」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_zw_ydjz`「月度结转」

- 「未进行」　条件：`parent.nf > integer(left(xt_jzyf,4))` <sub>cb_1.clicked</sub>
- 「未进行」　条件：`parent.yf < xt_kjqj and parent.nf < (bbnf + 1) or (parent.yf >= xt_kjqj and parent.nf < bbnf)` <sub>cb_1.clicked</sub>
- 「已经结帐，不能再做月度结转！~r如果需要做，请先反结账！」　条件：`(string(parent.nf,"0000") + "." + string(parent.yf,"00")) < xt_jzyf` <sub>cb_1.clicked</sub>
- 「本月还有  张凭证未过帐,不能自动结转!」　条件：`i > 0` <sub>cb_1.clicked</sub>

### `w_zw_ydjz_1`「月度结转——生成凭证」

- 「请先确认结转顺序是否正确？」　条件：`s_bz = "" or isnull(s_bz)` <sub>cb_1.clicked</sub>
- 「凭证汇总出错!」　条件：`i = -1` <sub>cb_1.clicked</sub>
- 「结转凭证生成完毕!」 <sub>cb_1.clicked</sub>

### `w_zw_ydjz_1_bak`「月度结转——生成凭证」

- 「自动生成结转凭证出错!」　条件：`i = -1` <sub>cb_1.clicked</sub>
- 「结转凭证转出金额为零!」　条件：`i = -2` <sub>cb_1.clicked</sub>
- 「凭证汇总出错!」　条件：`i = -1` <sub>cb_1.clicked</sub>
- 「是否还要继续生成其余结转凭证?」　条件：`parent.ddlb_1.totalitems() > parent.ii` <sub>cb_1.clicked</sub>

### `w_zw_ydjz_1_bak1`「月度结转」

- 「请先确认结转顺序是否正确？」 <sub>cb_1.clicked</sub>
- 「凭证汇总出错!」　条件：`i = -1` <sub>cb_1.clicked</sub>
- 「结转凭证生成完毕!」 <sub>cb_1.clicked</sub>

### `w_zw_ye`「汇总余额表」

- 「科目不存在！」　条件：`i <> 1` <sub>cb_1.clicked</sub>

### `w_zw_ye_1`「汇总余额表」

- 「有数据未存盘, 退出前是否存盘 ?」　条件：`this.dw_master.ib_need_save` <sub>窗口事件 closequery</sub>
- 「存盘不成功，请检查。」　条件：`message.returnvalue = 1` <sub>窗口事件 closequery</sub>

### `w_zw_ye_bak`「汇总余额表」

- 「科目不存在！」　条件：`i <> 1` <sub>cb_1.clicked</sub>

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

### 全局函数 `f_jzmonth`

- 「将上月数据转入下月？」
- 「已有数据，是否保留？」　条件：`l > 0`

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
