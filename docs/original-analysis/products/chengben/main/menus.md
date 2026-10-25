# 成本会计 · 账务+成本主程序 — 菜单结构

菜单文字、快捷键、显示状态取自菜单对象 create 事件的属性赋值；“→”为 clicked 事件中静态打开的窗口（含经全局函数打开的）。“〔默认隐藏〕”的项可能在运行时按版本、权限或 OEM 由脚本显示。PB 规则：后代菜单继承祖先全部菜单项，祖先中 ShiftToRight 的项排在后代新增项之后。

## 主菜单栏：账务（`m_frame_zw`）——主框架默认菜单

- **F.文件** <sub>m_system</sub>
  - **关闭窗口 Ctrl+F4** 快捷键 `Ctrl+F4` → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_system_closesheet</sub>
  - **关闭所有窗口** → `w_main1`「主窗口」 <sub>m_system_closeall</sub>
  - **切换套账** → `w_login`「用户登录」、`w_login_oem`「用户登录」、`w_bakupdata`「切换套账（取自菜单文字）」 <sub>m_system_trans</sub>
  - ———（分隔线）
  - **打印机设置** → 脚本：`printsetup()` <sub>m_system_printset</sub>
  - **屏幕打印 Shift+P** 快捷键 `Shift+P` → 脚本：`long job` <sub>m_system_printscreen</sub>
  - **工具条设置** 〔默认隐藏〕 → `w_setbar`「工具条设置」 <sub>m_system_barset</sub>
  - ———（分隔线）
  - **系统注册** 〔默认隐藏〕 <sub>m_xtzc</sub>
  - **模块管理** 〔默认隐藏〕 → `w_module`「模块维护」 <sub>m_module</sub>
  - **用户管理** → `w_xt_users`「用户管理」 <sub>m_useright</sub>
  - **自改密码** → `w_pass`「自改密码」 <sub>m_changepswd</sub>
  - ———（分隔线）
  - **退出系统 Alt+X** 快捷键 `Alt+X` → 脚本：`close(mainwindow)` <sub>m_system_exit</sub>
- **O日常业务** <sub>m_o</sub>
  - **凭证管理** <sub>m_o10</sub>
    - **凭证输入** → `w_pz_pzxsb`「凭证序时簿」 <sub>m_o10_10</sub>
    - **浏览查询** → `w_pz_see`「凭证浏览查看」 <sub>m_o10_20</sub>
    - **凭证审核** → `w_pz_tjsh`「批量审核」 <sub>m_pzsh</sub>
    - **凭证过帐** → `w_zw_jz`「凭证过账」 <sub>m_o10_30</sub>
    - **批量过帐** 〔默认隐藏〕 <sub>m_pzgz_pl</sub>
  - **账务处理** <sub>m_o20</sub>
    - **月度结转** → `w_zw_ydjz`「月度结转」 <sub>m_o20_15</sub>
    - **结帐** → `w_zw_fz`「结账」 <sub>m_o20_20</sub>
    - ———（分隔线）
    - **汇总余额表** → `w_zw_ye`「汇总余额表」 <sub>m_o20_30</sub>
    - **外币余额表** → `w_zw_wbye`「外币余额表」 <sub>m_o20_40</sub>
    - **数量余额表** → `w_zw_slye`「库存数量金额表」 <sub>m_o20_50</sub>
    - ———（分隔线）
    - **辅助余额表** → `w_zw_fhye`「辅助项目余额表」 <sub>m_o20_60</sub>
    - **辅助外币余额表** → `w_zw_fhwbye`「辅助项目外币余额表」 <sub>m_o20_70</sub>
    - **辅助数量余额表** → `w_zw_fhslye`「辅助项目库存数量金额表」 <sub>m_o20_80</sub>
    - **现金流量试算平衡表** → `w_zc_xjll`「现金流量试算平衡表」 <sub>m_o20_90</sub>
  - **账册** <sub>m_o30</sub>
    - **总分类账** → `w_zc_zc`「总分类账」 <sub>m_o30_00</sub>
    - **现金日记账** → `w_zc_xjrjz`「日记账」 <sub>m_o30_10</sub>
    - **银行日记账** → `w_zc_yhrjz`「银行日记帐」 <sub>m_o30_20</sub>
    - **明细账** → `w_zc_slz`「明细账」 <sub>m_o30_30</sub>
    - **特殊明细** 〔默认隐藏〕 <sub>m_tsmx</sub>
    - **多栏账** → `w_zc_dlz`「多栏账」 <sub>m_o30_40</sub>
    - **辅助明细账** → `w_zc_fhslz`「辅助明细账」 <sub>m_o30_50</sub>
    - **辅助多栏明细账** → `w_zc_fhdlz`「辅助多栏账」 <sub>m_o30_60</sub>
    - **年度打印** 〔默认隐藏〕 <sub>m_nddy</sub>
    - **帐册套打** 〔默认隐藏〕 <sub>m_zctd</sub>
      - **打印设置** <sub>m_dysz</sub>
      - **帐册打印** <sub>m_zcdy</sub>
  - **报表管理** → `w_bb_main`「报表管理」 <sub>m_o40</sub>
  - **财务分析** <sub>m_o50</sub>
    - **年度分析表** → `w_fx_nd`「年度分析表」 <sub>m_o50_10</sub>
    - **月度分析表** → `w_fx_yd`「月度分析表」 <sub>m_o50_20</sub>
    - **自定义分析表** → `w_fx_main`「财务分析」 <sub>m_o50_30</sub>
    - **账龄分析** → `w_fx_zl`「账龄分析」 <sub>m_o50_40</sub>
  - **往来** 〔默认隐藏〕 <sub>m_o60</sub>
    - **期初往来单据** <sub>m_o60_10</sub>
    - **单据核销** <sub>m_o60_20</sub>
    - **往来信息查询** <sub>m_o60_30</sub>
  - **合同管理** <sub>m_o70</sub>
    - **合同档案管理** → `w_ht_htda`「合同档案管理」 <sub>m_o70_10</sub>
    - **合同帐款查询** → `w_ht_httj`「合同账款查询」 <sub>m_o70_20</sub>
- **I 基础档案** <sub>m_i</sub>
  - **科目维护** → `w_xt_kmwh`「科目维护」 <sub>m_i10</sub>
  - **摘要信息维护** → `w_xt_zy`「摘要管理」 <sub>m_i20</sub>
  - **期初余额** <sub>m_i25</sub>
    - **期初录入** → `w_xt_ye_nf`「选择年份」、`w_xt_ye`「期初余额录入」 <sub>m_i25_10</sub>
    - **项目期初录入** → `w_xt_ye_nf`「选择年份」、`w_xt_xmnc`「【（运行时设置）」 <sub>m_i25_20</sub>
    - **客供期初录入** → `w_xt_ye_nf`「选择年份」、`w_xt_dwnc`「【（运行时设置）」 <sub>m_i25_30</sub>
    - **部门期初录入** → `w_xt_ye_nf`「选择年份」、`w_xt_bmnc`「【（运行时设置）」 <sub>m_i25_40</sub>
    - **个人期初录入** → `w_xt_ye_nf`「选择年份」、`w_xt_grnc`「人员期初余额录入（运行时设置）」 <sub>m_i25_50</sub>
  - **辅助档案** <sub>m_i30</sub>
    - **项目信息维护** → `w_xt_xmwh`「核算项目」 <sub>m_i30_10</sub>
    - **客供信息维护** → `w_xt_dwwh`「客供维护（运行时设置）」 <sub>m_i30_20</sub>
    - **部门信息维护** → `w_xt_bmwh`「部门管理」 <sub>m_i30_30</sub>
    - **人员信息维护** → `w_xt_grwh`「人员管理」 <sub>m_i30_40</sub>
    - **现金项目维护** → `w_xt_xjwh`「现金流量项目设定」 <sub>m_i30_50</sub>
  - ———（分隔线）
  - **凭证类型维护** → `w_xt_pzlx`「凭证类型管理」 <sub>m_i50</sub>
  - **结算类型维护** → `w_xt_jslb`「结算类别管理」 <sub>m_i70</sub>
  - **外币类型维护** → `w_xt_fbwh`「外币管理」 <sub>m_i80</sub>
  - **结转类型维护** → `w_xt_jzwh`「结转类型维护」 <sub>m_i90</sub>
  - **打印格式** → `w_bb_main_gs`「特殊打印格式管理」 <sub>m_i95</sub>
  - **凭证模版** → `w_pz_pzmb_main`「凭证模版维护」 <sub>m_i96</sub>
- **S系统管理** <sub>m_s</sub>
  - **套账管理** → `w_tzjl`「套帐管理」 <sub>m_s05</sub>
  - **数据备份** → `w_bf`「数据备份」 <sub>m_s10</sub>
  - **数据恢复** → `w_hf`「数据恢复」 <sub>m_s15</sub>
  - **审计接口** → `w_bf_98001`「审计导出」 <sub>m_s18</sub>
  - ———（分隔线）
  - **切换用户** → `w_login_1`「切换用户」 <sub>m_s30</sub>
  - **操作日志** → `w_xt_dlxx`「操作日志」 <sub>m_s40</sub>
  - ———（分隔线）
  - **系统初始化** → `w_xt_kgzb`「系统初始化--口令验证」、`w_login`「用户登录」 <sub>m_s60</sub>
  - **套账信息** → `w_xt_tz`「套账信息」 <sub>m_s70</sub>
  - ———（分隔线）
  - **反审核** → `w_pz_tjsh`「批量审核」 <sub>m_s92</sub>
  - **反过账** → `w_zw_fgz`「反过账」 <sub>m_s80</sub>
  - **反结账** → `w_zw_qxfz`「反结账」 <sub>m_s90</sub>
  - **综合检查 Shift+F10** 快捷键 `Shift+F10` → `w_zh_zhjc`「综合检查」 <sub>m_sb0</sub>
- **I.自助服务** 〔默认隐藏〕 <sub>m_t</sub>
  - **客服中心** → 脚本：`f_get_kf()` <sub>m_t_10</sub>
  - **视频教程** → 脚本：`runhtml("http://rhrj.net/Aboutmenuid95.html")` <sub>m_t_20</sub>
  - **软件升级** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_30</sub>
  - **软件下载** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_60</sub>
  - **会员中心** → 脚本：`runhtml("http://www.360360.com.cn/help/default.aspx?id=1193")` <sub>m_h_40</sub>
  - **官方网站 Alt+F10** 快捷键 `Alt+F10` → 脚本：`runhtml("http://www.rhrj.net")` <sub>m_t_70</sub>
- **W.窗口** <sub>m_window</sub>
  - **级联排列 Shift+F5** 快捷键 `Shift+F5` → 脚本：`mainwindow.arrangesheets(cascade!)` <sub>m_window_cascade</sub>
  - **水平排列** → 脚本：`mainwindow.arrangesheets(tilehorizontal!)` <sub>m_window_htile</sub>
  - **垂直排列 Shift+F4** 快捷键 `Shift+F4` → 脚本：`mainwindow.arrangesheets(tile!)` <sub>m_window_vtile</sub>
  - **窗口铺满** → 脚本：`mainwindow.arrangesheets(layer!)` <sub>m_window_layer</sub>
  - ———（分隔线）
  - **排列图标** → 脚本：`mainwindow.arrangesheets(icons!)` <sub>m_window_arrangeicons</sub>
- **H.帮助** <sub>m_help</sub>
  - **系统帮助 F1** 快捷键 `F1` → 运行 `hh.exe help.chm` <sub>m_help_sys</sub>
  - ———（分隔线）
  - **版权信息** → `w_cwxt`「关于...」 <sub>m_help_about</sub>
  - **计算器 Ctrl+F12** 快捷键 `Ctrl+F12` → 运行 `calc.exe` <sub>m_help_calc</sub>

## 主菜单栏：成本/进销存（`m_frame_cb`）——切换到该子系统时主框架换用此菜单

