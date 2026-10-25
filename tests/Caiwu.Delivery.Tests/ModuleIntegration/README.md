# 真实模块合成闭环

`../validate-modules.sh` 创建独立 `/tmp/caiwu-managed-validation-*`，从主分支基线和固定作者 SHA 组合源代码。实际编译 Modules 子项目并调用 Summary、ClassificationJsonStore、CostWorksheetExport、TemplateStore、LocalOperatorService 原生接口，验证账套及四种附件备份后源继续修改、恢复全新实例、逐项内容/版本/hash、stale分类拒绝、独立身份管理权限和卸载保留。

只读已有仓库源文件；不分析安装器、不访问真实账套、不上传任何虚构身份备份。测试结束删除自己新建的临时数据根；报告只留合成断言和固定源 SHA。构建组合目录保留用于复核，不是最终用户数据目录。

独立主 Delivery 不引用尚未集成的业务模块；要构建本项目，先采纳固定作者模块，或运行上述组合脚本。宿主接法和边界见 `packaging-next/src/Caiwu.Delivery/MANAGED_MODULES.md`。
