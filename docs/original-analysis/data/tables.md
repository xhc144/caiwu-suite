# 数据库表结构（来自账套模板 DDL）

来源：每套安装包的 60 个账套模板（`aNN.acd`，纯静态解压）中的 `rhsj/data_stru.txt`（CREATE TABLE / CREATE INDEX）。三套产品的模板 DDL 一致。
中文名取自 DataWindow 列标题（同一字段在不同报表里的标题可能不同，列出最常见的几个）；“使用窗口”= 通过 DataWindow 或嵌入式 SQL 读写该表的窗口。
不同账套模板的同名表可能有多个定义变体；下表展示覆盖模板最多的变体，并注明变体数。数据库为 Sybase SQL Anywhere 8/9（`asa8`）。

## 账套模板（新建账套时选择的会计制度）

| 模板文件 | 显示顺序 | 名称 |
|---|---|---|
| a01.acd | 01 | 企业会计准则（科目级数4-3-3） |
| a02.acd | 02 | 企业会计准则（科目级数4-2-2） |
| a05.acd | 03 | 小企业会计准则（科目级数4-3-3） |
| a52.acd | 04 | 小企业会计准则（科目级数4-2-2） |
| a54.acd | 05 | 民间非营利组织会计准则(2026) |
| a35.acd | 06 | 农民专业合作社会计制度(2023) |
| a53.acd | 07 | 农村集体经济组织会计制度(2024) |
| a49.acd | 08 | 工会制度（2022） |
| a50.acd | 09 | 基层工会制度（2022） |
| a07.acd | 10 | 建筑施工企业会计准则 |
| a12.acd | 11 | 基建企业会计准则 |
| a13.acd | 12 | 房地产开发企业会计准则 |
| a11.acd | 13 | 农村医疗会计准则 |
| a31.acd | 14 | 中小学会计模版 |
| a15.acd | 15 | 国有建设单位会计准则 |
| a16.acd | 16 | 投资担保行业 |
| a17.acd | 17 | 农村集体财务（一级科目3位） |
| a18.acd | 18 | 农村村级财务（一级科目4位） |
| a25.acd | 19 | 医院会计准则 |
| a26.acd | 20 | 基层医疗机构会计准则 |
| a29.acd | 21 | 财政总预算会计准则 |
| a32.acd | 22 | 小额贷款企业模版 |
| a33.acd | 23 | 典当行模版 |
| a23.acd | 24 | 出纳模版 |
| a46.acd | 25 | 党费管理模板 |
| a24.acd | 26 | 广东残联会计模版 |
| a42.acd | 27 | 民办幼儿园模版(2015) |
| a43.acd | 28 | 学校食堂会计制度模板 |
| a45.acd | 29 | 个体工商户模版 |
| a51.acd | 30 | 幼儿园食堂会计制度模板 |
| a10.acd | 31 | 事业单位会计准则(2019年停用) |
| a30.acd | 32 | 行政单位会计准则(2019年停用) |
| a19.acd | 33 | 学校会计准则(2013年停用) |
| a03.acd | 34 | 企业会计准则(2007年停用) |
| a04.acd | 35 | 小企业会计准则(2013年停用) |
| a08.acd | 36 | 旧建筑施工企业会计准则 |
| a09.acd | 37 | 行政单位会计准则(2014年停用) |
| a14.acd | 38 | 旧房地产开发企业会计准则 |
| a27.acd | 39 | 小企业会计准则(2006年停用) |
| a20.acd | 40 | 工会制度(2022年停用) |
| a22.acd | 41 | 基层工会制度(2022年停用) |
| a28.acd | 42 | 农民专业合作社会计准则(2023年停用) |
| a06.acd | 43 | 民间非营利组织会计准则(2026年停用) |
| a21.acd | 44 | 旧基层工会制度 |

未出现在 aclist.txt 中的模板文件（a36–a41、a55–a60 等）字节相同或为备用，新建账套界面不显示。

## 表目录