- **F.文件** <sub>m_system</sub>
  - **关闭窗口 Ctrl+F4** 快捷键 `Ctrl+F4` → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_system_closesheet</sub>
  - **关闭所有窗口** → `w_main1`「主窗口」 <sub>m_system_closeall</sub>
  - **切换套账** → `w_login`「用户登录」、`w_login_oem`「用户登录」、`w_bakupdata`「切换套账（取自菜单文字）」 <sub>m_system_trans</sub>
  - ———（分隔线）
  - **打印机设置** → 脚本：`printsetup()` <sub>m_system_printset</sub>
  - **屏幕打印 Shift+P** 快捷键 `Shift+P` → 脚本：`long job` <sub>m_system_printscreen</sub>
  - **工具条设置** 〔默认隐藏〕 → `w_setbar`「工具条设置」 <sub>m_system_barset</sub>
  - ———（分隔线）
  - **系统注册** 〔默认隐藏〕 <sub>m_xtzc</sub>
  - **模块管理** 〔默认隐藏〕 → `w_module`「模块维护」 <sub>m_module</sub>
  - **用户管理** → `w_xt_users`「用户管理」 <sub>m_useright</sub>
  - **自改密码** → `w_pass`「自改密码」 <sub>m_changepswd</sub>
  - ———（分隔线）
  - **退出系统 Alt+X** 快捷键 `Alt+X` → 脚本：`close(mainwindow)` <sub>m_system_exit</sub>
- **O日常业务** <sub>m_o</sub>
  - **入库单管理** → `w_cb_xt_kgzb`「成本初始化」、`w_ck_rk`「入库单浏览」 <sub>m_o_10</sub>
  - **出库单管理** → `w_cb_xt_kgzb`「成本初始化」、`w_ck_ck`「出库单浏览」 <sub>m_o_20</sub>
  - **当前库存** → `w_cb_xt_kgzb`「成本初始化」、`w_ck_kc`「当前库存」 <sub>m_o_30</sub>
  - **月末盘点表** → `w_cb_xt_kgzb`「成本初始化」、`w_cb_pdk`「月末盘点表」 <sub>m_o_50</sub>
  - **成本核算** → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hz`「成本核算」 <sub>m_o_60</sub>
  - **凭证生成** → `w_cb_xt_kgzb`「成本初始化」、`w_cb_pz`「凭证生成」 <sub>m_o_70</sub>
  - ———（分隔线）
  - **入库汇总** → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hzsj_rk`「入库汇总」 <sub>m_o_81</sub>
  - **出库汇总** → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hzsj_ck`「出库汇总」 <sub>m_o_82</sub>
  - **库存台帐** → `w_cb_xt_kgzb`「成本初始化」、`w_ck_tz`「库存台帐」 <sub>m_o_83</sub>
  - **库存汇总余额表** → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hzsj_sfc`「进销存表」 <sub>m_o_84</sub>
  - **成本利润表** → `w_cb_xt_kgzb`「成本初始化」、`w_cb_hzsj_cblr`「收入成本利润表(仅销售出库)」 <sub>m_o_85</sub>
  - **销售明细账** → `w_cb_xt_kgzb`「成本初始化」、`w_ck_xsmxz`「销售明细账--选择」 <sub>m_o_90</sub>
- **T 基础档案** <sub>m_t1</sub>
  - **产品档案** → `w_cb_xt_kgzb`「成本初始化」、`w_cb_cpda`「产品档案维护」 <sub>m_t1_10</sub>
  - **期初录入** → `w_cb_xt_kgzb`「成本初始化」、`w_cb_qc`「库存期初录入」 <sub>m_t1_20</sub>
  - ———（分隔线）
  - **打印格式定义** → `w_bb_main_pos`「报表管理」 <sub>m_t1_40</sub>
- **S系统管理** <sub>m_s</sub>
  - **套帐信息** → `w_cb_xt_kgzb`「成本初始化」、`w_cb_tzxx`「仓库模块套账信息」 <sub>m_s_15</sub>
  - ———（分隔线）
  - **系统初始化** → `w_cb_xt_kgzb`「成本初始化」 <sub>m_s_20</sub>
  - **取消成本核算** → `w_cb_xt_kgzb`「成本初始化」、`w_cb_fgz`「反结账」 <sub>m_s_30</sub>
- **I.自助服务** 〔默认隐藏〕 <sub>m_t</sub>
  - **客服中心** → 脚本：`f_get_kf()` <sub>m_t_10</sub>
  - **视频教程** → 脚本：`runhtml("http://rhrj.net/Aboutmenuid95.html")` <sub>m_t_20</sub>
  - **软件升级** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_30</sub>
  - **软件下载** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_60</sub>
  - **会员中心** → 脚本：`runhtml("http://www.360360.com.cn/help/default.aspx?id=1193")` <sub>m_h_40</sub>
  - **官方网站 Alt+F10** 快捷键 `Alt+F10` → 脚本：`runhtml("http://www.rhrj.net")` <sub>m_t_70</sub>
- **W.窗口** <sub>m_window</sub>
  - **级联排列 Shift+F5** 快捷键 `Shift+F5` → 脚本：`mainwindow.arrangesheets(cascade!)` <sub>m_window_cascade</sub>
  - **水平排列** → 脚本：`mainwindow.arrangesheets(tilehorizontal!)` <sub>m_window_htile</sub>
  - **垂直排列 Shift+F4** 快捷键 `Shift+F4` → 脚本：`mainwindow.arrangesheets(tile!)` <sub>m_window_vtile</sub>
  - **窗口铺满** → 脚本：`mainwindow.arrangesheets(layer!)` <sub>m_window_layer</sub>
  - ———（分隔线）
  - **排列图标** → 脚本：`mainwindow.arrangesheets(icons!)` <sub>m_window_arrangeicons</sub>
- **H.帮助** <sub>m_help</sub>
  - **系统帮助 F1** 快捷键 `F1` → 运行 `hh.exe help.chm` <sub>m_help_sys</sub>
  - ———（分隔线）
  - **版权信息** → `w_cwxt`「关于...」 <sub>m_help_about</sub>
  - **计算器 Ctrl+F12** 快捷键 `Ctrl+F12` → 运行 `calc.exe` <sub>m_help_calc</sub>

## 主菜单栏：工资（`m_frame_gz`）——切换到该子系统时主框架换用此菜单

- **F.文件** <sub>m_system</sub>
  - **关闭窗口 Ctrl+F4** 快捷键 `Ctrl+F4` → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_system_closesheet</sub>
  - **关闭所有窗口** → `w_main1`「主窗口」 <sub>m_system_closeall</sub>
  - **切换套账** → `w_login`「用户登录」、`w_login_oem`「用户登录」、`w_bakupdata`「切换套账（取自菜单文字）」 <sub>m_system_trans</sub>
  - ———（分隔线）
  - **打印机设置** → 脚本：`printsetup()` <sub>m_system_printset</sub>
  - **屏幕打印 Shift+P** 快捷键 `Shift+P` → 脚本：`long job` <sub>m_system_printscreen</sub>
  - **工具条设置** 〔默认隐藏〕 → `w_setbar`「工具条设置」 <sub>m_system_barset</sub>
  - ———（分隔线）
  - **系统注册** 〔默认隐藏〕 <sub>m_xtzc</sub>
  - **模块管理** 〔默认隐藏〕 → `w_module`「模块维护」 <sub>m_module</sub>
  - **用户管理** → `w_xt_users`「用户管理」 <sub>m_useright</sub>
  - **自改密码** → `w_pass`「自改密码」 <sub>m_changepswd</sub>
  - ———（分隔线）
  - **退出系统 Alt+X** 快捷键 `Alt+X` → 脚本：`close(mainwindow)` <sub>m_system_exit</sub>
- **O日常业务** <sub>m_o</sub>
  - **工资管理** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 <sub>m_o_10</sub>
  - **凭证生成** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」、`w_pz_build_gz`「凭证生成」 <sub>m_o_20</sub>
  - **结账** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_jz`「工资结账」 <sub>m_o_22</sub>
  - ———（分隔线）
  - **工资条** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 <sub>m_o_30</sub>
  - **工资表** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 <sub>m_o_40</sub>
  - **工资汇总表** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 <sub>m_o_50</sub>
  - **累计汇总表** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」、`w_gzgl_lshz`「查询累计汇总表」 <sub>m_o_60</sub>
  - **票面计算表** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_gzgl`「工资管理」 <sub>m_o_70</sub>
- **I基础档案** <sub>m_i</sub>
  - **部门维护** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_bmwh`「部门维护」 <sub>m_i_10</sub>
  - **人事管理** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_rsgl`「人事管理」 <sub>m_i_20</sub>
  - **工资结构** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_xt_gzsz`「工资栏目定义」 <sub>m_i_30</sub>
  - **公式设置** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_xt_gssz`「计算公式定义」 <sub>m_i_40</sub>
  - **个税起征点** → `w_xt_kgzb_1_gz`「套帐信息」 <sub>m_i_50</sub>
  - **凭证设置** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_pz_sz`「制作凭证信息设置」 <sub>m_i_60</sub>
  - **打印格式** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_xt_dysz`「打印宽度设置」 <sub>m_i_70</sub>
- **S系统管理** <sub>m_s</sub>
  - **套账信息** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_xt_kgzb_1_gz`「套帐信息」 <sub>m_s_1</sub>
  - ———（分隔线）
  - **系统初始化** → `w_xt_kgzb_gz`「人事工资系统初始化」 <sub>m_s_10</sub>
  - **反结账** → `w_xt_kgzb_gz`「人事工资系统初始化」、`w_gz_qxfz`「取消结帐」 <sub>m_s_20</sub>
- **I.自助服务** 〔默认隐藏〕 <sub>m_t</sub>
  - **客服中心** → 脚本：`f_get_kf()` <sub>m_t_10</sub>
  - **视频教程** → 脚本：`runhtml("http://rhrj.net/Aboutmenuid95.html")` <sub>m_t_20</sub>
  - **软件升级** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_30</sub>
  - **软件下载** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_60</sub>
  - **会员中心** → 脚本：`runhtml("http://www.360360.com.cn/help/default.aspx?id=1193")` <sub>m_h_40</sub>
  - **官方网站 Alt+F10** 快捷键 `Alt+F10` → 脚本：`runhtml("http://www.rhrj.net")` <sub>m_t_70</sub>
- **W.窗口** <sub>m_window</sub>
  - **级联排列 Shift+F5** 快捷键 `Shift+F5` → 脚本：`mainwindow.arrangesheets(cascade!)` <sub>m_window_cascade</sub>
  - **水平排列** → 脚本：`mainwindow.arrangesheets(tilehorizontal!)` <sub>m_window_htile</sub>
  - **垂直排列 Shift+F4** 快捷键 `Shift+F4` → 脚本：`mainwindow.arrangesheets(tile!)` <sub>m_window_vtile</sub>
  - **窗口铺满** → 脚本：`mainwindow.arrangesheets(layer!)` <sub>m_window_layer</sub>
  - ———（分隔线）
  - **排列图标** → 脚本：`mainwindow.arrangesheets(icons!)` <sub>m_window_arrangeicons</sub>
- **H.帮助** <sub>m_help</sub>
  - **系统帮助 F1** 快捷键 `F1` → 运行 `hh.exe help.chm` <sub>m_help_sys</sub>
  - ———（分隔线）
  - **版权信息** → `w_cwxt`「关于...」 <sub>m_help_about</sub>
  - **计算器 Ctrl+F12** 快捷键 `Ctrl+F12` → 运行 `calc.exe` <sub>m_help_calc</sub>

## 主菜单栏：固定资产（`m_frame_zc`）——切换到该子系统时主框架换用此菜单

- **F.文件** <sub>m_system</sub>
  - **关闭窗口 Ctrl+F4** 快捷键 `Ctrl+F4` → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_system_closesheet</sub>
  - **关闭所有窗口** → `w_main1`「主窗口」 <sub>m_system_closeall</sub>
  - **切换套账** → `w_login`「用户登录」、`w_login_oem`「用户登录」、`w_bakupdata`「切换套账（取自菜单文字）」 <sub>m_system_trans</sub>
  - ———（分隔线）
  - **打印机设置** → 脚本：`printsetup()` <sub>m_system_printset</sub>
  - **屏幕打印 Shift+P** 快捷键 `Shift+P` → 脚本：`long job` <sub>m_system_printscreen</sub>
  - **工具条设置** 〔默认隐藏〕 → `w_setbar`「工具条设置」 <sub>m_system_barset</sub>
  - ———（分隔线）
  - **系统注册** 〔默认隐藏〕 <sub>m_xtzc</sub>
  - **模块管理** 〔默认隐藏〕 → `w_module`「模块维护」 <sub>m_module</sub>
  - **用户管理** → `w_xt_users`「用户管理」 <sub>m_useright</sub>
  - **自改密码** → `w_pass`「自改密码」 <sub>m_changepswd</sub>
  - ———（分隔线）
  - **退出系统 Alt+X** 快捷键 `Alt+X` → 脚本：`close(mainwindow)` <sub>m_system_exit</sub>
- **O日常业务** <sub>m_o</sub>
  - **固定资产台账** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 <sub>m_o_10</sub>
  - ———（分隔线）
  - **增加固定资产** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 <sub>m_o_12</sub>
  - **注销固定资产** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 <sub>m_o_13</sub>
  - **计提折旧** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zjjs`「计提折旧」 <sub>m_o_20</sub>
  - **生成凭证** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zjgl`「折旧查询」 <sub>m_o_22</sub>
  - **折旧查询** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zjgl`「折旧查询」 <sub>m_o_30</sub>
