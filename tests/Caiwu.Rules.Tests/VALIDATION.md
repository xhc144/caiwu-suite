# 规则数据验证记录

2026-10-25，在基线 `97d696a3ee7adf100e24b4924438468bd34dd80c` 的独立分支 `codex/accounting-rules` 执行。仅修改规则及本测试目录。Python 3.12，jsonschema 4.26.0。没有dotnet命令，因此采用独立Python纯数据测试，不宣称.NET10、WPF或账务服务集成已验。

```text
python3 rules/validate.py
valid: true
packages: 3
accountCounts: SmallBusiness=66, Enterprise=9, Nonprofit=56
allVerifiedForProduction: false
completeMigrationValidated: false

python3 -m unittest discover -s tests/Caiwu.Rules.Tests -p 'test_*.py' -v
Ran 35 tests
OK
```

验证实际包含：四份JSON Schema及格式/额外字段/版本；UTF-8、重复JSON键、NaN；官方原始文件SHA-256/长度和包SHA-256；冻结一级编码集合、备抵科目方向、通常方向与反向业务边界；父级存在、层级段、孤儿/自环、父子属性；报表引用、父子重复取数、代表行Decimal分位与溢出、调用方低精度上下文隔离；小企业年度列和民非季/半年列；资格确认、旧期拒绝、草案禁选、新第30号三类主体2027/2029/2030边界和提前执行阻断；民非收入及费用的限定/非限定取数及结转路由、内部预算证据拒绝、5601待审；旧1701到新1801及费用编码位移、错误名称/版本/目标冲突、旧费用非零禁转、文物分类和未核旧科目阻断。

独立只读审查先复现了孤儿明细、Decimal上下文、报表期间列和企业名称来源/研发重分类问题；修复后另一次35项运行通过。源PDF、研究和官方网页由只读证据核查任务交叉核对；程序验证不能证明所有会计语义、整个制度实现或真实财务合规。

代表行输入是合成的已汇总事实，未连接实际账套；100000−10000−1200+20000=108800来自实施约定手算，规则测试仅核其报表输入与代表取数，不冒称已重测Core凭证流。没有修改或执行原商业软件。

未验：全套报表与附注、全部累计专项规定、完整旧账迁移、税务/行业/地方符合性、企业现行科目出版物、GB/T24589.1-2024全文字段、真实电子凭证流程及桌面端适配。详细限制和主协调接入要求见 `rules/README.md`。
