# 原版 UI 契约校验器（独立、无 GUI）

这是原软件升级的防偏移检查基础。它读取仓库已有原版分析 JSON，再读取候选 UI 观测，按 **产品 + 原对象 + 入口身份** 比较已知的控件、按钮文字、相对位置、菜单顺序与快捷键。它不启动原程序或候选程序，不需要 PB9/.NET 编译器，不生成 dashboard，也不改生产 UI。

依据：[原版交互契约](../../docs/revision-plan/original-ui-contract.md)、[分析来源与限制](../../docs/original-analysis/README.md)。原 JSON 保持在原目录，不复制到本工具或测试中。测试夹具全部为手写合成数据，**没有一份是真实 0.1.0.4 或原版 UIA 观测**。

## 执行

要求 Python 3.10+，仅标准库。从仓库根目录执行：

```sh
python3 tools/original-ui-contract-check/check.py --list-cases

# 没有探针输入：缺失观测必须显示 not-tested，退出 3。
python3 tools/original-ui-contract-check/check.py --output /tmp/original-ui-not-tested.json

# 最小合成匹配：只证明比较逻辑匹配；runtime_acceptance 仍 not-tested，退出 3。
python3 tools/original-ui-contract-check/check.py \
  --product qingsong/main --case login.startup \
  --observations tools/original-ui-contract-check/tests/fixtures/login-relative-match.synthetic.json \
  --output /tmp/original-ui-synthetic-match.json

# 最小非通过回归：退出 1。此输入不是旧版本的实机观测。
python3 tools/original-ui-contract-check/check.py \
  --product qingsong/main --case editor.standard \
  --observations tools/original-ui-contract-check/tests/fixtures/regression-editor-save-close.synthetic.json \
  --output /tmp/original-ui-synthetic-deviation.json

python3 -m unittest discover -s tools/original-ui-contract-check/tests -v
```

`--product`、`--case` 可重复；不指定时检查三套主程序的全部 13 个入口场景（12 个不同窗口），共 39 个产品/入口组合。`--repo` 指向含 `docs/original-analysis/json` 的 checkout；默认由脚本位置定位。`--output` 输出 JSON 报告，不指定则输出到 stdout；报告不应提交入 Git。

当前覆盖登录/切账、切换用户、账套管理/查找、MDI 框架、凭证序时簿/浏览条件/查询、审核/删除、标准和大版编辑。另两种编辑场景只声明候选观察身份；原版动态调用/选择条件仍为 unknown。具体入口字符串以 `--list-cases` 为准，不能把相同对象的不同入口互相顶替。

## 输入格式与真实探针的责任

未来真实 UIA 探针应提供如下结构；此处仅是格式示例，不是实机结果：

```json
{
  "schema_version": 1,
  "provenance": {
    "kind": "synthetic",
    "description": "格式示例；未运行软件"
  },
  "windows": [{
    "product": "qingsong/main",
    "object": "w_login",
    "entry": "event:w_frame.open",
    "coverage": {"controls": "partial", "menus": "partial", "columns": "partial"},
    "controls": [{
      "id": "cb_ok",
      "automation_id": "probe-reported-candidate-automation-id",
      "text": "Y. 确认",
      "visible": true,
      "bounds": {"x": 240, "y": 320, "width": 100, "height": 35,
                 "unit": "abstract", "space": "synthetic-window"}
    }],
    "menus": [],
    "tables": []
  }]
}
```

- `provenance.kind` 可为 `synthetic`、`static`、`uia`、`unspecified`。真实探针应另记录实际候选提交/二进制、探针版本、时间、进程、运行状态和原始证据位置；应由可信采集流程审核其真实性。**本比较器不认证这些自报字段**，不能改个 kind 就获得实机通过。
- `id` 是明确映射到原对象的控件名，`automation_id` 是候选探针实际读取值。映射应在探针适配器中经过审查；本工具不按相似标题猜对应控件，不把“新页面看起来像”当原对象身份。
- `entry` 是实际到达该窗口的入口，而不是随便填一个可使比较成功的标记。探针需要记录点击/快捷键路径与当前账套、用户权限和业务状态。未观测的窗口不要用静态定义填充。
- 同一入口的不同权限/业务状态应分别采集、分别运行；一个输入中重复的产品/对象/入口会被拒绝，不把不同快照混成同一窗口。现有比较器不推断业务状态等价性。
- `controls` 是观测到的控件，`text` 是读到的文字，`visible/enabled` 必须是布尔值。未知字段应省略，不用空字符串假装观测。文字比较只忽略助记标记 `&` 和空白，仍检查文字、标点和助记字母；不会把“保存并关闭”自动当“存盘”。
- `bounds` 必须有有限数值、正宽高、同一坐标空间与单位。UIA 使用 `pixels` 或 `dip`，`abstract` 仅供合成测试。相对位置只比同单位/空间下的左右/上下起点和行/列区间交叠；不把 PBU 转成像素，不检查未知比例，也不等同逐像素视觉验收。
- `menus` 是按实际顺序排列的树：每项有 `id/text`，可有 `shortcut/visible/enabled/children`。`shortcut` 应来自探针的实际命令/按键证据，不能仅从标签文字倒填。菜单项 ID 与菜单根对象不是同一层。例如编辑存盘项的路径是 `m_operation/m_operation_save`，F5 必须属于该编辑入口，不能借用序时簿的刷新 F5。
- `tables` 形如 `[{"control":"dw_master","columns":["pz_zy","kmbm","pz_jf","pz_df"]}]`，数组表示候选实际可见列顺序。当前原分析没有证明相应原版屏幕列顺序，所以比较器仍输出 column-order=unknown；不会拿源 JSON 列数组当视觉基线。
- `coverage` 默认是 `partial`。只有探针确实展开并完整枚举了相应范围，且运行权限/状态适合该契约时才能标 `complete`。部分枚举中找不到控件/菜单为 not-tested；完整枚举仍缺必需项才为 mismatch。仅枚举当前屏幕、未展开菜单或没有访问隐藏子窗口时，不得标 complete。即使窗口 complete，个别字段没读到仍为 not-tested。