- **I基础档案** <sub>m_i</sub>
  - **部门设置** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_sydw`「部门维护」 <sub>m_i_10</sub>
  - **资产类别** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_sblb`「设备类别维护」 <sub>m_i_20</sub>
  - **资产用途** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_sbyt`「用途维护」 <sub>m_i_30</sub>
  - **设备状态** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_sbzt`「设备状态维护」 <sub>m_i_40</sub>
  - **注销原因** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_sbzx`「注销原因维护」 <sub>m_i_50</sub>
  - **凭证设置** → `w_xt_kgzb_zc`「固定资产初始化」、`w_xt_kgzb_1_zc`「套帐信息」 <sub>m_i_60</sub>
- **B统计报表** <sub>m_b</sub>
  - **资产明细账** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 <sub>m_w_10</sub>
  - **资产清单** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 <sub>m_w_20</sub>
  - **附属设备表** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 <sub>m_w_30</sub>
  - **到期资产清单** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 <sub>m_w_40</sub>
  - **资产增加清单** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 <sub>m_w_50</sub>
  - **资产减少清单** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 <sub>m_w_60</sub>
  - **资产分布表** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 <sub>m_w_70</sub>
  - **打印资产标签** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 <sub>m_w_80</sub>
  - **固定资产台帐** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_zcgl`「固定资产管理」 <sub>m_w_90</sub>
- **S系统管理** <sub>m_s</sub>
  - **套账信息** → `w_xt_kgzb_zc`「固定资产初始化」、`w_xt_kgzb_1_zc`「套帐信息」 <sub>m_s_01</sub>
  - **m_** <sub>m_</sub>
  - **系统初始化** → `w_xt_kgzb_zc`「固定资产初始化」 <sub>m_s_10</sub>
  - **取消折旧** → `w_xt_kgzb_zc`「固定资产初始化」、`w_zc_qxfz`「取消折旧」 <sub>m_s_20</sub>
  - ———（分隔线）
- **I.自助服务** 〔默认隐藏〕 <sub>m_t</sub>
  - **客服中心** → 脚本：`f_get_kf()` <sub>m_t_10</sub>
  - **视频教程** → 脚本：`runhtml("http://rhrj.net/Aboutmenuid95.html")` <sub>m_t_20</sub>
  - **软件升级** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_30</sub>
  - **软件下载** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_60</sub>
  - **会员中心** → 脚本：`runhtml("http://www.360360.com.cn/help/default.aspx?id=1193")` <sub>m_h_40</sub>
  - **官方网站 Alt+F10** 快捷键 `Alt+F10` → 脚本：`runhtml("http://www.rhrj.net")` <sub>m_t_70</sub>
- **W.窗口** <sub>m_window</sub>
  - **级联排列 Shift+F5** 快捷键 `Shift+F5` → 脚本：`mainwindow.arrangesheets(cascade!)` <sub>m_window_cascade</sub>
  - **水平排列** → 脚本：`mainwindow.arrangesheets(tilehorizontal!)` <sub>m_window_htile</sub>
  - **垂直排列 Shift+F4** 快捷键 `Shift+F4` → 脚本：`mainwindow.arrangesheets(tile!)` <sub>m_window_vtile</sub>
  - **窗口铺满** → 脚本：`mainwindow.arrangesheets(layer!)` <sub>m_window_layer</sub>
  - ———（分隔线）
  - **排列图标** → 脚本：`mainwindow.arrangesheets(icons!)` <sub>m_window_arrangeicons</sub>
- **H.帮助** <sub>m_help</sub>
  - **系统帮助 F1** 快捷键 `F1` → 运行 `hh.exe help.chm` <sub>m_help_sys</sub>
  - ———（分隔线）
  - **版权信息** → `w_cwxt`「关于...」 <sub>m_help_about</sub>
  - **计算器 Ctrl+F12** 快捷键 `Ctrl+F12` → 运行 `calc.exe` <sub>m_help_calc</sub>

## 各功能窗口自带的菜单栏

MDI 程序中，打开某个功能窗口（sheet）时，菜单栏换成该窗口的菜单。下列菜单多继承主菜单，只列出新增或改写的部分。

### `m_bb_def`
使用窗口：`w_bb_def`「报表定义」

- **文件[F]** <sub>m_f</sub>
  - **打开 Ctrl+O** 快捷键 `Ctrl+O` 工具栏「打开」 → 脚本：`this.parentwindow.triggerevent("u_open")` <sub>m_f10</sub>
  - **存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("u_save")` <sub>m_f20</sub>
  - **另存为...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("u_save_as")` <sub>m_f25</sub>
  - **报表生成** 工具栏「生成」 → 脚本：`this.parentwindow.triggerevent("u_proc")` <sub>m_f30</sub>
  - **现场取数** 工具栏「取数」 → 脚本：`this.parentwindow.triggerevent("u_proc_1")` <sub>m_f35</sub>
  - ———（分隔线）
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("u_print")` <sub>m_f40</sub>
  - **打印预览** 工具栏「预览」 → 脚本：`this.parentwindow.triggerevent("u_preview")` <sub>m_printview</sub>
  - **打印标题** <sub>m_printtitles</sub>
    - **设置打印标题** → 脚本：`this.parentwindow.triggerevent("u_setprinttitle")` <sub>m_setprintitle</sub>
    - **清除打印标题** → 脚本：`this.parentwindow.triggerevent("u_clearprinttitle")` <sub>m_clearprinttitle</sub>
  - **设置打印页** → 脚本：`this.parentwindow.triggerevent("u_printpage")` <sub>m_e45</sub>
  - **打印机设置** → 脚本：`this.parentwindow.triggerevent("u_printsetup")` <sub>m_f50</sub>
  - **报表属性设置** → 脚本：`this.parentwindow.triggerevent("u_bbsetup")` <sub>m_f55</sub>
  - ———（分隔线）
  - **返回** 工具栏「返回」 → 脚本：`close(this.parentwindow)` <sub>m_f70</sub>
- **编辑[E]** <sub>m_e</sub>
  - **复制 Ctrl+C** 快捷键 `Ctrl+C` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("u_copy")` <sub>m_e10</sub>
  - **粘贴 Ctrl+V** 快捷键 `Ctrl+V` 工具栏「粘贴」 → 脚本：`this.parentwindow.triggerevent("u_paste")` <sub>m_e20</sub>
  - ———（分隔线）
  - **清除 Del** 快捷键 `Delete` 工具栏「清除」 → 脚本：`this.parentwindow.triggerevent("u_clear")` <sub>m_e40</sub>
  - ———（分隔线）
  - **插行 Ctrl+I** 快捷键 `Ctrl+I` 工具栏「插行」 → 脚本：`this.parentwindow.triggerevent("u_insert")` <sub>m_e60</sub>
  - **删行 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「删行」 → 脚本：`this.parentwindow.triggerevent("u_delete")` <sub>m_e70</sub>
  - **插列** → 脚本：`this.parentwindow.triggerevent("u_ins_c")` <sub>m_e80</sub>
  - **删列** → 脚本：`this.parentwindow.triggerevent("u_del_c")` <sub>m_e90</sub>
  - ———（分隔线）
  - **画线** 工具栏「画线」 → 脚本：`this.parentwindow.triggerevent("u_line")` <sub>m_e100</sub>
  - **设置分页线** → 脚本：`this.parentwindow.triggerevent("u_page")` <sub>m_e110</sub>
  - **取消分页线** → 脚本：`this.parentwindow.triggerevent("u_page1")` <sub>m_e120</sub>
- **显示[S]** <sub>m_s</sub>
  - **增加行** 工具栏「增行」 → 脚本：`this.parentwindow.triggerevent("u_addrow")` <sub>m_s10</sub>
  - **减行** 工具栏「减行」 → 脚本：`this.parentwindow.triggerevent("u_decrow")` <sub>m_s20</sub>
  - **增加列** 工具栏「增列」 → 脚本：`this.parentwindow.triggerevent("u_addcol")` <sub>m_s30</sub>
  - **减列** 工具栏「减列」 → 脚本：`this.parentwindow.triggerevent("u_deccol")` <sub>m_s40</sub>
  - **网格显示/取消** 工具栏「网格」 → 脚本：`this.parentwindow.triggerevent("u_grid")` <sub>m_s42</sub>
  - **定义/显示** → 脚本：`this.parentwindow.triggerevent("u_zhbz")` <sub>m_s45</sub>
  - **公式显示/取消** → 脚本：`this.parentwindow.triggerevent("u_formu")` <sub>m_s50</sub>
  - **sheet显示/取消 Alt+S** 快捷键 `Alt+S` 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("u_sheet")` <sub>m_sheet</sub>
- **格式[S]** <sub>m_m</sub>
  - **边框...** 工具栏「边框」 → 脚本：`this.parentwindow.triggerevent("u_bord")` <sub>m_m10</sub>
  - **字体...** → 脚本：`this.parentwindow.triggerevent("u_font")` <sub>m_m20</sub>
  - **行高...** → 脚本：`this.parentwindow.triggerevent("u_rowh")` <sub>m_m30</sub>
  - **列宽...** → 脚本：`this.parentwindow.triggerevent("u_colw")` <sub>m_m40</sub>
  - **排列格式...** → 脚本：`this.parentwindow.triggerevent("u_format")` <sub>m_m50</sub>
  - **数字格式...** → 脚本：`this.parentwindow.triggerevent("u_f_num")` <sub>m_m60</sub>
  - **乱码处理** → 脚本：`this.parentwindow.triggerevent("u_lm")` <sub>m_m70</sub>
  - **报税接口 Ctrl+F2** 快捷键 `Ctrl+F2` 工具栏「报税」 → 脚本：`this.parentwindow.triggerevent("u_jk")` <sub>m_s_90</sub>
- **窗口[W]** <sub>m_w</sub>
  - **层叠** → 脚本：`mainwindow.arrangesheets(cascade!)` <sub>m_w10</sub>
  - **平铺** → 脚本：`mainwindow.arrangesheets(layer!)` <sub>m_w20</sub>
- **帮助[H]** <sub>m_h</sub>
  - **报表函数指南** 工具栏「帮助」 → `w_bb_help`「报表函数指南」 <sub>m_h10</sub>
  - **报表函数向导 F8** 快捷键 `F8` 工具栏「向导」 → 脚本：`this.parentwindow.triggerevent("u_help")` <sub>m_h20</sub>
  - **汇总余额表** 工具栏「余额表」 → `w_zw_ye`「汇总余额表」 <sub>m_h30</sub>

### `m_bb_def_gs`
使用窗口：`w_bb_def_gs`「打印格式定义」

- **编辑[E]** <sub>m_e</sub>
  - **复制 Ctrl+C** 快捷键 `Ctrl+C` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("u_copy")` <sub>m_e10</sub>
  - **粘贴 Ctrl+V** 快捷键 `Ctrl+V` 工具栏「粘贴」 → 脚本：`this.parentwindow.triggerevent("u_paste")` <sub>m_e20</sub>
  - ———（分隔线）
  - **清除 Del** 快捷键 `Delete` 工具栏「清除」 → 脚本：`this.parentwindow.triggerevent("u_clear")` <sub>m_e40</sub>
  - ———（分隔线）
  - **插行 Ctrl+I** 快捷键 `Ctrl+I` → 脚本：`this.parentwindow.triggerevent("u_insert")` <sub>m_e60</sub>
  - **删行 Ctrl+K** 快捷键 `Ctrl+K` → 脚本：`this.parentwindow.triggerevent("u_delete")` <sub>m_e70</sub>
  - **插列** → 脚本：`this.parentwindow.triggerevent("u_ins_c")` <sub>m_e80</sub>
  - **删列** → 脚本：`this.parentwindow.triggerevent("u_del_c")` <sub>m_e90</sub>
  - ———（分隔线）
  - **画线** 工具栏「画线」 → 脚本：`this.parentwindow.triggerevent("u_line")` <sub>m_e100</sub>
  - **设置分页线** → 脚本：`this.parentwindow.triggerevent("u_page")` <sub>m_e110</sub>
  - **取消分页线** → 脚本：`this.parentwindow.triggerevent("u_page1")` <sub>m_e120</sub>
