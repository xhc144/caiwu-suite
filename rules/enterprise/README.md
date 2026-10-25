# 企业正式科目证据v2：具名数据已补强，数字表仍有空白

`current-official-evidence.json`新增25个可追溯正式具名科目定义，来源是已归档、同hash的财会〔2019〕6号附件2；没有重新下载该来源。每项有独立semanticId、名称、原文页码，`accountCode=null`、`normalDirection=null`，因为这份报表说明没有给数字编码和完整方向规则。semanticId是自研引用ID，不能打印成法定科目编号。

它与v1的9个工程编码样例分开。`packages/enterprise.json`通过 `officialNameEvidencePath`关联这份证据；原9个数字仍标工程样例，不能因新增25个正式名称便改标为官方已核验。25个名称也不是全部现行科目。

新增正式来源仅3份：2017收入准则通知、21页正式准则PDF、2018租赁准则通知，原始字节及hash入 `sources.json`。收入与租赁分主体实施、各自提前条件和对2006相关规则的替代分别记录，不能把2006原表原样称作2026现行。2019附件证明的新金融具名科目也单独记录，未拿2026征求稿补编号。

| 已核范围 | 仍未取得或未验 |
|---|---|
| 应收/坏账、固定资产/折旧/减值/清理、合同资产负债及成本减值、使用权资产/折旧/减值、租赁负债、债权/权益投资、管理费用、其他收益、信用减值损失、资产处置损益共25个名称的正式出处 | 2006正式一级数字表、2014后各现行出版物数字编码/主要账务处理、逐科目替代矩阵、全部累计解释及行业专项 |
| 2017收入通知及第28、41条，2018租赁通知的执行与替代安排 | 完整履约义务/计量/合同成本/租赁计算、新金融分类计量与预期信用损失、完整报表及生产认证 |

阻塞的确切行动是获取上海财政局2006指南原始RAR附件：
`https://czj.sh.gov.cn/resource/f9/f9a90a5ed4b940529d12e91da79edf9a/279ac7de8095a2e08a3f744aac428839.rar`。首次原始HTTP下载返回 **403 Forbidden**，已知未下载，已停止；没有加headers/cookies、改scheme/URL或找镜像重试。新发现的2006通知可由正常web读取，仅证明通知/附件入口存在。旧上海税务指南链接404，其他原文502/超时、一个HTTP200软404也逐项记入 `retrievalAttempts`；软404没有被当正式来源归档。之前的2016更名原始字节403也未重试。

这意味着“将9个工程编码全部补成有完整现行官方编号依据的科目表”目前**未完成**。不能从记忆、其他制度的相同数字、网络表格、名字或2026草案硬补。后续须正常取得获授权正式指南材料后按新版本补证；当前无待批准的远端写入，也不继续尝试被拒原文件。

只读API：

```python
from rules.enterprise_evidence import (
    load_enterprise_evidence,
    require_verified_enterprise_posting_chart,
)
evidence = load_enterprise_evidence()  # 25个正式名称；数字代码仍为None
require_verified_enterprise_posting_chart()  # 明确抛RuleError，防止把工程样例当正式记账种子
```

现有 `select_package`仅返回实验参考快照，不能据返回成功宣称正式编号、计量或生产合规通过。新增校验拒绝把这些null字段改成“熟悉的”编号/方向、用草案作当前依据、或抹掉未核编码清单。`rules/validate.py`明确输出 `verifiedNumericCodes=0` 和 `completeCurrentChart=false`。真实财务合规不能保证。
