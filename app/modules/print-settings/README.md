# 打印与导出

- `w_pz_prn_1/1_a4/2/3`：当前账套真实凭证预览，A4 每页 1/2/3 张、自定义纸张、续页、连续/合并、暂停和取消。
- `w_print/1/2/root`、`w_preview`：页码范围、跳页、缩放、打印本页/全部和 PDF；空记录、范围及截断检查。
- `w_print_zc/zc_pg`、`w_preview_zc`：总账、明细、现金/银行日记账，多科目页码、承前过次与手动奇偶页翻面。
- `w_xt_tz_zc`：当前账套独立的凭证/账册设置，保存即生效。
- `w_bb_main_gs/add_gs/copy_gs/def_gs`：安全结构化模板列表、新增、同账套复制、修改/改名、删除确认、未保存确认、字段预览与正附页。
- 入口 `/m/print-settings/preview?voucherId=…`，或 `?from=202601&to=202601&ids=3,1,2`；账册使用 `?mode=ledger&queried=1&account=1001,6603&kind=detail&from=202601&to=202601`。特殊格式 `/m/print-settings/formats?voucherId=…`。
- `@caiwu/print` 保留 W0 接口，追加纯数据 `buildVoucherView`、`buildLedgerView`、`buildLedgerBookView`、`buildTemplateView`、`viewToPrintJob` 和 `runPrintBatch`。
- 普通 HTML 宽表及毫米标签沿用 W0 调用。浏览器在 `afterprint` 后清理隐藏 iframe；E2E 应在打印事件捕获内容，再检查清理和再次输出，不能依赖点击后 iframe 仍在 DOM。
- 报表审核结果支持静态 `ul/li` 列表；属性、脚本、网络资源及危险样式继续按打印白名单拒绝。

未完成：任意单元格函数/合并单元格/逐行财务模板引擎、授权跨账套复制、旧格式文件导入、业务多栏/增值税/现金流量专用打印、全科目/一级/明细自动批选、壳关闭标签页的未保存拦截、Windows 实机打印及桌面 PDF 纸张联调。浏览器 PDF 需在系统打印对话框选择“另存为 PDF”。