- **文件[F]** <sub>m_f</sub>
  - **打开 Ctrl+O** 快捷键 `Ctrl+O` 工具栏「打开」 → 脚本：`this.parentwindow.triggerevent("u_open")` <sub>m_f10</sub>
  - **存储 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存储」 → 脚本：`this.parentwindow.triggerevent("u_save")` <sub>m_f20</sub>
  - **另存为...** → 脚本：`this.parentwindow.triggerevent("u_save_as")` <sub>m_f25</sub>
  - ———（分隔线）
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("u_print")` <sub>m_f40</sub>
  - **打印预览** → 脚本：`this.parentwindow.triggerevent("u_preview")` <sub>m_</sub>
  - **设置打印页** → 脚本：`this.parentwindow.triggerevent("u_printpage")` <sub>m_e45</sub>
  - **打印机设置** → 脚本：`this.parentwindow.triggerevent("u_printsetup")` <sub>m_f50</sub>
  - **报表属性设置** 工具栏「设置」 → 脚本：`this.parentwindow.triggerevent("u_bbsetup")` <sub>m_f55</sub>
  - ———（分隔线）
  - **关闭** 工具栏「关闭」 → 脚本：`close(this.parentwindow)` <sub>m_f70</sub>
- **帮助[H]** <sub>m_h</sub>
  - **格式函数向导 F8** 快捷键 `F8` → 脚本：`this.parentwindow.triggerevent("u_help")` <sub>m_h20</sub>
- **格式[S]** <sub>m_m</sub>
  - **边框...** 工具栏「边框」 → 脚本：`this.parentwindow.triggerevent("u_bord")` <sub>m_m10</sub>
  - **字体...** → 脚本：`this.parentwindow.triggerevent("u_font")` <sub>m_m20</sub>
  - **行高...** → 脚本：`this.parentwindow.triggerevent("u_rowh")` <sub>m_m30</sub>
  - **列宽...** → 脚本：`this.parentwindow.triggerevent("u_colw")` <sub>m_m40</sub>
  - **排列格式...** → 脚本：`this.parentwindow.triggerevent("u_format")` <sub>m_m50</sub>
  - **数字格式...** → 脚本：`this.parentwindow.triggerevent("u_f_num")` <sub>m_m60</sub>
- **显示[S]** <sub>m_s</sub>
  - **增加行** 工具栏「增行」 → 脚本：`this.parentwindow.triggerevent("u_addrow")` <sub>m_s10</sub>
  - **减行** 工具栏「减行」 → 脚本：`this.parentwindow.triggerevent("u_decrow")` <sub>m_s20</sub>
  - **增加列** 工具栏「增列」 → 脚本：`this.parentwindow.triggerevent("u_addcol")` <sub>m_s30</sub>
  - **减列** 工具栏「减列」 → 脚本：`this.parentwindow.triggerevent("u_deccol")` <sub>m_s40</sub>
  - **网格显示/取消** 工具栏「网格」 → 脚本：`this.parentwindow.triggerevent("u_grid")` <sub>m_s42</sub>
  - **公式显示/取消** → 脚本：`this.parentwindow.triggerevent("u_formu")` <sub>m_s50</sub>
  - **sheet显示/取消 Alt+S** 快捷键 `Alt+S` 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("u_sheet")` <sub>m_sheet</sub>
- **窗口[W]** <sub>m_w</sub>
  - **层叠** → 脚本：`mainwindow.arrangesheets(cascade!)` <sub>m_w10</sub>
  - **平铺** → 脚本：`mainwindow.arrangesheets(layer!)` <sub>m_w20</sub>

### `m_bb_def_pos`
使用窗口：`w_bb_def_pos`「格式定义」

- **编辑[E]** <sub>m_e</sub>
  - **复制 Ctrl+C** 快捷键 `Ctrl+C` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("u_copy")` <sub>m_e10</sub>
  - **粘贴 Ctrl+V** 快捷键 `Ctrl+V` 工具栏「粘贴」 → 脚本：`this.parentwindow.triggerevent("u_paste")` <sub>m_e20</sub>
  - ———（分隔线）
  - **清除 Del** 快捷键 `Delete` 工具栏「清除」 → 脚本：`this.parentwindow.triggerevent("u_clear")` <sub>m_e40</sub>
  - ———（分隔线）
  - **插行 Ctrl+I** 快捷键 `Ctrl+I` → 脚本：`this.parentwindow.triggerevent("u_insert")` <sub>m_e60</sub>
  - **删行 Ctrl+K** 快捷键 `Ctrl+K` → 脚本：`this.parentwindow.triggerevent("u_delete")` <sub>m_e70</sub>
  - **插列** → 脚本：`this.parentwindow.triggerevent("u_ins_c")` <sub>m_e80</sub>
  - **删列** → 脚本：`this.parentwindow.triggerevent("u_del_c")` <sub>m_e90</sub>
  - ———（分隔线）
  - **画线** 工具栏「画线」 → 脚本：`this.parentwindow.triggerevent("u_line")` <sub>m_e100</sub>
  - **设置分页线** → 脚本：`this.parentwindow.triggerevent("u_page")` <sub>m_e110</sub>
  - **取消分页线** → 脚本：`this.parentwindow.triggerevent("u_page1")` <sub>m_e120</sub>
- **文件[F]** <sub>m_f</sub>
  - **打开 Ctrl+O** 快捷键 `Ctrl+O` 工具栏「打开」 → 脚本：`this.parentwindow.triggerevent("u_open")` <sub>m_f10</sub>
  - **存储 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存储」 → 脚本：`this.parentwindow.triggerevent("u_save")` <sub>m_f20</sub>
  - **另存为...** → 脚本：`this.parentwindow.triggerevent("u_save_as")` <sub>m_f25</sub>
  - **报表生成** 工具栏「生成」 → 脚本：`this.parentwindow.triggerevent("u_proc")` <sub>m_f30</sub>
  - **现场取数** 工具栏「取数」 → 脚本：`this.parentwindow.triggerevent("u_proc_1")` <sub>m_f35</sub>
  - ———（分隔线）
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("u_print")` <sub>m_f40</sub>
  - **打印预览** → 脚本：`this.parentwindow.triggerevent("u_preview")` <sub>m_</sub>
  - **设置打印页** → 脚本：`this.parentwindow.triggerevent("u_printpage")` <sub>m_e45</sub>
  - **打印机设置** → 脚本：`this.parentwindow.triggerevent("u_printsetup")` <sub>m_f50</sub>
  - **报表属性设置** 工具栏「设置」 → 脚本：`this.parentwindow.triggerevent("u_bbsetup")` <sub>m_f55</sub>
  - ———（分隔线）
  - **关闭** 工具栏「关闭」 → 脚本：`close(this.parentwindow)` <sub>m_f70</sub>
- **帮助[H]** <sub>m_h</sub>
  - **报表函数指南** 〔默认隐藏〕 <sub>m_h10</sub>
  - **报表函数向导 F8** 快捷键 `F8` → 脚本：`this.parentwindow.triggerevent("u_help")` <sub>m_h20</sub>
- **格式[S]** <sub>m_m</sub>
  - **边框...** 工具栏「边框」 → 脚本：`this.parentwindow.triggerevent("u_bord")` <sub>m_m10</sub>
  - **字体...** → 脚本：`this.parentwindow.triggerevent("u_font")` <sub>m_m20</sub>
  - **行高...** → 脚本：`this.parentwindow.triggerevent("u_rowh")` <sub>m_m30</sub>
  - **列宽...** → 脚本：`this.parentwindow.triggerevent("u_colw")` <sub>m_m40</sub>
  - **排列格式...** → 脚本：`this.parentwindow.triggerevent("u_format")` <sub>m_m50</sub>
  - **数字格式...** → 脚本：`this.parentwindow.triggerevent("u_f_num")` <sub>m_m60</sub>
- **显示[S]** <sub>m_s</sub>
  - **增加行** 工具栏「增行」 → 脚本：`this.parentwindow.triggerevent("u_addrow")` <sub>m_s10</sub>
  - **减行** 工具栏「减行」 → 脚本：`this.parentwindow.triggerevent("u_decrow")` <sub>m_s20</sub>
  - **增加列** 工具栏「增列」 → 脚本：`this.parentwindow.triggerevent("u_addcol")` <sub>m_s30</sub>
  - **减列** 工具栏「减列」 → 脚本：`this.parentwindow.triggerevent("u_deccol")` <sub>m_s40</sub>
  - **网格显示/取消** 工具栏「网格」 → 脚本：`this.parentwindow.triggerevent("u_grid")` <sub>m_s42</sub>
  - **定义/显示** → 脚本：`this.parentwindow.triggerevent("u_zhbz")` <sub>m_s45</sub>
  - **公式显示/取消** → 脚本：`this.parentwindow.triggerevent("u_formu")` <sub>m_s50</sub>
  - **sheet显示/取消 Alt+S** 快捷键 `Alt+S` 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("u_sheet")` <sub>m_sheet</sub>
- **窗口[W]** <sub>m_w</sub>
  - **层叠** → 脚本：`mainwindow.arrangesheets(cascade!)` <sub>m_w10</sub>
  - **平铺** → 脚本：`mainwindow.arrangesheets(layer!)` <sub>m_w20</sub>

### `m_bb_htpj`
使用窗口：`w_bb_htpj`「特殊打印」、`w_bb_htpj_gs`「特殊打印」

- **操作** 〔默认隐藏〕 <sub>m_bb</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_saveas")` <sub>m_bb_00</sub>
  - **页设** 工具栏「页设」 → 脚本：`this.parentwindow.triggerevent("ue_page_setup")` <sub>m_bb_01</sub>
  - **设置** 工具栏「设置」 → 脚本：`this.parentwindow.triggerevent("ue_printer_setup")` <sub>m_bb_02</sub>
  - **预览** 工具栏「预览」 → 脚本：`this.parentwindow.triggerevent("ue_preview")` <sub>m_bb_03</sub>
  - **打印** 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_print")` <sub>m_bb_04</sub>
  - **选打** 工具栏「选打」 → 脚本：`this.parentwindow.triggerevent("ue_print1")` <sub>m_</sub>
  - **退出** 工具栏「退出」 → 脚本：`close(this.parentwindow)` <sub>m_bb_05</sub>

### `m_bb_saveas`
使用窗口：`w_bb_saveas`「数据导出」

- **操作** 〔默认隐藏〕 <sub>m_bb</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_saveas")` <sub>m_bb_00</sub>
  - **复制** 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("u_copy")` <sub>m_copy</sub>
  - **粘贴** 工具栏「粘贴」 → 脚本：`this.parentwindow.triggerevent("u_paste")` <sub>m_paste</sub>
  - **退出** 工具栏「退出」 → 脚本：`close(this.parentwindow)` <sub>m_bb_05</sub>

### `m_cb_cp`（继承 `m_frame_cb`）
使用窗口：`w_cb_cpda`「产品档案维护」

- **O.操作** <sub>m_operation</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **导入** 工具栏「转入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_operation_get</sub>
  - **数据刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`integer i` <sub>m_operation_refrash</sub>
  - **数据存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **增加记录 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **复制记录 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **删除记录 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_del</sub>
  - **批量删除** 工具栏「批删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_delall")` <sub>m_delall</sub>
  - **重取记录 Ctrl+R** 快捷键 `Ctrl+R` 工具栏「重取」 → 脚本：`this.parentwindow.triggerevent("ue_action_reselectrow")` <sub>m_operation_reselectrow</sub>
  - **编号修改** 工具栏「改号」 → 脚本：`this.parentwindow.triggerevent("ue_action_xg")` <sub>m_operation_xg</sub>
  - **重新恢复** 工具栏「恢复」 → 脚本：`this.parentwindow.triggerevent("ue_action_hf")` <sub>m_operation_hf</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>
  - **设置拼音 F8** 快捷键 `F8` 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("ue_action_py")` <sub>m_py</sub>

### `m_cb_crk_01`（继承 `m_frame_cb`）
使用窗口：`w_ck_ck`「出库单浏览」、`w_ck_rk`「入库单浏览」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`integer i` <sub>m_operation_refrash</sub>
  - **增加 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **查看** 工具栏「查看」 → 脚本：`this.parentwindow.triggerevent("ue_action_modify")` <sub>m_operation_modify</sub>
  - **复制 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **反冲** 工具栏「反冲」 → 脚本：`this.parentwindow.triggerevent("ue_action_fc")` <sub>m_o_fc</sub>
  - **转出** 工具栏「转出」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas1")` <sub>m_operation_out</sub>
  - **转入** → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_operation_reselectrow</sub>
  - **删除** 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_pzsc</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **综合查询** 工具栏「综查」 → 脚本：`this.parentwindow.triggerevent("ue_action_query1")` <sub>m_operation_query1</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上移  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下移   DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_cb_crk_02`（继承 `m_frame_cb`）
使用窗口：`w_ck_ck1`「采购合同」、`w_ck_rk1`「入库单」

- **O.操作** <sub>m_operation</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_1</sub>
  - **存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **审核** 工具栏「审核」 → 脚本：`this.parentwindow.triggerevent("ue_action_sh")` <sub>m_sh</sub>
  - **增加 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **复制记录 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **删除记录 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_del</sub>
  - **转入** 工具栏「转入」 → 脚本：`this.parentwindow.triggerevent("ue_action_gg")` <sub>m_operationt_get</sub>
  - **凭证生成** 工具栏「转凭证」 → 脚本：`this.parentwindow.triggerevent("ue_action_pz_ins")` <sub>m_oprection_pzsc</sub>
  - **凭证删除** 工具栏「删凭证」 → 脚本：`this.parentwindow.triggerevent("ue_action_pz_del")` <sub>m_oprection_pzdel</sub>
  - ———（分隔线）
  - **特殊打印** 工具栏「特打」 → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_preview</sub>
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>
  - **产品速查 Ctrl+F8** 快捷键 `Ctrl+F8` 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("ue_action_seek")` <sub>m_f501</sub>