| 表名 | 中文推断 | 列数 | 定义变体 | 使用窗口数 |
|---|---|---|---|---|
| [auditrpt](#auditrpt) |  | 15 | 1 | 0 |
| [b_errmsg](#b_errmsg) | 错误查看、System Error | 9 | 1 | 12 |
| [b_module](#b_module) |  | 4 | 1 | 0 |
| [b_rights](#b_rights) | 用户登录、共享式应用 | 4 | 1 | 110 |
| [b_user](#b_user) | 用户登录、分配权限 | 7 | 1 | 57 |
| [bbml](#bbml) | 数据备份、套帐复制 | 7 | 1 | 71 |
| [bbml_gs](#bbml_gs) | 数据备份、套帐复制 | 11 | 1 | 54 |
| [bbml_pos](#bbml_pos) | 报表生成、数据备份 | 15 | 1 | 52 |
| [bbml_t](#bbml_t) |  | 7 | 1 | 0 |
| [bmk](#bmk) | 打印凭证-1、三栏明细账 | 3 | 3 | 120 |
| [bmk_pos](#bmk_pos) |  | 2 | 1 | 0 |
| [bmnc](#bmnc) | 三栏明细账、多栏账 | 14 | 3 | 88 |
| [bzk](#bzk) |  | 4 | 1 | 0 |
| [cb_hzk](#cb_hzk) | 产品档案维护、反结账 | 11 | 2 | 7 |
| [cbfpb1](#cbfpb1) |  | 8 | 1 | 0 |
| [cbfpb2](#cbfpb2) |  | 7 | 1 | 0 |
| [chxl](#chxl) |  | 4 | 1 | 0 |
| [ckda](#ckda) |  | 8 | 1 | 0 |
| [ckjl](#ckjl) |  | 12 | 1 | 0 |
| [cn_hz](#cn_hz) | 修改科目编码长度、科目编码字符替换 | 5 | 2 | 17 |
| [cn_mx](#cn_mx) | 凭证录入、格式定义 | 16 | 8 | 59 |
| [cn_nc](#cn_nc) | 出纳数据引入、修改科目编码长度 | 3 | 3 | 22 |
| [cpda](#cpda) | 数据导出、凭证生成 | 9 | 6 | 37 |
| [cpsx](#cpsx) |  | 2 | 1 | 0 |
| [cw_pzzk](#cw_pzzk) |  | 15 | 1 | 0 |
| [dbver](#dbver) |  | 2 | 1 | 0 |
| [dj_lx](#dj_lx) | 特殊打印 | 10 | 1 | 1 |
| [dlk](#dlk) |  | 2 | 1 | 0 |
| [dlxx](#dlxx) | 期初建账操作向导、操作日志 | 6 | 1 | 15 |
| [dqda](#dqda) |  | 2 | 1 | 0 |
| [dwk](#dwk) | 打印凭证-1、三栏明细账 | 10 | 11 | 144 |
| [dwlx](#dwlx) |  | 2 | 1 | 0 |
| [dwnc](#dwnc) | 三栏明细账、多栏账 | 14 | 3 | 90 |
| [dwxz](#dwxz) |  | 2 | 1 | 0 |
| [dz_dw](#dz_dw) |  | 16 | 2 | 0 |
| [dz_jl](#dz_jl) |  | 12 | 2 | 0 |
| [dz_xt](#dz_xt) |  | 2 | 1 | 0 |
| [dz_yh](#dz_yh) |  | 13 | 2 | 0 |
| [dz_zh](#dz_zh) |  | 16 | 2 | 0 |
| [fbgl](#fbgl) | 【、用户登录 | 6 | 1 | 100 |
| [fcsp](#fcsp) |  | 20 | 2 | 0 |
| [fx_dy](#fx_dy) | 财务分析、财务分析定义 | 5 | 1 | 9 |
| [fx_ml](#fx_ml) | 报表复制、财务分析定义 | 2 | 1 | 15 |
| [g_fp_hz](#g_fp_hz) |  | 8 | 3 | 0 |
| [g_fp_mx](#g_fp_mx) | 凭证生成、用户登录 | 33 | 4 | 44 |
| [g_fp_mx_2](#g_fp_mx_2) | 凭证生成、发票汇总 | 21 | 3 | 37 |
| [grk](#grk) | 打印凭证-1、三栏明细账 | 3 | 3 | 120 |
| [grnc](#grnc) | 三栏明细账、多栏账 | 14 | 3 | 88 |
| [gxjh](#gxjh) |  | 9 | 1 | 0 |
| [gz_bmk](#gz_bmk) | 从其他套帐转入科目、部门维护 | 2 | 1 | 15 |
| [gz_gsk](#gz_gsk) | 计算公式定义、从其他套帐转入科目 | 7 | 3 | 11 |
| [gz_gzjg](#gz_gzjg) | 打印预览、从其他套帐转入科目 | 17 | 1 | 37 |
| [gz_gzk](#gz_gzk) | 用户登录、从其他套帐转入科目 | 92 | 2 | 29 |
| [gz_yfkm](#gz_yfkm) | 从其他套帐转入科目、凭证生成 | 2 | 2 | 9 |
| [h_bjlx](#h_bjlx) |  | 2 | 1 | 0 |
| [h_cpdj](#h_cpdj) |  | 8 | 1 | 0 |
| [h_khda](#h_khda) |  | 2 | 1 | 0 |
| [h_khdj](#h_khdj) |  | 12 | 1 | 0 |
| [h_khlx](#h_khlx) |  | 2 | 1 | 0 |
| [h_rz](#h_rz) |  | 6 | 1 | 0 |
| [h_wldj](#h_wldj) |  | 11 | 1 | 0 |
| [hg_da](#hg_da) | 数据导出、格式定义 | 7 | 2 | 14 |
| [ht1](#ht1) | 合同复制 | 28 | 1 | 1 |
| [ht2](#ht2) |  | 20 | 1 | 0 |
| [htda](#htda) | 凭证录入、数据导出 | 9 | 3 | 32 |
| [htfk](#htfk) |  | 8 | 1 | 0 |
| [htjetz](#htjetz) |  | 5 | 1 | 0 |
| [htk](#htk) |  | 30 | 1 | 0 |
| [htlx](#htlx) |  | 2 | 1 | 0 |
| [htnc](#htnc) |  | 15 | 1 | 0 |
| [htyeb](#htyeb) |  | 15 | 1 | 0 |
| [htzt](#htzt) |  | 2 | 1 | 0 |
| [hz](#hz) | 三栏明细账、【 | 10 | 3 | 158 |
| [hzk](#hzk) |  | 14 | 1 | 0 |
| [hzyeb](#hzyeb) | 打印预览、数据导出 | 22 | 5 | 53 |
| [im_bmk](#im_bmk) |  | 7 | 1 | 0 |
| [im_bmnc](#im_bmnc) |  | 8 | 2 | 0 |
| [im_cross](#im_cross) |  | 10 | 1 | 0 |
| [im_dwk](#im_dwk) |  | 19 | 1 | 0 |
| [im_dwnc](#im_dwnc) |  | 8 | 2 | 0 |
| [im_grk](#im_grk) |  | 8 | 1 | 0 |
| [im_grnc](#im_grnc) |  | 8 | 2 | 0 |
| [im_kmbm](#im_kmbm) |  | 24 | 2 | 0 |
| [im_wlxx](#im_wlxx) |  | 12 | 2 | 0 |
| [im_xmk](#im_xmk) |  | 15 | 1 | 0 |
| [im_xmnc](#im_xmnc) |  | 8 | 1 | 0 |
| [im_zjk](#im_zjk) |  | 7 | 1 | 0 |
| [im_zjnc](#im_zjnc) |  | 8 | 2 | 0 |
| [jf_tj_temp](#jf_tj_temp) |  | 5 | 1 | 0 |
| [jf_xm](#jf_xm) |  | 2 | 1 | 0 |
| [jf_zb](#jf_zb) |  | 13 | 1 | 0 |
| [jgb1](#jgb1) |  | 8 | 1 | 0 |
| [jgb2](#jgb2) |  | 7 | 1 | 0 |
| [jjda](#jjda) |  | 8 | 1 | 0 |
| [jrx_fd](#jrx_fd) |  | 2 | 1 | 0 |
| [jslb](#jslb) | 结算类别管理、系统初始化--执行操作 | 2 | 1 | 12 |
| [jzlx](#jzlx) | 月度结转、月度结转——生成凭证 | 9 | 4 | 36 |
| [jzlx_link](#jzlx_link) |  | 9 | 1 | 0 |
| [jzpz](#jzpz) |  | 13 | 1 | 0 |
| [jzpznr](#jzpznr) |  | 14 | 2 | 0 |
| [kcb](#kcb) | 库存速查、采购合同 | 3 | 3 | 3 |
| [kcb01](#kcb01) |  | 7 | 1 | 0 |
| [kcb1](#kcb1) |  | 5 | 1 | 0 |
| [khda](#khda) | 修改编号 | 25 | 1 | 1 |
| [khdy](#khdy) |  | 4 | 2 | 0 |
| [khhz](#khhz) |  | 6 | 1 | 0 |
| [km_link](#km_link) |  | 3 | 1 | 0 |
| [kmbm](#kmbm) | 三栏明细账、多栏账 | 32 | 7 | 400 |
| [kmzk](#kmzk) |  | 9 | 1 | 0 |
| [luck](#luck) |  | 2 | 1 | 0 |
| [m_ckdj](#m_ckdj) |  | 5 | 1 | 0 |
| [matetype](#matetype) |  | 3 | 1 | 0 |
| [nc](#nc) | 三栏明细账、凭证生成 | 15 | 2 | 161 |
| [nc_check](#nc_check) |  | 32 | 2 | 0 |
| [nc_cross](#nc_cross) |  | 22 | 1 | 0 |
| [pbcatcol](#pbcatcol) |  | 20 | 1 | 0 |
| [pbcatedt](#pbcatedt) |  | 7 | 1 | 0 |
| [pbcatfmt](#pbcatfmt) |  | 4 | 1 | 0 |
| [pbcattbl](#pbcattbl) |  | 25 | 1 | 0 |
| [pbcatvld](#pbcatvld) |  | 5 | 1 | 0 |
| [pdk](#pdk) | 产品档案维护、成本核算 | 8 | 3 | 3 |
| [pdk0](#pdk0) |  | 5 | 1 | 0 |
| [pdk_0](#pdk_0) |  | 14 | 1 | 0 |
| [pjlb](#pjlb) |  | 6 | 2 | 0 |
| [pjnr1](#pjnr1) | 凭证生成、库存台帐 | 13 | 6 | 40 |
| [pjnr1_0](#pjnr1_0) |  | 28 | 2 | 0 |
| [pjnr2](#pjnr2) | 凭证生成、数据导出 | 13 | 3 | 40 |
| [pjnr2_0](#pjnr2_0) |  | 27 | 2 | 0 |
| [pz](#pz) | 三栏明细账、凭证生成 | 34 | 6 | 285 |
| [pz_fj](#pz_fj) | 凭证删除、销项发票录入 | 4 | 1 | 12 |
| [pzdj](#pzdj) | 三栏明细账、凭证生成 | 12 | 3 | 190 |
| [pzhz](#pzhz) |  | 8 | 3 | 0 |
| [pzlx](#pzlx) | 三栏明细账、凭证生成 | 12 | 1 | 178 |
| [pzmb](#pzmb) | 凭证录入、凭证修改 | 2 | 1 | 24 |
| [pzmb_pz](#pzmb_pz) | 凭证录入、凭证修改 | 28 | 7 | 18 |
| [rhcert](#rhcert) |  | 23 | 3 | 0 |
| [rkdk0](#rkdk0) |  | 8 | 1 | 0 |
| [rkdk0_bf](#rkdk0_bf) |  | 9 | 1 | 0 |
| [rpt_bm](#rpt_bm) |  | 2 | 1 | 0 |
| [rpt_dq](#rpt_dq) |  | 2 | 1 | 0 |
| [rpt_ls](#rpt_ls) |  | 2 | 1 | 0 |
| [rpt_org](#rpt_org) |  | 2 | 1 | 0 |
| [rptcell](#rptcell) |  | 15 | 1 | 0 |
| [rptcover](#rptcover) |  | 26 | 1 | 0 |
| [ryk](#ryk) |  | 3 | 1 | 0 |
| [s_gxda](#s_gxda) |  | 5 | 1 | 0 |
| [scjh1](#scjh1) | 合同复制 | 7 | 1 | 1 |
| [scjh2](#scjh2) |  | 7 | 1 | 0 |
| [scjh3](#scjh3) |  | 9 | 1 | 0 |
| [scydd](#scydd) |  | 23 | 1 | 0 |
| [sd_lpj](#sd_lpj) |  | 5 | 1 | 0 |
| [shdb1](#shdb1) |  | 29 | 1 | 0 |
| [shdb2](#shdb2) |  | 27 | 1 | 0 |
| [sj_cpgxb](#sj_cpgxb) |  | 6 | 2 | 0 |
| [sj_ddys](#sj_ddys) |  | 1 | 1 | 0 |
| [sj_dw](#sj_dw) |  | 1 | 1 | 0 |
| [sj_fp1](#sj_fp1) |  | 11 | 2 | 0 |
| [sj_fp2](#sj_fp2) |  | 9 | 2 | 0 |
| [sj_gxda](#sj_gxda) |  | 4 | 1 | 0 |
| [sj_gxda_blp](#sj_gxda_blp) |  | 3 | 1 | 0 |
| [sj_ps](#sj_ps) |  | 1 | 1 | 0 |
| [sj_yg](#sj_yg) |  | 1 | 1 | 0 |
| [sj_yzys](#sj_yzys) |  | 1 | 1 | 0 |
| [sj_zdys](#sj_zdys) |  | 1 | 1 | 0 |
| [slz](#slz) | 三栏明细账、多栏账 | 26 | 8 | 68 |
| [tdk](#tdk) |  | 5 | 1 | 0 |
| [tlda](#tlda) | 产品档案维护 | 4 | 2 | 1 |
| [tlda0](#tlda0) |  | 1 | 2 | 0 |
| [users](#users) |  | 8 | 1 | 0 |
| [v_pz](#v_pz) |  | 10 | 1 | 0 |
| [wl_check](#wl_check) |  | 13 | 2 | 0 |
| [wldj](#wldj) | 出库单浏览 | 20 | 1 | 1 |
| [wldj_lx](#wldj_lx) |  | 2 | 2 | 0 |
| [wlhz](#wlhz) | 系统初始化--执行操作、一键初始 | 8 | 2 | 9 |
| [wlxx](#wlxx) | 系统初始化--执行操作、一键初始 | 15 | 3 | 24 |
| [wlxx_nc](#wlxx_nc) |  | 17 | 2 | 0 |
| [xh_fyda](#xh_fyda) |  | 3 | 1 | 0 |
| [xh_fylb](#xh_fylb) |  | 13 | 1 | 0 |
| [xh_ghda](#xh_ghda) |  | 3 | 1 | 0 |
| [xh_zyda](#xh_zyda) |  | 2 | 1 | 0 |
| [xjll_xm](#xjll_xm) | 凭证录入、数据导出 | 3 | 1 | 35 |
| [xlk](#xlk) |  | 2 | 1 | 0 |
| [xm_file](#xm_file) |  | 2 | 1 | 0 |
| [xmgm](#xmgm) |  | 2 | 1 | 0 |
| [xmk](#xmk) | 打印凭证-1、三栏明细账 | 3 | 4 | 120 |
| [xmlx](#xmlx) |  | 2 | 1 | 0 |
| [xmnc](#xmnc) | 三栏明细账、多栏账 | 14 | 3 | 88 |
| [xmxz](#xmxz) |  | 2 | 1 | 0 |
| [xt](#xt) | 三栏明细账、用户登录 | 2 | 4 | 322 |
| [xt_data](#xt_data) |  | 3 | 1 | 0 |
| [ydjz](#ydjz) |  | 11 | 1 | 0 |
| [ydjztp](#ydjztp) |  | 6 | 1 | 0 |
| [ye_cross](#ye_cross) |  | 29 | 1 | 0 |
| [yh_yt](#yh_yt) |  | 3 | 1 | 0 |
| [yhdzd](#yhdzd) | 数据导出、格式定义 | 11 | 2 | 23 |
| [ysda](#ysda) | 数据导出、格式定义 | 10 | 2 | 14 |
| [ysk](#ysk) |  | 14 | 2 | 0 |
| [yt](#yt) |  | 2 | 1 | 0 |
| [zc_fbb](#zc_fbb) |  | 3 | 1 | 0 |
| [zc_fssb](#zc_fssb) | 固定资产台帐、固定资产初始化 | 7 | 2 | 10 |
| [zc_ft_pcs](#zc_ft_pcs) |  | 2 | 1 | 0 |
| [zc_gdzc](#zc_gdzc) | 数据导出、用户登录 | 35 | 4 | 62 |
| [zc_pic](#zc_pic) |  | 2 | 1 | 0 |
| [zc_sbbd](#zc_sbbd) | 从其他套帐转入科目、固定资产初始化 | 6 | 1 | 5 |
| [zc_sblb](#zc_sblb) | 数据导出、资产分布表 | 4 | 3 | 35 |
| [zc_sbly](#zc_sbly) |  | 2 | 1 | 0 |
| [zc_sbyt](#zc_sbyt) | 数据导出、用途维护 | 3 | 2 | 29 |
| [zc_sbzt](#zc_sbzt) | 数据导出、从其他套帐转入科目 | 3 | 1 | 20 |
| [zc_sbzx](#zc_sbzx) | 固定资产明细账打印、生成凭证 | 2 | 1 | 12 |
| [zc_sydw](#zc_sydw) | 数据导出、部门维护 | 2 | 1 | 22 |
| [zc_syr](#zc_syr) |  | 1 | 1 | 0 |
| [zc_yzjb](#zc_yzjb) | 用户登录、打印固定资产明细帐 | 11 | 2 | 43 |
| [zc_yzzj](#zc_yzzj) | 原值调整、固定资产明细账打印 | 10 | 2 | 16 |
| [zc_zcbdb](#zc_zcbdb) |  | 12 | 1 | 0 |
| [zjly](#zjly) |  | 7 | 1 | 0 |
| [zjnc](#zjnc) |  | 19 | 1 | 0 |
| [ztk](#ztk) |  | 9 | 1 | 0 |
| [ztnr](#ztnr) |  | 3 | 1 | 0 |
| [zx_cbfpb](#zx_cbfpb) | 产品档案维护、凭证生成 | 10 | 2 | 2 |
| [zyk](#zyk) | 凭证录入、摘要管理 | 5 | 1 | 17 |

## 表明细

### auditrpt

- 定义变体 1 个；展示的变体出现在 2 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | rptid | integer | 否 |  | 1 |  |
| 2 | rptmc | varchar(64) | 是 |  |  |  |
| 3 | maxrow | integer | 是 |  |  |  |
| 4 | maxcol | integer | 是 |  |  |  |
| 5 | addrow | char(1) | 是 |  |  |  |
| 6 | rowitem | char(1) | 是 |  |  |  |
| 7 | h_b | integer | 是 |  |  |  |
| 8 | h_e | integer | 是 |  |  |  |
| 9 | d_b | integer | 是 |  |  |  |
| 10 | d_e | integer | 是 |  |  |  |
| 11 | f_b | integer | 是 |  |  |  |
| 12 | f_e | integer | 是 |  |  |  |
| 13 | header_r | char(2) | 是 |  |  |  |
| 14 | footer_r | char(1) | 是 |  |  |  |
| 15 | islock | char(1) | 是 |  |  |  |

### b_errmsg

- 主要相关窗口：错误查看、System Error
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_err_view`（chengben/fp）、`w_system_error`（chengben/fp）、`w_err_view`（chengben/main）、`w_system_error`（chengben/main）、`w_err_view`（minfeiqi/main）、`w_system_error`（minfeiqi/main）、`w_err_view`（qingsong/cn）、`w_system_error`（qingsong/cn）、`w_err_view`（qingsong/fp）、`w_system_error`（qingsong/fp）、`w_err_view`（qingsong/main）、`w_system_error`（qingsong/main）
- 数据窗口：`d_errmsg`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | err_time | timestamp | 否 |  | 1 | 出错时间 |
| 2 | err_cname | varchar(10) | 是 |  |  | 操作员 |
| 3 | err_num | varchar(6) | 是 |  |  | 错误号 |
| 4 | err_message | varchar(255) | 是 |  |  | 错误信息 |
| 5 | err_where | varchar(255) | 是 |  |  | 出错地方 |
| 6 | err_object | varchar(50) | 是 |  |  | 出错对象 |
| 7 | err_event | varchar(50) | 是 |  |  | 出错事件 |
| 8 | err_line | varchar(5) | 是 |  |  | 行号 |
| 9 | err_cnt | integer | 是 |  |  |  |

### b_module

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | m_id | char(6) | 是 |  |  | 模块编号 |
| 2 | e_name | char(30) | 是 |  |  | 英文名 |
| 3 | c_name | char(30) | 是 |  |  | 中文名 |
| 4 | isgroup | char(1) | 是 |  |  |  |

### b_rights

- 主要相关窗口：用户登录、共享式应用
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_login`（chengben/fp）、`w_login_oem`（chengben/fp）、`w_login_qhmk`（chengben/fp）、`wroot_share`（chengben/fp）、`wroot_share_tab`（chengben/fp）、`w_bakupdata`（chengben/main）、`w_bb_htpj`（chengben/main）、`w_bb_main`（chengben/main）、`w_cb_cpda`（chengben/main）、`w_cb_sl_hzyeb`（chengben/main）、`w_ck_ck1`（chengben/main）、`w_ck_kc`（chengben/main）、`w_ck_rk1`（chengben/main）、`w_ck_tz1`（chengben/main）、`w_ck_tz1_bak`（chengben/main）、`w_ck_xsmxz1`（chengben/main）、`w_fx_nd_1`（chengben/main）、`w_fx_yd_1`（chengben/main）、`w_fx_zl`（chengben/main）、`w_grant`（chengben/main）……共 110 个
- 数据窗口：`d_grant_now`、`dw_right_1`、`dw_users_rights`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | u_id | char(3) | 否 |  | 1 |  |
| 2 | m_id | char(3) | 否 |  | 2 |  |
| 3 | c_name | varchar(30) | 是 |  |  |  |
| 4 | isgroup | char(1) | 是 |  |  |  |

### b_user

- 主要相关窗口：用户登录、分配权限
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_login`（chengben/fp）、`w_login_oem`（chengben/fp）、`w_login_qhmk`（chengben/fp）、`w_acini_wizard`（chengben/main）、`w_cb_xt_kgzb`（chengben/main）、`w_grant`（chengben/main）、`w_hf`（chengben/main）、`w_login`（chengben/main）、`w_login_1`（chengben/main）、`w_login_oem`（chengben/main）、`w_login_qhmk`（chengben/main）、`w_pass`（chengben/main）、`w_pz_kmhz`（chengben/main）、`w_users`（chengben/main）、`w_xt_kgzb`（chengben/main）、`w_xt_kgzb_gz`（chengben/main）、`w_xt_kgzb_zc`（chengben/main）、`w_xt_users`（chengben/main）、`w_xt_uses_zj`（chengben/main）、`w_zh_zhjc`（chengben/main）……共 57 个
- 数据窗口：`d_grant_group`、`d_users_detail`、`d_users_master`、`dddw_user_login`、`dw_xt_users`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | u_id | char(3) | 否 |  | 1 | 用户号: |
| 2 | e_name | varchar(20) | 是 |  |  | 登录代码、用户代码 |
| 3 | c_name | varchar(20) | 是 |  |  | 用户姓名、用户名称 |
| 4 | pswd | varchar(20) | 是 |  |  | 密码 |
| 5 | isgroup | char(1) | 是 |  |  | 用户/组: |
| 6 | department | char(1) | 是 |  |  |  |
| 7 | ckbh | char(10) | 是 |  |  |  |

### bbml

- 主要相关窗口：数据备份、套帐复制
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_bakupdata`（chengben/main）、`w_bb_add`（chengben/main）、`w_bb_bbsetup`（chengben/main）、`w_bb_copy`（chengben/main）、`w_bb_def`（chengben/main）、`w_bb_def_cn`（chengben/main）、`w_bb_def_gs`（chengben/main）、`w_bb_def_open`（chengben/main）、`w_bb_def_pos`（chengben/main）、`w_bb_get`（chengben/main）、`w_bb_jk_get`（chengben/main）、`w_bb_main`（chengben/main）、`w_bb_main_bhxg`（chengben/main）、`w_bb_proc`（chengben/main）、`w_bf`（chengben/main）、`w_hf`（chengben/main）、`w_ini_bf`（chengben/main）、`w_pz_pzmb_main`（chengben/main）、`w_tzjl_2`（chengben/main）、`w_tzjl_2_bak`（chengben/main）……共 71 个
- 数据窗口：`d_bbml`、`dw_bbml_1`、`dw_ini_bbml`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xh | integer | 否 |  | 1 | 编号 |
| 2 | bbname | char(40) | 是 |  |  | 报表名称 |
| 3 | row | integer | 是 |  |  | 最大行数 |
| 4 | col | integer | 是 |  |  | 最大列数 |
| 5 | bz1 | char(1) | 是 |  |  |  |
| 6 | bz2 | char(1) | 是 |  |  |  |
| 7 | bb_nr | long binary | 是 |  |  |  |

### bbml_gs

- 主要相关窗口：数据备份、套帐复制
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_bakupdata`（chengben/main）、`w_bb_add_gs`（chengben/main）、`w_bb_bbsetup_gs`（chengben/main）、`w_bb_copy_gs`（chengben/main）、`w_bb_def_gs`（chengben/main）、`w_bb_def_open_gs`（chengben/main）、`w_bb_htpj_gs`（chengben/main）、`w_bb_main_gs`（chengben/main）、`w_bb_pjnr_gs`（chengben/main）、`w_bf`（chengben/main）、`w_hf`（chengben/main）、`w_ini_bf`（chengben/main）、`w_tzjl_2`（chengben/main）、`w_tzjl_2_bak`（chengben/main）、`w_tzjl_get`（chengben/main）、`w_tzjl_get_all`（chengben/main）、`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）、`w_bakupdata`（minfeiqi/main）、`w_bb_add_gs`（minfeiqi/main）……共 54 个
- 数据窗口：`dw_bbml_gs`、`dw_bbml_gs_1`、`dw_ini_bbml_gs`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xh | integer | 是 |  |  | 编
号、编号 |
| 2 | bbname | char(40) | 是 |  |  | 打印格式
名   称、报表名称 |
| 3 | row | integer | 是 |  |  | 最大
行数、最大行数 |
| 4 | col | integer | 是 |  |  | 最大
列数、最大列数 |
| 5 | t1 | integer | 是 |  |  |  |
| 6 | t2 | integer | 是 |  |  |  |
| 7 | t3 | integer | 是 |  |  |  |
| 8 | t4 | integer | 是 |  |  |  |
| 9 | bz1 | char(1) | 是 |  |  |  |
| 10 | bz2 | char(1) | 是 |  |  |  |
| 11 | bb_nr | long binary | 是 |  |  |  |

### bbml_pos

- 主要相关窗口：报表生成、数据备份
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_bakupdata`（chengben/main）、`w_bb_add_pos`（chengben/main）、`w_bb_bbsetup_pos`（chengben/main）、`w_bb_copy_pos`（chengben/main）、`w_bb_def_open_gs`（chengben/main）、`w_bb_def_open_pos`（chengben/main）、`w_bb_def_pos`（chengben/main）、`w_bb_get_pos`（chengben/main）、`w_bb_htpj`（chengben/main）、`w_bb_htpj_gs`（chengben/main）、`w_bb_main_pos`（chengben/main）、`w_bb_proc_gs`（chengben/main）、`w_bb_proc_pos`（chengben/main）、`w_bb_proc_pos_bak`（chengben/main）、`w_bf`（chengben/main）、`w_hf`（chengben/main）、`w_ini_bf`（chengben/main）、`w_tzjl_2`（chengben/main）、`w_tzjl_2_bak`（chengben/main）、`w_tzjl_get`（chengben/main）……共 52 个
- 数据窗口：`dw_bbml_0`、`dw_bbml_0_pos`、`dw_bbml_1_pos`、`dw_bbml_pos`、`dw_ini_bbml_pos`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xh | integer | 是 |  |  | 编
号、编号 |
| 2 | bbname | char(40) | 是 |  |  | 格   式
名   称、报   表
名   称、格式名称 |
| 3 | row | integer | 是 |  |  | 最大
行数、最大行数 |
| 4 | col | integer | 是 |  |  | 最大
列数、最大列数 |
| 5 | t1 | integer | 是 |  |  |  |
| 6 | t2 | integer | 是 |  |  |  |
| 7 | t3 | integer | 是 |  |  |  |
| 8 | t4 | integer | 是 |  |  |  |
| 9 | t5 | integer | 是 |  |  |  |
| 10 | s1 | char(10) | 是 |  |  |  |
| 11 | s2 | char(10) | 是 |  |  |  |
| 12 | s3 | char(10) | 是 |  |  |  |
| 13 | bz1 | char(1) | 是 |  |  |  |
| 14 | bz2 | char(1) | 是 |  |  |  |
| 15 | bb_nr | long binary | 是 |  |  |  |

### bbml_t

- 定义变体 1 个；展示的变体出现在 2 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xh | integer | 否 |  | 1 |  |
| 2 | bbname | char(40) | 是 |  |  |  |
| 3 | row | integer | 是 |  |  |  |
| 4 | col | integer | 是 |  |  |  |
| 5 | bz1 | char(1) | 是 |  |  |  |
| 6 | bz2 | char(1) | 是 |  |  |  |
| 7 | bb_nr | long binary | 是 |  |  |  |

### bmk

- 主要相关窗口：打印凭证-1、三栏明细账
- 定义变体 3 个；展示的变体出现在 30 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_main1`（chengben/fp）、`w_main1_cb`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_def_help`（chengben/main）、`w_bb_proc`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_fx_zl`（chengben/main）、`w_main1`（chengben/main）、`w_main1_cb`（chengben/main）、`w_pz_flxx1`（chengben/main）、`w_pz_jccx_1`（chengben/main）、`w_pz_prn_1`（chengben/main）、`w_pz_prn_1_a4`（chengben/main）、`w_pz_prn_1_bak`（chengben/main）、`w_pz_prn_2`（chengben/main）、`w_pz_prn_3`（chengben/main）、`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzedit_bak`（chengben/main）……共 120 个
- 数据窗口：`dw_xt_bm_ye`、`dw_xt_bmwh`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bmbm | char(10) | 是 |  |  | 编号 |
| 2 | bm_mc | char(100) | 是 |  |  | 部门名称 |
| 3 | bz | char(1) | 是 |  |  | 在用 |

### bmk_pos

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bmbh | char(4) | 是 |  |  |  |
| 2 | bmmc | char(20) | 是 |  |  |  |

### bmnc

- 主要相关窗口：三栏明细账、多栏账
- 定义变体 3 个；展示的变体出现在 33 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_fx_zl`（chengben/main）、`w_test`（chengben/main）、`w_xt_bmnc`（chengben/main）、`w_xt_bmwh`（chengben/main）、`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）、`w_xt_kmbm_edit_bak`（chengben/main）、`w_xt_kmbm_get`（chengben/main）、`w_xt_kmbm_len_bak`（chengben/main）、`w_xt_kmbm_replace_bak`（chengben/main）、`w_xt_kmwh`（chengben/main）、`w_xt_kmwh_1`（chengben/main）、`w_xt_wh`（chengben/main）、`w_zc_fhdlz_1`（chengben/main）、`w_zc_fhdlz_1_bak`（chengben/main）、`w_zc_fhslz_1`（chengben/main）、`w_zc_fhslz_1_bak`（chengben/main）……共 88 个
- 数据窗口：`dw_xt_bm_ye`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | char(20) | 是 |  |  | 科目编码 |
| 2 | bmbm | char(10) | 是 |  |  | 部门编码 |
| 3 | bz | char(6) | 是 |  |  | 币种 |
| 4 | nc_jf | double | 是 |  |  | 年初借方余额 |
| 5 | nc_df | double | 是 |  |  | 年初贷方余额 |
| 6 | jq_jf | double | 是 |  |  | 帐前借方发生额 |
| 7 | jq_df | double | 是 |  |  | 帐前贷方发生额 |
| 8 | fbs | char(1) | 是 |  |  |  |
| 9 | ys | double | 是 |  |  |  |
| 10 | nc_jf_b | double | 是 |  |  | 年初借方(本) |
| 11 | nc_df_b | double | 是 |  |  | 年初贷方(本) |
| 12 | jq_jf_b | double | 是 |  |  | 帐前借方(本) |
| 13 | jq_df_b | double | 是 |  |  | 帐前贷方(本) |
| 14 | nf | integer | 是 |  |  |  |

### bzk

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bz | char(4) | 否 |  | 1 |  |
| 2 | hl | double | 是 |  |  |  |
| 3 | bwbz | char(1) | 是 |  |  |  |
| 4 | qtbz | char(1) | 是 |  |  |  |

### cb_hzk

- 主要相关窗口：产品档案维护、反结账
- 定义变体 2 个；展示的变体出现在 45 个模板中。
- 使用窗口：`w_cb_cpda`（chengben/main）、`w_cb_fgz`（chengben/main）、`w_cb_hz`（chengben/main）、`w_cb_hzsj_sfc_bak`（chengben/main）、`w_cb_pdk_1`（chengben/main）、`w_cb_sl_hzyeb`（chengben/main）、`w_ck_kc_hz`（chengben/main）

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | hzny | char(10) | 是 |  |  |  |
| 2 | ckbh | char(4) | 是 |  |  |  |
| 3 | cpbh | char(10) | 是 |  |  |  |
| 4 | rksl | double | 是 |  |  |  |
| 5 | rkje | double | 是 |  |  |  |
| 6 | cksl | double | 是 |  |  |  |
| 7 | ckje | double | 是 |  |  |  |
| 8 | yksl | double | 是 |  |  |  |
| 9 | ykje | double | 是 |  |  |  |
| 10 | jysl | double | 是 |  |  |  |
| 11 | jyje | double | 是 |  |  |  |

### cbfpb1

- 定义变体 1 个；展示的变体出现在 10 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | hzny | char(7) | 是 |  |  |  |
| 2 | sx | char(1) | 是 |  |  |  |
| 3 | ckbh | char(10) | 是 |  |  |  |
| 4 | kpr | char(10) | 是 |  |  |  |
| 5 | bgr | char(10) | 是 |  |  |  |
| 6 | bz_sh | char(1) | 是 |  |  |  |
| 7 | sm | char(30) | 是 |  |  |  |
| 8 | fprq | date | 是 |  |  |  |

### cbfpb2

- 定义变体 1 个；展示的变体出现在 10 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | hzny | char(7) | 是 |  |  |  |
| 2 | sx | char(1) | 是 |  |  |  |
| 3 | ckbh | char(10) | 是 |  |  |  |
| 4 | cpbh | char(20) | 是 |  |  |  |
| 5 | fpje1 | double | 是 |  |  |  |
| 6 | fpje2 | double | 是 |  |  |  |
| 7 | fpje3 | double | 是 |  |  |  |

### chxl

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ckbh | char(4) | 是 |  |  |  |
| 2 | cpbh | char(15) | 是 |  |  |  |
| 3 | sl1 | double | 是 |  |  |  |
| 4 | sl2 | double | 是 |  |  |  |

### ckda

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ckbh | char(4) | 否 |  | 1 |  |
| 2 | ckmc | char(10) | 是 |  |  |  |
| 3 | sx | char(1) | 是 |  |  |  |
| 4 | khbh | char(6) | 是 |  |  |  |
| 5 | txdz | char(40) | 是 |  |  |  |
| 6 | lxdh | char(40) | 是 |  |  |  |
| 7 | fax | char(40) | 是 |  |  |  |
| 8 | lxr | char(10) | 是 |  |  |  |

### ckjl

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | cardlb | char(18) | 是 |  |  |  |
| 2 | card | char(18) | 是 |  |  |  |
| 3 | fgs | char(50) | 是 |  |  |  |
| 4 | fkr | timestamp | 是 |  |  |  |
| 5 | khmc | char(18) | 是 |  |  |  |
| 6 | dwbh | char(18) | 是 |  |  |  |
| 7 | sgdw | char(50) | 是 |  |  |  |
| 8 | sgcp | char(50) | 是 |  |  |  |
| 9 | cx | char(50) | 是 |  |  |  |
| 10 | ch | char(18) | 是 |  |  |  |
| 11 | dh | char(50) | 是 |  |  |  |
| 12 | dz | char(100) | 是 |  |  |  |

### cn_hz

- 主要相关窗口：修改科目编码长度、科目编码字符替换
- 定义变体 2 个；展示的变体出现在 25 个模板中。
- 使用窗口：`w_xt_kmbm_len_bak`（chengben/main）、`w_xt_kmbm_replace_bak`（chengben/main）、`w_xt_kmwh`（chengben/main）、`w_xt_kmwh_1`（chengben/main）、`w_xt_kmbm_len_bak`（minfeiqi/main）、`w_xt_kmbm_replace_bak`（minfeiqi/main）、`w_xt_kmwh`（minfeiqi/main）、`w_xt_kmwh_1`（minfeiqi/main）、`w_cn_fjz`（qingsong/cn）、`w_cn_fz`（qingsong/cn）、`w_cn_hz_1`（qingsong/cn）、`w_cn_wbhz_1`（qingsong/cn）、`w_cn_xtcsh`（qingsong/cn）、`w_xt_kmbm_len_bak`（qingsong/main）、`w_xt_kmbm_replace_bak`（qingsong/main）、`w_xt_kmwh`（qingsong/main）、`w_xt_kmwh_1`（qingsong/main）

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ny | char(7) | 是 |  |  |  |
| 2 | kmbm | varchar(30) | 是 |  |  |  |
| 3 | bz | char(10) | 是 |  |  |  |
| 4 | jf | double | 是 |  |  |  |
| 5 | df | double | 是 |  |  |  |

### cn_mx

- 主要相关窗口：凭证录入、格式定义
- 定义变体 8 个；展示的变体出现在 10 个模板中。
- 使用窗口：`w_bb_def_cn`（chengben/main）、`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzedit_bak`（chengben/main）、`w_pz_pzedit_cn_get`（chengben/main）、`w_pz_pzedit_mb`（chengben/main）、`w_pz_pzxsb`（chengben/main）、`w_pz_pzxsb_see`（chengben/main）、`w_pz_tjdel`（chengben/main）、`w_xt_kmbm_len_bak`（chengben/main）、`w_xt_kmbm_replace_bak`（chengben/main）、`w_xt_kmwh`（chengben/main）、`w_xt_kmwh_1`（chengben/main）、`w_zh_zhjc_kzrq`（chengben/main）、`w_zw_fgz`（chengben/main）、`w_bb_def_cn`（minfeiqi/main）、`w_pz_pzedit`（minfeiqi/main）、`w_pz_pzedit_b`（minfeiqi/main）、`w_pz_pzedit_bak`（minfeiqi/main）、`w_pz_pzedit_cn_get`（minfeiqi/main）……共 59 个
- 数据窗口：`dw_cn_gz`、`dw_cn_ll`、`dw_cn_mx_get`、`dw_pz_edit_cn`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | varchar(30) | 是 |  |  | 科目编码 |
| 2 | bz | char(10) | 是 |  |  | 币种 |
| 3 | rq | date | 是 |  |  | 日期、日　　　期 |
| 4 | xh | integer | 是 |  |  | 单号 |
| 5 | nf | integer | 是 |  |  | 年 |
| 6 | yf | integer | 是 |  |  | 月 |
| 7 | dd | integer | 是 |  |  | 日 |
| 8 | zy | char(100) | 是 |  |  | 摘要、摘　　　　　　　　　要 |
| 9 | jf | double | 是 |  |  | 借方、收款金额、借　　　　　方 |
| 10 | df | double | 是 |  |  | 贷方、付款金额、贷　　　　　　方 |
| 11 | bz1 | char(1) | 是 |  |  | 勾账、选择 |
| 12 | bz2 | char(1) | 是 |  |  | 已转凭证 |
| 13 | gzm | integer | 是 |  |  | 勾账码 |
| 14 | lrr | char(20) | 是 |  |  | 录入人 |
| 15 | sm | varchar(255) | 是 |  |  | 说明、说　　　　　　　　　　　　　　　　　　　　　　明 |
| 16 | dfkm | char(20) | 是 |  |  | 对方科目、对方科目编码 |

### cn_nc

- 主要相关窗口：出纳数据引入、修改科目编码长度
- 定义变体 3 个；展示的变体出现在 25 个模板中。
- 使用窗口：`w_pz_pzedit_cn_get`（chengben/main）、`w_xt_kmbm_len_bak`（chengben/main）、`w_xt_kmbm_replace_bak`（chengben/main）、`w_xt_kmwh`（chengben/main）、`w_xt_kmwh_1`（chengben/main）、`w_pz_pzedit_cn_get`（minfeiqi/main）、`w_xt_kmbm_len_bak`（minfeiqi/main）、`w_xt_kmbm_replace_bak`（minfeiqi/main）、`w_xt_kmwh`（minfeiqi/main）、`w_xt_kmwh_1`（minfeiqi/main）、`w_cn_dz`（qingsong/cn）、`w_cn_hz_1`（qingsong/cn）、`w_cn_lr_qc`（qingsong/cn）、`w_cn_wbhz_1`（qingsong/cn）、`w_cn_xtcsh`（qingsong/cn）、`w_login`（qingsong/cn）、`w_login_oem`（qingsong/cn）、`w_pz_pzedit_cn_get`（qingsong/main）、`w_xt_kmbm_len_bak`（qingsong/main）、`w_xt_kmbm_replace_bak`（qingsong/main）……共 22 个
- 数据窗口：`dw_cn_lr_qc`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | varchar(30) | 是 |  |  | 科目编码 |
| 2 | bz | char(10) | 是 |  |  | 币种 |
| 3 | ye | double | 是 |  |  | 期初余额 |

### cpda

- 主要相关窗口：数据导出、凭证生成
- 定义变体 6 个；展示的变体出现在 31 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_fp_pz_bak`（chengben/fp）、`w_fp_pz_ckd`（chengben/fp）、`w_fp_pz_sz`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_cb_cpda`（chengben/main）、`w_cb_cpda_xg`（chengben/main）、`w_cb_hz`（chengben/main）、`w_cb_hzsj_cblr`（chengben/main）、`w_cb_hzsj_ck`（chengben/main）、`w_cb_hzsj_rk`（chengben/main）、`w_cb_hzsj_sfc`（chengben/main）、`w_cb_hzsj_sfc_bak`（chengben/main）、`w_cb_pdk_1`（chengben/main）、`w_cb_pz`（chengben/main）、`w_cb_qc`（chengben/main）、`w_cb_sl_hzyeb`（chengben/main）、`w_cb_xt_cpbh_sc`（chengben/main）、`w_cb_xt_kc_sc`（chengben/main）……共 37 个
- 数据窗口：`dw_cb_cpda_1`、`dw_cb_cpda_2`、`dw_cb_pdk`、`dw_cb_pdk_1`、`dw_cb_qc`、`dw_cb_qc_cj`、`dw_cb_xt_cpda_help`、`dw_cb_xt_kc_sc`、`dw_ck_ck2`、`dw_ck_kcb`、`dw_ck_rk2`、`dw_print_djnr`、`dw_print_djnr_ck`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | cpbh | char(10) | 是 |  |  | 产品编号 |
| 2 | cpmc | char(40) | 是 |  |  | 产品名称、名称 |
| 3 | gg | char(40) | 是 |  |  | 规格 |
| 4 | jldw | char(4) | 是 |  |  | 单位、计量单位 |
| 5 | kmbm | char(20) | 是 |  |  | 科目编码、产品对应科目编码 |
| 6 | kmbm_xs | char(20) | 是 |  |  |  |
| 7 | jhdj | double | 是 |  |  | 计划单价、金额、税率 |
| 8 | rkdj | double | 是 |  |  | 默认入库价、税率 |
| 9 | ckdj | double | 是 |  |  | 默认出库价、金额 |

### cpsx

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | sx | char(1) | 否 |  | 1 |  |
| 2 | sx_mc | char(10) | 是 |  |  |  |

### cw_pzzk

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | jzrq | date | 是 |  |  |  |
| 2 | pzbh | char(20) | 是 |  |  |  |
| 3 | zylr | char(50) | 是 |  |  |  |
| 4 | kmdm | char(20) | 是 |  |  |  |
| 5 | jd | char(50) | 是 |  |  |  |
| 6 | fcje | numeric(10,2) | 是 |  |  |  |
| 7 | dj | numeric(10,2) | 是 |  |  |  |
| 8 | sl | numeric(10,2) | 是 |  |  |  |
| 9 | yhph | char(50) | 是 |  |  |  |
| 10 | dzbz | char(20) | 是 |  |  |  |
| 11 | shm | char(20) | 是 |  |  |  |
| 12 | kjm | char(20) | 是 |  |  |  |
| 13 | cnm | char(20) | 是 |  |  |  |
| 14 | fds | char(20) | 是 |  |  |  |
| 15 | pz_id | integer | 否 |  | 1 |  |

### dbver

- 定义变体 1 个；展示的变体出现在 2 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | id | integer | 否 |  | 1 |  |
| 2 | dbver | numeric(18,2) | 是 |  |  |  |

### dj_lx

- 主要相关窗口：特殊打印
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_bb_htpj`（chengben/main）

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pjlb | char(2) | 是 |  |  |  |
| 2 | lb_jc | char(10) | 是 |  |  |  |
| 3 | jc_bz | char(1) | 是 |  |  |  |
| 4 | xs_bz | char(1) | 是 |  |  |  |
| 5 | sy_bz | char(1) | 是 |  |  |  |
| 6 | cb_bz | char(1) | 是 |  |  |  |
| 7 | jg_bz | char(1) | 是 |  |  |  |
| 8 | bz_1 | char(1) | 是 |  |  |  |
| 9 | bz_2 | char(1) | 是 |  |  |  |
| 10 | bz_3 | char(1) | 是 |  |  |  |

### dlk

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | dlm | char(3) | 否 |  | 1 |  |
| 2 | dlmc | char(30) | 是 |  |  |  |

### dlxx

- 主要相关窗口：期初建账操作向导、操作日志
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_acini_wizard`（chengben/main）、`w_xt_dlxx`（chengben/main）、`w_xt_dlxx_del`（chengben/main）、`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）、`w_acini_wizard`（minfeiqi/main）、`w_xt_dlxx`（minfeiqi/main）、`w_xt_dlxx_del`（minfeiqi/main）、`w_xt_kgzb_2`（minfeiqi/main）、`w_xt_kgzb_3`（minfeiqi/main）、`w_acini_wizard`（qingsong/main）、`w_xt_dlxx`（qingsong/main）、`w_xt_dlxx_del`（qingsong/main）、`w_xt_kgzb_2`（qingsong/main）、`w_xt_kgzb_3`（qingsong/main）
- 数据窗口：`dw_xt_dlxx`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | dlrq | date | 是 |  |  | 登录日期 |
| 2 | xtrq | date | 是 |  |  | 系统日期 |
| 3 | jrsj | time | 是 |  |  | 进入时间 |
| 4 | dlr | char(10) | 是 |  |  | 登录人 |
| 5 | cdm | char(20) | 是 |  |  | 使用功能 |
| 6 | tcsj | time | 是 |  |  | 退出时间 |

### dqda

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | dqbh | char(4) | 否 |  | 1 |  |
| 2 | dqmc | char(20) | 是 |  |  |  |

### dwk

- 主要相关窗口：打印凭证-1、三栏明细账
- 定义变体 11 个；展示的变体出现在 15 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_fp_khhz`（chengben/fp）、`w_fp_khhz_2`（chengben/fp）、`w_main1`（chengben/fp）、`w_main1_cb`（chengben/fp）、`w_xt_dwwh`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_def_help`（chengben/main）、`w_bb_proc`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_fx_zl`（chengben/main）、`w_ht_htda`（chengben/main）、`w_ht_httj`（chengben/main）、`w_ht_pz`（chengben/main）、`w_login`（chengben/main）、`w_login_oem`（chengben/main）、`w_main1`（chengben/main）、`w_main1_cb`（chengben/main）、`w_pz_flxx1`（chengben/main）、`w_pz_jccx_1`（chengben/main）……共 144 个
- 数据窗口：`dw_ht_help`、`dw_ht_htda`、`dw_ht_httj`、`dw_wl_1_khhz`、`dw_wl_1_prt`、`dw_wl_1_wlxx`、`dw_wl_qcxx`、`dw_wl_qcxx_prt`、`dw_wl_wlhz`、`dw_wl_wlxx`、`dw_wl_wlxx_prt`、`dw_xt_dw_ye`、`dw_xt_dwwh`、`dw_xt_dwwh_1`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | dwbm | char(10) | 是 |  |  | 客供编号、客供编码： |
| 2 | dw_mc | varchar(40) | 是 |  |  | 客户名称、客户/供应商名称、客户/供应商名称： |
| 3 | txdz | char(20) | 是 |  |  | 通讯地址、通信地址： |
| 4 | yzbm | char(6) | 是 |  |  | 邮政编码、邮政编码： |
| 5 | lxr | char(8) | 是 |  |  | 联系人、联系人： |
| 6 | lxdh | char(14) | 是 |  |  | 联系电话、联系电话： |
| 7 | khyh | char(50) | 是 |  |  | 开户银行、开户行： |
| 8 | yhzh | char(50) | 是 |  |  | 银行帐号、帐号： |
| 9 | nsh | char(50) | 是 |  |  | 纳税登记号、纳税登记号： |
| 10 | bz | char(1) | 是 |  |  | 在用、在用： |

### dwlx

- 定义变体 1 个；展示的变体出现在 21 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh | char(2) | 否 |  | 1 |  |
| 2 | mc | char(20) | 是 |  |  |  |

### dwnc

- 主要相关窗口：三栏明细账、多栏账
- 定义变体 3 个；展示的变体出现在 33 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_xt_dwwh`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_fx_zl`（chengben/main）、`w_test`（chengben/main）、`w_xt_dwnc`（chengben/main）、`w_xt_dwwh`（chengben/main）、`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）、`w_xt_kmbm_edit_bak`（chengben/main）、`w_xt_kmbm_get`（chengben/main）、`w_xt_kmbm_len_bak`（chengben/main）、`w_xt_kmbm_replace_bak`（chengben/main）、`w_xt_kmwh`（chengben/main）、`w_xt_kmwh_1`（chengben/main）、`w_xt_wh`（chengben/main）、`w_zc_fhdlz_1`（chengben/main）、`w_zc_fhdlz_1_bak`（chengben/main）、`w_zc_fhslz_1`（chengben/main）……共 90 个
- 数据窗口：`dw_xt_dw_ye`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | char(20) | 是 |  |  | 科目编码 |
| 2 | dwbm | char(10) | 是 |  |  | 客户编码 |
| 3 | bz | char(6) | 是 |  |  | 币种 |
| 4 | nc_jf | double | 是 |  |  | 年初借方余额 |
| 5 | nc_df | double | 是 |  |  | 年初贷方余额 |
| 6 | jq_jf | double | 是 |  |  | 帐前借方发生额 |
| 7 | jq_df | double | 是 |  |  | 帐前贷方发生额 |
| 8 | fbs | char(1) | 是 |  |  |  |
| 9 | ys | double | 是 |  |  |  |
| 10 | nc_jf_b | double | 是 |  |  | 年初借方(本) |
| 11 | nc_df_b | double | 是 |  |  | 年初贷方(本) |
| 12 | jq_jf_b | double | 是 |  |  | 帐前借方(本) |
| 13 | jq_df_b | double | 是 |  |  | 帐前贷方(本) |
| 14 | nf | integer | 是 |  |  |  |

### dwxz

- 定义变体 1 个；展示的变体出现在 21 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh | char(2) | 否 |  | 1 |  |
| 2 | mc | char(20) | 是 |  |  |  |

### dz_dw

- 定义变体 2 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | id | varchar(20) | 否 |  | 1 |  |
| 2 | kmbm | char(20) | 是 |  |  |  |
| 3 | nf | integer | 是 |  |  |  |
| 4 | yf | integer | 是 |  |  |  |
| 5 | dzd_rq | date | 是 |  |  |  |
| 6 | dzd_zy | varchar(100) | 是 |  |  |  |
| 7 | dzd_jsh | varchar(50) | 是 |  |  |  |
| 8 | dzd_jsfs | varchar(10) | 是 |  |  |  |
| 9 | dzd_jf | decimal | 是 |  |  |  |
| 10 | dzd_df | decimal | 是 |  |  |  |
| 11 | dzd_ye | decimal | 是 |  |  |  |
| 12 | dzd_bz | integer | 是 |  |  |  |
| 13 | dzd_lx | integer | 是 |  |  |  |
| 14 | pzlx | integer | 是 |  |  |  |
| 15 | pzbh | integer | 是 |  |  |  |
| 16 | pz_xh | integer | 是 |  |  |  |

### dz_jl

- 定义变体 2 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | groupid | integer | 否 |  | 1 |  |
| 2 | yhid | varchar(20) | 否 |  | 2 |  |
| 3 | dwid | varchar(20) | 否 |  | 3 |  |
| 4 | yhlx | integer | 否 |  | 4 |  |
| 5 | dwlx | integer | 否 |  | 5 |  |
| 6 | nf | integer | 否 |  | 6 |  |
| 7 | yf | integer | 否 |  | 7 |  |
| 8 | pzlx | integer | 否 |  | 8 |  |
| 9 | pzbh | integer | 否 |  | 9 |  |
| 10 | pz_xh | integer | 否 |  | 10 |  |
| 11 | dz_rq | date | 是 |  |  |  |
| 12 | kmbm | varchar(20) | 是 |  |  |  |

### dz_xt

- 定义变体 1 个；展示的变体出现在 2 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | fkey | varchar(20) | 否 |  | 1 |  |
| 2 | fvalue | varchar(20) | 是 |  |  |  |

### dz_yh

- 定义变体 2 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | id | varchar(20) | 否 |  | 1 |  |
| 2 | kmbm | char(20) | 是 |  |  |  |
| 3 | nf | integer | 是 |  |  |  |
| 4 | yf | integer | 是 |  |  |  |
| 5 | dzd_rq | date | 是 |  |  |  |
| 6 | dzd_zy | varchar(100) | 是 |  |  |  |
| 7 | dzd_jsh | varchar(50) | 是 |  |  |  |
| 8 | dzd_jsfs | varchar(10) | 是 |  |  |  |
| 9 | dzd_jf | decimal | 是 |  |  |  |
| 10 | dzd_df | decimal | 是 |  |  |  |
| 11 | dzd_ye | decimal | 是 |  |  |  |
| 12 | dzd_bz | integer | 是 |  |  |  |
| 13 | dzd_lx | integer | 是 |  |  |  |

### dz_zh

- 定义变体 2 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | zhid | varchar(20) | 否 |  | 1 |  |
| 2 | zhmc | varchar(100) | 是 |  |  |  |
| 3 | kmbm | char(20) | 是 |  |  |  |
| 4 | qsnf | integer | 是 |  |  |  |
| 5 | qsyf | integer | 是 |  |  |  |
| 6 | qsrq | date | 是 |  |  |  |
| 7 | dwjf | decimal | 是 |  |  |  |
| 8 | dwdf | decimal | 是 |  |  |  |
| 9 | dwye | decimal | 是 |  |  |  |
| 10 | yhjf | decimal | 是 |  |  |  |
| 11 | yhdf | decimal | 是 |  |  |  |
| 12 | yhye | decimal | 是 |  |  |  |
| 13 | gsmc | varchar(100) | 是 |  |  |  |
| 14 | yhzh | varchar(100) | 是 |  |  |  |
| 15 | khyh | varchar(100) | 是 |  |  |  |
| 16 | qybz | integer | 是 |  |  |  |

### fbgl

- 主要相关窗口：【、用户登录
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_login`（chengben/fp）、`w_login_oem`（chengben/fp）、`w_login_qhmk`（chengben/fp）、`w_bb_def_help`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_bf_98001`（chengben/main）、`w_bf_98001_bak`（chengben/main）、`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzedit_bak`（chengben/main）、`w_pz_pzedit_cn_get`（chengben/main）、`w_pz_pzedit_mb`（chengben/main）、`w_xt_bmnc`（chengben/main）、`w_xt_dwnc`（chengben/main）、`w_xt_fbwh`（chengben/main）、`w_xt_fbwh_1`（chengben/main）、`w_xt_grnc`（chengben/main）、`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）……共 100 个
- 数据窗口：`dw_xt_bm_ye`、`dw_xt_dw_ye`、`dw_xt_fbwh`、`dw_xt_gr_ye`、`dw_xt_nc_prt`、`dw_xt_wbnc_prt`、`dw_xt_xm_ye`、`dw_xt_xmwbye_prt`、`dw_xt_xmye_prt`、`dw_xt_ye`、`dw_xt_ye_bak`、`dw_xt_ye_prt`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bz | char(6) | 是 |  |  | 币种 |
| 2 | nchl | double | 是 |  |  | 年初汇率 |
| 3 | qchl | double | 是 |  |  |  |
| 4 | qmhl | double | 是 |  |  | 期末汇率 |
| 5 | sykm | char(20) | 是 |  |  |  |
| 6 | bwbz | char(1) | 是 |  |  |  |

### fcsp

- 定义变体 2 个；展示的变体出现在 34 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | char(20) | 是 |  |  |  |
| 2 | kmmc | char(40) | 是 |  |  |  |
| 3 | sl | double | 是 |  |  |  |
| 4 | je | double | 是 |  |  |  |
| 5 | wbje | double | 是 |  |  |  |
| 6 | bz | char(4) | 是 |  |  |  |
| 7 | ybje | double | 是 |  |  |  |
| 8 | dybh | varchar(1) | 是 |  |  |  |
| 9 | dwbm | char(4) | 是 |  |  |  |
| 10 | dwmc | char(20) | 是 |  |  |  |
| 11 | ml | double | 是 |  |  |  |
| 12 | bz_1 | char(1) | 是 |  |  |  |
| 13 | nf0 | integer | 是 |  |  |  |
| 14 | yf0 | integer | 是 |  |  |  |
| 15 | pzlx0 | smallint | 是 |  |  |  |
| 16 | pzbh0 | integer | 是 |  |  |  |
| 17 | nf1 | integer | 是 |  |  |  |
| 18 | yf1 | integer | 是 |  |  |  |
| 19 | pzlx1 | integer | 是 |  |  |  |
| 20 | pzbh1 | integer | 是 |  |  |  |

### fx_dy

- 主要相关窗口：财务分析、财务分析定义
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_fx_def`（chengben/main）、`w_fx_demo`（chengben/main）、`w_fx_main`（chengben/main）、`w_fx_def`（minfeiqi/main）、`w_fx_demo`（minfeiqi/main）、`w_fx_main`（minfeiqi/main）、`w_fx_def`（qingsong/main）、`w_fx_demo`（qingsong/main）、`w_fx_main`（qingsong/main）
- 数据窗口：`dw_fx_def`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | fxdm | integer | 是 |  |  |  |
| 2 | xh | integer | 是 |  |  | 序号 |
| 3 | xmmc | char(20) | 是 |  |  | 项目 |
| 4 | gs | char(256) | 是 |  |  | 公式 |
| 5 | bz | char(1) | 是 |  |  | 小计标志 |

### fx_ml

- 主要相关窗口：报表复制、财务分析定义
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_fx_copy`（chengben/main）、`w_fx_def`（chengben/main）、`w_fx_demo_open`（chengben/main）、`w_fx_demo_tx`（chengben/main）、`w_fx_main`（chengben/main）、`w_fx_copy`（minfeiqi/main）、`w_fx_def`（minfeiqi/main）、`w_fx_demo_open`（minfeiqi/main）、`w_fx_demo_tx`（minfeiqi/main）、`w_fx_main`（minfeiqi/main）、`w_fx_copy`（qingsong/main）、`w_fx_def`（qingsong/main）、`w_fx_demo_open`（qingsong/main）、`w_fx_demo_tx`（qingsong/main）、`w_fx_main`（qingsong/main）
- 数据窗口：`dw_fx_fxml`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | fxdm | integer | 否 |  | 1 | 代码 |
| 2 | fx_mc | char(20) | 是 |  |  | 名称 |

### g_fp_hz

- 定义变体 3 个；展示的变体出现在 15 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | l1 | char(2) | 是 |  |  |  |
| 2 | l2 | char(2) | 是 |  |  |  |
| 3 | j_1 | decimal | 是 |  |  |  |
| 4 | s_1 | decimal | 是 |  |  |  |
| 5 | j_2 | decimal | 是 |  |  |  |
| 6 | s_2 | decimal | 是 |  |  |  |
| 7 | j_3 | decimal | 是 |  |  |  |
| 8 | s_3 | decimal | 是 |  |  |  |

### g_fp_mx

- 主要相关窗口：凭证生成、用户登录
- 定义变体 4 个；展示的变体出现在 15 个模板中。
- 使用窗口：`w_fp_hz`（chengben/fp）、`w_fp_hz_bak`（chengben/fp）、`w_fp_khhz`（chengben/fp）、`w_fp_lr_1`（chengben/fp）、`w_fp_lr_2`（chengben/fp）、`w_fp_pz`（chengben/fp）、`w_fp_pz_bak`（chengben/fp）、`w_fp_pz_ckd`（chengben/fp）、`w_fp_pz_sz`（chengben/fp）、`w_fp_xtcsh`（chengben/fp）、`w_fp_zzs_hz`（chengben/fp）、`w_login`（chengben/fp）、`w_login_oem`（chengben/fp）、`w_login_qhmk`（chengben/fp）、`w_ck_ck`（chengben/main）、`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzxsb`（chengben/main）、`w_pz_pzxsb_see`（chengben/main）、`w_pz_tjdel`（chengben/main）……共 44 个
- 数据窗口：`dw_fp_lr`、`dw_fp_lr_get`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | fpdm | char(20) | 是 |  |  | 发票代码 |
| 2 | fphm | char(20) | 是 |  |  | 发票号码 |
| 3 | g_qymc | char(100) | 是 |  |  | 购方企业名称 |
| 4 | g_sh | char(100) | 是 |  |  | 购方税号 |
| 5 | yhzh | char(100) | 是 |  |  | 银行帐号、发票来源 |
| 6 | dzdh | char(100) | 是 |  |  | 地址电话、发票票种 |
| 7 | rq | timestamp | 是 |  |  | 开票日期 |
| 8 | djh | char(100) | 是 |  |  | 单据号、销方识别号 |
| 9 | bz1 | char(100) | 是 |  |  | 备注、销方名称 |
| 10 | spmc | char(100) | 是 |  |  | 商品名称、货物或应税劳务名称 |
| 11 | gg | char(100) | 是 |  |  | 规格、规格型号 |
| 12 | jldw | char(20) | 是 |  |  | 单位 |
| 13 | sl | double | 是 |  |  | 数量 |
| 14 | dj | double | 是 |  |  | 单价 |
| 15 | je0 | decimal | 是 |  |  | 金额 |
| 16 | slv | decimal | 是 |  |  | 税率 |
| 17 | se | decimal | 是 |  |  | 税额 |
| 18 | je1 | decimal | 是 |  |  | 开票总额、价税合计 |
| 19 | fpzt | char(20) | 是 |  |  | 发票状态 |
| 20 | lx | char(4) | 是 |  |  | 类型 |
| 21 | sh_bz | char(1) | 是 |  |  | 审核 |
| 22 | nf | integer | 是 |  |  |  |
| 23 | yf | integer | 是 |  |  |  |
| 24 | xf | char(4) | 是 |  |  |  |
| 25 | pz_bz | char(1) | 是 |  |  | 处理标志 |
| 26 | p_nf | integer | 是 |  |  | 凭证年 |
| 27 | p_yf | integer | 是 |  |  | 凭证月 |
| 28 | p_pzlx | integer | 是 |  |  | 凭证类型 |
| 29 | p_pzbh | integer | 是 |  |  | 凭证编号 |
| 30 | p_pjdh | char(20) | 是 |  |  | 出库单编号 |
| 31 | xh | integer | 是 |  |  | 序号 |
| 32 | s_spbmbbh | char(10) | 是 |  |  | 商品编码版本号、特定业务类型 |
| 33 | s_ssflbm | char(20) | 是 |  |  | 税收分类编码 |

### g_fp_mx_2

- 主要相关窗口：凭证生成、发票汇总
- 定义变体 3 个；展示的变体出现在 17 个模板中。
- 使用窗口：`w_fp_hz`（chengben/fp）、`w_fp_hz_bak`（chengben/fp）、`w_fp_khhz_2`（chengben/fp）、`w_fp_lr_2`（chengben/fp）、`w_fp_pz`（chengben/fp）、`w_fp_pz_bak`（chengben/fp）、`w_fp_pz_sz`（chengben/fp）、`w_fp_xtcsh`（chengben/fp）、`w_fp_zzs_hz`（chengben/fp）、`w_login`（chengben/fp）、`w_login_oem`（chengben/fp）、`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzxsb`（chengben/main）、`w_pz_pzxsb_see`（chengben/main）、`w_pz_tjdel`（chengben/main）、`w_pz_pzedit`（minfeiqi/main）、`w_pz_pzedit_b`（minfeiqi/main）、`w_pz_pzxsb`（minfeiqi/main）、`w_pz_pzxsb_see`（minfeiqi/main）……共 37 个
- 数据窗口：`dw_fp_lr_2`、`dw_fp_lr_get_2`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | fpdm | char(20) | 是 |  |  | 发票代码 |
| 2 | fphm | char(20) | 是 |  |  | 发票号码 |
| 3 | g_sh | char(100) | 是 |  |  | 销方税号 |
| 4 | g_qymc | char(100) | 是 |  |  | 销方企业名称 |
| 5 | rq | timestamp | 是 |  |  | 开票日期 |
| 6 | bz1 | char(100) | 是 |  |  | 备注 |
| 7 | je0 | decimal | 是 |  |  | 金额 |
| 8 | se | decimal | 是 |  |  | 税额 |
| 9 | je1 | decimal | 是 |  |  | 开票总额 |
| 10 | fpzt | char(20) | 是 |  |  | 发票状态 |
| 11 | rq_2 | timestamp | 是 |  |  | 认证日期 |
| 12 | lx | char(4) | 是 |  |  | 发票类型 |
| 13 | sh_bz | char(1) | 是 |  |  | 审核、认证方式 |
| 14 | nf | integer | 是 |  |  |  |
| 15 | yf | integer | 是 |  |  |  |
| 16 | pz_bz | char(1) | 是 |  |  | 处理标志 |
| 17 | p_nf | integer | 是 |  |  | 凭证年 |
| 18 | p_yf | integer | 是 |  |  | 凭证月 |
| 19 | p_pzlx | integer | 是 |  |  | 凭证类型 |
| 20 | p_pzbh | integer | 是 |  |  | 凭证编号 |
| 21 | p_pjdh | char(20) | 是 |  |  |  |

### grk

- 主要相关窗口：打印凭证-1、三栏明细账
- 定义变体 3 个；展示的变体出现在 30 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_main1`（chengben/fp）、`w_main1_cb`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_def_help`（chengben/main）、`w_bb_proc`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_fx_zl`（chengben/main）、`w_main1`（chengben/main）、`w_main1_cb`（chengben/main）、`w_pz_flxx1`（chengben/main）、`w_pz_jccx_1`（chengben/main）、`w_pz_prn_1`（chengben/main）、`w_pz_prn_1_a4`（chengben/main）、`w_pz_prn_1_bak`（chengben/main）、`w_pz_prn_2`（chengben/main）、`w_pz_prn_3`（chengben/main）、`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzedit_bak`（chengben/main）……共 120 个
- 数据窗口：`dw_xt_gr_ye`、`dw_xt_grwh`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | grbm | char(10) | 是 |  |  | 人员编码 |
| 2 | gr_mc | char(100) | 是 |  |  | 人员名称 |
| 3 | bz | char(1) | 是 |  |  | 在用 |

### grnc

- 主要相关窗口：三栏明细账、多栏账
- 定义变体 3 个；展示的变体出现在 33 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_fx_zl`（chengben/main）、`w_test`（chengben/main）、`w_xt_grnc`（chengben/main）、`w_xt_grwh`（chengben/main）、`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）、`w_xt_kmbm_edit_bak`（chengben/main）、`w_xt_kmbm_get`（chengben/main）、`w_xt_kmbm_len_bak`（chengben/main）、`w_xt_kmbm_replace_bak`（chengben/main）、`w_xt_kmwh`（chengben/main）、`w_xt_kmwh_1`（chengben/main）、`w_xt_wh`（chengben/main）、`w_zc_fhdlz_1`（chengben/main）、`w_zc_fhdlz_1_bak`（chengben/main）、`w_zc_fhslz_1`（chengben/main）、`w_zc_fhslz_1_bak`（chengben/main）……共 88 个
- 数据窗口：`dw_xt_gr_ye`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | char(20) | 是 |  |  | 科目编码 |
| 2 | grbm | char(10) | 是 |  |  | 人员编码 |
| 3 | bz | char(6) | 是 |  |  | 币种 |
| 4 | nc_jf | double | 是 |  |  | 年初借方余额 |
| 5 | nc_df | double | 是 |  |  | 年初贷方余额 |
| 6 | jq_jf | double | 是 |  |  | 帐前借方发生额 |
| 7 | jq_df | double | 是 |  |  | 帐前贷方发生额 |
| 8 | fbs | char(1) | 是 |  |  |  |
| 9 | ys | double | 是 |  |  |  |
| 10 | nc_jf_b | double | 是 |  |  | 年初借方(本) |
| 11 | nc_df_b | double | 是 |  |  | 年初贷方(本) |
| 12 | jq_jf_b | double | 是 |  |  | 帐前借方(本) |
| 13 | jq_df_b | double | 是 |  |  | 帐前贷方(本) |
| 14 | nf | integer | 是 |  |  |  |

### gxjh

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | jhbh | char(20) | 是 |  |  |  |
| 2 | gx_xh | integer | 是 |  |  |  |
| 3 | gxbh | char(8) | 是 |  |  |  |
| 4 | cpbh | char(15) | 是 |  |  |  |
| 5 | sl | double | 是 |  |  |  |
| 6 | sl0 | double | 是 |  |  |  |
| 7 | rq1 | date | 是 |  |  |  |
| 8 | rq2 | date | 是 |  |  |  |
| 9 | ph | char(20) | 是 |  |  |  |

### gz_bmk

- 主要相关窗口：从其他套帐转入科目、部门维护
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_gz_bmwh`（chengben/main）、`w_gz_prt_gzb`（chengben/main）、`w_gz_prt_pm`（chengben/main）、`w_gz_rsgl_ins`（chengben/main）、`w_gzgl_lshz`（chengben/main）、`w_xt_kgzb_gz`（chengben/main）、`w_xt_kmwh_copy`（chengben/main）、`w_gz_bmwh`（minfeiqi/main）、`w_gz_prt_gzb`（minfeiqi/main）、`w_gz_prt_pm`（minfeiqi/main）、`w_gz_rsgl_ins`（minfeiqi/main）、`w_gzgl_lshz`（minfeiqi/main）、`w_xt_kgzb_gz`（minfeiqi/main）、`w_xt_kmwh_copy`（minfeiqi/main）、`w_xt_kmwh_copy`（qingsong/main）
- 数据窗口：`dw_gz_prt`、`dw_gzt_prt`、`dw_xt_bm`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bmbm | char(4) | 否 |  | 1 | 部门编码 |
| 2 | bmmc | char(10) | 是 |  |  | 部门名称 |

### gz_gsk

- 主要相关窗口：计算公式定义、从其他套帐转入科目
- 定义变体 3 个；展示的变体出现在 54 个模板中。
- 使用窗口：`w_gz_gzgl`（chengben/main）、`w_xt_gs_edit`（chengben/main）、`w_xt_gssz`（chengben/main）、`w_xt_kgzb_gz`（chengben/main）、`w_xt_kmwh_copy`（chengben/main）、`w_gz_gzgl`（minfeiqi/main）、`w_xt_gs_edit`（minfeiqi/main）、`w_xt_gssz`（minfeiqi/main）、`w_xt_kgzb_gz`（minfeiqi/main）、`w_xt_kmwh_copy`（minfeiqi/main）、`w_xt_kmwh_copy`（qingsong/main）
- 数据窗口：`dw_xt_gs_edit`、`dw_xt_gs_edit_bak`、`dw_xt_gs_ll`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xh | integer | 否 |  | 1 | 序号、顺序 |
| 2 | gs_name | char(10) | 是 |  |  | 公式名 |
| 3 | tjx | char(120) | 是 |  |  | 如果该公式需要满足某些条件再执行，请点击、执行条件 |
| 4 | mdx | char(10) | 是 |  |  | 计算结果 |
| 5 | lyx | char(120) | 是 |  |  | 计算公式 |
| 6 | xzbz | char(1) | 是 |  |  | 执行 |
| 7 | jzbz | char(1) | 是 |  |  | 计税 |

### gz_gzjg

- 主要相关窗口：打印预览、从其他套帐转入科目
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_fp_preview`（chengben/fp）、`w_preview_fp`（chengben/fp）、`w_gz_edit_set`（chengben/main）、`w_gz_gzgl`（chengben/main）、`w_gz_prt_gzb`（chengben/main）、`w_gz_prt_hzlm`（chengben/main）、`w_gz_prt_pm`（chengben/main）、`w_gz_rsgl`（chengben/main）、`w_gz_rsgl_ins`（chengben/main）、`w_gz_zhcx`（chengben/main）、`w_gzgl_lshz`（chengben/main）、`w_preview`（chengben/main）、`w_pz_sz`（chengben/main）、`w_xt_dysz`（chengben/main）、`w_xt_gs_edit`（chengben/main）、`w_xt_gzsz`（chengben/main）、`w_xt_kmwh_copy`（chengben/main）、`w_gz_edit_set`（minfeiqi/main）、`w_gz_gzgl`（minfeiqi/main）、`w_gz_prt_gzb`（minfeiqi/main）……共 37 个
- 数据窗口：`dw_help_gzlm`、`dw_xt_dy`、`dw_xt_gzsz`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xh | integer | 是 |  |  | 序号 |
| 2 | f_name | char(6) | 否 |  | 1 | 字段名 |
| 3 | f_mc | char(8) | 是 |  |  | 栏目名称 |
| 4 | f_use | char(1) | 是 |  |  | 选中 |
| 5 | f_style | char(1) | 是 |  |  | 类型 |
| 6 | f_len | integer | 是 |  |  | 宽度 |
| 7 | f_inh | char(1) | 是 |  |  | 传递 |
| 8 | f_gzb_set | char(1) | 是 |  |  | 打印工资表 |
| 9 | f_gzb_int | integer | 是 |  |  | 整数宽 |
| 10 | f_gzb_dec | integer | 是 |  |  | 小数宽 |
| 11 | f_hzb_set | char(1) | 是 |  |  | 打印 |
| 12 | f_hzb_int | integer | 是 |  |  | 整数宽 |
| 13 | f_hzb_dec | integer | 是 |  |  | 小数宽 |
| 14 | f_gzt_set | char(1) | 是 |  |  |  |
| 15 | f_gzt_int | integer | 是 |  |  |  |
| 16 | f_gzt_dec | integer | 是 |  |  |  |
| 17 | f_xm | char(10) | 是 |  |  | 栏目说明 |

### gz_gzk

- 主要相关窗口：用户登录、从其他套帐转入科目
- 定义变体 2 个；展示的变体出现在 50 个模板中。
- 使用窗口：`w_gz_bmwh`（chengben/main）、`w_gz_gzgl`（chengben/main）、`w_gz_prt_gzb`（chengben/main）、`w_gz_prt_pm`（chengben/main）、`w_gz_rsgl`（chengben/main）、`w_gz_rsgl_ins`（chengben/main）、`w_gz_rsgl_xg`（chengben/main）、`w_gzgl_lshz`（chengben/main）、`w_login`（chengben/main）、`w_login_qhmk`（chengben/main）、`w_main1_gz`（chengben/main）、`w_xt_gs_edit`（chengben/main）、`w_xt_kgzb_gz`（chengben/main）、`w_xt_kmwh_copy`（chengben/main）、`w_gz_bmwh`（minfeiqi/main）、`w_gz_gzgl`（minfeiqi/main）、`w_gz_prt_gzb`（minfeiqi/main）、`w_gz_prt_pm`（minfeiqi/main）、`w_gz_rsgl`（minfeiqi/main）、`w_gz_rsgl_ins`（minfeiqi/main）……共 29 个
- 数据窗口：`dw_gz_gzgl`、`dw_gz_prt`、`dw_gz_rsgl`、`dw_gzt_prt`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | nf | integer | 是 |  |  | 年 |
| 2 | yf | integer | 是 |  |  | 月 |
| 3 | g_j1 | char(6) | 是 |  |  | 编号 |
| 4 | g_j2 | char(8) | 是 |  |  | 姓名 |
| 5 | g_j3 | char(4) | 是 |  |  | 部门 |
| 6 | g_j4 | char(20) | 是 |  |  |  |
| 7 | g_j5 | char(20) | 是 |  |  |  |
| 8 | g_j6 | char(20) | 是 |  |  |  |
| 9 | g_j7 | char(20) | 是 |  |  |  |
| 10 | g_j8 | char(20) | 是 |  |  |  |
| 11 | g_f1 | integer | 是 |  |  |  |
| 12 | g_f2 | char(10) | 是 |  |  |  |
| 13 | g_l01 | double | 是 |  |  |  |
| 14 | g_l02 | double | 是 |  |  |  |
| 15 | g_l03 | double | 是 |  |  |  |
| 16 | g_l04 | double | 是 |  |  |  |
| 17 | g_l05 | double | 是 |  |  |  |
| 18 | g_l06 | double | 是 |  |  |  |
| 19 | g_l07 | double | 是 |  |  |  |
| 20 | g_l08 | double | 是 |  |  |  |
| 21 | g_l09 | double | 是 |  |  |  |
| 22 | g_l10 | double | 是 |  |  |  |
| 23 | g_l11 | double | 是 |  |  |  |
| 24 | g_l12 | double | 是 |  |  |  |
| 25 | g_l13 | double | 是 |  |  |  |
| 26 | g_l14 | double | 是 |  |  |  |
| 27 | g_l15 | double | 是 |  |  |  |
| 28 | g_l16 | double | 是 |  |  |  |
| 29 | g_l17 | double | 是 |  |  |  |
| 30 | g_l18 | double | 是 |  |  |  |
| 31 | g_l19 | double | 是 |  |  |  |
| 32 | g_l20 | double | 是 |  |  |  |
| 33 | g_l21 | double | 是 |  |  |  |
| 34 | g_l22 | double | 是 |  |  |  |
| 35 | g_l23 | double | 是 |  |  |  |
| 36 | g_l24 | double | 是 |  |  |  |
| 37 | g_l25 | double | 是 |  |  |  |
| 38 | g_l26 | double | 是 |  |  |  |
| 39 | g_l27 | double | 是 |  |  |  |
| 40 | g_l28 | double | 是 |  |  |  |
| 41 | g_l29 | double | 是 |  |  |  |
| 42 | g_l30 | double | 是 |  |  |  |
| 43 | g_l31 | double | 是 |  |  |  |
| 44 | g_l32 | double | 是 |  |  |  |
| 45 | g_l33 | double | 是 |  |  |  |
| 46 | g_l34 | double | 是 |  |  |  |
| 47 | g_l35 | double | 是 |  |  |  |
| 48 | g_l36 | double | 是 |  |  |  |
| 49 | g_l37 | double | 是 |  |  |  |
| 50 | g_l38 | double | 是 |  |  |  |
| 51 | g_l39 | double | 是 |  |  |  |
| 52 | g_l40 | double | 是 |  |  |  |
| 53 | g_l41 | double | 是 |  |  |  |
| 54 | g_l42 | double | 是 |  |  |  |
| 55 | g_l43 | double | 是 |  |  |  |
| 56 | g_l44 | double | 是 |  |  |  |
| 57 | g_l45 | double | 是 |  |  |  |
| 58 | g_l46 | double | 是 |  |  |  |
| 59 | g_l47 | double | 是 |  |  |  |
| 60 | g_l48 | double | 是 |  |  |  |
| 61 | g_l49 | double | 是 |  |  |  |
| 62 | g_l50 | double | 是 |  |  |  |
| 63 | g_l51 | double | 是 |  |  |  |
| 64 | g_l52 | double | 是 |  |  |  |
| 65 | g_l53 | double | 是 |  |  |  |
| 66 | g_l54 | double | 是 |  |  |  |
| 67 | g_l55 | double | 是 |  |  |  |
| 68 | g_l56 | double | 是 |  |  |  |
| 69 | g_l57 | double | 是 |  |  |  |
| 70 | g_l58 | double | 是 |  |  |  |
| 71 | g_l59 | double | 是 |  |  |  |
| 72 | g_l60 | double | 是 |  |  |  |
| 73 | g_l61 | double | 是 |  |  |  |
| 74 | g_l62 | double | 是 |  |  |  |
| 75 | g_l63 | double | 是 |  |  |  |
| 76 | g_l64 | double | 是 |  |  |  |
| 77 | g_l65 | double | 是 |  |  |  |
| 78 | g_l66 | double | 是 |  |  |  |
| 79 | g_l67 | double | 是 |  |  |  |
| 80 | g_l68 | double | 是 |  |  |  |
| 81 | g_l69 | double | 是 |  |  |  |
| 82 | g_l70 | double | 是 |  |  |  |
| 83 | g_l71 | double | 是 |  |  |  |
| 84 | g_l72 | double | 是 |  |  |  |
| 85 | g_l73 | double | 是 |  |  |  |
| 86 | g_l74 | double | 是 |  |  |  |
| 87 | g_l75 | double | 是 |  |  |  |
| 88 | g_l76 | double | 是 |  |  |  |
| 89 | g_l77 | double | 是 |  |  |  |
| 90 | g_l78 | double | 是 |  |  |  |
| 91 | g_l79 | double | 是 |  |  |  |
| 92 | g_l80 | double | 是 |  |  |  |

### gz_yfkm

- 主要相关窗口：从其他套帐转入科目、凭证生成
- 定义变体 2 个；展示的变体出现在 34 个模板中。
- 使用窗口：`w_pz_build_gz`（chengben/main）、`w_pz_sz`（chengben/main）、`w_xt_kgzb_gz`（chengben/main）、`w_xt_kmwh_copy`（chengben/main）、`w_pz_build_gz`（minfeiqi/main）、`w_pz_sz`（minfeiqi/main）、`w_xt_kgzb_gz`（minfeiqi/main）、`w_xt_kmwh_copy`（minfeiqi/main）、`w_xt_kmwh_copy`（qingsong/main）
- 数据窗口：`dw_pz_yfkm`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | lmname | char(10) | 否 |  | 1 | 对应工资栏目 |
| 2 | kmbm | char(20) | 是 |  |  | 贷方科目代码 |

### h_bjlx

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bjlx | char(4) | 否 |  | 1 |  |
| 2 | bjmc | char(20) | 是 |  |  |  |

### h_cpdj

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | khlx | char(4) | 是 |  |  |  |
| 2 | cpbh | char(20) | 是 |  |  |  |
| 3 | dj1 | double | 是 |  |  |  |
| 4 | dj2 | double | 是 |  |  |  |
| 5 | dj3 | double | 是 |  |  |  |
| 6 | bz | char(20) | 是 |  |  |  |
| 7 | zhxgsj | timestamp | 是 |  |  |  |
| 8 | zhxgr | char(10) | 是 |  |  |  |

### h_khda

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | khbh | char(10) | 是 |  |  |  |
| 2 | sm | long binary | 是 |  |  |  |

### h_khdj

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | khbh | char(10) | 是 |  |  |  |
| 2 | cpbh | char(20) | 是 |  |  |  |
| 3 | dj1 | double | 是 |  |  |  |
| 4 | jbr1 | char(10) | 是 |  |  |  |
| 5 | rq1 | date | 是 |  |  |  |
| 6 | dj2 | double | 是 |  |  |  |
| 7 | jbr2 | char(10) | 是 |  |  |  |
| 8 | rq2 | date | 是 |  |  |  |
| 9 | dj3 | double | 是 |  |  |  |
| 10 | jbr3 | char(10) | 是 |  |  |  |
| 11 | rq3 | date | 是 |  |  |  |
| 12 | dfbh | char(20) | 是 |  |  |  |

### h_khlx

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | khlx | char(4) | 否 |  | 1 |  |
| 2 | khlxmc | char(20) | 是 |  |  |  |

### h_rz

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | rzbh | integer | 是 |  |  |  |
| 2 | u_name | char(12) | 是 |  |  |  |
| 3 | mkmc | char(20) | 是 |  |  |  |
| 4 | jrsj | timestamp | 是 |  |  |  |
| 5 | tcsj | timestamp | 是 |  |  |  |
| 6 | tcbz | char(1) | 是 |  |  |  |

### h_wldj

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | lx | char(6) | 是 |  |  |  |
| 2 | dh | char(10) | 是 |  |  |  |
| 3 | rq | date | 是 |  |  |  |
| 4 | khbh | char(10) | 是 |  |  |  |
| 5 | zy | char(20) | 是 |  |  |  |
| 6 | bz1 | char(1) | 是 |  |  |  |
| 7 | xh | integer | 是 |  |  |  |
| 8 | fplx | char(6) | 是 |  |  |  |
| 9 | fpdh | char(10) | 是 |  |  |  |
| 10 | fpjf | double | 是 |  |  |  |
| 11 | fpdf | double | 是 |  |  |  |

### hg_da

- 主要相关窗口：数据导出、格式定义
- 定义变体 2 个；展示的变体出现在 34 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_xt_kmbm_get`（chengben/main）、`w_zh_zhjc`（chengben/main）、`w_bb_def_cn`（minfeiqi/main）、`w_bb_saveas`（minfeiqi/main）、`w_xt_kmbm_get`（minfeiqi/main）、`w_zh_zhjc`（minfeiqi/main）、`w_bb_saveas`（qingsong/fp）、`w_bb_def_cn`（qingsong/main）、`w_bb_saveas`（qingsong/main）、`w_xt_kmbm_get`（qingsong/main）、`w_zh_zhjc`（qingsong/main）

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | hg_bh | char(15) | 是 |  |  |  |
| 2 | mc | char(50) | 是 |  |  |  |
| 3 | gg | char(50) | 是 |  |  |  |
| 4 | dw | char(10) | 是 |  |  |  |
| 5 | zl_dw | char(10) | 是 |  |  |  |
| 6 | kmbm | char(20) | 是 |  |  |  |
| 7 | lx | char(20) | 是 |  |  |  |

### ht1

- 主要相关窗口：合同复制
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_cb_ck_copy`（chengben/main）

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | htlb | char(1) | 是 |  |  |  |
| 2 | htbh | char(10) | 是 |  |  |  |
| 3 | ckbh | char(4) | 是 |  |  |  |
| 4 | rq | date | 是 |  |  |  |
| 5 | khbh | char(10) | 是 |  |  |  |
| 6 | bmbh | char(4) | 是 |  |  |  |
| 7 | jbr | char(10) | 是 |  |  |  |
| 8 | zsl | double | 是 |  |  |  |
| 9 | zje | double | 是 |  |  |  |
| 10 | zcb | double | 是 |  |  |  |
| 11 | sl1 | double | 是 |  |  |  |
| 12 | je1 | double | 是 |  |  |  |
| 13 | je2 | double | 是 |  |  |  |
| 14 | bz | char(4) | 是 |  |  |  |
| 15 | zje0 | double | 是 |  |  |  |
| 16 | rq1 | date | 是 |  |  |  |
| 17 | sm | char(20) | 是 |  |  |  |
| 18 | qxbz | char(1) | 是 |  |  |  |
| 19 | sm2 | char(40) | 是 |  |  |  |
| 20 | sm3 | char(40) | 是 |  |  |  |
| 21 | sm4 | char(40) | 是 |  |  |  |
| 22 | kpr | char(10) | 是 |  |  |  |
| 23 | bgr | char(10) | 是 |  |  |  |
| 24 | fklx | char(1) | 是 |  |  |  |
| 25 | ts | integer | 是 |  |  |  |
| 26 | fpzl | char(10) | 是 |  |  |  |
| 27 | slv | double | 是 |  |  |  |
| 28 | sh_bz | char(1) | 是 |  |  |  |

### ht2

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | htlb | char(1) | 是 |  |  |  |
| 2 | htbh | char(10) | 是 |  |  |  |
| 3 | cpbh | char(20) | 是 |  |  |  |
| 4 | sl0 | double | 是 |  |  |  |
| 5 | dj0 | double | 是 |  |  |  |
| 6 | cb | double | 是 |  |  |  |
| 7 | sl1 | double | 是 |  |  |  |
| 8 | je1 | double | 是 |  |  |  |
| 9 | dj | double | 是 |  |  |  |
| 10 | ckbh | char(4) | 是 |  |  |  |
| 11 | sl_b | double | 是 |  |  |  |
| 12 | qxbz | char(1) | 是 |  |  |  |
| 13 | dfbh | char(20) | 是 |  |  |  |
| 14 | tj_bz | char(1) | 是 |  |  |  |
| 15 | rq1 | date | 是 |  |  |  |
| 16 | rq2 | date | 是 |  |  |  |
| 17 | tj_sj | double | 是 |  |  |  |
| 18 | zk | double | 是 |  |  |  |
| 19 | tj_sj0 | double | 是 |  |  |  |
| 20 | ph | char(20) | 是 |  |  |  |

### htda

- 主要相关窗口：凭证录入、数据导出
- 定义变体 3 个；展示的变体出现在 51 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_saveas`（chengben/main）、`w_ht_htda`（chengben/main）、`w_ht_httj`（chengben/main）、`w_ht_pz`（chengben/main）、`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzedit_bak`（chengben/main）、`w_pz_pzedit_mb`（chengben/main）、`w_xt_ht_sc`（chengben/main）、`w_xt_wh`（chengben/main）、`w_bb_saveas`（minfeiqi/main）、`w_ht_htda`（minfeiqi/main）、`w_ht_httj`（minfeiqi/main）、`w_ht_pz`（minfeiqi/main）、`w_pz_pzedit`（minfeiqi/main）、`w_pz_pzedit_b`（minfeiqi/main）、`w_pz_pzedit_bak`（minfeiqi/main）、`w_pz_pzedit_mb`（minfeiqi/main）、`w_xt_ht_sc`（minfeiqi/main）……共 32 个
- 数据窗口：`dw_ht_htda`、`dw_ht_httj`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | htbh | char(15) | 是 |  |  | 合同号、合同编号 |
| 2 | khbh | char(10) | 是 |  |  | 客户编号 |
| 3 | htmc | char(50) | 是 |  |  | 合同名称 |
| 4 | nr | varchar(800) | 是 |  |  |  |
| 5 | rq1 | date | 是 |  |  | 签定日期 |
| 6 | je | numeric(20,4) | 是 |  |  | 金额、合同金额 |
| 7 | lx | char(1) | 是 |  |  | 类型 |
| 8 | je1 | numeric(20,4) | 是 |  |  | 已收/付金额 |
| 9 | je2 | numeric(20,4) | 是 |  |  | 未完成金额 |

### htfk

- 定义变体 1 个；展示的变体出现在 21 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | htbm | char(20) | 否 |  | 1 |  |
| 2 | sortid | integer | 否 |  | 2 |  |
| 3 | jdlx | char(1) | 是 |  |  |  |
| 4 | fkjd | numeric(18,4) | 是 |  |  |  |
| 5 | fkje | numeric(18,2) | 是 |  |  |  |
| 6 | fktj | varchar(200) | 是 |  |  |  |
| 7 | msg | varchar(60) | 是 |  |  |  |
| 8 | isover | char(1) | 是 |  |  |  |

### htjetz

- 定义变体 1 个；展示的变体出现在 21 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | htbm | char(20) | 否 |  | 1 |  |
| 2 | sortid | integer | 否 |  | 2 |  |
| 3 | tzrq | date | 是 |  |  |  |
| 4 | tzje | numeric(18,2) | 是 |  |  |  |
| 5 | tzsm | varchar(30) | 是 |  |  |  |

### htk

- 定义变体 1 个；展示的变体出现在 21 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | htbm | char(20) | 否 |  | 1 |  |
| 2 | hth | varchar(30) | 是 |  |  |  |
| 3 | htmc | varchar(60) | 是 |  |  |  |
| 4 | ht_qc | varchar(130) | 是 |  |  |  |
| 5 | htlx | char(2) | 是 |  |  |  |
| 6 | htlb | char(1) | 是 |  |  |  |
| 7 | htxm | char(20) | 是 |  |  |  |
| 8 | jelx | char(1) | 是 |  |  |  |
| 9 | je | numeric(18,2) | 是 |  |  |  |
| 10 | sumje | numeric(18,2) | 是 |  |  |  |
| 11 | zblx | char(1) | 是 |  |  |  |
| 12 | zbbl | numeric(18,4) | 是 |  |  |  |
| 13 | zbje | numeric(18,2) | 是 |  |  |  |
| 14 | zbrq | date | 是 |  |  |  |
| 15 | jf | char(20) | 是 |  |  |  |
| 16 | jfdb | char(20) | 是 |  |  |  |
| 17 | yf | char(20) | 是 |  |  |  |
| 18 | yfdb | char(20) | 是 |  |  |  |
| 19 | sfht | char(1) | 是 |  |  |  |
| 20 | bf | char(20) | 是 |  |  |  |
| 21 | bfdb | char(20) | 是 |  |  |  |
| 22 | qdrq | date | 是 |  |  |  |
| 23 | ksrq | date | 是 |  |  |  |
| 24 | yxq | date | 是 |  |  |  |
| 25 | jsrq | date | 是 |  |  |  |
| 26 | jsbz | char(1) | 是 |  |  |  |
| 27 | jsyy | char(2) | 是 |  |  |  |
| 28 | yjd | char(1) | 是 |  |  |  |
| 29 | jdjs | smallint | 是 |  |  |  |
| 30 | htmemo | varchar(1024) | 是 |  |  |  |

### htlx

- 定义变体 1 个；展示的变体出现在 21 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh | char(2) | 否 |  | 1 |  |
| 2 | mc | char(20) | 是 |  |  |  |

### htnc

- 定义变体 1 个；展示的变体出现在 21 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | htbm | char(20) | 否 |  | 1 |  |
| 2 | kmbm | char(20) | 否 |  | 2 |  |
| 3 | nf | integer | 否 |  | 3 |  |
| 4 | bz | char(6) | 否 |  | 4 |  |
| 5 | nc_jf | double | 是 |  |  |  |
| 6 | nc_df | double | 是 |  |  |  |
| 7 | jq_jf | double | 是 |  |  |  |
| 8 | jq_df | double | 是 |  |  |  |
| 9 | fbs | char(1) | 是 |  |  |  |
| 10 | ys | double | 是 |  |  |  |
| 11 | nc_jf_b | double | 是 |  |  |  |
| 12 | nc_df_b | double | 是 |  |  |  |
| 13 | jq_jf_b | double | 是 |  |  |  |
| 14 | jq_df_b | double | 是 |  |  |  |
| 15 | yjd | char(1) | 是 |  |  |  |

### htyeb

- 定义变体 1 个；展示的变体出现在 21 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | htbm | char(20) | 是 |  |  |  |
| 2 | xmbm | char(20) | 是 |  |  |  |
| 3 | dwbm | char(20) | 是 |  |  |  |
| 4 | xmgs | numeric(18,2) | 是 |  |  |  |
| 5 | htje | numeric(18,2) | 是 |  |  |  |
| 6 | hebg | numeric(18,2) | 是 |  |  |  |
| 7 | nc_ye | numeric(18,2) | 是 |  |  |  |
| 8 | jf | numeric(18,2) | 是 |  |  |  |
| 9 | df | numeric(18,2) | 是 |  |  |  |
| 10 | lj_jf | numeric(18,2) | 是 |  |  |  |
| 11 | lj_df | numeric(18,2) | 是 |  |  |  |
| 12 | htzbj | numeric(18,2) | 是 |  |  |  |
| 13 | nf | integer | 是 |  |  |  |
| 14 | yf | integer | 是 |  |  |  |
| 15 | htlx | char(20) | 是 |  |  |  |

### htzt

- 定义变体 1 个；展示的变体出现在 21 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh | char(2) | 否 |  | 1 |  |
| 2 | mc | char(8) | 是 |  |  |  |

### hz

- 主要相关窗口：三栏明细账、【
- 定义变体 3 个；展示的变体出现在 33 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_fx_zl`（chengben/main）、`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzedit_bak`（chengben/main）、`w_pz_pzedit_mb`（chengben/main）、`w_xt_bmnc`（chengben/main）、`w_xt_dwnc`（chengben/main）、`w_xt_grnc`（chengben/main）、`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）、`w_xt_kmbm_edit_bak`（chengben/main）、`w_xt_kmbm_get`（chengben/main）、`w_xt_kmbm_len_bak`（chengben/main）、`w_xt_kmbm_replace_bak`（chengben/main）、`w_xt_kmwh`（chengben/main）、`w_xt_kmwh_1`（chengben/main）、`w_xt_kmwh_copy`（chengben/main）……共 158 个

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | nf | integer | 是 |  |  |  |
| 2 | yf | integer | 是 |  |  |  |
| 3 | kmbm | char(20) | 是 |  |  |  |
| 4 | xmlb | char(2) | 是 |  |  |  |
| 5 | xmbm | char(10) | 是 |  |  |  |
| 6 | bz | char(6) | 是 |  |  |  |
| 7 | jf | double | 是 |  |  |  |
| 8 | df | double | 是 |  |  |  |
| 9 | wbjf | double | 是 |  |  |  |
| 10 | wbdf | double | 是 |  |  |  |

### hzk

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | hzny | char(7) | 是 |  |  |  |
| 2 | ckbh | char(4) | 是 |  |  |  |
| 3 | cpbh | char(20) | 是 |  |  |  |
| 4 | rksl | double | 是 |  |  |  |
| 5 | rkje | double | 是 |  |  |  |
| 6 | cksl | double | 是 |  |  |  |
| 7 | ckje | double | 是 |  |  |  |
| 8 | jysl | double | 是 |  |  |  |
| 9 | jyje | double | 是 |  |  |  |
| 10 | pdsl | double | 是 |  |  |  |
| 11 | pdje | double | 是 |  |  |  |
| 12 | ph | char(20) | 是 |  |  |  |
| 13 | htlb | char(10) | 是 |  |  |  |
| 14 | htbh | char(10) | 是 |  |  |  |

### hzyeb

- 主要相关窗口：打印预览、数据导出
- 定义变体 5 个；展示的变体出现在 30 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_bf_98001`（chengben/main）、`w_bf_98001_bak`（chengben/main）、`w_preview`（chengben/main）、`w_print`（chengben/main）、`w_print_root`（chengben/main）、`w_xt_kmbm_get`（chengben/main）、`w_zh_zhjc`（chengben/main）、`w_zw_fhslye_1`（chengben/main）、`w_zw_fhwbye_1`（chengben/main）、`w_zw_fhye_1`（chengben/main）、`w_zw_fhye_1_bak`（chengben/main）、`w_zw_slye_1`（chengben/main）、`w_zw_wbye_1`（chengben/main）、`w_zw_ye_1`（chengben/main）、`w_bb_def_cn`（minfeiqi/main）、`w_bb_saveas`（minfeiqi/main）、`w_bf_98001`（minfeiqi/main）……共 53 个
- 数据窗口：`dw_cn_wbye`、`dw_cn_wbye_prt`、`dw_cn_ye`、`dw_cn_ye_prt`、`dw_wl_1_zl_khhz`、`dw_zw_fhslye`、`dw_zw_fhslye_b`、`dw_zw_fhslye_prt`、`dw_zw_fhwbye`、`dw_zw_fhwbye_b`、`dw_zw_fhwbye_prt`、`dw_zw_fhye`、`dw_zw_fhye_b`、`dw_zw_fhye_prt`、`dw_zw_slye`、`dw_zw_slye_b`、`dw_zw_slye_prt`、`dw_zw_wbye`、`dw_zw_wbye_b`、`dw_zw_wbye_prt`……共 24 个

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | char(20) | 是 |  |  | 科目编码 |
| 2 | km_mc | varchar(80) | 是 |  |  | 科目名称、客户 |
| 3 | qcfx | char(3) | 是 |  |  |  |
| 4 | qcwbye | double | 是 |  |  | 期初外币、年初数量、年初外币 |
| 5 | qcye | double | 是 |  |  | 期初余额、期初金额、年初金额 |
| 6 | bq_jfwb | double | 是 |  |  | 本期借方外币、本期借方数量、100天--100天 |
| 7 | bq_jf | double | 是 |  |  | 本期借方发生额、本期借方金额、本期发生额 |
| 8 | bq_dfwb | double | 是 |  |  | 本期贷方外币、本期贷方数量、本期贷方外币发生额 |
| 9 | bq_df | double | 是 |  |  | 本期贷方金额、本期贷方发生额、本位币金额 |
| 10 | lj_jfwb | double | 是 |  |  | 累计借方外币、累计借方数量、累计借方外币发生额 |
| 11 | lj_jf | double | 是 |  |  | 累计借方金额、累计借方发生额、累计借方 |
| 12 | lj_dfwb | double | 是 |  |  | 累计贷方外币、累计贷方数量、累计贷方外币发生额 |
| 13 | lj_df | double | 是 |  |  | 累计贷方金额、累计贷方发生额、累计贷方 |
| 14 | yjd | char(1) | 是 |  |  |  |
| 15 | kmjs | smallint | 是 |  |  |  |
| 16 | xmbm | char(10) | 是 |  |  | 编码 |
| 17 | xm_mc | char(100) | 是 |  |  |  |
| 18 | bz | char(6) | 是 |  |  | 币种、单位 |
| 19 | qc_hl | double | 是 |  |  |  |
| 20 | jy_je | double | 是 |  |  | 结余金额、余  额 |
| 21 | jy_hl | double | 是 |  |  | 结余单价 |
| 22 | jy_wb | double | 是 |  |  | 结余外币、结余数量 |

### im_bmk

- 定义变体 1 个；展示的变体出现在 2 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bmbm | char(20) | 否 |  | 1 |  |
| 2 | bm_mc | varchar(40) | 是 |  |  |  |
| 3 | sm | varchar(128) | 是 |  |  |  |
| 4 | jdjs | smallint | 是 |  |  |  |
| 5 | yjd | char(1) | 是 |  |  |  |
| 6 | qc | varchar(90) | 是 |  |  |  |
| 7 | cstop | char(1) | 是 |  |  |  |

### im_bmnc

- 定义变体 2 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bmbm | char(20) | 否 |  | 1 |  |
| 2 | bm_mc | char(80) | 是 |  |  |  |
| 3 | kmbm | char(20) | 否 |  | 2 |  |
| 4 | km_mc | char(80) | 是 |  |  |  |
| 5 | nc_jf | decimal | 是 |  |  |  |
| 6 | nc_df | decimal | 是 |  |  |  |
| 7 | lj_jf | decimal | 是 |  |  |  |
| 8 | lj_df | decimal | 是 |  |  |  |

### im_cross

- 定义变体 1 个；展示的变体出现在 2 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | char(20) | 否 |  | 1 |  |
| 2 | xmbm | char(20) | 否 |  | 2 |  |
| 3 | dwbm | char(20) | 否 |  | 3 |  |
| 4 | bmbm | char(20) | 否 |  | 4 |  |
| 5 | grbm | char(20) | 否 |  | 5 |  |
| 6 | lybm | char(20) | 否 |  | 6 |  |
| 7 | nc_jf | decimal | 是 |  |  |  |
| 8 | nc_df | decimal | 是 |  |  |  |
| 9 | lj_jf | decimal | 是 |  |  |  |
| 10 | lj_df | decimal | 是 |  |  |  |

### im_dwk

- 定义变体 1 个；展示的变体出现在 2 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | dwbm | char(20) | 否 |  | 1 |  |
| 2 | dw_mc | varchar(40) | 是 |  |  |  |
| 3 | frdb | varchar(20) | 是 |  |  |  |
| 4 | dwxz | char(2) | 是 |  |  |  |
| 5 | dwlx | char(2) | 是 |  |  |  |
| 6 | addr | varchar(128) | 是 |  |  |  |
| 7 | yb | char(10) | 是 |  |  |  |
| 8 | fax | char(15) | 是 |  |  |  |
| 9 | lxr | varchar(64) | 是 |  |  |  |
| 10 | zlzz | varchar(128) | 是 |  |  |  |
| 11 | tel | char(64) | 是 |  |  |  |
| 12 | bank | varchar(64) | 是 |  |  |  |
| 13 | acno | varchar(32) | 是 |  |  |  |
| 14 | nsh | varchar(32) | 是 |  |  |  |
| 15 | sm | varchar(128) | 是 |  |  |  |
| 16 | jdjs | smallint | 是 |  |  |  |
| 17 | yjd | char(1) | 是 |  |  |  |
| 18 | qc | varchar(90) | 是 |  |  |  |
| 19 | cstop | char(1) | 是 |  |  |  |

### im_dwnc

- 定义变体 2 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | dwbm | char(20) | 否 |  | 1 |  |
| 2 | dw_mc | char(80) | 是 |  |  |  |
| 3 | kmbm | char(20) | 否 |  | 2 |  |
| 4 | km_mc | char(80) | 是 |  |  |  |
| 5 | nc_jf | decimal | 是 |  |  |  |
| 6 | nc_df | decimal | 是 |  |  |  |
| 7 | lj_jf | decimal | 是 |  |  |  |
| 8 | lj_df | decimal | 是 |  |  |  |

### im_grk

- 定义变体 1 个；展示的变体出现在 2 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | grbm | char(20) | 否 |  | 1 |  |
| 2 | gr_mc | varchar(40) | 是 |  |  |  |
| 3 | tel | char(40) | 是 |  |  |  |
| 4 | sm | varchar(128) | 是 |  |  |  |
| 5 | jdjs | smallint | 是 |  |  |  |
| 6 | yjd | char(1) | 是 |  |  |  |
| 7 | qc | varchar(90) | 是 |  |  |  |
| 8 | cstop | char(1) | 是 |  |  |  |

### im_grnc

- 定义变体 2 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | grbm | char(20) | 否 |  | 1 |  |
| 2 | gr_mc | char(80) | 是 |  |  |  |
| 3 | kmbm | char(20) | 否 |  | 2 |  |
| 4 | km_mc | char(80) | 是 |  |  |  |
| 5 | nc_jf | decimal | 是 |  |  |  |
| 6 | nc_df | decimal | 是 |  |  |  |
| 7 | lj_jf | decimal | 是 |  |  |  |
| 8 | lj_df | decimal | 是 |  |  |  |

### im_kmbm

- 定义变体 2 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | char(20) | 否 |  | 1 |  |
| 2 | km_mc | varchar(40) | 是 |  |  |  |
| 3 | kmjs | smallint | 是 |  |  |  |
| 4 | kmsx | char(1) | 是 |  |  |  |
| 5 | zhlb | char(1) | 是 |  |  |  |
| 6 | fbs | char(1) | 是 |  |  |  |
| 7 | sls | char(1) | 是 |  |  |  |
| 8 | bz | char(6) | 是 |  |  |  |
| 9 | dw | char(4) | 是 |  |  |  |
| 10 | xms | char(1) | 是 |  |  |  |
| 11 | dws | char(1) | 是 |  |  |  |
| 12 | bms | char(1) | 是 |  |  |  |
| 13 | grs | char(1) | 是 |  |  |  |
| 14 | hts | char(1) | 是 |  |  |  |
| 15 | wls | char(1) | 是 |  |  |  |
| 16 | yjd | char(1) | 是 |  |  |  |
| 17 | yefx | char(1) | 是 |  |  |  |
| 18 | sybz | char(1) | 是 |  |  |  |
| 19 | xjs | char(1) | 是 |  |  |  |
| 20 | zjs | char(1) | 是 |  |  |  |
| 21 | nc_jf | decimal | 是 |  |  |  |
| 22 | nc_df | decimal | 是 |  |  |  |
| 23 | lj_jf | decimal | 是 |  |  |  |
| 24 | lj_df | decimal | 是 |  |  |  |

### im_wlxx

- 定义变体 2 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | dwbm | char(20) | 否 |  | 1 |  |
| 2 | dw_mc | char(80) | 是 |  |  |  |
| 3 | kmbm | char(20) | 否 |  | 2 |  |
| 4 | km_mc | char(80) | 是 |  |  |  |
| 5 | sortid | integer | 否 |  | 3 |  |
| 6 | pz_zy | char(80) | 是 |  |  |  |
| 7 | pz_jf | decimal | 是 |  |  |  |
| 8 | pz_df | decimal | 是 |  |  |  |
| 9 | pz_ph | char(20) | 是 |  |  |  |
| 10 | dqrq | date | 是 |  |  |  |
| 11 | pzrq | date | 是 |  |  |  |
| 12 | xmbm | char(20) | 是 |  |  |  |

### im_xmk

- 定义变体 1 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xmbm | char(20) | 否 |  | 1 |  |
| 2 | xm_mc | varchar(40) | 是 |  |  |  |
| 3 | pzwh | varchar(30) | 是 |  |  |  |
| 4 | xmgm | char(2) | 是 |  |  |  |
| 5 | xmxz | char(2) | 是 |  |  |  |
| 6 | xmlx | char(2) | 是 |  |  |  |
| 7 | kgrq | date | 是 |  |  |  |
| 8 | jelx | char(1) | 是 |  |  |  |
| 9 | xmgs | decimal | 是 |  |  |  |
| 10 | sm | varchar(128) | 是 |  |  |  |
| 11 | jdjs | smallint | 是 |  |  |  |
| 12 | yjd | char(1) | 是 |  |  |  |
| 13 | qc | varchar(90) | 是 |  |  |  |
| 14 | cstop | char(1) | 是 |  |  |  |
| 15 | xm_qc | varchar(128) | 是 |  |  |  |

### im_xmnc

- 定义变体 1 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xmbm | char(20) | 否 |  | 1 |  |
| 2 | xm_mc | char(80) | 是 |  |  |  |
| 3 | kmbm | char(20) | 否 |  | 2 |  |
| 4 | km_mc | char(80) | 是 |  |  |  |
| 5 | nc_jf | decimal | 是 |  |  |  |
| 6 | nc_df | decimal | 是 |  |  |  |
| 7 | lj_jf | decimal | 是 |  |  |  |
| 8 | lj_df | decimal | 是 |  |  |  |

### im_zjk

- 定义变体 1 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | lybm | char(20) | 否 |  | 1 |  |
| 2 | ly_mc | varchar(40) | 是 |  |  |  |
| 3 | sm | varchar(128) | 是 |  |  |  |
| 4 | jdjs | smallint | 是 |  |  |  |
| 5 | yjd | char(1) | 是 |  |  |  |
| 6 | qc | varchar(90) | 是 |  |  |  |
| 7 | cstop | char(1) | 是 |  |  |  |

### im_zjnc

- 定义变体 2 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | lybm | char(20) | 否 |  | 1 |  |
| 2 | ly_mc | char(80) | 是 |  |  |  |
| 3 | kmbm | char(20) | 否 |  | 2 |  |
| 4 | km_mc | char(80) | 是 |  |  |  |
| 5 | nc_jf | decimal | 是 |  |  |  |
| 6 | nc_df | decimal | 是 |  |  |  |
| 7 | lj_jf | decimal | 是 |  |  |  |
| 8 | lj_df | decimal | 是 |  |  |  |

### jf_tj_temp

- 定义变体 1 个；展示的变体出现在 25 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | nf | integer | 是 |  |  |  |
| 2 | yf | integer | 是 |  |  |  |
| 3 | bmbm | char(10) | 是 |  |  |  |
| 4 | jfbh | char(10) | 是 |  |  |  |
| 5 | je | double | 是 |  |  |  |

### jf_xm

- 定义变体 1 个；展示的变体出现在 25 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | jfbh | char(10) | 否 |  | 1 |  |
| 2 | jfmc | char(100) | 是 |  |  |  |

### jf_zb

- 定义变体 1 个；展示的变体出现在 25 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | nf | integer | 是 |  |  |  |
| 2 | yf | integer | 是 |  |  |  |
| 3 | bmbm | char(10) | 是 |  |  |  |
| 4 | jfbh | char(10) | 是 |  |  |  |
| 5 | je | double | 是 |  |  |  |
| 6 | lrr | char(10) | 是 |  |  |  |
| 7 | sh_bz | char(1) | 是 |  |  |  |
| 8 | shr | char(10) | 是 |  |  |  |
| 9 | sm | char(50) | 是 |  |  |  |
| 10 | sx | char(2) | 是 |  |  |  |
| 11 | wcje | double | 是 |  |  |  |
| 12 | bz1 | char(1) | 是 |  |  |  |
| 13 | bz2 | char(1) | 是 |  |  |  |

### jgb1

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pjlb | char(2) | 否 |  | 1 |  |
| 2 | pjbh | char(10) | 否 |  | 2 |  |
| 3 | khbh | char(10) | 是 |  |  |  |
| 4 | bjrq | date | 是 |  |  |  |
| 5 | sxrq | date | 是 |  |  |  |
| 6 | fktj | char(50) | 是 |  |  |  |
| 7 | czr | char(10) | 是 |  |  |  |
| 8 | dz | char(100) | 是 |  |  |  |

### jgb2

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pjlb | char(2) | 否 |  | 1 |  |
| 2 | pjbh | char(10) | 否 |  | 2 |  |
| 3 | biz | char(10) | 是 |  |  |  |
| 4 | fktj | char(50) | 是 |  |  |  |
| 5 | cpbh | char(20) | 否 |  | 3 |  |
| 6 | dj | double | 是 |  |  |  |
| 7 | sxrq | date | 是 |  |  |  |

### jjda

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | lb1 | char(1) | 是 |  |  |  |
| 2 | dh1 | char(10) | 是 |  |  |  |
| 3 | lb2 | char(1) | 是 |  |  |  |
| 4 | dh2 | char(10) | 是 |  |  |  |
| 5 | ckbh | char(4) | 是 |  |  |  |
| 6 | cpbh | char(15) | 是 |  |  |  |
| 7 | sl | double | 是 |  |  |  |
| 8 | dj | double | 是 |  |  |  |

### jrx_fd

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | fdbh | char(10) | 是 |  |  |  |
| 2 | fdmc | char(30) | 是 |  |  |  |

### jslb

- 主要相关窗口：结算类别管理、系统初始化--执行操作
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_xt_jslb`（chengben/main）、`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）、`w_zc_yhrjz_1`（chengben/main）、`w_xt_jslb`（minfeiqi/main）、`w_xt_kgzb_2`（minfeiqi/main）、`w_xt_kgzb_3`（minfeiqi/main）、`w_zc_yhrjz_1`（minfeiqi/main）、`w_xt_jslb`（qingsong/main）、`w_xt_kgzb_2`（qingsong/main）、`w_xt_kgzb_3`（qingsong/main）、`w_zc_yhrjz_1`（qingsong/main）
- 数据窗口：`dw_xt_jslb`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | jslb | char(2) | 是 |  |  | 代码 |
| 2 | jslb_mc | char(16) | 是 |  |  | 结算类别 |

### jzlx

- 主要相关窗口：月度结转、月度结转——生成凭证
- 定义变体 4 个；展示的变体出现在 26 个模板中。
- 使用窗口：`w_ini_bf`（chengben/main）、`w_xt_jzwh`（chengben/main）、`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）、`w_xt_kmbm_edit_bak`（chengben/main）、`w_xt_kmbm_len_bak`（chengben/main）、`w_xt_kmbm_replace_bak`（chengben/main）、`w_xt_kmwh`（chengben/main）、`w_xt_kmwh_1`（chengben/main）、`w_zw_ydjz_1`（chengben/main）、`w_zw_ydjz_1_bak`（chengben/main）、`w_zw_ydjz_1_bak1`（chengben/main）、`w_ini_bf`（minfeiqi/main）、`w_xt_jzwh`（minfeiqi/main）、`w_xt_kgzb_2`（minfeiqi/main）、`w_xt_kgzb_3`（minfeiqi/main）、`w_xt_kmbm_edit_bak`（minfeiqi/main）、`w_xt_kmbm_len_bak`（minfeiqi/main）、`w_xt_kmbm_replace_bak`（minfeiqi/main）、`w_xt_kmwh`（minfeiqi/main）……共 36 个
- 数据窗口：`dw_ini_jzlx`、`dw_xt_jzlx_1`、`dw_xt_jzlx_1_1`、`dw_xt_jzlx_2`、`dw_xt_jzlx_2_0`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | jzlx | char(2) | 是 |  |  | 类型 |
| 2 | pzlx | char(2) | 是 |  |  | 凭证类型 |
| 3 | xmlb | char(1) | 是 |  |  | 转空标志 |
| 4 | jc | char(10) | 是 |  |  | 简称 |
| 5 | zy | varchar(80) | 是 |  |  | 摘要 |
| 6 | zrkm | char(20) | 是 |  |  | 转入科目名称 |
| 7 | zckm | char(20) | 是 |  |  | 转出科目名称 |
| 8 | bz0 | char(1) | 是 |  |  | 转出类型 |
| 9 | bl0 | double | 是 |  |  | 转出比例 |

### jzlx_link

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | lxbm | char(2) | 否 |  | 1 |  |
| 2 | jc | char(10) | 是 |  |  |  |
| 3 | pzlx | char(2) | 是 |  |  |  |
| 4 | zckm | varchar(30) | 是 |  |  |  |
| 5 | zc_zy | char(80) | 是 |  |  |  |
| 6 | zrkm | varchar(30) | 是 |  |  |  |
| 7 | zr_zy | char(80) | 是 |  |  |  |
| 8 | zclx | char(1) | 是 |  |  |  |
| 9 | bl | double | 是 |  |  |  |

### jzpz

- 定义变体 1 个；展示的变体出现在 2 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | id | varchar(4) | 否 |  | 1 |  |
| 2 | mc | varchar(32) | 是 |  |  |  |
| 3 | pzlx | integer | 是 |  |  |  |
| 4 | cstop | char(1) | 是 |  |  |  |
| 5 | sortid | integer | 是 |  |  |  |
| 6 | xmlb | char(1) | 是 |  |  |  |
| 7 | xmbm | varchar(512) | 是 |  |  |  |
| 8 | sybz | char(1) | 是 |  |  |  |
| 9 | opsign | char(8) | 是 |  |  |  |
| 10 | shbz | char(1) | 是 |  |  |  |
| 11 | shr | char(8) | 是 |  |  |  |
| 12 | jzbz | char(1) | 是 |  |  |  |
| 13 | jzr | char(8) | 是 |  |  |  |

### jzpznr

- 定义变体 2 个；展示的变体出现在 1 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | id | varchar(4) | 否 |  | 1 |  |
| 2 | sortid | integer | 否 |  | 2 |  |
| 3 | pz_zy | varchar(80) | 是 |  |  |  |
| 4 | zckm | char(20) | 是 |  |  |  |
| 5 | jzlb | char(1) | 是 |  |  |  |
| 6 | jzbl | char(1) | 是 |  |  |  |
| 7 | rate | double | 是 |  |  |  |
| 8 | rateformulas | varchar(256) | 是 |  |  |  |
| 9 | zrkm | char(20) | 是 |  |  |  |
| 10 | zcxm | char(20) | 是 |  |  |  |
| 11 | zrxm | char(20) | 是 |  |  |  |
| 12 | zcfx | char(1) | 是 |  |  |  |
| 13 | zrfx | char(1) | 是 |  |  |  |
| 14 | formulas | varchar(256) | 是 |  |  |  |

### kcb

- 主要相关窗口：库存速查、采购合同
- 定义变体 3 个；展示的变体出现在 40 个模板中。
- 使用窗口：`w_cb_xt_kc_sc`（chengben/main）、`w_ck_ck1`（chengben/main）、`w_ck_kc`（chengben/main）
- 数据窗口：`dw_cb_xt_kc_sc`、`dw_ck_kcb`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ckbh | char(4) | 是 |  |  |  |
| 2 | cpbh | char(10) | 是 |  |  | 产品编号 |
| 3 | dqkc | double | 是 |  |  | 当前库存 |

### kcb01

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ckbh | char(4) | 是 |  |  |  |
| 2 | cpbh | char(20) | 是 |  |  |  |
| 3 | ph | char(20) | 是 |  |  |  |
| 4 | dqkc | double | 是 |  |  |  |
| 5 | sxq | date | 是 |  |  |  |
| 6 | kc1 | double | 是 |  |  |  |
| 7 | kc2 | double | 是 |  |  |  |

### kcb1

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ckbh | char(4) | 是 |  |  |  |
| 2 | cpbh | char(20) | 是 |  |  |  |
| 3 | dqkc | double | 是 |  |  |  |
| 4 | je | double | 是 |  |  |  |
| 5 | bz | char(1) | 是 |  |  |  |

### khda

- 主要相关窗口：修改编号
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_cb_cpda_xg`（chengben/main）

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | dwbh | char(6) | 是 |  |  |  |
| 2 | dwmc | char(50) | 是 |  |  |  |
| 3 | txdz | char(60) | 是 |  |  |  |
| 4 | yzbm | char(6) | 是 |  |  |  |
| 5 | lxdh | char(60) | 是 |  |  |  |
| 6 | lxr | char(24) | 是 |  |  |  |
| 7 | khyh | char(40) | 是 |  |  |  |
| 8 | yhzh | char(40) | 是 |  |  |  |
| 9 | nsh | char(20) | 是 |  |  |  |
| 10 | dqbh | char(4) | 是 |  |  |  |
| 11 | bz | char(30) | 是 |  |  |  |
| 12 | sx | char(1) | 是 |  |  |  |
| 13 | yskm | char(20) | 是 |  |  |  |
| 14 | yfkm | char(20) | 是 |  |  |  |
| 15 | xyed | double | 是 |  |  |  |
| 16 | fax | char(30) | 是 |  |  |  |
| 17 | ywy | char(10) | 是 |  |  |  |
| 18 | fklx | char(1) | 是 |  |  |  |
| 19 | ts | integer | 是 |  |  |  |
| 20 | fpzl | char(10) | 是 |  |  |  |
| 21 | slv | double | 是 |  |  |  |
| 22 | shdz | char(100) | 是 |  |  |  |
| 23 | shdh | char(24) | 是 |  |  |  |
| 24 | shlxr | char(10) | 是 |  |  |  |
| 25 | kfry | char(10) | 是 |  |  |  |

### khdy

- 定义变体 2 个；展示的变体出现在 34 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | dybh | char(1) | 否 |  | 1 |  |
| 2 | dymc | char(10) | 是 |  |  |  |
| 3 | srkm | char(10) | 是 |  |  |  |
| 4 | cbkm | char(10) | 是 |  |  |  |

### khhz

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | nf | integer | 是 |  |  |  |
| 2 | yf | integer | 是 |  |  |  |
| 3 | khbh | char(10) | 是 |  |  |  |
| 4 | jf | double | 是 |  |  |  |
| 5 | df | double | 是 |  |  |  |
| 6 | sm | char(1) | 是 |  |  |  |

### km_link

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | char(20) | 否 |  | 1 |  |
| 2 | comments | varchar(30) | 是 |  |  |  |
| 3 | sortid | integer | 是 |  |  |  |

### kmbm

- 主要相关窗口：三栏明细账、多栏账
- 定义变体 7 个；展示的变体出现在 17 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_cb_xt_kmbm_sc`（chengben/fp）、`w_fp_hz`（chengben/fp）、`w_fp_pz`（chengben/fp）、`w_fp_pz_bak`（chengben/fp）、`w_fp_pz_ckd`（chengben/fp）、`w_fp_pz_hz`（chengben/fp）、`w_fp_pz_sz`（chengben/fp）、`w_fp_sz`（chengben/fp）、`w_fp_sz_2`（chengben/fp）、`w_fp_zzs_hz`（chengben/fp）、`w_main1`（chengben/fp）、`w_main1_cb`（chengben/fp）、`w_main1_fp`（chengben/fp）、`w_xt_dwwh`（chengben/fp）、`w_acini_wizard`（chengben/main）、`w_bb_def_cn`（chengben/main）、`w_bb_def_help`（chengben/main）、`w_bb_htpj`（chengben/main）、`w_bb_proc`（chengben/main）……共 400 个
- 数据窗口：`dw_cb_cpda_1`、`dw_cb_cpda_2`、`dw_ck_ck`、`dw_ck_rk`、`dw_ck_rk1_tt`、`dw_cn_ll`、`dw_cn_lr_qc`、`dw_ht_pz_ll`、`dw_ht_pz_prt`、`dw_ini_kmbm`、`dw_kmbm_get`、`dw_print_lyck`、`dw_print_qtck`、`dw_print_qtrk`、`dw_pz_edit`、`dw_pz_edit0`、`dw_pz_edit0_b`、`dw_pz_edit_1`、`dw_pz_edit_1_b`、`dw_pz_edit_b`……共 55 个

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | varchar(30) | 是 |  |  | 科目编码、科目代码： |
| 2 | km_mc | varchar(80) | 是 |  |  | 科目名称、科目名称： |
| 3 | kmjs | smallint | 是 |  |  | 级数、Kmjs: |
| 4 | kmsx | char(1) | 是 |  |  | Kmsx: |
| 5 | zhlb | char(1) | 是 |  |  | 银行、银行标志 |
| 6 | fbs | char(1) | 是 |  |  | 复币、复币标志 |
| 7 | sls | char(1) | 是 |  |  | 数量、数量标志 |
| 8 | bz | char(6) | 是 |  |  | 币种、默认币种 |
| 9 | dw | char(4) | 是 |  |  | 单位、计量单位 |
| 10 | xms | char(1) | 是 |  |  | 项目、项目标志 |
| 11 | dws | char(1) | 是 |  |  | 客户、客户标志 |
| 12 | bms | char(1) | 是 |  |  | 部门、部门标志 |
| 13 | grs | char(1) | 是 |  |  | 个人、人员标志 |
| 14 | wls | char(1) | 是 |  |  | 往来、往来标志 |
| 15 | yjd | char(1) | 是 |  |  | 分类、Yjd: |
| 16 | yefx | char(1) | 是 |  |  | 余额方向、余额方向： |
| 17 | kmqc | varchar(200) | 是 |  |  | 科目名称、Kmqc:、收款科目名称 |
| 18 | xmbm | char(10) | 是 |  |  | 缺省项目编码、默认项目编码 |
| 19 | dwbm | char(10) | 是 |  |  | 缺省客户编码、默认客供编码 |
| 20 | bmbm | char(10) | 是 |  |  | 缺省部门编码、默认部门编码 |
| 21 | grbm | char(10) | 是 |  |  | 缺省人员编码、默认人员编码 |
| 22 | sybz | char(1) | 是 |  |  | 停用标志 |
| 23 | xjs | char(1) | 是 |  |  | 现金流量、现金流量标志 |
| 24 | zl_dw | char(10) | 是 |  |  |  |
| 25 | gg | char(40) | 是 |  |  |  |
| 26 | zl_ws | integer | 是 |  |  |  |
| 27 | hg_1 | char(5) | 是 |  |  |  |
| 28 | hg_2 | char(5) | 是 |  |  |  |
| 29 | hg_3 | char(5) | 是 |  |  |  |
| 30 | zl_dj | double | 是 |  |  |  |
| 31 | fullname | varchar(80) | 是 |  |  |  |
| 32 | zjm | char(20) | 是 |  |  | 助记码 |

### kmzk

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmdm | char(20) | 否 |  | 1 |  |
| 2 | kmmc | varchar(80) | 是 |  |  |  |
| 3 | kmbz | char(20) | 是 |  |  |  |
| 4 | ncye | numeric(10,2) | 是 |  |  |  |
| 5 | jflj | numeric(10,2) | 是 |  |  |  |
| 6 | dflj | numeric(10,2) | 是 |  |  |  |
| 7 | ncyhye | numeric(10,2) | 是 |  |  |  |
| 8 | ncsl | numeric(10,2) | 是 |  |  |  |
| 9 | kmsm | varchar(50) | 是 |  |  |  |

### luck

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | luck | char(5) | 否 |  | 1 |  |
| 2 | luck_name | char(10) | 是 |  |  |  |

### m_ckdj

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | khbh | char(10) | 是 |  |  |  |
| 2 | cpbh | char(20) | 是 |  |  |  |
| 3 | dj | double | 是 |  |  |  |
| 4 | ny | integer | 是 |  |  |  |
| 5 | jc_bz | char(1) | 是 |  |  |  |

### matetype

- 定义变体 1 个；展示的变体出现在 10 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | code | char(12) | 否 |  | 1 |  |
| 2 | cname | char(50) | 是 |  |  |  |
| 3 | parentcode | char(12) | 是 |  |  |  |

### nc

- 主要相关窗口：三栏明细账、凭证生成
- 定义变体 2 个；展示的变体出现在 34 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_fp_pz`（chengben/fp）、`w_fp_pz_bak`（chengben/fp）、`w_fp_pz_ckd`（chengben/fp）、`w_fp_pz_sz`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_bf_98001`（chengben/main）、`w_bf_98001_bak`（chengben/main）、`w_fx_nd_1`（chengben/main）、`w_fx_zl`（chengben/main）、`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzedit_bak`（chengben/main）、`w_pz_pzedit_mb`（chengben/main）、`w_test`（chengben/main）、`w_xt_fbwh`（chengben/main）、`w_xt_fbwh_1`（chengben/main）、`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）……共 161 个
- 数据窗口：`dw_xt_nc_prt`、`dw_xt_wbnc_prt`、`dw_xt_ye`、`dw_xt_ye_bak`、`dw_xt_ye_prt`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | char(20) | 是 |  |  | 科目编码 |
| 2 | bz | char(6) | 是 |  |  | 币种 |
| 3 | nc_jf | double | 是 |  |  | 年初借方余额、年初借方 |
| 4 | nc_df | double | 是 |  |  | 年初贷方余额、年初贷方 |
| 5 | jq_jf | double | 是 |  |  | 帐前借方发生额、账前借方发生额 |
| 6 | jq_df | double | 是 |  |  | 帐前贷方发生额、账前贷方发生额 |
| 7 | yjd | char(1) | 是 |  |  |  |
| 8 | fbs | char(1) | 是 |  |  |  |
| 9 | kmjs | smallint | 是 |  |  |  |
| 10 | ys | double | 是 |  |  |  |
| 11 | nc_jf_b | double | 是 |  |  | 折合本位币、年初借方本位币 |
| 12 | nc_df_b | double | 是 |  |  | 折合本位币、年初贷方本位币 |
| 13 | jq_jf_b | double | 是 |  |  | 折合本位币、帐前借方本位币 |
| 14 | jq_df_b | double | 是 |  |  | 折合本位币、帐前贷方本位币 |
| 15 | nf | integer | 是 |  |  |  |

### nc_check

- 定义变体 2 个；展示的变体出现在 18 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | varchar(30) | 是 |  |  |  |
| 2 | bz | char(6) | 是 |  |  |  |
| 3 | nc_jf | double | 是 |  |  |  |
| 4 | nc_df | double | 是 |  |  |  |
| 5 | nc_jqj | double | 是 |  |  |  |
| 6 | nc_jqd | double | 是 |  |  |  |
| 7 | xms | char(1) | 是 |  |  |  |
| 8 | xm_jf | double | 是 |  |  |  |
| 9 | xm_df | double | 是 |  |  |  |
| 10 | xm_jqj | double | 是 |  |  |  |
| 11 | xm_jqd | double | 是 |  |  |  |
| 12 | dws | char(1) | 是 |  |  |  |
| 13 | dw_jf | double | 是 |  |  |  |
| 14 | dw_df | double | 是 |  |  |  |
| 15 | dw_jqj | double | 是 |  |  |  |
| 16 | dw_jqd | double | 是 |  |  |  |
| 17 | bms | char(1) | 是 |  |  |  |
| 18 | bm_jf | double | 是 |  |  |  |
| 19 | bm_df | double | 是 |  |  |  |
| 20 | bm_jqj | double | 是 |  |  |  |
| 21 | bm_jqd | double | 是 |  |  |  |
| 22 | grs | char(1) | 是 |  |  |  |
| 23 | gr_jf | double | 是 |  |  |  |
| 24 | gr_df | double | 是 |  |  |  |
| 25 | gr_jqj | double | 是 |  |  |  |
| 26 | gr_jqd | double | 是 |  |  |  |
| 27 | lys | char(1) | 是 |  |  |  |
| 28 | ly_jf | double | 是 |  |  |  |
| 29 | ly_df | double | 是 |  |  |  |
| 30 | ly_jqj | double | 是 |  |  |  |
| 31 | ly_jqd | double | 是 |  |  |  |
| 32 | sresult | char(1) | 是 |  |  |  |

### nc_cross

- 定义变体 1 个；展示的变体出现在 19 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | nf | integer | 否 |  | 1 |  |
| 2 | bz | char(6) | 否 |  | 2 |  |
| 3 | fbs | char(1) | 是 |  |  |  |
| 4 | kmbm | char(20) | 否 |  | 3 |  |
| 5 | xmbm | char(20) | 否 |  | 4 |  |
| 6 | dwbm | char(20) | 否 |  | 5 |  |
| 7 | bmbm | char(20) | 否 |  | 6 |  |
| 8 | grbm | char(20) | 否 |  | 7 |  |
| 9 | lybm | char(20) | 否 |  | 8 |  |
| 10 | nc_jf | double | 是 |  |  |  |
| 11 | nc_df | double | 是 |  |  |  |
| 12 | jq_jf | double | 是 |  |  |  |
| 13 | jq_df | double | 是 |  |  |  |
| 14 | nc_jf_b | decimal | 是 |  |  |  |
| 15 | nc_df_b | decimal | 是 |  |  |  |
| 16 | jq_jf_b | decimal | 是 |  |  |  |
| 17 | jq_df_b | decimal | 是 |  |  |  |
| 18 | yjd | char(1) | 是 |  |  |  |
| 19 | lj_jf | double | 是 |  |  |  |
| 20 | lj_df | double | 是 |  |  |  |
| 21 | lj_jf_b | double | 是 |  |  |  |
| 22 | lj_df_b | double | 是 |  |  |  |

### pbcatcol

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pbc_tnam | char(129) | 是 |  |  |  |
| 2 | pbc_tid | integer | 是 |  |  |  |
| 3 | pbc_ownr | char(129) | 是 |  |  |  |
| 4 | pbc_cnam | char(129) | 是 |  |  |  |
| 5 | pbc_cid | smallint | 是 |  |  |  |
| 6 | pbc_labl | char(254) | 是 |  |  |  |
| 7 | pbc_lpos | smallint | 是 |  |  |  |
| 8 | pbc_hdr | char(254) | 是 |  |  |  |
| 9 | pbc_hpos | smallint | 是 |  |  |  |
| 10 | pbc_jtfy | smallint | 是 |  |  |  |
| 11 | pbc_mask | char(31) | 是 |  |  |  |
| 12 | pbc_case | smallint | 是 |  |  |  |
| 13 | pbc_hght | smallint | 是 |  |  |  |
| 14 | pbc_wdth | smallint | 是 |  |  |  |
| 15 | pbc_ptrn | char(31) | 是 |  |  |  |
| 16 | pbc_bmap | char(1) | 是 |  |  |  |
| 17 | pbc_init | char(254) | 是 |  |  |  |
| 18 | pbc_cmnt | char(254) | 是 |  |  |  |
| 19 | pbc_edit | char(31) | 是 |  |  |  |
| 20 | pbc_tag | char(254) | 是 |  |  |  |

### pbcatedt

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pbe_name | char(30) | 是 |  |  |  |
| 2 | pbe_edit | char(254) | 是 |  |  |  |
| 3 | pbe_type | smallint | 是 |  |  |  |
| 4 | pbe_cntr | integer | 是 |  |  |  |
| 5 | pbe_seqn | smallint | 是 |  |  |  |
| 6 | pbe_flag | integer | 是 |  |  |  |
| 7 | pbe_work | char(32) | 是 |  |  |  |

### pbcatfmt

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pbf_name | char(30) | 是 |  |  |  |
| 2 | pbf_frmt | char(254) | 是 |  |  |  |
| 3 | pbf_type | smallint | 是 |  |  |  |
| 4 | pbf_cntr | integer | 是 |  |  |  |

### pbcattbl

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pbt_tnam | char(129) | 是 |  |  |  |
| 2 | pbt_tid | integer | 是 |  |  |  |
| 3 | pbt_ownr | char(129) | 是 |  |  |  |
| 4 | pbd_fhgt | smallint | 是 |  |  |  |
| 5 | pbd_fwgt | smallint | 是 |  |  |  |
| 6 | pbd_fitl | char(1) | 是 |  |  |  |
| 7 | pbd_funl | char(1) | 是 |  |  |  |
| 8 | pbd_fchr | smallint | 是 |  |  |  |
| 9 | pbd_fptc | smallint | 是 |  |  |  |
| 10 | pbd_ffce | char(18) | 是 |  |  |  |
| 11 | pbh_fhgt | smallint | 是 |  |  |  |
| 12 | pbh_fwgt | smallint | 是 |  |  |  |
| 13 | pbh_fitl | char(1) | 是 |  |  |  |
| 14 | pbh_funl | char(1) | 是 |  |  |  |
| 15 | pbh_fchr | smallint | 是 |  |  |  |
| 16 | pbh_fptc | smallint | 是 |  |  |  |
| 17 | pbh_ffce | char(18) | 是 |  |  |  |
| 18 | pbl_fhgt | smallint | 是 |  |  |  |
| 19 | pbl_fwgt | smallint | 是 |  |  |  |
| 20 | pbl_fitl | char(1) | 是 |  |  |  |
| 21 | pbl_funl | char(1) | 是 |  |  |  |
| 22 | pbl_fchr | smallint | 是 |  |  |  |
| 23 | pbl_fptc | smallint | 是 |  |  |  |
| 24 | pbl_ffce | char(18) | 是 |  |  |  |
| 25 | pbt_cmnt | char(254) | 是 |  |  |  |

### pbcatvld

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pbv_name | char(30) | 是 |  |  |  |
| 2 | pbv_vald | char(254) | 是 |  |  |  |
| 3 | pbv_type | smallint | 是 |  |  |  |
| 4 | pbv_cntr | integer | 是 |  |  |  |
| 5 | pbv_msg | char(254) | 是 |  |  |  |

### pdk

- 主要相关窗口：产品档案维护、成本核算
- 定义变体 3 个；展示的变体出现在 40 个模板中。
- 使用窗口：`w_cb_cpda`（chengben/main）、`w_cb_hz`（chengben/main）、`w_cb_pdk_1`（chengben/main）
- 数据窗口：`dw_cb_pdk`、`dw_cb_pdk_1`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pdny | char(10) | 是 |  |  |  |
| 2 | ckbh | char(4) | 是 |  |  |  |
| 3 | cpbh | char(10) | 是 |  |  | 产品编号 |
| 4 | zmsl | double | 是 |  |  | 账面数量 |
| 5 | zmje | double | 是 |  |  | 账面金额 |
| 6 | sjsl | double | 是 |  |  | 实际数量 |
| 7 | dj | double | 是 |  |  | 单价 |
| 8 | sjje | double | 是 |  |  | 实际金额 |

### pdk0

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pddh | char(20) | 是 |  |  |  |
| 2 | rq | date | 是 |  |  |  |
| 3 | ckbh | char(10) | 是 |  |  |  |
| 4 | yksl | double | 是 |  |  |  |
| 5 | ykje | double | 是 |  |  |  |

### pdk_0

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pddh | char(10) | 是 |  |  |  |
| 2 | rq | date | 是 |  |  |  |
| 3 | ckbh | char(10) | 是 |  |  |  |
| 4 | cpbh | char(20) | 是 |  |  |  |
| 5 | zmsl | double | 是 |  |  |  |
| 6 | zmje | double | 是 |  |  |  |
| 7 | sl | double | 是 |  |  |  |
| 8 | dj | double | 是 |  |  |  |
| 9 | je | double | 是 |  |  |  |
| 10 | sjsl | double | 是 |  |  |  |
| 11 | sjje | double | 是 |  |  |  |
| 12 | jzbz | char(1) | 是 |  |  |  |
| 13 | bzrq | date | 是 |  |  |  |
| 14 | ph | char(20) | 是 |  |  |  |

### pjlb

- 定义变体 2 个；展示的变体出现在 12 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pjlb | char(4) | 是 |  |  |  |
| 2 | pjlb_jc | char(10) | 是 |  |  |  |
| 3 | jc_bz | char(1) | 是 |  |  |  |
| 4 | kmbm | varchar(30) | 是 |  |  |  |
| 5 | cbkm | varchar(30) | 是 |  |  |  |
| 6 | bz_1 | char(1) | 是 |  |  |  |

### pjnr1

- 主要相关窗口：凭证生成、库存台帐
- 定义变体 6 个；展示的变体出现在 31 个模板中。
- 使用窗口：`w_fp_lr_1`（chengben/fp）、`w_fp_pz`（chengben/fp）、`w_fp_pz_bak`（chengben/fp）、`w_fp_pz_ckd`（chengben/fp）、`w_fp_pz_sz`（chengben/fp）、`w_bb_htpj`（chengben/main）、`w_cb_ck_copy`（chengben/main）、`w_cb_hzsj_ck`（chengben/main）、`w_cb_hzsj_rk`（chengben/main）、`w_cb_pz`（chengben/main）、`w_cb_pz_bak`（chengben/main）、`w_cb_tzxx_rkdtz`（chengben/main）、`w_ck_ck`（chengben/main）、`w_ck_ck1`（chengben/main）、`w_ck_kc`（chengben/main）、`w_ck_rk`（chengben/main）、`w_ck_rk1`（chengben/main）、`w_ck_tz1`（chengben/main）、`w_ck_tz1_bak`（chengben/main）、`w_ck_xsmxz1`（chengben/main）……共 40 个
- 数据窗口：`dw_ck_ck`、`dw_ck_ck1_tt`、`dw_ck_ck_temp`、`dw_ck_rk`、`dw_ck_rk1_tt`、`dw_pjnr_save`、`dw_print_lyck`、`dw_print_qtck`、`dw_print_qtrk`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pjlb | char(4) | 是 |  |  | 票据类别、类别 |
| 2 | pjdh | char(10) | 是 |  |  | 单       号 :、票据单号 |
| 3 | rq | date | 是 |  |  | 日期:、日期、日   期 |
| 4 | ckbh | char(4) | 是 |  |  |  |
| 5 | kpr | char(10) | 是 |  |  | 操作人、开票人: |
| 6 | sm | char(40) | 是 |  |  | 摘要、分录摘要:、分录摘要 |
| 7 | fpzl | char(10) | 是 |  |  |  |
| 8 | slv | double | 是 |  |  |  |
| 9 | kmbm | char(20) | 是 |  |  | 收款科目、收入凭证借方科目、付款科目编码 |
| 10 | cbkm | char(20) | 是 |  |  | 成本凭证借方科目 |
| 11 | jc_bz | char(1) | 是 |  |  |  |
| 12 | bz_sh | char(1) | 是 |  |  | 审核 |
| 13 | shr | char(10) | 是 |  |  |  |

### pjnr1_0

- 定义变体 2 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pjlb | char(2) | 是 |  |  |  |
| 2 | pjdh | char(20) | 是 |  |  |  |
| 3 | rq | date | 是 |  |  |  |
| 4 | htbh | char(20) | 是 |  |  |  |
| 5 | khbh | char(10) | 是 |  |  |  |
| 6 | bmbh | char(4) | 是 |  |  |  |
| 7 | ckbh | char(10) | 是 |  |  |  |
| 8 | bgr | char(10) | 是 |  |  |  |
| 9 | jbr | char(10) | 是 |  |  |  |
| 10 | kpr | char(10) | 是 |  |  |  |
| 11 | fklx | char(1) | 是 |  |  |  |
| 12 | jzbz | char(1) | 是 |  |  |  |
| 13 | jzsx | integer | 是 |  |  |  |
| 14 | drck | char(10) | 是 |  |  |  |
| 15 | sm | char(40) | 是 |  |  |  |
| 16 | fpzl | char(10) | 是 |  |  |  |
| 17 | fpdh | char(20) | 是 |  |  |  |
| 18 | fprq | date | 是 |  |  |  |
| 19 | zkl | double | 是 |  |  |  |
| 20 | yt | char(10) | 是 |  |  |  |
| 21 | slv | double | 是 |  |  |  |
| 22 | jsr | char(10) | 是 |  |  |  |
| 23 | fcr | char(10) | 是 |  |  |  |
| 24 | htlb | char(1) | 是 |  |  |  |
| 25 | jc_bz | char(1) | 是 |  |  |  |
| 26 | ts | integer | 是 |  |  |  |
| 27 | bz_sh | char(1) | 是 |  |  |  |
| 28 | bz_zf | char(1) | 是 |  |  |  |

### pjnr2

- 主要相关窗口：凭证生成、数据导出
- 定义变体 3 个；展示的变体出现在 40 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_fp_lr_1`（chengben/fp）、`w_fp_pz_bak`（chengben/fp）、`w_fp_pz_ckd`（chengben/fp）、`w_fp_pz_sz`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_htpj`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_cb_cpda`（chengben/main）、`w_cb_hz`（chengben/main）、`w_cb_hzsj_cblr`（chengben/main）、`w_cb_hzsj_ck`（chengben/main）、`w_cb_hzsj_rk`（chengben/main）、`w_cb_hzsj_sfc_bak`（chengben/main）、`w_cb_pdk_1`（chengben/main）、`w_cb_pz`（chengben/main）、`w_cb_pz_bak`（chengben/main）、`w_cb_qc`（chengben/main）、`w_cb_sl_hzyeb`（chengben/main）、`w_cb_tzxx_rkdtz`（chengben/main）……共 40 个
- 数据窗口：`dw_cb_qc`、`dw_cb_qc_cj`、`dw_ck_ck2`、`dw_ck_rk2`、`dw_ck_tz_cp`、`dw_ck_xsmxz_cp`、`dw_pjnr_save`、`dw_print_djnr`、`dw_print_djnr_ck`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pjlb | char(4) | 是 |  |  |  |
| 2 | pjdh | char(10) | 是 |  |  |  |
| 3 | xh | smallint | 是 |  |  | 序号 |
| 4 | ny | integer | 是 |  |  |  |
| 5 | cpbh | char(10) | 是 |  |  | 产品编号 |
| 6 | sl | double | 是 |  |  | 数量、数  量 |
| 7 | dj | double | 是 |  |  | 单价、不含税单价 |
| 8 | dwcb | double | 是 |  |  |  |
| 9 | ckbh | char(4) | 是 |  |  |  |
| 10 | dj_hs | double | 是 |  |  | 单  价 |
| 11 | je | double | 是 |  |  | 金额、价税合计 |
| 12 | jc_int | smallint | 是 |  |  |  |
| 13 | jc_bz | char(1) | 是 |  |  |  |

### pjnr2_0

- 定义变体 2 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pjlb | char(2) | 是 |  |  |  |
| 2 | pjdh | char(20) | 是 |  |  |  |
| 3 | xh | smallint | 是 |  |  |  |
| 4 | ny | integer | 是 |  |  |  |
| 5 | cpbh | char(20) | 是 |  |  |  |
| 6 | sl | double | 是 |  |  |  |
| 7 | dj | double | 是 |  |  |  |
| 8 | dwcb | double | 是 |  |  |  |
| 9 | bzrq | date | 是 |  |  |  |
| 10 | ckbh | char(10) | 是 |  |  |  |
| 11 | htbh | char(20) | 是 |  |  |  |
| 12 | sl_b | double | 是 |  |  |  |
| 13 | bz | char(10) | 是 |  |  |  |
| 14 | wbdj | double | 是 |  |  |  |
| 15 | je | double | 是 |  |  |  |
| 16 | wbje | double | 是 |  |  |  |
| 17 | dj_hs | double | 是 |  |  |  |
| 18 | slv | double | 是 |  |  |  |
| 19 | zkl | double | 是 |  |  |  |
| 20 | dj_bz | double | 是 |  |  |  |
| 21 | yt | char(10) | 是 |  |  |  |
| 22 | dfbh | char(20) | 是 |  |  |  |
| 23 | ph | char(20) | 是 |  |  |  |
| 24 | sxq | date | 是 |  |  |  |
| 25 | jc_int | smallint | 是 |  |  |  |
| 26 | htlb | char(1) | 是 |  |  |  |
| 27 | jc_bz | char(1) | 是 |  |  |  |

### pz

- 主要相关窗口：三栏明细账、凭证生成
- 定义变体 6 个；展示的变体出现在 26 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_fp_lr_1`（chengben/fp）、`w_fp_lr_2`（chengben/fp）、`w_fp_pz`（chengben/fp）、`w_fp_pz_bak`（chengben/fp）、`w_fp_pz_ckd`（chengben/fp）、`w_fp_pz_hz`（chengben/fp）、`w_fp_pz_sz`（chengben/fp）、`w_fp_zzs_hz`（chengben/fp）、`w_xt_dwwh`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_htpj_gs`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_bf_98001`（chengben/main）、`w_bf_98001_bak`（chengben/main）、`w_cb_get`（chengben/main）、`w_cb_pz`（chengben/main）、`w_cb_pz_bak`（chengben/main）、`w_cg_ht_get`（chengben/main）、`w_ck_ck1`（chengben/main）……共 285 个
- 数据窗口：`dw_cn_pz`、`dw_fp_pz`、`dw_ht_pz_ll`、`dw_ht_pz_prt`、`dw_pz`、`dw_pz_dzzh`、`dw_pz_edit`、`dw_pz_edit0`、`dw_pz_edit0_b`、`dw_pz_edit_1`、`dw_pz_edit_1_b`、`dw_pz_edit_b`、`dw_pz_prn_x1`、`dw_pz_prn_x11`、`dw_pz_prn_x1_xzsy`、`dw_pz_prn_x2`、`dw_pz_prn_x2_sz`、`dw_pz_prn_x2_zy`、`dw_pz_prn_x3`、`dw_pz_prn_x4`……共 27 个

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | nf | integer | 是 |  |  | 年、年份 |
| 2 | yf | integer | 是 |  |  | 月、月份 |
| 3 | pzlx | smallint | 是 |  |  | 类型、凭证类型 |
| 4 | pzbh | integer | 是 |  |  | 编号、凭证编号 |
| 5 | pz_xh | integer | 是 |  |  | 序号 |
| 6 | kmbm | char(20) | 是 |  |  | 科目编码、科目编码/名称 |
| 7 | pz_zy | varchar(80) | 是 |  |  | 分录摘要、摘要 |
| 8 | pz_jf | double | 是 |  |  | 借方金额、借方 |
| 9 | pz_df | double | 是 |  |  | 贷方金额、贷方 |
| 10 | pz_wb | double | 是 |  |  | 外币金额、外币金额： |
| 11 | pz_hl | double | 是 |  |  | 汇　　率：、汇　　率、汇率 |
| 12 | pz_sl | double | 是 |  |  | 数量、数量： |
| 13 | pz_dj | double | 是 |  |  | 单价、单价： |
| 14 | jslb | char(2) | 是 |  |  | 结算类别、结算类别： |
| 15 | pz_ph | char(20) | 是 |  |  | 银行单号、票号 |
| 16 | jzbz | char(1) | 是 |  |  | 结转标志 |
| 17 | xmbm | char(10) | 是 |  |  | 项目、核算项目：、核算项目 |
| 18 | dwbm | char(10) | 是 |  |  | 客供、客供编码：、客供编码 |
| 19 | bmbm | char(10) | 是 |  |  | 部门、部门编码、部门编码： |
| 20 | grbm | char(10) | 是 |  |  | 人员、个人编码：、个人编码 |
| 21 | bz | char(6) | 是 |  |  | 币种、币种： |
| 22 | dw | char(4) | 是 |  |  |  |
| 23 | pzdj_bz | char(1) | 是 |  |  |  |
| 24 | dqrq | date | 是 |  |  |  |
| 25 | dd | integer | 是 |  |  | 日 |
| 26 | bz1 | integer | 是 |  |  |  |
| 27 | xjbm | char(4) | 是 |  |  | 现金流向：、现金流向、现金流量编码 |
| 28 | hg_dh | char(20) | 是 |  |  |  |
| 29 | hg_zl | double | 是 |  |  |  |
| 30 | hg_bz | char(20) | 是 |  |  |  |
| 31 | hg_qdh | char(20) | 是 |  |  |  |
| 32 | kmsx | char(1) | 是 |  |  |  |
| 33 | zl_dw | char(10) | 是 |  |  |  |
| 34 | htbh | char(15) | 是 |  |  | 合同编号 |

### pz_fj

- 主要相关窗口：凭证删除、销项发票录入
- 定义变体 1 个；展示的变体出现在 4 个模板中。
- 使用窗口：`w_fp_lr_1`（chengben/fp）、`w_fp_lr_2`（chengben/fp）、`w_cb_pz`（chengben/main）、`w_cb_pz_bak`（chengben/main）、`w_ck_ck1`（chengben/main）、`w_ck_rk1`（chengben/main）、`w_pz_tjdel`（chengben/main）、`w_pz_tjdel`（minfeiqi/main）、`w_cn_lr`（qingsong/cn）、`w_fp_lr_1`（qingsong/fp）、`w_fp_lr_2`（qingsong/fp）、`w_pz_tjdel`（qingsong/main）

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pz_fjdm | integer | 是 |  |  |  |
| 2 | xh | integer | 是 |  |  |  |
| 3 | wjmc | char(100) | 是 |  |  |  |
| 4 | nr | long binary | 是 |  |  |  |

### pzdj

- 主要相关窗口：三栏明细账、凭证生成
- 定义变体 3 个；展示的变体出现在 35 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_fp_lr_1`（chengben/fp）、`w_fp_lr_2`（chengben/fp）、`w_fp_pz`（chengben/fp）、`w_fp_pz_bak`（chengben/fp）、`w_fp_pz_hz`（chengben/fp）、`w_fp_pz_sz`（chengben/fp）、`w_bb_htpj_gs`（chengben/main）、`w_bb_proc`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_bf_98001`（chengben/main）、`w_bf_98001_bak`（chengben/main）、`w_cb_get`（chengben/main）、`w_cb_pz`（chengben/main）、`w_cb_pz_bak`（chengben/main）、`w_cg_ht_get`（chengben/main）、`w_ck_ck1`（chengben/main）、`w_ck_rk1`（chengben/main）、`w_ht_pz`（chengben/main）、`w_pz_build`（chengben/main）……共 190 个
- 数据窗口：`dw_ht_pz_ll`、`dw_ht_pz_prt`、`dw_pz_dzzh`、`dw_pz_saveas`、`dw_pz_saveas0`、`dw_pz_xsb`、`dw_pz_xsb_b`、`dw_pz_xsb_s`、`dw_pz_xsb_s_b`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | nf | integer | 是 |  |  |  |
| 2 | yf | integer | 是 |  |  |  |
| 3 | pzlx | smallint | 是 |  |  |  |
| 4 | pzbh | integer | 是 |  |  |  |
| 5 | pzdj_fds | integer | 是 |  |  | 附单数 |
| 6 | pzdj_bz | char(1) | 是 |  |  |  |
| 7 | pzdj_zdr | char(8) | 是 |  |  | 制单人 |
| 8 | pzdj_shr | char(8) | 是 |  |  | 审核人 |
| 9 | pzdj_jzr | char(8) | 是 |  |  | 记账人 |
| 10 | pzdj_rq | date | 是 |  |  | 凭证日期、制单日期 |
| 11 | pzdj_shrq | date | 是 |  |  |  |
| 12 | pzdj_jzrq | date | 是 |  |  |  |

### pzhz

- 定义变体 3 个；展示的变体出现在 20 个模板中。
- 数据窗口：`dw_pz_hz_prt`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | varchar(30) | 是 |  |  | 科目编码 |
| 2 | bz | char(6) | 是 |  |  | 币种、币  种 |
| 3 | jfwb | double | 是 |  |  | 借方原币、借方外币 |
| 4 | jf | double | 是 |  |  | 借方金额 |
| 5 | dfwb | double | 是 |  |  | 贷方原币、贷方外币 |
| 6 | df | double | 是 |  |  | 贷方金额 |
| 7 | delebz | char(1) | 是 |  |  |  |
| 8 | kmqc | varchar(200) | 是 |  |  | 科目名称 |

### pzlx

- 主要相关窗口：三栏明细账、凭证生成
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_fp_pz`（chengben/fp）、`w_fp_pz_bak`（chengben/fp）、`w_fp_pz_hz`（chengben/fp）、`w_fp_pz_sz`（chengben/fp）、`w_bb_htpj_gs`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_bf_98001_bak`（chengben/main）、`w_cb_pz`（chengben/main）、`w_cb_pz_bak`（chengben/main）、`w_ini_bf`（chengben/main）、`w_pz_bhzl`（chengben/main）、`w_pz_build`（chengben/main）、`w_pz_build_gz`（chengben/main）、`w_pz_get`（chengben/main）、`w_pz_get_bak`（chengben/main）、`w_pz_get_bb`（chengben/main）、`w_pz_kmhz`（chengben/main）、`w_pz_modify`（chengben/main）、`w_pz_plxg`（chengben/main）……共 178 个
- 数据窗口：`dw_ini_pzlx`、`dw_xt_pzlx`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pzlx | integer | 是 |  |  | 代码 |
| 2 | pzlx_jc | char(20) | 是 |  |  | 简称 |
| 3 | pzlx_qc | char(20) | 是 |  |  | 全称 |
| 4 | pzlx_jfy1 | char(20) | 是 |  |  |  |
| 5 | pzlx_jfy2 | char(20) | 是 |  |  |  |
| 6 | pzlx_dfy1 | char(20) | 是 |  |  |  |
| 7 | pzlx_dfy2 | char(20) | 是 |  |  |  |
| 8 | pzlx_pzy1 | char(20) | 是 |  |  |  |
| 9 | pzlx_pzy2 | char(20) | 是 |  |  |  |
| 10 | pzlx_pzw1 | char(20) | 是 |  |  |  |
| 11 | pzlx_pzw2 | char(20) | 是 |  |  |  |
| 12 | pzlx_jz | char(1) | 是 |  |  |  |

### pzmb

- 主要相关窗口：凭证录入、凭证修改
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzedit_bak`（chengben/main）、`w_pz_pzedit_mb`（chengben/main）、`w_pz_pzmb_add`（chengben/main）、`w_pz_pzmb_main`（chengben/main）、`w_pz_pzmb_xz`（chengben/main）、`w_xt_wh`（chengben/main）、`w_pz_pzedit`（minfeiqi/main）、`w_pz_pzedit_b`（minfeiqi/main）、`w_pz_pzedit_bak`（minfeiqi/main）、`w_pz_pzedit_mb`（minfeiqi/main）、`w_pz_pzmb_add`（minfeiqi/main）、`w_pz_pzmb_main`（minfeiqi/main）、`w_pz_pzmb_xz`（minfeiqi/main）、`w_xt_wh`（minfeiqi/main）、`w_pz_pzedit`（qingsong/main）、`w_pz_pzedit_b`（qingsong/main）、`w_pz_pzedit_bak`（qingsong/main）、`w_pz_pzedit_mb`（qingsong/main）……共 24 个
- 数据窗口：`dw_pz_pzmb`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | mbbh | char(4) | 是 |  |  | 编号 |
| 2 | mbmc | varchar(40) | 是 |  |  | 模版名称 |

### pzmb_pz

- 主要相关窗口：凭证录入、凭证修改
- 定义变体 7 个；展示的变体出现在 26 个模板中。
- 使用窗口：`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzedit_bak`（chengben/main）、`w_pz_pzedit_mb`（chengben/main）、`w_pz_pzmb_main`（chengben/main）、`w_xt_wh`（chengben/main）、`w_pz_pzedit`（minfeiqi/main）、`w_pz_pzedit_b`（minfeiqi/main）、`w_pz_pzedit_bak`（minfeiqi/main）、`w_pz_pzedit_mb`（minfeiqi/main）、`w_pz_pzmb_main`（minfeiqi/main）、`w_xt_wh`（minfeiqi/main）、`w_pz_pzedit`（qingsong/main）、`w_pz_pzedit_b`（qingsong/main）、`w_pz_pzedit_bak`（qingsong/main）、`w_pz_pzedit_mb`（qingsong/main）、`w_pz_pzmb_main`（qingsong/main）、`w_xt_wh`（qingsong/main）
- 数据窗口：`dw_pz_edit_mb`、`dw_pz_edit_mb_1`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | mbbh | char(4) | 是 |  |  |  |
| 2 | pzlx | integer | 是 |  |  |  |
| 3 | pzbh | integer | 是 |  |  |  |
| 4 | pz_xh | integer | 是 |  |  |  |
| 5 | kmbm | char(20) | 是 |  |  |  |
| 6 | pz_zy | varchar(80) | 是 |  |  |  |
| 7 | pz_jf | numeric(18,2) | 是 |  |  | 借方金额 |
| 8 | pz_df | numeric(18,2) | 是 |  |  | 贷方金额 |
| 9 | pz_wb | numeric(18,2) | 是 |  |  | 外币金额： |
| 10 | pz_hl | float | 是 |  |  | 汇　　率： |
| 11 | pz_sl | float | 是 |  |  | 数量： |
| 12 | pz_dj | numeric(18,2) | 是 |  |  | 单价： |
| 13 | jslb | char(2) | 是 |  |  | 结算类别： |
| 14 | pz_ph | char(8) | 是 |  |  | 银行单号 |
| 15 | jzbz | char(1) | 是 |  |  |  |
| 16 | xmbm | char(4) | 是 |  |  | 核算项目： |
| 17 | dwbm | char(4) | 是 |  |  | 客供编码： |
| 18 | bmbm | char(4) | 是 |  |  | 部门编码： |
| 19 | grbm | char(4) | 是 |  |  | 个人编码： |
| 20 | bz | char(6) | 是 |  |  | 币种： |
| 21 | dw | char(4) | 是 |  |  |  |
| 22 | pzdj_bz | char(1) | 是 |  |  |  |
| 23 | dqrq | date | 是 |  |  |  |
| 24 | dd | integer | 是 |  |  |  |
| 25 | bz1 | integer | 是 |  |  |  |
| 26 | xjbm | char(4) | 是 |  |  | 现金流向： |
| 27 | kmsx | char(1) | 是 |  |  |  |
| 28 | zl_dw | char(10) | 是 |  |  |  |

### rhcert

- 定义变体 3 个；展示的变体出现在 2 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | id | varchar(50) | 是 |  |  |  |
| 2 | orgid | varchar(20) | 是 |  |  |  |
| 3 | grpcode | varchar(50) | 是 |  |  |  |
| 4 | budcode | varchar(50) | 是 |  |  |  |
| 5 | rescode | varchar(50) | 是 |  |  |  |
| 6 | cstcode | varchar(50) | 是 |  |  |  |
| 7 | ipitemcode | varchar(50) | 是 |  |  |  |
| 8 | paycategory | varchar(50) | 是 |  |  |  |
| 9 | tradingname | varchar(50) | 是 |  |  |  |
| 10 | raccount | varchar(50) | 是 |  |  |  |
| 11 | rbank | varchar(50) | 是 |  |  |  |
| 12 | paidtype | varchar(50) | 是 |  |  |  |
| 13 | cvsm | numeric(19,4) | 是 |  |  |  |
| 14 | filldate | timestamp | 是 |  |  |  |
| 15 | belfncycle | varchar(20) | 是 |  |  |  |
| 16 | pcode | varchar(50) | 是 |  |  |  |
| 17 | pplancode | varchar(50) | 是 |  |  |  |
| 18 | locklogo | integer | 是 |  |  |  |
| 19 | zth | integer | 是 |  |  |  |
| 20 | nf | integer | 是 |  |  |  |
| 21 | yf | integer | 是 |  |  |  |
| 22 | pzlx | integer | 是 |  |  |  |
| 23 | pzbh | integer | 是 |  |  |  |

### rkdk0

- 定义变体 1 个；展示的变体出现在 58 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ckbh | char(4) | 是 |  |  |  |
| 2 | cpbh | char(20) | 是 |  |  |  |
| 3 | ny | integer | 是 |  |  |  |
| 4 | sl | double | 是 |  |  |  |
| 5 | dj | double | 是 |  |  |  |
| 6 | pjlb | char(1) | 是 |  |  |  |
| 7 | pjdh | char(10) | 是 |  |  |  |
| 8 | xh | integer | 是 |  |  |  |

### rkdk0_bf

- 定义变体 1 个；展示的变体出现在 58 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ckbh | char(4) | 是 |  |  |  |
| 2 | cpbh | char(20) | 是 |  |  |  |
| 3 | ny | integer | 是 |  |  |  |
| 4 | sl | double | 是 |  |  |  |
| 5 | dj | double | 是 |  |  |  |
| 6 | pjlb | char(1) | 是 |  |  |  |
| 7 | pjdh | char(10) | 是 |  |  |  |
| 8 | xh | integer | 是 |  |  |  |
| 9 | hzny | char(7) | 是 |  |  |  |

### rpt_bm

- 定义变体 1 个；展示的变体出现在 18 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | id | char(3) | 否 |  | 1 |  |
| 2 | sname | varchar(30) | 是 |  |  |  |

### rpt_dq

- 定义变体 1 个；展示的变体出现在 18 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | id | char(6) | 否 |  | 1 |  |
| 2 | sname | varchar(30) | 是 |  |  |  |

### rpt_ls

- 定义变体 1 个；展示的变体出现在 18 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | id | char(6) | 否 |  | 1 |  |
| 2 | sname | varchar(30) | 是 |  |  |  |

### rpt_org

- 定义变体 1 个；展示的变体出现在 18 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | id | char(12) | 否 |  | 1 |  |
| 2 | sname | varchar(60) | 是 |  |  |  |

### rptcell

- 定义变体 1 个；展示的变体出现在 18 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | rptid | integer | 否 |  | 1 |  |
| 2 | rptmc | varchar(64) | 是 |  |  |  |
| 3 | maxrow | integer | 是 |  |  |  |
| 4 | maxcol | integer | 是 |  |  |  |
| 5 | addrow | char(1) | 是 |  |  |  |
| 6 | rowitem | char(1) | 是 |  |  |  |
| 7 | h_b | integer | 是 |  |  |  |
| 8 | h_e | integer | 是 |  |  |  |
| 9 | d_b | integer | 是 |  |  |  |
| 10 | d_e | integer | 是 |  |  |  |
| 11 | f_b | integer | 是 |  |  |  |
| 12 | f_e | integer | 是 |  |  |  |
| 13 | header_r | char(2) | 是 |  |  |  |
| 14 | footer_r | char(1) | 是 |  |  |  |
| 15 | islock | char(1) | 是 |  |  |  |

### rptcover

- 定义变体 1 个；展示的变体出现在 18 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | dwmc | varchar(50) | 是 |  |  |  |
| 2 | dwfzr | varchar(10) | 是 |  |  |  |
| 3 | cwfzr | varchar(10) | 是 |  |  |  |
| 4 | tbr | varchar(10) | 是 |  |  |  |
| 5 | dwdz | varchar(50) | 是 |  |  |  |
| 6 | tel_1 | varchar(5) | 是 |  |  |  |
| 7 | tel_2 | varchar(8) | 是 |  |  |  |
| 8 | tel_3 | varchar(5) | 是 |  |  |  |
| 9 | dwtydm | char(9) | 否 |  | 1 |  |
| 10 | dwxz | char(1) | 是 |  |  |  |
| 11 | szdq | char(6) | 是 |  |  |  |
| 12 | lsgx | char(6) | 是 |  |  |  |
| 13 | bmbzdm | char(3) | 是 |  |  |  |
| 14 | bblx | char(1) | 是 |  |  |  |
| 15 | d_dwxz | char(1) | 是 |  |  |  |
| 16 | d_dq_1 | char(2) | 是 |  |  |  |
| 17 | d_dq_2 | char(4) | 是 |  |  |  |
| 18 | d_dq_3 | char(6) | 是 |  |  |  |
| 19 | d_ls_1 | char(2) | 是 |  |  |  |
| 20 | d_ls_2 | char(4) | 是 |  |  |  |
| 21 | d_ls_3 | char(6) | 是 |  |  |  |
| 22 | d_bmbzdm | char(3) | 是 |  |  |  |
| 23 | d_bblx | char(1) | 是 |  |  |  |
| 24 | bym | varchar(10) | 是 |  |  |  |
| 25 | id | char(12) | 是 |  |  |  |
| 26 | bsrq | date | 是 |  |  |  |

### ryk

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bmbh | char(4) | 否 |  | 1 |  |
| 2 | rybh | char(4) | 否 |  | 2 |  |
| 3 | name | char(10) | 是 |  |  |  |

### s_gxda

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | gxbh | char(8) | 是 |  |  |  |
| 2 | gxmc | char(20) | 是 |  |  |  |
| 3 | dj | double | 是 |  |  |  |
| 4 | lx | char(10) | 是 |  |  |  |
| 5 | bz | char(1) | 是 |  |  |  |

### scjh1

- 主要相关窗口：合同复制
- 定义变体 1 个；展示的变体出现在 57 个模板中。
- 使用窗口：`w_cb_ck_copy`（chengben/main）

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | jhbh | char(10) | 是 |  |  |  |
| 2 | rq | date | 是 |  |  |  |
| 3 | rq1 | date | 是 |  |  |  |
| 4 | ckbh_yl | char(4) | 是 |  |  |  |
| 5 | ckbh_sc | char(4) | 是 |  |  |  |
| 6 | ckbh_cp | char(4) | 是 |  |  |  |
| 7 | sm | char(30) | 是 |  |  |  |

### scjh2

- 定义变体 1 个；展示的变体出现在 57 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | jhbh | char(10) | 是 |  |  |  |
| 2 | cpbh | char(20) | 是 |  |  |  |
| 3 | sl | double | 是 |  |  |  |
| 4 | sl1 | double | 是 |  |  |  |
| 5 | ckbh_cp | char(4) | 是 |  |  |  |
| 6 | sl_b | double | 是 |  |  |  |
| 7 | ckbh_sc | char(4) | 是 |  |  |  |

### scjh3

- 定义变体 1 个；展示的变体出现在 57 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | jhbh | char(10) | 是 |  |  |  |
| 2 | cpbh | char(20) | 是 |  |  |  |
| 3 | ylbh | char(20) | 是 |  |  |  |
| 4 | sl | double | 是 |  |  |  |
| 5 | sl1 | double | 是 |  |  |  |
| 6 | ckbh_yl | char(4) | 是 |  |  |  |
| 7 | sl_b | double | 是 |  |  |  |
| 8 | ckbh_sc | char(4) | 是 |  |  |  |
| 9 | sl2 | double | 是 |  |  |  |

### scydd

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | gxbh | char(8) | 是 |  |  |  |
| 2 | rq | date | 是 |  |  |  |
| 3 | jhbh | char(20) | 是 |  |  |  |
| 4 | cpbh | char(15) | 是 |  |  |  |
| 5 | ph | char(20) | 是 |  |  |  |
| 6 | sl | double | 是 |  |  |  |
| 7 | sl0 | double | 是 |  |  |  |
| 8 | sl_01 | integer | 是 |  |  |  |
| 9 | sl_02 | integer | 是 |  |  |  |
| 10 | sl_03 | integer | 是 |  |  |  |
| 11 | sl_04 | integer | 是 |  |  |  |
| 12 | sl_05 | integer | 是 |  |  |  |
| 13 | sl_06 | integer | 是 |  |  |  |
| 14 | sl_07 | integer | 是 |  |  |  |
| 15 | sl_08 | integer | 是 |  |  |  |
| 16 | sl_09 | integer | 是 |  |  |  |
| 17 | sl_10 | integer | 是 |  |  |  |
| 18 | sl_11 | integer | 是 |  |  |  |
| 19 | sl_12 | integer | 是 |  |  |  |
| 20 | sl_13 | integer | 是 |  |  |  |
| 21 | sl_14 | integer | 是 |  |  |  |
| 22 | sl_15 | integer | 是 |  |  |  |
| 23 | kpr | char(10) | 是 |  |  |  |

### sd_lpj

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh | char(10) | 是 |  |  |  |
| 2 | mm | char(10) | 是 |  |  |  |
| 3 | zt | char(10) | 是 |  |  |  |
| 4 | cs | integer | 是 |  |  |  |
| 5 | je | double | 是 |  |  |  |

### shdb1

- 定义变体 1 个；展示的变体出现在 10 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pjlb | char(2) | 是 |  |  |  |
| 2 | pjdh | char(20) | 是 |  |  |  |
| 3 | rq | date | 是 |  |  |  |
| 4 | htbh | char(20) | 是 |  |  |  |
| 5 | khbh | char(10) | 是 |  |  |  |
| 6 | bmbh | char(4) | 是 |  |  |  |
| 7 | ckbh | char(10) | 是 |  |  |  |
| 8 | bgr | char(10) | 是 |  |  |  |
| 9 | jbr | char(10) | 是 |  |  |  |
| 10 | kpr | char(10) | 是 |  |  |  |
| 11 | fklx | char(1) | 是 |  |  |  |
| 12 | jzbz | char(1) | 是 |  |  |  |
| 13 | jzsx | integer | 是 |  |  |  |
| 14 | drck | char(10) | 是 |  |  |  |
| 15 | sm | char(40) | 是 |  |  |  |
| 16 | fpzl | char(10) | 是 |  |  |  |
| 17 | fpdh | char(20) | 是 |  |  |  |
| 18 | fprq | date | 是 |  |  |  |
| 19 | zkl | double | 是 |  |  |  |
| 20 | yt | char(10) | 是 |  |  |  |
| 21 | slv | double | 是 |  |  |  |
| 22 | jsr | char(10) | 是 |  |  |  |
| 23 | fcr | char(10) | 是 |  |  |  |
| 24 | htlb | char(1) | 是 |  |  |  |
| 25 | jc_bz | char(1) | 是 |  |  |  |
| 26 | bz_sh | char(1) | 是 |  |  |  |
| 27 | bz_zf | char(1) | 是 |  |  |  |
| 28 | ts | integer | 是 |  |  |  |
| 29 | khddh | char(40) | 是 |  |  |  |

### shdb2

- 定义变体 1 个；展示的变体出现在 10 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pjlb | char(2) | 是 |  |  |  |
| 2 | pjdh | char(20) | 是 |  |  |  |
| 3 | xh | smallint | 是 |  |  |  |
| 4 | ny | integer | 是 |  |  |  |
| 5 | cpbh | char(20) | 是 |  |  |  |
| 6 | sl | double | 是 |  |  |  |
| 7 | dj | double | 是 |  |  |  |
| 8 | dwcb | double | 是 |  |  |  |
| 9 | bzrq | date | 是 |  |  |  |
| 10 | ckbh | char(10) | 是 |  |  |  |
| 11 | htbh | char(20) | 是 |  |  |  |
| 12 | sl_b | double | 是 |  |  |  |
| 13 | bz | char(10) | 是 |  |  |  |
| 14 | wbdj | double | 是 |  |  |  |
| 15 | je | double | 是 |  |  |  |
| 16 | wbje | double | 是 |  |  |  |
| 17 | dj_hs | double | 是 |  |  |  |
| 18 | slv | double | 是 |  |  |  |
| 19 | zkl | double | 是 |  |  |  |
| 20 | dj_bz | double | 是 |  |  |  |
| 21 | yt | char(10) | 是 |  |  |  |
| 22 | dfbh | char(20) | 是 |  |  |  |
| 23 | ph | char(20) | 是 |  |  |  |
| 24 | sxq | date | 是 |  |  |  |
| 25 | jc_int | smallint | 是 |  |  |  |
| 26 | htlb | char(1) | 是 |  |  |  |
| 27 | jc_bz | char(1) | 是 |  |  |  |

### sj_cpgxb

- 定义变体 2 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | cpbh | char(15) | 是 |  |  |  |
| 2 | gxbh | char(8) | 是 |  |  |  |
| 3 | sl | double | 是 |  |  |  |
| 4 | dj | double | 是 |  |  |  |
| 5 | ph | char(20) | 是 |  |  |  |
| 6 | cpbh0 | char(20) | 是 |  |  |  |

### sj_ddys

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | sj_ddys | char(20) | 否 |  | 1 |  |

### sj_dw

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | sj_dw | char(20) | 否 |  | 1 |  |

### sj_fp1

- 定义变体 2 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | fpbh | char(15) | 是 |  |  |  |
| 2 | rq | date | 是 |  |  |  |
| 3 | khbh | char(10) | 是 |  |  |  |
| 4 | htbh | char(20) | 是 |  |  |  |
| 5 | myfs | char(1) | 是 |  |  |  |
| 6 | skfs | char(1) | 是 |  |  |  |
| 7 | fyg | char(20) | 是 |  |  |  |
| 8 | zyg | char(20) | 是 |  |  |  |
| 9 | ysgj | char(1) | 是 |  |  |  |
| 10 | mdg | char(20) | 是 |  |  |  |
| 11 | xyzh | char(20) | 是 |  |  |  |

### sj_fp2

- 定义变体 2 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | fpbh | char(15) | 是 |  |  |  |
| 2 | htbh | char(20) | 是 |  |  |  |
| 3 | cpbh | char(15) | 是 |  |  |  |
| 4 | sl | double | 是 |  |  |  |
| 5 | dj | double | 是 |  |  |  |
| 6 | je | double | 是 |  |  |  |
| 7 | xh | integer | 是 |  |  |  |
| 8 | ph | char(20) | 是 |  |  |  |
| 9 | cpbh0 | char(20) | 是 |  |  |  |

### sj_gxda

- 定义变体 1 个；展示的变体出现在 13 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | gxbh | char(8) | 是 |  |  |  |
| 2 | gxmc | char(20) | 是 |  |  |  |
| 3 | dj | double | 是 |  |  |  |
| 4 | lx | char(10) | 是 |  |  |  |

### sj_gxda_blp

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | gxbh | char(8) | 是 |  |  |  |
| 2 | xh | integer | 是 |  |  |  |
| 3 | mc | char(20) | 是 |  |  |  |

### sj_ps

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | sj_ps | char(20) | 否 |  | 1 |  |

### sj_yg

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | sj_yg | char(20) | 否 |  | 1 |  |

### sj_yzys

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | sj_yzys | char(40) | 否 |  | 1 |  |

### sj_zdys

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | sj_zdys | char(10) | 否 |  | 1 |  |

### slz

- 主要相关窗口：三栏明细账、多栏账
- 定义变体 8 个；展示的变体出现在 19 个模板中。
- 使用窗口：`w_preview_zc`（chengben/main）、`w_print_zc`（chengben/main）、`w_pz_jccx_1`（chengben/main）、`w_zc_dlz_1`（chengben/main）、`w_zc_fhdlz_1`（chengben/main）、`w_zc_fhdlz_1_bak`（chengben/main）、`w_zc_fhslz_1`（chengben/main）、`w_zc_fhslz_1_bak`（chengben/main）、`w_zc_fzslz_fb`（chengben/main）、`w_zc_fzslz_sl`（chengben/main）、`w_zc_slz_1`（chengben/main）、`w_zc_slz_1_bak`（chengben/main）、`w_zc_slz_fb`（chengben/main）、`w_zc_slz_sl`（chengben/main）、`w_zc_slz_slfb`（chengben/main）、`w_zc_xjll_1`（chengben/main）、`w_zc_xjrjz_1`（chengben/main）、`w_zc_xjrjz_fb`（chengben/main）、`w_zc_yhrjz_1`（chengben/main）、`w_zc_yhrjz_fb`（chengben/main）……共 68 个
- 数据窗口：`dw_cn_lr`、`dw_cn_xjrjz_prt`、`dw_cn_xjrjz_prt_sz`、`dw_wl_1_khhz`、`dw_wl_1_zl`、`dw_zc_fbslz_prt`、`dw_zc_fbslz_prt_sz`、`dw_zc_fbxjrjz_prt`、`dw_zc_fbxjrjz_prt_sz`、`dw_zc_fbyhrjz_prt`、`dw_zc_fbyhrjz_prt_sz`、`dw_zc_fhslz`、`dw_zc_fhslz_b`、`dw_zc_slfbslz_prt`、`dw_zc_slslz_prt`、`dw_zc_slz`、`dw_zc_slz_b`、`dw_zc_slz_bak`、`dw_zc_slz_fb`、`dw_zc_slz_fb_b`……共 32 个

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | yf | integer | 是 |  |  | 月、序号 |
| 2 | rq | integer | 是 |  |  | 日 |
| 3 | pzlx | integer | 是 |  |  |  |
| 4 | pzbh | integer | 是 |  |  | 单号 |
| 5 | pz_xh | integer | 是 |  |  |  |
| 6 | pz_zh | char(24) | 是 |  |  | 凭证字号、凭证、凭证
字号 |
| 7 | pz_zy | varchar(80) | 是 |  |  | 凭证摘要、摘  要、摘要 |
| 8 | kmbm | char(20) | 是 |  |  | 科目名称、对方科目编码 |
| 9 | dfkm_mc | varchar(40) | 是 |  |  | 对方科目、对方科目名称、科目名称 |
| 10 | jslb | char(2) | 是 |  |  | 勾账 |
| 11 | pz_ph | char(8) | 是 |  |  | 支票号、币种 |
| 12 | pjdh | char(22) | 是 |  |  | 银行票据 |
| 13 | jf | double | 是 |  |  | 借方发生额、借 方 发 生 额、借 方 |
| 14 | jf_wb | double | 是 |  |  | 借方外币、借方数量、原币金额 |
| 15 | jf_hl | double | 是 |  |  | 汇率、单价、估损率(%) |
| 16 | df | double | 是 |  |  | 贷方发生额、贷 方 发 生 额、贷 方 |
| 17 | df_wb | double | 是 |  |  | 贷方外币、贷方数量、原币金额 |
| 18 | df_hl | double | 是 |  |  | 汇率、单价 |
| 19 | ye | double | 是 |  |  | 余额、余          额、余额 BALANCE |
| 20 | ye_wb | double | 是 |  |  | 余额数量、外币余额、原币金额 |
| 21 | ye_hl | double | 是 |  |  | 原币金额 |
| 22 | pzrq | date | 是 |  |  |  |
| 23 | xmbm | char(10) | 是 |  |  | 客户名称 |
| 24 | xm_mc | char(20) | 是 |  |  | 录入人 |
| 25 | nf | integer | 是 |  |  |  |
| 26 | pzdj_bz | char(1) | 是 |  |  |  |

### tdk

- 定义变体 1 个；展示的变体出现在 58 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | cpbh | char(20) | 是 |  |  |  |
| 2 | tdbh | char(20) | 是 |  |  |  |
| 3 | sx | integer | 是 |  |  |  |
| 4 | xh | integer | 是 |  |  |  |
| 5 | tlbh | char(15) | 是 |  |  |  |

### tlda

- 主要相关窗口：产品档案维护
- 定义变体 2 个；展示的变体出现在 31 个模板中。
- 使用窗口：`w_cb_cpda`（chengben/main）

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | tlbh | char(20) | 是 |  |  |  |
| 2 | cpbh | char(20) | 是 |  |  |  |
| 3 | sl | double | 是 |  |  |  |
| 4 | xh | integer | 是 |  |  |  |

### tlda0

- 定义变体 2 个；展示的变体出现在 9 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | tlbh | char(20) | 是 |  |  |  |

### users

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | u_id | char(8) | 否 |  | 1 |  |
| 2 | u_name | char(8) | 是 |  |  |  |
| 3 | u_pass | char(8) | 是 |  |  |  |
| 4 | u_r01 | char(50) | 是 |  |  |  |
| 5 | u_r02 | char(20) | 是 |  |  |  |
| 6 | u_r03 | char(20) | 是 |  |  |  |
| 7 | u_r04 | char(20) | 是 |  |  |  |
| 8 | u_r05 | char(20) | 是 |  |  |  |

### v_pz

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | varchar(30) | 是 |  |  |  |
| 2 | pzlx_jc | char(20) | 是 |  |  |  |
| 3 | pzbh | char(10) | 是 |  |  |  |
| 4 | ye | double | 是 |  |  |  |
| 5 | xmbm | char(4) | 是 |  |  |  |
| 6 | bmbm | char(4) | 是 |  |  |  |
| 7 | grbm | char(4) | 是 |  |  |  |
| 8 | pzdj_rq | date | 是 |  |  |  |
| 9 | pzdj_bz | char(1) | 是 |  |  |  |
| 10 | yefx | char(1) | 是 |  |  |  |

### wl_check

- 定义变体 2 个；展示的变体出现在 19 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | dwbm | char(20) | 是 |  |  |  |
| 2 | kmbm | varchar(30) | 是 |  |  |  |
| 3 | bz | char(6) | 是 |  |  |  |
| 4 | nc_jf | double | 是 |  |  |  |
| 5 | nc_df | double | 是 |  |  |  |
| 6 | nc_jqj | double | 是 |  |  |  |
| 7 | nc_jqd | double | 是 |  |  |  |
| 8 | wls | char(1) | 是 |  |  |  |
| 9 | wl_jf | double | 是 |  |  |  |
| 10 | wl_df | double | 是 |  |  |  |
| 11 | fbs | char(1) | 是 |  |  |  |
| 12 | yjd | char(1) | 是 |  |  |  |
| 13 | sresult | char(1) | 是 |  |  |  |

### wldj

- 主要相关窗口：出库单浏览
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_ck_ck`（chengben/main）

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | lx | char(6) | 是 |  |  |  |
| 2 | dh | char(10) | 是 |  |  |  |
| 3 | rq | date | 是 |  |  |  |
| 4 | htbh | char(10) | 是 |  |  |  |
| 5 | khbh | char(10) | 是 |  |  |  |
| 6 | jf | double | 是 |  |  |  |
| 7 | df | double | 是 |  |  |  |
| 8 | zy | char(20) | 是 |  |  |  |
| 9 | bz1 | char(1) | 是 |  |  |  |
| 10 | xh | integer | 是 |  |  |  |
| 11 | htlb | char(1) | 是 |  |  |  |
| 12 | bz | char(4) | 是 |  |  |  |
| 13 | wbjf | double | 是 |  |  |  |
| 14 | wbdf | double | 是 |  |  |  |
| 15 | dqrq | date | 是 |  |  |  |
| 16 | pjlb | char(2) | 是 |  |  |  |
| 17 | pjdh | char(10) | 是 |  |  |  |
| 18 | cpbh | char(20) | 是 |  |  |  |
| 19 | fpjf | double | 是 |  |  |  |
| 20 | fpdf | double | 是 |  |  |  |

### wldj_lx

- 定义变体 2 个；展示的变体出现在 34 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | lx | char(6) | 否 |  | 1 |  |
| 2 | kmbm | char(20) | 是 |  |  |  |

### wlhz

- 主要相关窗口：系统初始化--执行操作、一键初始
- 定义变体 2 个；展示的变体出现在 59 个模板中。
- 使用窗口：`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）、`w_xt_wh`（chengben/main）、`w_xt_kgzb_2`（minfeiqi/main）、`w_xt_kgzb_3`（minfeiqi/main）、`w_xt_wh`（minfeiqi/main）、`w_xt_kgzb_2`（qingsong/main）、`w_xt_kgzb_3`（qingsong/main）、`w_xt_wh`（qingsong/main）
- 数据窗口：`dw_wl_1_prt`、`dw_wl_wlhz`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | dwbm | char(10) | 是 |  |  | 代码、客户代码 |
| 2 | pz_ph | char(8) | 是 |  |  | 票据单号 |
| 3 | pzrq | date | 是 |  |  | 日期 |
| 4 | dqrq | date | 是 |  |  | 到期日期 |
| 5 | pz_jf | double | 是 |  |  | 借方金额 |
| 6 | pz_df | double | 是 |  |  | 贷方金额 |
| 7 | pz_wb | double | 是 |  |  |  |
| 8 | bz | char(6) | 是 |  |  |  |

### wlxx

- 主要相关窗口：系统初始化--执行操作、一键初始
- 定义变体 3 个；展示的变体出现在 34 个模板中。
- 使用窗口：`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）、`w_xt_wh`（chengben/main）、`w_zh_zhjc`（chengben/main）、`w_zh_zhjc_kzrq`（chengben/main）、`w_zw_fgz`（chengben/main）、`w_zw_jz`（chengben/main）、`w_zw_jz_pl`（chengben/main）、`w_xt_kgzb_2`（minfeiqi/main）、`w_xt_kgzb_3`（minfeiqi/main）、`w_xt_wh`（minfeiqi/main）、`w_zh_zhjc`（minfeiqi/main）、`w_zh_zhjc_kzrq`（minfeiqi/main）、`w_zw_fgz`（minfeiqi/main）、`w_zw_jz`（minfeiqi/main）、`w_zw_jz_pl`（minfeiqi/main）、`w_xt_kgzb_2`（qingsong/main）、`w_xt_kgzb_3`（qingsong/main）、`w_xt_wh`（qingsong/main）、`w_zh_zhjc`（qingsong/main）……共 24 个
- 数据窗口：`dw_wl_1_wlxx`、`dw_wl_qcxx`、`dw_wl_qcxx_prt`、`dw_wl_wlxx`、`dw_wl_wlxx_prt`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | nf | integer | 是 |  |  | 年 |
| 2 | yf | integer | 是 |  |  | 月 |
| 3 | pzlx | smallint | 是 |  |  | 凭证类型 |
| 4 | pzbh | integer | 是 |  |  | 凭证编号 |
| 5 | pz_xh | integer | 是 |  |  | 凭证序号 |
| 6 | pz_zy | varchar(80) | 是 |  |  | 摘要、摘     要 |
| 7 | pz_jf | double | 是 |  |  | 借方金额 |
| 8 | pz_df | double | 是 |  |  | 贷方金额 |
| 9 | pz_wb | double | 是 |  |  | 外币金额 |
| 10 | pz_ph | char(8) | 是 |  |  | 票据单号 |
| 11 | dwbm | char(10) | 是 |  |  | 代码、客户名称、客户 |
| 12 | bz | char(6) | 是 |  |  | 币种 |
| 13 | dqrq | date | 是 |  |  | 到期日期 |
| 14 | pzrq | date | 是 |  |  | 日期 |
| 15 | qcbz | char(1) | 是 |  |  | 期初标志 |

### wlxx_nc

- 定义变体 2 个；展示的变体出现在 20 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | o_nf | integer | 是 |  |  |  |
| 2 | nf | integer | 是 |  |  |  |
| 3 | yf | integer | 是 |  |  |  |
| 4 | pzlx | integer | 是 |  |  |  |
| 5 | pzbh | integer | 是 |  |  |  |
| 6 | pz_xh | integer | 是 |  |  |  |
| 7 | pz_zy | varchar(200) | 是 |  |  |  |
| 8 | pz_jf | numeric(18,2) | 是 |  |  |  |
| 9 | pz_df | numeric(18,2) | 是 |  |  |  |
| 10 | pz_wb | float | 是 |  |  |  |
| 11 | pz_ph | char(20) | 是 |  |  |  |
| 12 | dwbm | char(20) | 是 |  |  |  |
| 13 | bz | char(6) | 是 |  |  |  |
| 14 | dqrq | date | 是 |  |  |  |
| 15 | pzrq | date | 是 |  |  |  |
| 16 | qcbz | char(1) | 是 |  |  |  |
| 17 | kmbm | varchar(30) | 是 |  |  |  |

### xh_fyda

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | fybh | char(2) | 否 |  | 1 |  |
| 2 | fymc | char(40) | 是 |  |  |  |
| 3 | kmbm | varchar(30) | 是 |  |  |  |

### xh_fylb

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ghbh | char(4) | 是 |  |  |  |
| 2 | fybh | char(2) | 是 |  |  |  |
| 3 | xh | integer | 是 |  |  |  |
| 4 | rq | date | 是 |  |  |  |
| 5 | zy | char(40) | 是 |  |  |  |
| 6 | zyxh | integer | 是 |  |  |  |
| 7 | jf | double | 是 |  |  |  |
| 8 | df | double | 是 |  |  |  |
| 9 | ye | double | 是 |  |  |  |
| 10 | dykm | char(20) | 是 |  |  |  |
| 11 | jbr | char(10) | 是 |  |  |  |
| 12 | czr | char(10) | 是 |  |  |  |
| 13 | bz | integer | 是 |  |  |  |

### xh_ghda

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ghbh | char(4) | 否 |  | 1 |  |
| 2 | ghmc | char(40) | 是 |  |  |  |
| 3 | mm | char(6) | 是 |  |  |  |

### xh_zyda

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | zyxh | integer | 否 |  | 1 |  |
| 2 | zynr | char(40) | 是 |  |  |  |

### xjll_xm

- 主要相关窗口：凭证录入、数据导出
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_saveas`（chengben/main）、`w_ini_bf`（chengben/main）、`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzedit_bak`（chengben/main）、`w_pz_pzedit_mb`（chengben/main）、`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）、`w_xt_wh`（chengben/main）、`w_xt_xjwh`（chengben/main）、`w_zc_xjll_1`（chengben/main）、`w_bb_saveas`（minfeiqi/main）、`w_ini_bf`（minfeiqi/main）、`w_pz_pzedit`（minfeiqi/main）、`w_pz_pzedit_b`（minfeiqi/main）、`w_pz_pzedit_bak`（minfeiqi/main）、`w_pz_pzedit_mb`（minfeiqi/main）、`w_xt_kgzb_2`（minfeiqi/main）、`w_xt_kgzb_3`（minfeiqi/main）……共 35 个
- 数据窗口：`dw_ini_xjll_xm`、`dw_xt_xjll`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xjbm | char(4) | 否 |  | 1 | 编号 |
| 2 | xjmc | char(40) | 是 |  |  | 名称 |
| 3 | jd | char(1) | 是 |  |  |  |

### xlk

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xlm | char(3) | 否 |  | 1 |  |
| 2 | xlmc | char(30) | 是 |  |  |  |

### xm_file

- 定义变体 1 个；展示的变体出现在 2 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xmbm | varchar(20) | 否 |  | 1 |  |
| 2 | cellfile | long binary | 是 |  |  |  |

### xmgm

- 定义变体 1 个；展示的变体出现在 20 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh | char(2) | 否 |  | 1 |  |
| 2 | mc | char(20) | 是 |  |  |  |

### xmk

- 主要相关窗口：打印凭证-1、三栏明细账
- 定义变体 4 个；展示的变体出现在 29 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_main1`（chengben/fp）、`w_main1_cb`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_def_help`（chengben/main）、`w_bb_proc`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_fx_zl`（chengben/main）、`w_main1`（chengben/main）、`w_main1_cb`（chengben/main）、`w_pz_flxx1`（chengben/main）、`w_pz_jccx_1`（chengben/main）、`w_pz_prn_1`（chengben/main）、`w_pz_prn_1_a4`（chengben/main）、`w_pz_prn_1_bak`（chengben/main）、`w_pz_prn_2`（chengben/main）、`w_pz_prn_3`（chengben/main）、`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzedit_bak`（chengben/main）……共 120 个
- 数据窗口：`dw_xt_xm_ye`、`dw_xt_xmwbye_prt`、`dw_xt_xmwh`、`dw_xt_xmye_prt`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xmbm | char(10) | 是 |  |  | 项目编码 |
| 2 | xm_mc | char(20) | 是 |  |  | 项目名称 |
| 3 | bz | char(1) | 是 |  |  | 在用 |

### xmlx

- 定义变体 1 个；展示的变体出现在 19 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh | char(2) | 否 |  | 1 |  |
| 2 | mc | char(20) | 是 |  |  |  |

### xmnc

- 主要相关窗口：三栏明细账、多栏账
- 定义变体 3 个；展示的变体出现在 33 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_fx_zl`（chengben/main）、`w_test`（chengben/main）、`w_xt_kgzb_2`（chengben/main）、`w_xt_kgzb_3`（chengben/main）、`w_xt_kmbm_edit_bak`（chengben/main）、`w_xt_kmbm_get`（chengben/main）、`w_xt_kmbm_len_bak`（chengben/main）、`w_xt_kmbm_replace_bak`（chengben/main）、`w_xt_kmwh`（chengben/main）、`w_xt_kmwh_1`（chengben/main）、`w_xt_wh`（chengben/main）、`w_xt_xmnc`（chengben/main）、`w_xt_xmwh`（chengben/main）、`w_zc_fhdlz_1`（chengben/main）、`w_zc_fhdlz_1_bak`（chengben/main）、`w_zc_fhslz_1`（chengben/main）、`w_zc_fhslz_1_bak`（chengben/main）……共 88 个
- 数据窗口：`dw_xt_xm_ye`、`dw_xt_xmwbye_prt`、`dw_xt_xmye_prt`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | kmbm | char(20) | 是 |  |  | 科目编码 |
| 2 | xmbm | char(10) | 是 |  |  | 项目编码 |
| 3 | bz | char(6) | 是 |  |  | 币种 |
| 4 | nc_jf | double | 是 |  |  | 年初借方余额 |
| 5 | nc_df | double | 是 |  |  | 年初贷方余额 |
| 6 | jq_jf | double | 是 |  |  | 帐前借方发生额 |
| 7 | jq_df | double | 是 |  |  | 帐前贷方发生额 |
| 8 | fbs | char(1) | 是 |  |  |  |
| 9 | ys | double | 是 |  |  |  |
| 10 | nc_jf_b | double | 是 |  |  | 年初借方本位币、年初借方(本) |
| 11 | nc_df_b | double | 是 |  |  | 年初贷方本位币、年初贷方(本) |
| 12 | jq_jf_b | double | 是 |  |  | 帐前借方本位币、帐前借方(本) |
| 13 | jq_df_b | double | 是 |  |  | 帐前贷方(本) |
| 14 | nf | integer | 是 |  |  |  |

### xmxz

- 定义变体 1 个；展示的变体出现在 19 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh | char(2) | 否 |  | 1 |  |
| 2 | mc | char(20) | 是 |  |  |  |

### xt

- 主要相关窗口：三栏明细账、用户登录
- 定义变体 4 个；展示的变体出现在 32 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_fp_fjz`（chengben/fp）、`w_fp_fz`（chengben/fp）、`w_fp_hz`（chengben/fp）、`w_fp_hz_bak`（chengben/fp）、`w_fp_khhz_2`（chengben/fp）、`w_fp_lr_2`（chengben/fp）、`w_fp_preview`（chengben/fp）、`w_fp_pz`（chengben/fp）、`w_fp_pz_bak`（chengben/fp）、`w_fp_pz_ckd`（chengben/fp）、`w_fp_pz_hz`（chengben/fp）、`w_fp_pz_sz`（chengben/fp）、`w_fp_sz`（chengben/fp）、`w_fp_sz_2`（chengben/fp）、`w_fp_xtcsh`（chengben/fp）、`w_fp_zzs_hz`（chengben/fp）、`w_login`（chengben/fp）、`w_login_oem`（chengben/fp）、`w_login_qhmk`（chengben/fp）……共 322 个
- 数据窗口：`dw_ini_xt`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | mc | char(11) | 是 |  |  |  |
| 2 | nr | varchar(100) | 是 |  |  |  |

### xt_data

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | mc | char(15) | 是 |  |  |  |
| 2 | nr | varchar(40) | 是 |  |  |  |
| 3 | sm | varchar(40) | 是 |  |  |  |

### ydjz

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pz_xh | integer | 是 |  |  |  |
| 2 | zy | varchar(80) | 是 |  |  |  |
| 3 | kmbm | varchar(30) | 是 |  |  |  |
| 4 | jd | char(1) | 是 |  |  |  |
| 5 | iobz | char(1) | 是 |  |  |  |
| 6 | ye | char(1) | 是 |  |  |  |
| 7 | zclx | char(1) | 是 |  |  |  |
| 8 | bl | double | 是 |  |  |  |
| 9 | jzlx | char(2) | 是 |  |  |  |
| 10 | sfun | varchar(500) | 是 |  |  |  |
| 11 | sval | numeric(18,2) | 是 |  |  |  |

### ydjztp

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | jzlx | char(2) | 是 |  |  |  |
| 2 | pzlx | smallint | 是 |  |  |  |
| 3 | jc | varchar(30) | 是 |  |  |  |
| 4 | stopbz | char(1) | 是 |  |  |  |
| 5 | sortid | integer | 是 |  |  |  |
| 6 | lx | char(1) | 是 |  |  |  |

### ye_cross

- 定义变体 1 个；展示的变体出现在 20 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bm1 | char(20) | 否 |  | 1 |  |
| 2 | bm1_mc | char(80) | 是 |  |  |  |
| 3 | bm2 | char(20) | 否 |  | 2 |  |
| 4 | bm2_mc | char(80) | 是 |  |  |  |
| 5 | bm3 | char(20) | 否 |  | 3 |  |
| 6 | bm3_mc | char(80) | 是 |  |  |  |
| 7 | bm4 | char(20) | 否 |  | 4 |  |
| 8 | bm4_mc | char(80) | 是 |  |  |  |
| 9 | bm5 | char(20) | 否 |  | 5 |  |
| 10 | bm5_mc | char(80) | 是 |  |  |  |
| 11 | bm6 | char(20) | 否 |  | 6 |  |
| 12 | bm6_mc | char(80) | 是 |  |  |  |
| 13 | qcye | double | 是 |  |  |  |
| 14 | qcwbye | double | 是 |  |  |  |
| 15 | qc_hl | double | 是 |  |  |  |
| 16 | bq_jf | double | 是 |  |  |  |
| 17 | bq_jfwb | double | 是 |  |  |  |
| 18 | bq_df | double | 是 |  |  |  |
| 19 | bq_dfwb | double | 是 |  |  |  |
| 20 | lj_jf | double | 是 |  |  |  |
| 21 | lj_jfwb | double | 是 |  |  |  |
| 22 | lj_df | double | 是 |  |  |  |
| 23 | lj_dfwb | double | 是 |  |  |  |
| 24 | jy_je | double | 是 |  |  |  |
| 25 | jy_hl | double | 是 |  |  |  |
| 26 | jy_wb | double | 是 |  |  |  |
| 27 | yjd | char(1) | 是 |  |  |  |
| 28 | bmjs | integer | 否 |  | 7 |  |
| 29 | bz | char(6) | 否 |  | 8 |  |

### yh_yt

- 定义变体 1 个；展示的变体出现在 8 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | yt | char(10) | 是 |  |  |  |
| 2 | bz | char(1) | 是 |  |  |  |
| 3 | sm | char(40) | 是 |  |  |  |

### yhdzd

- 主要相关窗口：数据导出、格式定义
- 定义变体 2 个；展示的变体出现在 34 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_xt_kmbm_edit_bak`（chengben/main）、`w_xt_kmbm_get`（chengben/main）、`w_xt_kmbm_len_bak`（chengben/main）、`w_xt_kmbm_replace_bak`（chengben/main）、`w_zh_zhjc`（chengben/main）、`w_bb_def_cn`（minfeiqi/main）、`w_bb_saveas`（minfeiqi/main）、`w_xt_kmbm_edit_bak`（minfeiqi/main）、`w_xt_kmbm_get`（minfeiqi/main）、`w_xt_kmbm_len_bak`（minfeiqi/main）、`w_xt_kmbm_replace_bak`（minfeiqi/main）、`w_zh_zhjc`（minfeiqi/main）、`w_bb_saveas`（qingsong/fp）、`w_bb_def_cn`（qingsong/main）、`w_bb_saveas`（qingsong/main）、`w_xt_kmbm_edit_bak`（qingsong/main）、`w_xt_kmbm_get`（qingsong/main）……共 23 个

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | dzd_xh | integer | 是 |  |  |  |
| 2 | rq | date | 是 |  |  |  |
| 3 | kmbm | char(20) | 是 |  |  |  |
| 4 | jf | double | 是 |  |  |  |
| 5 | df | double | 是 |  |  |  |
| 6 | jslb | char(2) | 是 |  |  |  |
| 7 | pz_ph | char(8) | 是 |  |  |  |
| 8 | dzbz | char(1) | 是 |  |  |  |
| 9 | dzbh | integer | 是 |  |  |  |
| 10 | pz_dzd_bz | char(1) | 是 |  |  |  |
| 11 | csh_bz | char(1) | 是 |  |  |  |

### ysda

- 主要相关窗口：数据导出、格式定义
- 定义变体 2 个；展示的变体出现在 34 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_xt_kmbm_get`（chengben/main）、`w_zh_zhjc`（chengben/main）、`w_bb_def_cn`（minfeiqi/main）、`w_bb_saveas`（minfeiqi/main）、`w_xt_kmbm_get`（minfeiqi/main）、`w_zh_zhjc`（minfeiqi/main）、`w_bb_saveas`（qingsong/fp）、`w_bb_def_cn`（qingsong/main）、`w_bb_saveas`（qingsong/main）、`w_xt_kmbm_get`（qingsong/main）、`w_zh_zhjc`（qingsong/main）

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xh | integer | 是 |  |  |  |
| 2 | ysbh | char(10) | 是 |  |  |  |
| 3 | yssm | char(30) | 是 |  |  |  |
| 4 | nf | integer | 是 |  |  |  |
| 5 | yf | integer | 是 |  |  |  |
| 6 | je | numeric(20,4) | 是 |  |  |  |
| 7 | kmbm | char(20) | 是 |  |  |  |
| 8 | je1 | numeric(20,4) | 是 |  |  |  |
| 9 | lx | char(1) | 是 |  |  |  |
| 10 | yefx | char(1) | 是 |  |  |  |

### ysk

- 定义变体 2 个；展示的变体出现在 20 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ysbm | integer | 否 |  | 1 |  |
| 2 | ysmc | varchar(64) | 是 |  |  |  |
| 3 | kmbm | varchar(30) | 是 |  |  |  |
| 4 | xmbm | char(20) | 是 |  |  |  |
| 5 | dwbm | char(20) | 是 |  |  |  |
| 6 | bmbm | char(20) | 是 |  |  |  |
| 7 | grbm | char(20) | 是 |  |  |  |
| 8 | ystj | varchar(1024) | 是 |  |  |  |
| 9 | bdate | date | 是 |  |  |  |
| 10 | edate | date | 是 |  |  |  |
| 11 | jdfx | char(1) | 是 |  |  |  |
| 12 | canover | char(1) | 是 |  |  |  |
| 13 | tsnr | varchar(128) | 是 |  |  |  |
| 14 | istop | smallint | 是 |  |  |  |

### yt

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | yt | char(10) | 是 |  |  |  |
| 2 | bz | char(1) | 是 |  |  |  |

### zc_fbb

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh1 | char(20) | 是 |  |  |  |
| 2 | bh2 | char(20) | 是 |  |  |  |
| 3 | je | double | 是 |  |  |  |

### zc_fssb

- 主要相关窗口：固定资产台帐、固定资产初始化
- 定义变体 2 个；展示的变体出现在 55 个模板中。
- 使用窗口：`w_print_tz`（chengben/main）、`w_xt_kgzb_zc`（chengben/main）、`w_zc_zcgl`（chengben/main）、`w_zcgl_kp`（chengben/main）、`w_zcgl_kp_fssb`（chengben/main）、`w_print_tz`（minfeiqi/main）、`w_xt_kgzb_zc`（minfeiqi/main）、`w_zc_zcgl`（minfeiqi/main）、`w_zcgl_kp`（minfeiqi/main）、`w_zcgl_kp_fssb`（minfeiqi/main）
- 数据窗口：`dw_fssb`、`dw_fssb_prt`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh | char(10) | 是 |  |  | 设备编号 |
| 2 | fsbh | char(4) | 是 |  |  | 编号 |
| 3 | fsmc | char(20) | 是 |  |  | 名称、附属设备名称 |
| 4 | fssl | integer | 是 |  |  | 数量 |
| 5 | fsdj | double | 是 |  |  | 单价 |
| 6 | fsje | double | 是 |  |  | 金额 |
| 7 | sm | char(20) | 是 |  |  | 说明 |

### zc_ft_pcs

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | pcs_bh | char(4) | 否 |  | 1 |  |
| 2 | pcs_mc | char(20) | 是 |  |  |  |

### zc_gdzc

- 主要相关窗口：数据导出、用户登录
- 定义变体 4 个；展示的变体出现在 47 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_saveas`（chengben/main）、`w_hf`（chengben/main）、`w_login`（chengben/main）、`w_login_qhmk`（chengben/main）、`w_preview_zc_mxz`（chengben/main）、`w_print_tz`（chengben/main）、`w_pz_build`（chengben/main）、`w_test`（chengben/main）、`w_tzjl_get`（chengben/main）、`w_tzjl_get_all`（chengben/main）、`w_xt_kgzb_zc`（chengben/main）、`w_xt_kmwh_copy`（chengben/main）、`w_zc_dz`（chengben/main）、`w_zc_qxfz`（chengben/main）、`w_zc_sblb_bak`（chengben/main）、`w_zc_sbyt_bak`（chengben/main）、`w_zc_sbzt_bak`（chengben/main）、`w_zc_sbzx_bak`（chengben/main）、`w_zc_sydw_bak`（chengben/main）……共 62 个
- 数据窗口：`dw_fssb_prt`、`dw_zc_grid_xz`、`dw_zc_grid_zx`、`dw_zcb_prt`、`dw_zcb_prt_1`、`dw_zcb_prt_2`、`dw_zcb_prt_3`、`dw_zcgl`、`dw_zcgl_fb_1`、`dw_zcgl_kp`、`dw_zcgl_label`、`dw_zctz_prt`、`dw_zjgl`、`dw_zjgl_prt`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh | char(10) | 是 |  |  | 设备编号、编号 |
| 2 | mc | char(30) | 是 |  |  | 设备名称、名称 |
| 3 | sblb | char(4) | 是 |  |  | 类别、设备类别、类  别 |
| 4 | sbzt | char(2) | 是 |  |  | 状态、设备状态 |
| 5 | sydw | char(4) | 是 |  |  | 使用部门、使用单位 |
| 6 | gzrq | date | 是 |  |  | 购置日期 |
| 7 | yz | double | 是 |  |  | 原值、设备原值、原   值 |
| 8 | czl | double | 是 |  |  | 残值率、预计残值率 |
| 9 | yzcz | double | 是 |  |  | 预计残值 |
| 10 | syrq | date | 是 |  |  | 使用日期 |
| 11 | zjff | char(1) | 是 |  |  | 折旧方法、提折旧方法 |
| 12 | synx | integer | 是 |  |  | 使用年限、使用年限(月) |
| 13 | zgzl | double | 是 |  |  | 总工作量 |
| 14 | bz | char(60) | 是 |  |  | 规格型号、备注 |
| 15 | ytbh | char(4) | 是 |  |  | 用途 |
| 16 | ygzl | double | 是 |  |  | 月工作量 |
| 17 | yzje | double | 是 |  |  | 月折旧额 |
| 18 | ljzjy | integer | 是 |  |  | 累计折旧月 |
| 19 | ljgzl | double | 是 |  |  | 累计工作量 |
| 20 | ljzje | double | 是 |  |  | 累计折旧额、累计折旧 |
| 21 | sbbz | char(1) | 是 |  |  | 标志、设备标志 |
| 22 | zxyy | char(2) | 是 |  |  | 注销原因 |
| 23 | zxrq | date | 是 |  |  | 注销日期 |
| 24 | zcjz | double | 是 |  |  | 净值、资产净值、累计折旧额 |
| 25 | zjjt | char(14) | 是 |  |  |  |
| 26 | bjbh | char(15) | 是 |  |  | 本机编号 |
| 27 | wbbz | char(6) | 是 |  |  | 币种 |
| 28 | wbje | double | 是 |  |  | 外币金额 |
| 29 | zccm | char(20) | 是 |  |  | 制造厂名 |
| 30 | azdd | char(20) | 是 |  |  | 安装地点 |
| 31 | zcrq | date | 是 |  |  | 制造日期 |
| 32 | dw | char(4) | 是 |  |  | 单位 |
| 33 | sl | integer | 是 |  |  | 数量、台数 |
| 34 | ckbh | char(15) | 是 |  |  | 参考编号 |
| 35 | synx_y | integer | 是 |  |  | 使用年限(月) |

### zc_pic

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh | char(10) | 是 |  |  |  |
| 2 | pic | long binary | 是 |  |  |  |

### zc_sbbd

- 主要相关窗口：从其他套帐转入科目、固定资产初始化
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_xt_kgzb_zc`（chengben/main）、`w_xt_kmwh_copy`（chengben/main）、`w_xt_kgzb_zc`（minfeiqi/main）、`w_xt_kmwh_copy`（minfeiqi/main）、`w_xt_kmwh_copy`（qingsong/main）

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh | char(10) | 是 |  |  |  |
| 2 | bdxm | char(1) | 是 |  |  |  |
| 3 | oldvalue | double | 是 |  |  |  |
| 4 | newvalue | double | 是 |  |  |  |
| 5 | rq | date | 是 |  |  |  |
| 6 | czr | char(10) | 是 |  |  |  |

### zc_sblb

- 主要相关窗口：数据导出、资产分布表
- 定义变体 3 个；展示的变体出现在 34 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_pz_build`（chengben/main）、`w_xt_kgzb_zc`（chengben/main）、`w_xt_kmbm_get`（chengben/main）、`w_xt_kmwh_copy`（chengben/main）、`w_zc_sblb`（chengben/main）、`w_zc_sblb_bak`（chengben/main）、`w_zc_zcgl`（chengben/main）、`w_zcgl_fb`（chengben/main）、`w_zcgl_fb_bak`（chengben/main）、`w_zcgl_kp`（chengben/main）、`w_zh_zhjc`（chengben/main）、`w_zjgl_fb`（chengben/main）、`w_bb_def_cn`（minfeiqi/main）、`w_bb_saveas`（minfeiqi/main）、`w_pz_build`（minfeiqi/main）、`w_xt_kgzb_zc`（minfeiqi/main）、`w_xt_kmbm_get`（minfeiqi/main）……共 35 个
- 数据窗口：`dw_sblb`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | sblb | char(4) | 是 |  |  | 类别 |
| 2 | mc | char(14) | 是 |  |  | 名称 |
| 3 | czl | double | 是 |  |  |  |
| 4 | kmbm | char(20) | 是 |  |  |  |

### zc_sbly

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | lybh | char(2) | 否 |  | 1 |  |
| 2 | lymc | char(10) | 是 |  |  |  |

### zc_sbyt

- 主要相关窗口：数据导出、用途维护
- 定义变体 2 个；展示的变体出现在 34 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_def_cn`（chengben/main）、`w_bb_saveas`（chengben/main）、`w_pz_build`（chengben/main）、`w_xt_kgzb_zc`（chengben/main）、`w_xt_kmbm_get`（chengben/main）、`w_xt_kmwh_copy`（chengben/main）、`w_zc_sbyt`（chengben/main）、`w_zc_sbyt_bak`（chengben/main）、`w_zc_zcgl`（chengben/main）、`w_zcgl_kp`（chengben/main）、`w_zh_zhjc`（chengben/main）、`w_bb_def_cn`（minfeiqi/main）、`w_bb_saveas`（minfeiqi/main）、`w_pz_build`（minfeiqi/main）、`w_xt_kgzb_zc`（minfeiqi/main）、`w_xt_kmbm_get`（minfeiqi/main）、`w_xt_kmwh_copy`（minfeiqi/main）、`w_zc_sbyt`（minfeiqi/main）、`w_zc_sbyt_bak`（minfeiqi/main）……共 29 个
- 数据窗口：`dw_sbyt`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ytbh | char(4) | 否 |  | 1 | 编号 |
| 2 | yt_mc | char(20) | 是 |  |  | 用途 |
| 3 | kmbm | char(20) | 是 |  |  | 对应折旧分配科目 |

### zc_sbzt

- 主要相关窗口：数据导出、从其他套帐转入科目
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_saveas`（chengben/main）、`w_pz_build`（chengben/main）、`w_xt_kmwh_copy`（chengben/main）、`w_zc_sbzt`（chengben/main）、`w_zc_sbzt_bak`（chengben/main）、`w_zc_zcgl`（chengben/main）、`w_zcgl_kp`（chengben/main）、`w_zjjs`（chengben/main）、`w_bb_saveas`（minfeiqi/main）、`w_pz_build`（minfeiqi/main）、`w_xt_kmwh_copy`（minfeiqi/main）、`w_zc_sbzt`（minfeiqi/main）、`w_zc_sbzt_bak`（minfeiqi/main）、`w_zc_zcgl`（minfeiqi/main）、`w_zcgl_kp`（minfeiqi/main）、`w_zjjs`（minfeiqi/main）、`w_bb_saveas`（qingsong/fp）、`w_bb_saveas`（qingsong/main）、`w_xt_kmwh_copy`（qingsong/main）
- 数据窗口：`dw_sbzt`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | sbzt | char(2) | 否 |  | 1 | 编号 |
| 2 | sbzt_mc | char(20) | 是 |  |  | 状态 |
| 3 | zjjt | char(1) | 是 |  |  | 是否折旧 |

### zc_sbzx

- 主要相关窗口：固定资产明细账打印、生成凭证
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_preview_zc_mxz`（chengben/main）、`w_pz_build`（chengben/main）、`w_xt_kgzb_zc`（chengben/main）、`w_zc_sbzx`（chengben/main）、`w_zc_sbzx_bak`（chengben/main）、`w_zcgl_delete`（chengben/main）、`w_preview_zc_mxz`（minfeiqi/main）、`w_pz_build`（minfeiqi/main）、`w_xt_kgzb_zc`（minfeiqi/main）、`w_zc_sbzx`（minfeiqi/main）、`w_zc_sbzx_bak`（minfeiqi/main）、`w_zcgl_delete`（minfeiqi/main）
- 数据窗口：`dw_zxyy`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | zxyy | char(2) | 否 |  | 1 | 编号 |
| 2 | zx_sm | char(20) | 是 |  |  | 注销原因 |

### zc_sydw

- 主要相关窗口：数据导出、部门维护
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_bb_saveas`（chengben/fp）、`w_bb_saveas`（chengben/main）、`w_xt_kgzb_zc`（chengben/main）、`w_xt_kmwh_copy`（chengben/main）、`w_zc_sydw`（chengben/main）、`w_zc_sydw_bak`（chengben/main）、`w_zc_zcgl`（chengben/main）、`w_zcgl_fb`（chengben/main）、`w_zcgl_fb_bak`（chengben/main）、`w_zjgl_fb`（chengben/main）、`w_bb_saveas`（minfeiqi/main）、`w_xt_kgzb_zc`（minfeiqi/main）、`w_xt_kmwh_copy`（minfeiqi/main）、`w_zc_sydw`（minfeiqi/main）、`w_zc_sydw_bak`（minfeiqi/main）、`w_zc_zcgl`（minfeiqi/main）、`w_zcgl_fb`（minfeiqi/main）、`w_zcgl_fb_bak`（minfeiqi/main）、`w_zjgl_fb`（minfeiqi/main）、`w_bb_saveas`（qingsong/fp）……共 22 个
- 数据窗口：`dw_sydw`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | sydw | char(4) | 否 |  | 1 | 编号 |
| 2 | dw_mc | char(20) | 是 |  |  | 部门名称 |

### zc_syr

- 定义变体 1 个；展示的变体出现在 11 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | syr | char(20) | 否 |  | 1 |  |

### zc_yzjb

- 主要相关窗口：用户登录、打印固定资产明细帐
- 定义变体 2 个；展示的变体出现在 58 个模板中。
- 使用窗口：`w_hf`（chengben/main）、`w_login`（chengben/main）、`w_login_qhmk`（chengben/main）、`w_preview_zc_mxz`（chengben/main）、`w_pz_build`（chengben/main）、`w_test`（chengben/main）、`w_tzjl_get`（chengben/main）、`w_tzjl_get_all`（chengben/main）、`w_xt_kgzb_zc`（chengben/main）、`w_xt_kmwh_copy`（chengben/main）、`w_zc_qxfz`（chengben/main）、`w_zc_sydw_bak`（chengben/main）、`w_zc_zcgl`（chengben/main）、`w_zcgl_fb`（chengben/main）、`w_zcgl_kp`（chengben/main）、`w_zcgl_prtmxz`（chengben/main）、`w_zcgl_prtmxz_bak`（chengben/main）、`w_zjgl`（chengben/main）、`w_zjgl_fb`（chengben/main）、`w_zjjs`（chengben/main）……共 43 个
- 数据窗口：`dw_mxz_prt`、`dw_zjgl`、`dw_zjgl_prt`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | nf | integer | 是 |  |  | 年 |
| 2 | yf | integer | 是 |  |  | 月 |
| 3 | bh | char(10) | 是 |  |  | 设备编号 |
| 4 | sydw | char(4) | 是 |  |  | 使用部门、摘要 |
| 5 | ytbh | char(4) | 是 |  |  | 用途 |
| 6 | zjff | char(1) | 是 |  |  | 折旧方法 |
| 7 | yzjl | double | 是 |  |  | 累计折旧额 |
| 8 | ygzl | double | 是 |  |  | 月工作量、净值 |
| 9 | yzje | double | 是 |  |  | 月折旧额 |
| 10 | ckbh | char(15) | 是 |  |  | 参考编号 |
| 11 | ljzje | double | 是 |  |  |  |

### zc_yzzj

- 主要相关窗口：原值调整、固定资产明细账打印
- 定义变体 2 个；展示的变体出现在 19 个模板中。
- 使用窗口：`w_preview_zc_mxz`（chengben/main）、`w_xt_kgzb_zc`（chengben/main）、`w_zc_qxfz`（chengben/main）、`w_zc_zcgl`（chengben/main）、`w_zcgl_kp`（chengben/main）、`w_zcgl_yztz`（chengben/main）、`w_zcgl_yztz_cx`（chengben/main）、`w_zjjs`（chengben/main）、`w_preview_zc_mxz`（minfeiqi/main）、`w_xt_kgzb_zc`（minfeiqi/main）、`w_zc_qxfz`（minfeiqi/main）、`w_zc_zcgl`（minfeiqi/main）、`w_zcgl_kp`（minfeiqi/main）、`w_zcgl_yztz`（minfeiqi/main）、`w_zcgl_yztz_cx`（minfeiqi/main）、`w_zjjs`（minfeiqi/main）
- 数据窗口：`dw_zcgl_yztz`、`dw_zcgl_yztz_cx`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | xh | integer | 是 |  |  | Xh: |
| 2 | bh | char(10) | 是 |  |  | Bh: |
| 3 | ckbh | char(15) | 是 |  |  | Ckbh: |
| 4 | rq | date | 是 |  |  | 调整日期：、日期 |
| 5 | yz | double | 是 |  |  | 之前原值：、之前原值 |
| 6 | yzzje | double | 是 |  |  | 调整后的原值：、调整后原值 |
| 7 | sm | char(200) | 是 |  |  | 调整说明：、调整说明 |
| 8 | nf | integer | 是 |  |  |  |
| 9 | yf | integer | 是 |  |  |  |
| 10 | s1 | char(1) | 是 |  |  |  |

### zc_zcbdb

- 定义变体 1 个；展示的变体出现在 60 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | bh | char(10) | 是 |  |  |  |
| 2 | bdrq | date | 是 |  |  |  |
| 3 | sydw | char(12) | 是 |  |  |  |
| 4 | jgdw | char(12) | 是 |  |  |  |
| 5 | azdd | char(30) | 是 |  |  |  |
| 6 | xzdd | char(30) | 是 |  |  |  |
| 7 | sybgr | char(10) | 是 |  |  |  |
| 8 | xsybgr | char(10) | 是 |  |  |  |
| 9 | sl | integer | 是 |  |  |  |
| 10 | xsl | integer | 是 |  |  |  |
| 11 | je | double | 是 |  |  |  |
| 12 | xje | double | 是 |  |  |  |

### zjly

- 定义变体 1 个；展示的变体出现在 21 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | lybm | char(20) | 否 |  | 1 |  |
| 2 | ly_mc | varchar(40) | 是 |  |  |  |
| 3 | sm | varchar(128) | 是 |  |  |  |
| 4 | jdjs | smallint | 是 |  |  |  |
| 5 | yjd | char(1) | 是 |  |  |  |
| 6 | qc | varchar(90) | 是 |  |  |  |
| 7 | cstop | char(1) | 是 |  |  |  |

### zjnc

- 定义变体 1 个；展示的变体出现在 21 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | lybm | char(20) | 否 |  | 1 |  |
| 2 | kmbm | char(20) | 否 |  | 2 |  |
| 3 | nf | integer | 否 |  | 3 |  |
| 4 | bz | char(6) | 否 |  | 4 |  |
| 5 | nc_jf | double | 是 |  |  |  |
| 6 | nc_df | double | 是 |  |  |  |
| 7 | jq_jf | double | 是 |  |  |  |
| 8 | jq_df | double | 是 |  |  |  |
| 9 | fbs | char(1) | 是 |  |  |  |
| 10 | ys | double | 是 |  |  |  |
| 11 | nc_jf_b | double | 是 |  |  |  |
| 12 | nc_df_b | double | 是 |  |  |  |
| 13 | jq_jf_b | double | 是 |  |  |  |
| 14 | jq_df_b | double | 是 |  |  |  |
| 15 | yjd | char(1) | 是 |  |  |  |
| 16 | lj_jf | double | 是 |  |  |  |
| 17 | lj_df | double | 是 |  |  |  |
| 18 | lj_jf_b | double | 是 |  |  |  |
| 19 | lj_df_b | double | 是 |  |  |  |

### ztk

- 定义变体 1 个；展示的变体出现在 2 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ztbm | char(20) | 否 |  | 1 |  |
| 2 | zt_mc | varchar(60) | 是 |  |  |  |
| 3 | ztlb | varchar(8) | 是 |  |  |  |
| 4 | sm | varchar(128) | 是 |  |  |  |
| 5 | jdjs | smallint | 是 |  |  |  |
| 6 | yjd | char(1) | 是 |  |  |  |
| 7 | qc | varchar(90) | 是 |  |  |  |
| 8 | cstop | char(1) | 是 |  |  |  |
| 9 | rpton | char(1) | 是 |  |  |  |

### ztnr

- 定义变体 1 个；展示的变体出现在 2 个模板中。

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | ztbm | char(20) | 否 |  | 1 |  |
| 2 | nrbm | char(20) | 否 |  | 2 |  |
| 3 | ztlb | char(1) | 是 |  |  |  |

### zx_cbfpb

- 主要相关窗口：产品档案维护、凭证生成
- 定义变体 2 个；展示的变体出现在 48 个模板中。
- 使用窗口：`w_cb_cpda`（chengben/main）、`w_cb_pz`（chengben/main）

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | hzny | char(7) | 是 |  |  |  |
| 2 | sx | char(1) | 是 |  |  |  |
| 3 | ckbh | char(4) | 是 |  |  |  |
| 4 | cpbh | char(20) | 是 |  |  |  |
| 5 | jqxs | double | 是 |  |  |  |
| 6 | sl | double | 是 |  |  |  |
| 7 | fpje1 | double | 是 |  |  |  |
| 8 | fpje2 | double | 是 |  |  |  |
| 9 | fpje3 | double | 是 |  |  |  |
| 10 | dj | double | 是 |  |  |  |

### zyk

- 主要相关窗口：凭证录入、摘要管理
- 定义变体 1 个；展示的变体出现在 60 个模板中。
- 使用窗口：`w_pz_pzedit`（chengben/main）、`w_pz_pzedit_b`（chengben/main）、`w_pz_pzedit_bak`（chengben/main）、`w_pz_pzedit_mb`（chengben/main）、`w_xt_zy`（chengben/main）、`w_pz_pzedit`（minfeiqi/main）、`w_pz_pzedit_b`（minfeiqi/main）、`w_pz_pzedit_bak`（minfeiqi/main）、`w_pz_pzedit_mb`（minfeiqi/main）、`w_xt_zy`（minfeiqi/main）、`w_cn_lr_add`（qingsong/cn）、`w_xt_zy_cn`（qingsong/cn）、`w_pz_pzedit`（qingsong/main）、`w_pz_pzedit_b`（qingsong/main）、`w_pz_pzedit_bak`（qingsong/main）、`w_pz_pzedit_mb`（qingsong/main）、`w_xt_zy`（qingsong/main）
- 数据窗口：`dw_xt_zy_1`、`dw_xt_zy_2`

| # | 字段 | 类型 | 可空 | 默认 | 主键 | 中文（DW 标题） |
|---|---|---|---|---|---|---|
| 1 | zylb | char(8) | 是 |  |  | 摘要类别 |
| 2 | zybm | char(4) | 是 |  |  | 编码 |
| 3 | zydy | char(20) | 是 |  |  | 摘要短语 |
| 4 | usecut | char(1) | 是 |  |  |  |
| 5 | shortcut | char(10) | 是 |  |  |  |