## 报告与退出码

每条检查保留产品、对象、入口、字段和原 JSON 文件/对象/控件或菜单路径，方便回查；baseline 记录三个输入 JSON 的 SHA256，避免把换过的分析当同一份证据。

| 字段/状态 | 含义 |
|---|---|
| `matched` | 当前已知约束与所给观测值一致，仅是比较结果 |
| `mismatch` / `mismatches` | 明确观测违反已知约束；或声明完整枚举后缺必需控件/菜单；身份错误也单列 |
| `not-tested` / `not_tested` | 窗口/字段/坐标未提供、部分枚举、不可见或坐标空间不一致；不是通过，也不是已经证明原程序缺功能 |
| `unknown` / `unknowns` | 缺少原版相应事实；当前包括原屏幕列顺序、工具栏实际顺序、运行时可见性、焦点/保存关闭细节和动态编辑入口 |
| `comparison` | `mismatch`、`incomplete` 或已知检查 `matched`；不包括 unknown 的“通过”推定 |
| `runtime_acceptance` | 合成/静态/缺省输入为 `not-tested`；自报 UIA 为 `not-established`，从不输出实机通过 |
| 退出 `1` | 有已知约束 mismatch；合成反例也使用此码，但不能称真实候选失败已实测 |
| 退出 `2` | 输入/基线错误，例如任意深度的 JSON 重复键、重复身份、坏 JSON、NaN、坐标不合法、原对象或已审关系发生变化。基线与观测使用同一拒绝重复键的读取器，不接受 last-wins |
| 退出 `3` | 没有已知 mismatch，但仍不是验收通过；可能匹配、未测或存在 unknown |
| 退出 `0` | 仅 `--list-cases` 清单操作成功。当前没有返回 0 的验收模式 |

原导出的 `visible/enabled` 只有设计时含义，实际可能按版本、权限与业务状态变更。当前所有运行时可见性对照单列 unknown，包含候选读到的值，绝不以设计 false 静默判实际隐藏正确。`enabled` 可被探针保留，但当前不作状态等价断言。待有真实、同入口/同状态的原版证据后，才能增加相应约束；不能为了让 CI 变绿删掉 unknown。

## 最小合成回归及局限

| 夹具 | 证明校验器能发现什么 | 与旧预览的证据关系 |
|---|---|---|
| `login-relative-match.synthetic.json` | 自由尺度/平移下的原登录位置关系；匹配仍退出3 | 纯手写对照，不代表任何真实窗口 |
| `regression-split-login.synthetic.json` | 完整枚举声明下缺少账套/日期/新增/搜索、按钮名改变 | 决策来自已读 `App.xaml.cs`、`LoginWindow.xaml`；合成输入只复现该类偏离，不声称取自二进制 |
| `regression-editor-save-close.synthetic.json` | F5 改 Ctrl+S、“存盘”变“保存并关闭”、日期与类型挤到一行 | 决策来自 `VoucherEditorWindow.xaml/.xaml.cs`；不据此推定原成功存盘后留窗/下一张/关闭的完整行为 |
| `regression-book-button-order.synthetic.json` | 管理窗确定/取消竖排顺序颠倒 | 仅用于顺序算法反例，不声称旧版本实际有这两个坐标 |

测试还防止跨产品/跨入口冒领、部分观测误判缺失、漏字段自动匹配、跨坐标空间比较、把 schema 列序当屏幕列序、以及将自报 UIA 当真实验收通过。它们是工具回归，不是财务业务测试或 Windows UIA 验收。

本轮实际验证（2026-10-25，Linux / Python 3.12）：32 项合成测试通过，包括重复 id/text/entry 键、同值/转义后同名键、根层及嵌套基线重复键的拒绝；四个夹具的 CLI 实跑结果如下。`unknown` 仍保留，不能把第一行称为真实登录验收通过。

| 合成输入 | comparison | mismatch 数 | runtime_acceptance | 退出码 |
|---|---|---:|---|---:|
| login-relative-match | matched | 0 | not-tested | 3 |
| regression-split-login | mismatch | 16 | not-tested | 1 |
| regression-book-button-order | mismatch | 1 | not-tested | 1 |
| regression-editor-save-close | mismatch | 3 | not-tested | 1 |

本轮不生成真实探针、不获取原资源、不执行原安装包、不改原版分析、不修改生产 UI。后续 UI 改动应提交真实观测与报告来核对已知约束；截图可辅助视觉审查，但不能替代明确的对象、入口、按键及操作结果证据。