### `m_cb_kc`（继承 `m_frame_cb`）
使用窗口：`w_ck_kc`「当前库存」

- **O.操作** <sub>m_operation</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **数据刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`this.parentwindow.triggerevent("ue_action_refresh")` <sub>m_operation_refrash</sub>
  - **库存汇总** 工具栏「汇总」 → 脚本：`this.parentwindow.triggerevent("ue_action_hz")` <sub>m_operation_add</sub>
  - **重算库存** 工具栏「重算」 → 脚本：`this.parentwindow.triggerevent("ue_action_kc")` <sub>m_o_100</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_cb_pd`（继承 `m_frame_cb`）
使用窗口：`w_cb_pdk_1`「月末盘点表」

- **O.操作** <sub>m_operation</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **数据刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`this.parentwindow.triggerevent("ue_action_refresh")` <sub>m_operation_refrash</sub>
  - **数据存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **无盘盈盘亏调整** → 脚本：`this.parentwindow.triggerevent("ue_action_tz")` <sub>m_o_01</sub>
  - **重新计算 Ctrl+R** 快捷键 `Ctrl+R` 工具栏「重算」 → 脚本：`this.parentwindow.triggerevent("ue_action_reselectrow")` <sub>m_operation_reselectrow</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_cb_qc`（继承 `m_frame_cb`）
使用窗口：`w_cb_qc`「库存期初录入」

- **O.操作** <sub>m_operation</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **导入** 工具栏「转入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_o_get</sub>
  - **数据刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`this.parentwindow.triggerevent("ue_action_refresh")` <sub>m_operation_refrash</sub>
  - **数据存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_cb_sl_hzyeb`（继承 `m_frame_cb`）
使用窗口：`w_cb_sl_hzyeb`「库存汇总余额表」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **库存台帐** 工具栏「台帐」 → 脚本：`this.parentwindow.triggerevent("ue_action_mxz")` <sub>m_operation_modify</sub>
  - ———（分隔线）
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_ck_kctz`（继承 `m_frame_cb`）
使用窗口：`w_ck_tz1`「库存台帐」、`w_ck_xsmxz1`「库存台帐」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **批量导出** 工具栏「批导出」 → 脚本：`this.parentwindow.triggerevent("ue_action_out")` <sub>m_o_out</sub>
  - **单据明细** 工具栏「明细」 → 脚本：`this.parentwindow.triggerevent("ue_action_mx")` <sub>m_operation_mx</sub>
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - **连续打印** 工具栏「连打」 → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_printlx</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_preview_r`
使用窗口：`w_preview_base_r1`「打印预览」、`w_preview_base_r_bak`「打印预览」

- **操作** 〔默认隐藏〕 <sub>m_11</sub>
  - **上移** 工具栏「上移」 → 脚本：`this.parentwindow.triggerevent("ue_up")` <sub>m_1</sub>
  - **下移** 工具栏「下移」 → 脚本：`this.parentwindow.triggerevent("ue_down")` <sub>m_2</sub>
  - **左移** 工具栏「左移」 → 脚本：`this.parentwindow.triggerevent("ue_left")` <sub>m_3</sub>
  - **右移** 工具栏「右移」 → 脚本：`this.parentwindow.triggerevent("ue_right")` <sub>m_4</sub>
  - **放大** 工具栏「放大」 → 脚本：`this.parentwindow.triggerevent("ue_zoomout")` <sub>m_5</sub>
  - **缩小** 工具栏「缩小」 → 脚本：`this.parentwindow.triggerevent("ue_zoomin")` <sub>m_6</sub>
  - **设置** 工具栏「设置」 → 脚本：`this.parentwindow.triggerevent("ue_printer_setup")` <sub>m_7</sub>
  - **打印** 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_print")` <sub>m_8</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_saveas")` <sub>m_9</sub>
  - **退出** 工具栏「退出」 → 脚本：`this.parentwindow.triggerevent("ue_exit")` <sub>m_10</sub>

### `m_report_r`
使用窗口：`w_ht_httj`「合同账款查询」、`w_preview_report_base`「报表查询」、`w_zc_zzs`「增值税明细帐」

- **操作** 〔默认隐藏〕 <sub>m_11</sub>
  - **上移** 工具栏「上移」 → 脚本：`this.parentwindow.triggerevent("ue_up")` <sub>m_1</sub>
  - **下移** 工具栏「下移」 → 脚本：`this.parentwindow.triggerevent("ue_down")` <sub>m_2</sub>
  - **左移** 工具栏「左移」 → 脚本：`this.parentwindow.triggerevent("ue_left")` <sub>m_3</sub>
  - **右移** 工具栏「右移」 → 脚本：`this.parentwindow.triggerevent("ue_right")` <sub>m_4</sub>
  - **放大** 工具栏「放大」 → 脚本：`this.parentwindow.triggerevent("ue_zoomout")` <sub>m_5</sub>
  - **缩小** 工具栏「缩小」 → 脚本：`this.parentwindow.triggerevent("ue_zoomin")` <sub>m_6</sub>
  - **设置** 工具栏「设置」 → 脚本：`this.parentwindow.triggerevent("ue_printer_setup")` <sub>m_7</sub>
  - **打印** 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_print")` <sub>m_8</sub>
  - **查询** 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_query")` <sub>m_12</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_saveas")` <sub>m_9</sub>
  - **退出** 工具栏「退出」 → 脚本：`this.parentwindow.triggerevent("ue_exit")` <sub>m_10</sub>

### `m_work`（继承 `m_frame_zw`）
使用窗口：`w_err_view`「错误查看」、`w_module`「模块维护」、`wroot_fix_query`「固定查询及统计」、`wroot_md`「主从式应用示例」、`wroot_md_2`「主从式应用示例」、`wroot_mds`「共享式 + 主从式应用示例」、`wroot_share`「共享式应用」、`wroot_share_tab`「共享式应用(TAB)」、`wroot_sheet`「wroot_sheet」、`wroot_single`「单一式应用」

- **O.操作** <sub>m_operation</sub>
  - **另存** → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **数据刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`this.parentwindow.triggerevent("ue_action_refresh")` <sub>m_operation_refrash</sub>
  - **数据存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **增加记录 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **拷加记录 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「拷加」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **删除记录 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_del</sub>
  - **重取记录 Ctrl+R** 快捷键 `Ctrl+R` 工具栏「重取」 → 脚本：`this.parentwindow.triggerevent("ue_action_reselectrow")` <sub>m_operation_reselectrow</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_01`（继承 `m_frame_zw`）
使用窗口：`wroot_md2`「wroot_sheet（继承自祖先）」、`wroot_md2_1`「wroot_sheet（继承自祖先）」、`wroot_single_1`「单一式应用」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`integer i` <sub>m_operation_refrash</sub>
  - **增加 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **查看** 工具栏「查看」 → 脚本：`this.parentwindow.triggerevent("ue_action_modify")` <sub>m_operation_modify</sub>
  - **复制 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **转入** 工具栏「转入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_operation_reselectrow</sub>
  - **删除** 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_pzsc</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **综合查询** 工具栏「综查」 → 脚本：`this.parentwindow.triggerevent("ue_action_query1")` <sub>m_operation_query1</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上移  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下移   DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_dlxx`（继承 `m_frame_zw`）
使用窗口：`w_xt_dlxx`「操作日志」

- **O.操作** <sub>m_operation</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **数据刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`this.parentwindow.triggerevent("ue_action_refresh")` <sub>m_operation_refrash</sub>
  - **删除记录 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_del</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_fx_def`（继承 `m_frame_zw`）
使用窗口：`w_fx_def`「财务分析定义」

- **O.操作** <sub>m_operation</sub>
  - **分析** 工具栏「分析」 → 脚本：`this.parentwindow.triggerevent("ue_fx")` <sub>m_operation_fx</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **增加 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **复制记录 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **删除记录 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_del</sub>
  - ———（分隔线）
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **函数指南** 工具栏「指南」 → `w_bb_help`「报表函数指南」 <sub>m_operation_help1</sub>
  - **函数向导** 工具栏「向导」 → 脚本：`this.parentwindow.triggerevent("u_help")` <sub>m_operation_help2</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_fx_demo`（继承 `m_frame_zw`）
使用窗口：`w_fx_demo`「财务分析」

- **O.操作** <sub>m_operation</sub>
  - **分析方法选择** 工具栏「分析」 → 脚本：`this.parentwindow.triggerevent("u_fx")` <sub>m_operation_fx</sub>
  - **打开 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「打开」 → 脚本：`this.parentwindow.triggerevent("u_open")` <sub>m_operation_save</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **增加 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("u_insert")` <sub>m_operation_add</sub>
  - **删除 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("u_delete")` <sub>m_operation_del</sub>
  - ———（分隔线）
  - **图形分析 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「图形」 → 脚本：`this.parentwindow.triggerevent("u_txfx")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_fx_nd`（继承 `m_frame_zw`）
使用窗口：`w_fx_nd_1`「年度分析表」、`w_fx_yd_1`「年度分析表」

- **O.操作** <sub>m_operation</sub>
  - **重新选择** 工具栏「重选」 → 脚本：`this.parentwindow.triggerevent("ue_action_xz")` <sub>m_operation_xz</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **图形分析 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「图形」 → 脚本：`this.parentwindow.triggerevent("u_txfx")` <sub>m_operation_print</sub>
  - **数据打印** 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_preview</sub>
  - ———（分隔线）
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_fx_zl`（继承 `m_frame_zw`）
使用窗口：`w_fx_zl`「账龄分析」

- **O.操作** <sub>m_operation</sub>
  - **分析** 工具栏「分析」 → 脚本：`this.parentwindow.triggerevent("u_fx")` <sub>m_operation_fx</sub>
  - **账册** 工具栏「账册」 → 脚本：`this.parentwindow.triggerevent("ue_action_zc")` <sub>m_operation_zc</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - ———（分隔线）
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_gzgl`（继承 `m_frame_gz`）
使用窗口：`w_gz_gzgl`「工资管理」

- **O.操作** <sub>m_operation</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **刷新** 工具栏「刷新」 → 脚本：`this.parentwindow.triggerevent("ue_action_refresh")` <sub>m_operation_refrash</sub>
  - **存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **统一置数** 工具栏「置数」 → 脚本：`this.parentwindow.triggerevent("ue_action_zs")` <sub>m_operation_zs</sub>
  - **工资计算** 工具栏「计算」 → 脚本：`this.parentwindow.triggerevent("ue_action_com")` <sub>m_o_101</sub>
  - **票面计算** → 脚本：`this.parentwindow.triggerevent("ue_action_pm")` <sub>m_o_201</sub>
  - ———（分隔线）
  - **工资发放凭证** → `w_pz_build_gz`「凭证生成」 <sub>m_o_301</sub>
  - **工资分配凭证** → `w_pz_build_gz`「凭证生成」 <sub>m_o_401</sub>
  - ———（分隔线）
  - **累计汇总** 工具栏「汇总」 → `w_gzgl_lshz`「查询累计汇总表」 <sub>m_o_601</sub>
  - **综合查询** 工具栏「综查」 → 脚本：`this.parentwindow.triggerevent("ue_action_zhcx")` <sub>m_o_701</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **打印** <sub>m_operation_print</sub>
    - **工资表** 工具栏「工资表」 → 脚本：`xt_cs1 = "1"` <sub>m_o_p_10</sub>
    - **工资条** 工具栏「工资条」 → 脚本：`xt_cs1 = "2"` <sub>m_o_p_20</sub>
    - **汇总表** 工具栏「汇总表」 → 脚本：`xt_cs1 = "3"` <sub>m_o_p_30</sub>
    - **其它汇总表** 〔默认隐藏〕 → 脚本：`xt_cs1 = "4"` <sub>m_o_p_40</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_ht_zw`（继承 `m_frame_zw`）
