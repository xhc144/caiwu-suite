using System.Numerics;
using static Caiwu.Nonprofit.NonprofitRules;

namespace Caiwu.Nonprofit.Writable;

/// <summary>Validation for the finite writable slice. Original SQL Anywhere variants remain separate evidence.</summary>
public static class NonprofitLedgerValidation
{
    internal static decimal Amount(decimal value)
    {
        Check(decimal.Round(value, 2) == value, "NP_MONEY_PRECISION", "本位币金额必须精确到分，不能静默舍入。");
        Check(value >= -92233720368547758.07m && value <= 92233720368547758.07m,
            "NP_TOTAL_OVERFLOW", "本位币金额超出对称Int64分范围。");
        return value;
    }
    internal static decimal Sum(IEnumerable<decimal> values)
    {
        BigInteger cents = 0;
        foreach (var value in values) cents += (BigInteger)(Amount(value) * 100m);
        Check(BigInteger.Abs(cents) <= long.MaxValue, "NP_TOTAL_OVERFLOW", "金额合计超出对称Int64分范围。");
        return (decimal)cents / 100m;
    }
    internal static bool ProfitLoss(NonprofitLedgerAccount a) => a.Kind is NonprofitAccountKind.Income or NonprofitAccountKind.Expense;
    internal static void Fields(IReadOnlyList<OriginalField> fields)
    {
        Check(fields is not null && fields.All(f => f is not null && !string.IsNullOrWhiteSpace(f.Table) &&
            !string.IsNullOrWhiteSpace(f.Column) && !string.IsNullOrWhiteSpace(f.Declaration)), "NP_ORIGINAL_FIELD", "原字段须保留表、列、原声明及原值（允许NULL）。");
        Check(fields!.Select(f => (f.Table, f.Column)).Distinct().Count() == fields!.Count,
            "NP_ORIGINAL_FIELD", "同一记录的原表/列不能重复。");
    }
    internal static void Classify(NonprofitLedgerSnapshot s, NonprofitLedgerAccount account, Classification? tag)
    {
        if (!ProfitLoss(account) && account.Kind != NonprofitAccountKind.NetAsset && account.Kind != NonprofitAccountKind.PriorAdjustment)
        {
            Check(tag is null, "NP_CLASS_NOT_APPLICABLE", "资产负债使用辅助维度，不得混入收入费用限定类别。");
            return;
        }
        Check(tag is not null && Enum.IsDefined(tag.Class), "NP_CLASS_REQUIRED", "收入、费用和净资产须明确限定类别。");
        if (account.OfficialRoot is "3101" or "3102")
            Check(tag!.Class == (account.OfficialRoot == "3101" ? RestrictionClass.Unrestricted : RestrictionClass.Restricted),
                "NP_NET_ASSET_CLASS", "净资产类别必须与科目一致。");
        if (tag!.Class == RestrictionClass.Unrestricted)
            Check(tag.RestrictionId is null && tag.RestrictionVersion is null, "NP_CLASS_RESTRICTION_MISMATCH", "非限定类别不能带限定ID/版本。");
        else
        {
            var evidence = s.Restrictions.SingleOrDefault(r => r.Id == tag.RestrictionId && r.Version == tag.RestrictionVersion);
            Check(evidence is not null && tag.ProjectId == evidence.ProjectId, "NP_RESTRICTION_EVIDENCE", "限定分录须绑定已保存的外部/法律限制版本和项目。");
        }
        Check(tag.ProjectId is null || !string.IsNullOrWhiteSpace(tag.ProjectId), "NP_PROJECT", "项目标识不能为空白。");
    }
    internal static void Dimensions(NonprofitLedgerAccount account, LineDimensions d)
    {
        Check(d is not null, "NP_DIMENSIONS", "必须保留分录维度对象。");
        var a = account.Dimensions;
        void Required(bool flag, string? value, string name) => Check(!flag || !string.IsNullOrWhiteSpace(value), "NP_DIMENSIONS", "科目要求" + name + "。");
        Required(a.Project, d!.Project, "项目"); Required(a.Counterparty, d.Counterparty, "客供");
        Required(a.Department, d.Department, "部门"); Required(a.Person, d.Person, "人员");
        Required(a.CashFlow, d.CashFlow, "现金项目"); Required(a.Settlement, d.SettlementType, "结算方式");
        Check(!a.ForeignCurrency || !string.IsNullOrWhiteSpace(d.Currency) && d.ForeignAmount.HasValue && d.ExchangeRate is > 0,
            "NP_FOREIGN_DIMENSIONS", "复币科目须保留币种、原币金额和正汇率。");
        Check(!a.Quantity || d.Quantity.HasValue && d.UnitPrice.HasValue && !string.IsNullOrWhiteSpace(d.Unit),
            "NP_QUANTITY_DIMENSIONS", "数量科目须保留数量、单价和单位；不自动按分舍入。");
        Check(d.ExchangeRate is null or > 0, "NP_EXCHANGE_RATE", "汇率必须为正。");
        // Foreign/quantity/rate values are decimal at their supplied precision, never passed through Amount().
    }
    internal static NonprofitLedgerAccount Leaf(NonprofitLedgerSnapshot s, string code)
    {
        var account = s.Accounts.SingleOrDefault(a => a.Code == code);
        Check(account is not null && !s.Accounts.Any(a => a.ParentCode == code), "NP_ACCOUNT_LEAF", "只能在存在的末级科目记账。");
        return account!;
    }
    internal static void Sides(decimal debit, decimal credit, bool allowZero = false)
    {
        Amount(debit); Amount(credit);
        Check(debit >= 0 && credit >= 0 && (debit == 0 || credit == 0) && (allowZero || debit + credit > 0),
            "NP_LINE_AMOUNT", "同一行只能有一个正借/贷金额。");
    }
    public static void Validate(NonprofitLedgerSnapshot s)
    {
        ArgumentNullException.ThrowIfNull(s);
        Check(s.SchemaVersion == 1 && s.BookId != Guid.Empty && s.Revision >= 0 && s.FiscalYear >= 2026 &&
            s.StartMonth is >= 1 and <= 12 && s.ClosedThroughMonth >= s.StartMonth - 1 && s.ClosedThroughMonth <= 12,
            "NP_BOOK", "账套身份、格式、版本或会计期间无效。");
        Check(s.BookCode is { Length: 2 } && s.BookCode.All(char.IsAsciiLetterOrDigit) && !string.IsNullOrWhiteSpace(s.BookName) &&
            s.OriginalTemplateId == "a54" && !string.IsNullOrWhiteSpace(s.ChartEvidenceReference), "NP_TEMPLATE", "此切片仅处理有明确科目依据的a54民非账套；不能映射为实验模板。");
        Check(s.Accounts is not null && s.Accounts.Count > 0 && s.Opening is not null && s.Restrictions is not null &&
            s.Vouchers is not null && s.Audit is not null, "NP_STATE", "账簿集合不得缺省。");
        Fields(s.OriginalFields);
        Check(s.Accounts!.All(a => a is not null && !string.IsNullOrWhiteSpace(a.Code) && a.Code.Length <= 30 &&
            !string.IsNullOrWhiteSpace(a.Name) && a.Dimensions is not null && Enum.IsDefined(a.Kind)) &&
            s.Accounts!.Select(a => a.Code).Distinct(StringComparer.Ordinal).Count() == s.Accounts!.Count,
            "NP_ACCOUNT", "科目不能为空或重复。");
        foreach (var a in s.Accounts!)
        {
            Fields(a.OriginalFields);
            var rule = NonprofitRules.Official2026.Account(a.OfficialRoot);
            var kind = a.OfficialRoot == "3201" ? NonprofitAccountKind.PriorAdjustment : rule.Category switch
            {
                "Asset" => NonprofitAccountKind.Asset, "Liability" => NonprofitAccountKind.Liability,
                "NetAssets" => NonprofitAccountKind.NetAsset, "Income" => NonprofitAccountKind.Income,
                "Expense" => NonprofitAccountKind.Expense, _ => throw new InvalidDataException("未知科目类别。")
            };
            Check(a.Kind == kind, "NP_ACCOUNT_MAPPING", "科目类别须匹配显式官方根映射。");
            var seen = new HashSet<string>(StringComparer.Ordinal) { a.Code }; var cursor = a;
            while (cursor.ParentCode is { } parent)
            {
                Check(seen.Add(parent), "NP_ACCOUNT_CYCLE", "科目父子关系成环。");
                cursor = s.Accounts!.SingleOrDefault(x => x.Code == parent)!;
                Check(cursor is not null && cursor.OfficialRoot == a.OfficialRoot && cursor.Kind == a.Kind,
                    "NP_ACCOUNT_PARENT", "父科目不存在或根映射/类别不同。");
            }
        }
        Check(s.Restrictions!.All(r => r is not null && !string.IsNullOrWhiteSpace(r.Id) && r.Version > 0 &&
            !string.IsNullOrWhiteSpace(r.ProjectId) && !string.IsNullOrWhiteSpace(r.EvidenceReference) &&
            r.SourceKind is RestrictionSourceKind.ExternalProvider or RestrictionSourceKind.LawOrAdministrativeRegulation &&
            r.Conditions is {Count: > 0} && r.Conditions.All(c => c is not null && Enum.IsDefined(c.Kind) && !string.IsNullOrWhiteSpace(c.Terms))) &&
            s.Restrictions!.Select(r => (r.Id, r.Version)).Distinct().Count() == s.Restrictions!.Count,
            "NP_RESTRICTION_EVIDENCE", "限定证据须是外部/法律来源，具有项目、版本和具体条件；内部预算不是限定依据。");
        var ids = new HashSet<Guid>();
        foreach (var o in s.Opening!)
        {
            Check(o is not null && o.Id != Guid.Empty && ids.Add(o.Id), "NP_LINE_ID", "期初行身份重复或无效。");
            var a = Leaf(s, o!.AccountCode); Sides(o.Debit, o.Credit, allowZero: true);
            Classify(s, a, o.Classification); Dimensions(a, o.Dimensions); Fields(o.OriginalFields);
            Check(s.StartMonth != 1 || !ProfitLoss(a) || o.Debit == 0 && o.Credit == 0,
                "NP_OPENING_PL", "一月年初不能带入旧损益；请先完成经审的年度衔接。");
        }
        Check(!s.OpeningConfirmed || Sum(s.Opening!.Select(o => o.Debit - o.Credit)) == 0,
            "NP_OPENING_UNBALANCED", "确认期初必须借贷平衡。");
        Check(s.Vouchers!.Select(v => v.Id).Distinct().Count() == s.Vouchers.Count &&
            s.Vouchers.Select(v => (v.Date.Month, v.Kind, v.Number)).Distinct().Count() == s.Vouchers.Count,
            "NP_VOUCHER_DUPLICATE", "凭证身份或月度类型编号重复。");
        foreach (var v in s.Vouchers)
        {
            Check(v.Id != Guid.Empty && v.Date.Year == s.FiscalYear && v.Date.Month >= s.StartMonth &&
                v.Number > 0 && v.AttachmentCount >= 0 && !string.IsNullOrWhiteSpace(v.Kind) &&
                !string.IsNullOrWhiteSpace(v.PreparedBy) && v.PreparedAt != default &&
                !string.IsNullOrWhiteSpace(v.EvidenceReference) && Enum.IsDefined(v.State), "NP_VOUCHER", "凭证身份、日期、编号、附件或证据无效。");
            Check(v.Role is NonprofitMovementRole.Activity or NonprofitMovementRole.IncomeExpenseClosing,
                "NP_ROLE_UNIMPLEMENTED", "本切片尚未支持净资产转类/前期调整的写入流程，不能冒充普通活动。");
            Check(v.Lines is {Count: >= 2}, "NP_VOUCHER_LINES", "凭证至少两行。"); Fields(v.OriginalFields);
            Check(v.State == NonprofitVoucherState.Draft ? v.ReviewedBy is null && v.ReviewedAt is null :
                !string.IsNullOrWhiteSpace(v.ReviewedBy) && v.ReviewedBy != v.PreparedBy && v.ReviewedAt.HasValue,
                "NP_REVIEW", "审核人须异于制单人，审核状态与人员/时间须一致。");
            Check(v.State == NonprofitVoucherState.Posted ? !string.IsNullOrWhiteSpace(v.PostedBy) && v.PostedAt.HasValue && s.HasEverPosted && s.OpeningConfirmed :
                v.PostedBy is null && v.PostedAt is null, "NP_POST", "记账状态与人员/时间、期初须一致。");
            Check(v.Date.Month > s.ClosedThroughMonth || v.State == NonprofitVoucherState.Posted,
                "NP_CLOSED_MONTH", "已结账期间不能含未记账凭证。");
            foreach (var l in v.Lines!)
            {
                Check(l is not null && l.Id != Guid.Empty && ids.Add(l.Id), "NP_LINE_ID", "分录须有账套内唯一稳定行ID。");
                var a = Leaf(s, l!.AccountCode); Sides(l.Debit, l.Credit);
                Classify(s, a, l.Classification); Dimensions(a, l.Dimensions); Fields(l.OriginalFields);
                Check(a.Kind != NonprofitAccountKind.PriorAdjustment, "NP_PRIOR_ADJUSTMENT_UNIMPLEMENTED", "3201前期调整需独立已审流程，尚未接入本切片。");
            }
            Check(Sum(v.Lines.Select(l => l.Debit)) == Sum(v.Lines.Select(l => l.Credit)), "NP_UNBALANCED", "借贷不平，不能存盘。");
            if (v.Role == NonprofitMovementRole.IncomeExpenseClosing)
            {
                Check(v.Date.Day == DateTime.DaysInMonth(v.Date.Year, v.Date.Month) &&
                    v.Lines.All(l => ProfitLoss(Leaf(s, l.AccountCode)) || Leaf(s, l.AccountCode).Kind == NonprofitAccountKind.NetAsset),
                    "NP_CLOSING_ROLE", "损益结转只能于月末在损益与净资产科目间进行。");
                foreach (var group in v.Lines.GroupBy(l => l.Classification))
                    Check(Sum(group.Select(l => l.Debit - l.Credit)) == 0, "NP_CLOSING_CLASS", "损益结转必须逐限定类别/限制范围平衡，不能跨类转移。");
            }
        }
        Check(s.Audit!.All(a => a is not null && a.Id != Guid.Empty && a.At != default && !string.IsNullOrWhiteSpace(a.OperatorId) && !string.IsNullOrWhiteSpace(a.Action)) &&
            s.Audit!.Select(a => a.Id).Distinct().Count() == s.Audit!.Count, "NP_AUDIT", "操作记录身份无效或重复。");
        // Reject an otherwise valid posting BEFORE it leaves an unrepresentable saved balance.
        var posted = s.Opening.Select(o => (o.AccountCode, o.Classification, Net: o.Debit - o.Credit))
            .Concat(s.Vouchers.Where(v => v.State == NonprofitVoucherState.Posted).SelectMany(v => v.Lines)
                .Select(l => (l.AccountCode, l.Classification, Net: l.Debit - l.Credit))).ToArray();
        foreach (var group in posted.GroupBy(b => (b.AccountCode, b.Classification))) _ = Sum(group.Select(b => b.Net));
        foreach (var group in posted.GroupBy(b => b.AccountCode)) _ = Sum(group.Select(b => b.Net));
    }
}