使用窗口：`w_ht_htda`「合同档案管理」

- **O.操作** <sub>m_operation</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **审核** 工具栏「审核」 → 脚本：`this.parentwindow.triggerevent("ue_action_sh")` <sub>m_operation_sh</sub>
  - **导入** 工具栏「转入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_o_get</sub>
  - **数据刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`this.parentwindow.triggerevent("ue_action_refresh")` <sub>m_operation_refrash</sub>
  - **数据存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **增加记录 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **拷加记录 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「拷加」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **删除记录 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_del</sub>
  - **重取记录 Ctrl+R** 快捷键 `Ctrl+R` 工具栏「重取」 → 脚本：`this.parentwindow.triggerevent("ue_action_reselectrow")` <sub>m_operation_reselectrow</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_pz_pzedit`（继承 `m_frame_zw`）
使用窗口：`w_pz_pzedit`「凭证录入」、`w_pz_pzedit_b`「凭证修改（运行时设置）」、`w_pz_pzedit_bak`「凭证录入」

- **O.操作** <sub>m_operation</sub>
  - **存盘 F5** 快捷键 `F5` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("u_pzsave")` <sub>m_operation_save</sub>
  - **插入一行 Ctrl+I** 快捷键 `Ctrl+I` 工具栏「插行」 → 脚本：`this.parentwindow.triggerevent("u_insert")` <sub>m_operation_add</sub>
  - **删除一行 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删行」 → 脚本：`this.parentwindow.triggerevent("u_delete")` <sub>m_operation_del</sub>
  - **平衡复制 F7** 快捷键 `F7` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("u_rowcopy")` <sub>m_operation_newcopy</sub>
  - **平衡 Ctrl+H** 快捷键 `Ctrl+H` 工具栏「平衡」 → 脚本：`this.parentwindow.triggerevent("u_ph")` <sub>m_operation_ph</sub>
  - **借贷互换 F8** 快捷键 `F8` 工具栏「互换」 → 脚本：`this.parentwindow.triggerevent("u_jdhh")` <sub>m_operation_jdhh</sub>
  - **重新输入** 工具栏「重输」 → 脚本：`this.parentwindow.triggerevent("u_new")` <sub>m_operation_new</sub>
  - **审核** 工具栏「审核」 → 脚本：`this.parentwindow.triggerevent("u_pzclock")` <sub>m_operation_sh</sub>
  - ———（分隔线）
  - **读入模版** 工具栏「读模版」 → 脚本：`this.parentwindow.triggerevent("u_mb")` <sub>m_operation_mb</sub>
  - **转成模版** 工具栏「转模版」 → 脚本：`this.parentwindow.triggerevent("u_mb1")` <sub>m_operation_mb1</sub>
  - **读出纳** 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("u_cn_get")` <sub>m_operation_cn</sub>
  - **反冲凭证** → 脚本：`this.parentwindow.triggerevent("u_fc")` <sub>m_operation_fc</sub>
  - **汇兑损益** → 脚本：`this.parentwindow.triggerevent("u_hlgl")` <sub>m_operation_hl</sub>
  - **凭证复制 Ctrl+T** 快捷键 `Ctrl+T` → 脚本：`this.parentwindow.triggerevent("u_copy")` <sub>m_operation_fz</sub>
  - **科目搜索 F4** 快捷键 `F4` → 脚本：`this.parentwindow.triggerevent("u_find")` <sub>m_operation_find</sub>
  - **科目维护 F3** 快捷键 `F3` → `w_xt_kmwh`「科目维护」 <sub>m_wh</sub>
  - **分录信息 F6** 快捷键 `F6` 工具栏「分录」 → 脚本：`this.parentwindow.triggerevent("u_flxx")` <sub>m_operation_fl</sub>
  - **打印预览 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「预览」 → 脚本：`this.parentwindow.triggerevent("u_print")` <sub>m_operation_print</sub>
  - **特殊打印** 工具栏「特打」 → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_print1</sub>
  - **计算器 F9** 快捷键 `F9` 工具栏「计算器」 → 脚本：`this.parentwindow.triggerevent("u_calc")` <sub>m_operation_calc</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("u_first")` <sub>m_move_first</sub>
    - **上一记录** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("u_befo")` <sub>m_move_prior</sub>
    - **下一记录** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("u_next")` <sub>m_move_next</sub>
    - **记录尾** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("u_end")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`close(this.parentwindow)` <sub>m_f</sub>

### `m_work_pz_pzedit_mb`（继承 `m_frame_zw`）
使用窗口：`w_pz_pzedit_mb`「凭证模版」

- **O.操作** <sub>m_operation</sub>
  - **存盘 F5** 快捷键 `F5` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("u_pzsave")` <sub>m_operation_save</sub>
  - **插入一行 Ctrl+I** 快捷键 `Ctrl+I` 工具栏「插行」 → 脚本：`this.parentwindow.triggerevent("u_insert")` <sub>m_operation_add</sub>
  - **删除一行 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删行」 → 脚本：`this.parentwindow.triggerevent("u_delete")` <sub>m_operation_del</sub>
  - **重新输入** 工具栏「重输」 → 脚本：`this.parentwindow.triggerevent("u_new")` <sub>m_operation_new</sub>
  - ———（分隔线）
  - **凭证复制 Ctrl+T** 快捷键 `Ctrl+T` → 脚本：`this.parentwindow.triggerevent("u_copy")` <sub>m_operation_fz</sub>
  - **科目搜索 F4** 快捷键 `F4` → 脚本：`this.parentwindow.triggerevent("u_find")` <sub>m_operation_find</sub>
  - **科目维护 F3** 快捷键 `F3` → `w_xt_kmwh`「科目维护」 <sub>m_wh</sub>
  - **分录信息 F6** 快捷键 `F6` 工具栏「分录」 → 脚本：`this.parentwindow.triggerevent("u_flxx")` <sub>m_operation_fl</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`close(this.parentwindow)` <sub>m_f</sub>

### `m_work_pz_pzxsb`（继承 `m_frame_zw`）
使用窗口：`w_pz_pzxsb`「凭证序时簿」、`w_pz_pzxsb_bak`「凭证序时簿」、`w_pz_pzxsb_see`「凭证查询」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **刷新 F5** 快捷键 `F5` 工具栏「刷新」 → 脚本：`integer i` <sub>m_operation_refrash</sub>
  - **增加凭证 Ctrl+N** 快捷键 `Ctrl+N` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **凭证修改** 工具栏「修改」 → 脚本：`this.parentwindow.triggerevent("ue_action_modify")` <sub>m_operation_modify</sub>
  - **批量修改** 工具栏「批修改」 → 脚本：`this.parentwindow.triggerevent("ue_action_plxg")` <sub>m_operation_m1</sub>
  - **插入** 工具栏「插入」 → 脚本：`this.parentwindow.triggerevent("ue_action_insert")` <sub>m_operation_insert</sub>
  - **凭证复制 Ctrl+T** 快捷键 `Ctrl+T` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **反冲凭证** 工具栏「反冲」 → 脚本：`this.parentwindow.triggerevent("ue_action_fc")` <sub>m_operation_fc</sub>
  - **凭证删除 Del** 快捷键 `Delete` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_del</sub>
  - **凭证导出** → 脚本：`this.parentwindow.triggerevent("ue_action_out")` <sub>m_x</sub>
  - **凭证导入** → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_operation_get</sub>
  - **凭证转出** 工具栏「转出」 → 脚本：`this.parentwindow.triggerevent("ue_action_out2")` <sub>m_out2</sub>
  - **凭证转入** 工具栏「转入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get2")` <sub>m_get2</sub>
  - **查看凭证** 工具栏「查看」 → 脚本：`this.parentwindow.triggerevent("ue_action_ck")` <sub>m_operation_ck</sub>
  - **操作易人** 工具栏「易人」 → `w_login_1`「切换用户」 <sub>m_operation_yr</sub>
  - **凭证审核 F4** 快捷键 `F4` 工具栏「审核」 → 脚本：`this.parentwindow.triggerevent("ue_action_sh")` <sub>m_operation_ps</sub>
  - **批量审核** 工具栏「批审核」 → 脚本：`this.parentwindow.triggerevent("ue_action_plsh")` <sub>m_operation_plsh</sub>
  - **取消审核** 工具栏「反审核」 → 脚本：`this.parentwindow.triggerevent("ue_action_qxsh")` <sub>m_operation_qxsh</sub>
  - **排序** 工具栏「排序」 → 脚本：`this.parentwindow.triggerevent("ue_action_bh")` <sub>m_operation_bh</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **综合查询** 工具栏「综查」 → 脚本：`this.parentwindow.triggerevent("ue_action_query1")` <sub>m_operation_query1</sub>
  - **辅助项交叉查询 Ctrl+F1** 快捷键 `Ctrl+F1` 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("ue_action_query2")` <sub>m_operation_query2</sub>
  - **凭证连续打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「连打」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - **合并打印** 工具栏「合打」 → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_print1</sub>
  - ———（分隔线）
  - **明细账** 工具栏「明细账」 → 脚本：`this.parentwindow.triggerevent("ue_action_mxz")` <sub>m_operation_mxz</sub>
  - **凭证科目汇总** 工具栏「汇总」 → 脚本：`this.parentwindow.triggerevent("ue_action_hz")` <sub>m_operation_hz</sub>
  - **丁字帐户** 工具栏「丁字帐」 → 脚本：`this.parentwindow.triggerevent("ue_action_zhu")` <sub>m_operation0</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_rsgl`（继承 `m_frame_gz`）
使用窗口：`w_gz_rsgl`「人事管理」

- **O.操作** <sub>m_operation</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **刷新** 工具栏「刷新」 → 脚本：`this.parentwindow.triggerevent("ue_action_refresh")` <sub>m_operation_refrash</sub>
  - **存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **增加 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **编号修改** 工具栏「改编号」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **删除 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_del</sub>
  - **统一置数** 工具栏「置数」 → 脚本：`this.parentwindow.triggerevent("ue_action_zs")` <sub>m_operation_zs</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_xt_01`（继承 `m_frame_zw`）
使用窗口：`w_xt_ye`「期初余额录入」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **分级汇总** 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **转入** 工具栏「转入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_1</sub>
  - ———（分隔线）
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.科目** <sub>m_move</sub>
    - **返回总帐科目** 工具栏「总帐」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **退回上一级科目** 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **进入下级科目** 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **返回明细科目** 工具栏「明细」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_xt_fznc`（继承 `m_frame_zw`）
使用窗口：`w_xt_bmnc`「【（运行时设置）」、`w_xt_dwnc`「【（运行时设置）」、`w_xt_grnc`「人员期初余额录入（运行时设置）」、`w_xt_xmnc`「【（运行时设置）」

- **O.操作** <sub>m_operation</sub>
  - **另存** → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **数据存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **增加记录 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **删除记录 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_del</sub>
  - **导入** 工具栏「导入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_1</sub>
  - ———（分隔线）
  - **预览** 工具栏「预览」 → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_preview</sub>
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_xt_wh`（继承 `m_frame_zw`）
使用窗口：`w_xt_dwwh`「客供维护（运行时设置）」

- **O.操作** <sub>m_operation</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **数据刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`this.parentwindow.triggerevent("ue_action_refresh")` <sub>m_operation_refrash</sub>
  - **数据存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **增加记录 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **导入** 工具栏「导入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_导入</sub>
  - **m_operation_get** <sub>m_operation_get</sub>
  - **编码修改** 工具栏「改编码」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **删除记录 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_del</sub>
  - **编码分级长度格式** 工具栏「分级」 → 脚本：`this.parentwindow.triggerevent("ue_action_fj")` <sub>m_</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_zc_01`（继承 `m_frame_zw`）
使用窗口：`w_zc_fhslz_1`「三栏明细账（继承自祖先）」、`w_zc_fhslz_1_bak`「三栏明细账（继承自祖先）」、`w_zc_fzslz_fb`「三栏复币明细账」、`w_zc_fzslz_sl`「三栏明细账（继承自祖先）」、`w_zc_slz_1`「三栏明细账」、`w_zc_slz_1_bak`「三栏明细账」、`w_zc_slz_fb`「三栏明细账（继承自祖先）」、`w_zc_slz_sl`「三栏明细账（继承自祖先）」、`w_zc_slz_slfb`「三栏明细账（继承自祖先）」、`w_zc_xjll_1`「现金流量试算平衡表」、`w_zc_xjrjz_1`「现金日记账」、`w_zc_xjrjz_fb`「现金复币日记账」、`w_zc_yhrjz_1`「银行日记账」、`w_zc_yhrjz_fb`「银行复币日记账」、`w_zc_zc_1`「总分类账」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **批量导出** 工具栏「批导出」 → 脚本：`this.parentwindow.triggerevent("ue_saveas")` <sub>m_operation_out</sub>
  - **重新选择** 工具栏「重选」 → 脚本：`this.parentwindow.triggerevent("u_open")` <sub>m_operation_open</sub>
  - **排序** 工具栏「排序」 → 脚本：`this.parentwindow.triggerevent("u_sort")` <sub>m_operation_sort</sub>
  - **查看凭证** 工具栏「查看」 → 脚本：`this.parentwindow.triggerevent("ue_action_ck")` <sub>m_operation_ck</sub>
  - **修改凭证** 工具栏「修改」 → 脚本：`this.parentwindow.triggerevent("ue_action_modify")` <sub>m_operation_modify</sub>
  - **删除凭证** 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_del</sub>
  - ———（分隔线）
  - **打印预览** 工具栏「预览」 → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_31</sub>
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("user_prt")` <sub>m_operation_print</sub>
  - **连续打印** 工具栏「连打」 → 脚本：`this.parentwindow.triggerevent("user_prt_lx")` <sub>m_operation_print1</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("x1")` <sub>m_move_first</sub>
    - **上移  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("x3")` <sub>m_move_prior</sub>
    - **下移   DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("x4")` <sub>m_move_next</sub>
    - **尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("x2")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_zc_02`（继承 `m_frame_zw`）
使用窗口：`w_zc_dlz_1`「多栏账」、`w_zc_fhdlz_1`「多栏账」、`w_zc_fhdlz_1_bak`「多栏账」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **批量导出** → 脚本：`this.parentwindow.triggerevent("ue_saveas")` <sub>m_operation_out</sub>
  - **重新选择** 工具栏「重选」 → 脚本：`this.parentwindow.triggerevent("u_open")` <sub>m_operation_open</sub>
  - **排序** 工具栏「排序」 → 脚本：`this.parentwindow.triggerevent("u_sort")` <sub>m_operation_sort</sub>
  - ———（分隔线）
  - **打印预览** 工具栏「预览」 → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_31</sub>
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("user_prt")` <sub>m_operation_print</sub>
  - **连续打印** 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("user_prt_lx")` <sub>m_operation_print1</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("x1")` <sub>m_move_first</sub>
    - **上移  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("x3")` <sub>m_move_prior</sub>
    - **下移   DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("x4")` <sub>m_move_next</sub>
    - **尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("x2")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_zcgl`（继承 `m_frame_zc`）
使用窗口：`w_zc_zcgl`「固定资产管理」

- **O.操作** <sub>m_operation</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`this.parentwindow.triggerevent("ue_action_refresh")` <sub>m_operation_refrash</sub>
  - **存盘 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存盘」 → 脚本：`this.parentwindow.triggerevent("ue_action_save")` <sub>m_operation_save</sub>
  - **新增资产 Ctrl+A** 快捷键 `Ctrl+A` 工具栏「增加」 → 脚本：`this.parentwindow.triggerevent("ue_action_new")` <sub>m_operation_add</sub>
  - **修改** 工具栏「修改」 → 脚本：`this.parentwindow.triggerevent("u_modify")` <sub>m_modi</sub>
  - **原值调整** 工具栏「调整」 → 脚本：`this.parentwindow.triggerevent("ue_action_yztz")` <sub>m_yztz</sub>
  - **拷加 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「拷加」 → 脚本：`this.parentwindow.triggerevent("ue_action_newcopy")` <sub>m_operation_addcopy</sub>
  - **注销** 工具栏「注销」 → 脚本：`this.parentwindow.triggerevent("ue_CLEAR")` <sub>m_zx</sub>
  - **删除资产 Ctrl+D** 快捷键 `Ctrl+D` 工具栏「删除」 → 脚本：`this.parentwindow.triggerevent("ue_action_del")` <sub>m_operation_del</sub>
  - **转入** 工具栏「转入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_oprecation_get</sub>
  - ———（分隔线）
  - **累计折旧重新设置 Shift+F10** 快捷键 `Shift+F10` 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("ue_action_zjjs")` <sub>m_o_ljzj</sub>
  - **统一置数** → 脚本：`this.parentwindow.triggerevent("u_zs")` <sub>m_operation_zs</sub>
  - **月工作量录入** → 脚本：`this.parentwindow.triggerevent("u_gzl")` <sub>m_operation_gzl</sub>
  - **凭证制作** 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("u_pz")` <sub>m_operation_pz</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("u_prt_sbqd")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **记录首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上一记录  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下一记录  DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **记录尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>
- **R统计报表** <sub>m_r</sub>
  - **资产明细帐** → 脚本：`this.parentwindow.triggerevent("u_prt_mxz")` <sub>m_r_70</sub>
  - **资产清单** → 脚本：`this.parentwindow.triggerevent("u_prt_sbqd")` <sub>m_r_40</sub>
  - **附属设备表** → 脚本：`this.parentwindow.triggerevent("u_prt_fssb")` <sub>m_r_50</sub>
  - **到期资产清单** → 脚本：`this.parentwindow.triggerevent("u_prt_nddq")` <sub>m_r_10</sub>
  - **资产增加清单** → 脚本：`this.parentwindow.triggerevent("u_prt_ndzj")` <sub>m_r_30</sub>
  - **资产减少清单** → 脚本：`this.parentwindow.triggerevent("u_prt_ndjs")` <sub>m_r_20</sub>
  - **资产分布表** → 脚本：`this.parentwindow.triggerevent("u_prt_zcfb")` <sub>m_r_60</sub>
  - **打印资产标签** → 脚本：`this.parentwindow.triggerevent("u_prt_bq")` <sub>m_r_80</sub>
  - **固定资产台帐** → 脚本：`this.parentwindow.triggerevent("u_prt_tz")` <sub>m_r_90</sub>

### `m_work_zjgl`（继承 `m_frame_zc`）
使用窗口：`w_zjgl`「折旧查询」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **刷新 Ctrl+F** 快捷键 `Ctrl+F` 工具栏「刷新」 → 脚本：`this.parentwindow.triggerevent("ue_action_refresh")` <sub>m_operation_refrash</sub>
  - **折旧分布表** 工具栏「分布」 → 脚本：`this.parentwindow.triggerevent("u_print_fb")` <sub>m_operation_prt_fp</sub>
  - **凭证制作** 工具栏「凭证」 → 脚本：`this.parentwindow.triggerevent("u_pz")` <sub>m_operation_pz</sub>
  - ———（分隔线）
  - **定位查询 Ctrl+Q** 快捷键 `Ctrl+Q` 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - **综合查询** 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("ue_action_query1")` <sub>m_operation_query1</sub>
  - **数据打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - ———（分隔线）
  - **M.移动** <sub>m_move</sub>
    - **首      Ctrl+Home** 工具栏「首项」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **上移  UpArrow** 工具栏「上项」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **下移   DownArrow** 工具栏「下项」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **尾      Ctrl+End** 工具栏「末项」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_zw_01`（继承 `m_frame_zw`）
使用窗口：`w_pz_jccx_1`「辅助项交叉查询汇总表」、`w_zw_slye_1`「库存数量金额表」、`w_zw_wbye_1`「外币余额表」、`w_zw_ye_1`「汇总余额表」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **重新选择** 工具栏「重选」 → 脚本：`this.parentwindow.triggerevent("u_open")` <sub>m_operation_newfw</sub>
  - **定位查询** 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - ———（分隔线）
  - **打印预览** 工具栏「预览」 → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_preview</sub>
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - **查看帐册** 工具栏「帐册」 → 脚本：`this.parentwindow.triggerevent("ue_action_zc")` <sub>m_operation_zc</sub>
  - ———（分隔线）
  - **M.科目** <sub>m_move</sub>
    - **返回总帐科目** 工具栏「总帐」 → 脚本：`this.parentwindow.triggerevent("ue_move_first")` <sub>m_move_first</sub>
    - **退回上一级科目** 工具栏「上级」 → 脚本：`this.parentwindow.triggerevent("ue_move_prior")` <sub>m_move_prior</sub>
    - **进入下级科目** 工具栏「下级」 → 脚本：`this.parentwindow.triggerevent("ue_move_next")` <sub>m_move_next</sub>
    - **展开全部科目** 工具栏「底级」 → 脚本：`this.parentwindow.triggerevent("ue_move_last")` <sub>m_move_last</sub>
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

### `m_work_zw_01_fh`（继承 `m_frame_zw`）
使用窗口：`w_zw_fhslye_1`「辅助项目库存数量金额表」、`w_zw_fhwbye_1`「辅助项目外币余额表」、`w_zw_fhye_1`「辅助项目余额表」、`w_zw_fhye_1_bak`「辅助汇总余额表(（运行时设置）」

- **O.操作** <sub>m_operation</sub>
  - **另存...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_action_saveas")` <sub>m_operation_saveas</sub>
  - **重新选择** 工具栏「重选」 → 脚本：`this.parentwindow.triggerevent("u_open")` <sub>m_operation_newfw</sub>
  - **定位查询** 工具栏「查询」 → 脚本：`this.parentwindow.triggerevent("ue_action_query")` <sub>m_operation_query</sub>
  - ———（分隔线）
  - **打印预览** → 脚本：`this.parentwindow.triggerevent("ue_action_preview")` <sub>m_operation_preview</sub>
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("ue_action_print")` <sub>m_operation_print</sub>
  - **查看帐册** 工具栏「帐册」 → 脚本：`this.parentwindow.triggerevent("ue_action_zc")` <sub>m_operation_zc</sub>
  - ———（分隔线）
  - **F.返回 Ctrl+F4** 快捷键 `Ctrl+F4` 工具栏「返回」 → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_f</sub>

## 右键/弹出菜单

### `m_bb_def_bak`

- **编辑[E]** <sub>m_e</sub>
  - **复制 Ctrl+C** 快捷键 `Ctrl+C` 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("u_copy")` <sub>m_e10</sub>
  - **粘贴 Ctrl+V** 快捷键 `Ctrl+V` 工具栏「粘贴」 → 脚本：`this.parentwindow.triggerevent("u_paste")` <sub>m_e20</sub>
  - ———（分隔线）
  - **清除 Del** 快捷键 `Delete` 工具栏「清除」 → 脚本：`this.parentwindow.triggerevent("u_clear")` <sub>m_e40</sub>
  - ———（分隔线）
  - **插行 Ctrl+I** 快捷键 `Ctrl+I` 工具栏「插行」 → 脚本：`this.parentwindow.triggerevent("u_insert")` <sub>m_e60</sub>
  - **删行 Ctrl+K** 快捷键 `Ctrl+K` 工具栏「删行」 → 脚本：`this.parentwindow.triggerevent("u_delete")` <sub>m_e70</sub>
  - **插列** → 脚本：`this.parentwindow.triggerevent("u_ins_c")` <sub>m_e80</sub>
  - **删列** → 脚本：`this.parentwindow.triggerevent("u_del_c")` <sub>m_e90</sub>
  - ———（分隔线）
  - **画线** 工具栏「画线」 → 脚本：`this.parentwindow.triggerevent("u_line")` <sub>m_e100</sub>
  - **设置分页线** → 脚本：`this.parentwindow.triggerevent("u_page")` <sub>m_e110</sub>
  - **取消分页线** → 脚本：`this.parentwindow.triggerevent("u_page1")` <sub>m_e120</sub>
- **文件[F]** <sub>m_f</sub>
  - **打开 Ctrl+O** 快捷键 `Ctrl+O` 工具栏「打开」 → 脚本：`this.parentwindow.triggerevent("u_open")` <sub>m_f10</sub>
  - **存储 Ctrl+S** 快捷键 `Ctrl+S` 工具栏「存储」 → 脚本：`this.parentwindow.triggerevent("u_save")` <sub>m_f20</sub>
  - **另存为...** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("u_save_as")` <sub>m_f25</sub>
  - **报表生成** 工具栏「生成」 → 脚本：`this.parentwindow.triggerevent("u_proc")` <sub>m_f30</sub>
  - **现场取数** 工具栏「取数」 → 脚本：`this.parentwindow.triggerevent("u_proc_1")` <sub>m_f35</sub>
  - ———（分隔线）
  - **打印 Ctrl+P** 快捷键 `Ctrl+P` 工具栏「打印」 → 脚本：`this.parentwindow.triggerevent("u_print")` <sub>m_f40</sub>
  - **打印预览** 工具栏「预览」 → 脚本：`this.parentwindow.triggerevent("u_preview")` <sub>m_printview</sub>
  - **打印标题** <sub>m_printtitles</sub>
    - **设置打印标题** → 脚本：`this.parentwindow.triggerevent("u_setprinttitle")` <sub>m_setprintitle</sub>
    - **清除打印标题** → 脚本：`this.parentwindow.triggerevent("u_clearprinttitle")` <sub>m_clearprinttitle</sub>
  - **设置打印页** → 脚本：`this.parentwindow.triggerevent("u_printpage")` <sub>m_e45</sub>
  - **打印机设置** → 脚本：`this.parentwindow.triggerevent("u_printsetup")` <sub>m_f50</sub>
  - ———（分隔线）
  - **返回** 工具栏「返回」 → 脚本：`close(this.parentwindow)` <sub>m_f70</sub>
- **帮助[H]** <sub>m_h</sub>
  - **报表函数指南** 工具栏「帮助」 → `w_bb_help`「报表函数指南」 <sub>m_h10</sub>
  - **报表函数向导 F8** 快捷键 `F8` 工具栏「向导」 → 脚本：`this.parentwindow.triggerevent("u_help")` <sub>m_h20</sub>
  - **汇总余额表** 工具栏「余额表」 → `w_zw_ye`「汇总余额表」 <sub>m_h30</sub>
- **格式[S]** <sub>m_m</sub>
  - **边框...** 工具栏「边框」 → 脚本：`this.parentwindow.triggerevent("u_bord")` <sub>m_m10</sub>
  - **字体...** → 脚本：`this.parentwindow.triggerevent("u_font")` <sub>m_m20</sub>
  - **行高...** → 脚本：`this.parentwindow.triggerevent("u_rowh")` <sub>m_m30</sub>
  - **列宽...** → 脚本：`this.parentwindow.triggerevent("u_colw")` <sub>m_m40</sub>
  - **排列格式...** → 脚本：`this.parentwindow.triggerevent("u_format")` <sub>m_m50</sub>
  - **数字格式...** → 脚本：`this.parentwindow.triggerevent("u_f_num")` <sub>m_m60</sub>
- **显示[S]** <sub>m_s</sub>
  - **增加行** 工具栏「增行」 → 脚本：`this.parentwindow.triggerevent("u_addrow")` <sub>m_s10</sub>
  - **减行** 工具栏「减行」 → 脚本：`this.parentwindow.triggerevent("u_decrow")` <sub>m_s20</sub>
  - **增加列** 工具栏「增列」 → 脚本：`this.parentwindow.triggerevent("u_addcol")` <sub>m_s30</sub>
  - **减列** 工具栏「减列」 → 脚本：`this.parentwindow.triggerevent("u_deccol")` <sub>m_s40</sub>
  - **网格显示/取消** 工具栏「网格」 → 脚本：`this.parentwindow.triggerevent("u_grid")` <sub>m_s42</sub>
  - **定义/显示** → 脚本：`this.parentwindow.triggerevent("u_zhbz")` <sub>m_s45</sub>
  - **公式显示/取消** → 脚本：`this.parentwindow.triggerevent("u_formu")` <sub>m_s50</sub>
  - **sheet显示/取消 Alt+S** 快捷键 `Alt+S` 〔默认隐藏〕 → 脚本：`this.parentwindow.triggerevent("u_sheet")` <sub>m_sheet</sub>
- **窗口[W]** <sub>m_w</sub>
  - **层叠** → 脚本：`mainwindow.arrangesheets(cascade!)` <sub>m_w10</sub>
  - **平铺** → 脚本：`mainwindow.arrangesheets(layer!)` <sub>m_w20</sub>

### `m_bb_saveas_get`

- **操作** 〔默认隐藏〕 <sub>m_bb</sub>
  - **读入** 工具栏「读入」 → 脚本：`this.parentwindow.triggerevent("ue_action_get")` <sub>m_bb_get</sub>
  - **另存** 工具栏「另存」 → 脚本：`this.parentwindow.triggerevent("ue_saveas")` <sub>m_bb_00</sub>
  - **复制** 工具栏「复制」 → 脚本：`this.parentwindow.triggerevent("u_copy")` <sub>m_copy</sub>
  - **粘贴** 工具栏「粘贴」 → 脚本：`this.parentwindow.triggerevent("u_paste")` <sub>m_paste</sub>
  - **退出** 工具栏「退出」 → 脚本：`close(this.parentwindow)` <sub>m_bb_05</sub>

### `m_cpq_rbutton_paste`

- **a1** <sub>m_1</sub>
  - **V.取现有值** → `w_paste`「请选择粘贴值」 <sub>m_value</sub>
  - **D.清除本列** → 脚本：`datawindow dwp` <sub>m_clear</sub>
  - **N.返回** <sub>m_return</sub>

### `m_cpq_rbutton_select`

- **a1** <sub>m_1</sub>
  - **A.选择所有列** → 脚本：`long i` <sub>m_selectall</sub>
  - **D.去掉所有列** → 脚本：`long i` <sub>m_unselectall</sub>
  - **N.返回** <sub>m_return</sub>

### `m_rbtn_paste`

- **a1** <sub>m_1</sub>
  - **H.帮助 Shift+F1** 快捷键 `Shift+F1` 〔默认禁用〕 → 脚本：`message.stringparm = "help"` <sub>m_help</sub>
  - ———（分隔线）
  - **U.取消上次操作 Ctrl+Z** 快捷键 `Ctrl+Z` → 脚本：`message.stringparm = "undo"` <sub>m_undo</sub>
  - ———（分隔线）
  - **T.剪切 Ctrl+X** 快捷键 `Ctrl+X` → 脚本：`message.stringparm = "cut"` <sub>m_cut</sub>
  - **C.拷贝 Ctrl+C** 快捷键 `Ctrl+C` → 脚本：`message.stringparm = "copy"` <sub>m_copy</sub>
  - **P.粘贴 Ctrl+V** 快捷键 `Ctrl+V` → 脚本：`message.stringparm = "paste"` <sub>m_paste</sub>
  - **L.清除 Del** 快捷键 `Delete` → 脚本：`message.stringparm = "clear"` <sub>m_clear</sub>
  - ———（分隔线）
  - **S.选中当前列 Ctrl+A** 快捷键 `Ctrl+A` → 脚本：`message.stringparm = "selectall"` <sub>m_s</sub>

### `m_rbtn_preview`

- **Preview** <sub>m_1</sub>
  - **预览** → 脚本：`message.stringparm = "preview"` <sub>m_preview</sub>
  - **标尺** → 脚本：`message.stringparm = "rulers"` <sub>m_rulers</sub>
  - ———（分隔线）
  - **200%** → 脚本：`message.stringparm = "200"` <sub>m_200</sub>
  - **100%** → 脚本：`message.stringparm = "100"` <sub>m_100</sub>
  - **75%** → 脚本：`message.stringparm = "75"` <sub>m_75</sub>
  - **50%** → 脚本：`message.stringparm = "50"` <sub>m_50</sub>
  - **25%** → 脚本：`message.stringparm = "25"` <sub>m_25</sub>
  - ———（分隔线）
  - **定制** → 脚本：`message.stringparm = "custom"` <sub>m_custom</sub>

### `m_rbutton`

- **a1** <sub>m_1</sub>
  - **A.插入一行** → 脚本：`message.stringparm = "insertrow"` <sub>m_add</sub>
  - **D.删除一行** → 脚本：`message.stringparm = "deleterow"` <sub>m_deletearow</sub>
  - **N.返回** <sub>m_return</sub>

### `m_root`

- **F.文件** <sub>m_system</sub>
  - **关闭窗口 Ctrl+F4** 快捷键 `Ctrl+F4` → 脚本：`mainwindow.triggerevent("ue_closesheet")` <sub>m_system_closesheet</sub>
  - **关闭所有窗口** → `w_main1`「主窗口」 <sub>m_system_closeall</sub>
  - **切换套账** → `w_login`「用户登录」、`w_login_oem`「用户登录」、`w_bakupdata`「切换套账（取自菜单文字）」 <sub>m_system_trans</sub>
  - ———（分隔线）
  - **打印机设置** → 脚本：`printsetup()` <sub>m_system_printset</sub>
  - **屏幕打印 Shift+P** 快捷键 `Shift+P` → 脚本：`long job` <sub>m_system_printscreen</sub>
  - **工具条设置** 〔默认隐藏〕 → `w_setbar`「工具条设置」 <sub>m_system_barset</sub>
  - ———（分隔线）
  - **系统注册** 〔默认隐藏〕 <sub>m_xtzc</sub>
  - **模块管理** 〔默认隐藏〕 → `w_module`「模块维护」 <sub>m_module</sub>
  - **用户管理** → `w_xt_users`「用户管理」 <sub>m_useright</sub>
  - **自改密码** → `w_pass`「自改密码」 <sub>m_changepswd</sub>
  - ———（分隔线）
  - **退出系统 Alt+X** 快捷键 `Alt+X` → 脚本：`close(mainwindow)` <sub>m_system_exit</sub>
- **I.自助服务** 〔默认隐藏〕 <sub>m_t</sub>
  - **客服中心** → 脚本：`f_get_kf()` <sub>m_t_10</sub>
  - **视频教程** → 脚本：`runhtml("http://rhrj.net/Aboutmenuid95.html")` <sub>m_t_20</sub>
  - **软件升级** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_30</sub>
  - **软件下载** → 脚本：`runhtml("http://www.rhrj.net/downloadmenuid11.html")` <sub>m_t_60</sub>
  - **会员中心** → 脚本：`runhtml("http://www.360360.com.cn/help/default.aspx?id=1193")` <sub>m_h_40</sub>
  - **官方网站 Alt+F10** 快捷键 `Alt+F10` → 脚本：`runhtml("http://www.rhrj.net")` <sub>m_t_70</sub>
- **W.窗口** <sub>m_window</sub>
  - **级联排列 Shift+F5** 快捷键 `Shift+F5` → 脚本：`mainwindow.arrangesheets(cascade!)` <sub>m_window_cascade</sub>
  - **水平排列** → 脚本：`mainwindow.arrangesheets(tilehorizontal!)` <sub>m_window_htile</sub>
  - **垂直排列 Shift+F4** 快捷键 `Shift+F4` → 脚本：`mainwindow.arrangesheets(tile!)` <sub>m_window_vtile</sub>
  - **窗口铺满** → 脚本：`mainwindow.arrangesheets(layer!)` <sub>m_window_layer</sub>
  - ———（分隔线）
  - **排列图标** → 脚本：`mainwindow.arrangesheets(icons!)` <sub>m_window_arrangeicons</sub>
- **H.帮助** <sub>m_help</sub>
  - **系统帮助 F1** 快捷键 `F1` → 运行 `hh.exe help.chm` <sub>m_help_sys</sub>
  - ———（分隔线）
  - **版权信息** → `w_cwxt`「关于...」 <sub>m_help_about</sub>
  - **计算器 Ctrl+F12** 快捷键 `Ctrl+F12` → 运行 `calc.exe` <sub>m_help_calc</sub>

### `m_treeview_rbutton`

- **a1** <sub>m_1</sub>
  - **扩展所有项** → 脚本：`message.stringparm = "expandall"` <sub>m_expandall</sub>
  - ———（分隔线）
  - **关闭所有项** → 脚本：`message.stringparm = "unexpandall"` <sub>m_unexpandall</sub>
