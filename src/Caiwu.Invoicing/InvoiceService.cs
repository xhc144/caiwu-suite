using System.Collections.Immutable;
using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Caiwu.Invoicing;

public sealed class InvoiceService(IInvoiceStore store)
{
    public InvoiceWorkspace Read() => store.Read();

    public ImportResult Import(long expectedRevision, IEnumerable<InvoiceImport> batch)
    {
        var state = Current(expectedRevision);
        var docs = state.Documents.ToBuilder();
        int added = 0, duplicates = 0;
        foreach (var item in batch)
        {
            var candidate = BuildDocument(state, Guid.NewGuid(), 1, item);
            var existing = docs.FirstOrDefault(x => x.Key == candidate.Key);
            if (existing is not null)
            {
                Require(existing.ContentDigest == candidate.ContentDigest || Digest(existing.Rows) == candidate.ContentDigest,
                    "import-conflict", "同一发票已有不同内容，整批未转入；请核对原记录。");
                duplicates++;
                continue;
            }
            docs.Add(candidate);
            added++;
        }
        if (added != 0) Publish(state, state with { Documents = docs.ToImmutable() });
        return new(added, duplicates, state.Revision + (added == 0 ? 0 : 1));
    }

    public InvoiceDocument Save(long expectedRevision, Guid? id, InvoiceImport input)
        => SaveMany(expectedRevision, [new(id, input)])[0];

    public ImmutableArray<InvoiceDocument> SaveMany(long expectedRevision, ImmutableArray<InvoiceEdit> edits)
    {
        var state = Current(expectedRevision);
        Require(!edits.IsDefaultOrEmpty && edits.Where(x => x.Id.HasValue).Select(x => x.Id).Distinct().Count()
            == edits.Count(x => x.Id.HasValue), "selection", "保存项目为空或包含重复发票。");
        var changed = ImmutableArray.CreateBuilder<InvoiceDocument>();
        foreach (var edit in edits)
        {
            var prior = edit.Id.HasValue ? Find(state, edit.Id.Value) : null;
            if (prior is not null) Editable(state, prior);
            var doc = BuildDocument(state, edit.Id ?? Guid.NewGuid(), (prior?.Version ?? 0) + 1, edit.Input);
            // Editing business fields must never manufacture or clear processing back-links.
            Require(doc.IsUnprocessed && doc.IsUnreviewed && doc.Rows.All(NoBackLink), "status-write", "录入不能写入审核、处理标志或凭证回链。");
            changed.Add(doc);
        }
        var documents = state.Documents.Where(x => changed.All(y => y.Id != x.Id)).Concat(changed).ToImmutableArray();
        Require(documents.Select(x => x.Key).Distinct().Count() == documents.Length, "duplicate-invoice", "发票代码、号码及票种重复。");
        Publish(state, state with { Documents = documents });
        return changed.ToImmutable();
    }

    public ImportResult ImportTransfer(long expectedRevision, InvoiceTransfer transfer)
    {
        var state = Current(expectedRevision);
        Require(transfer.FormatVersion == 1 && transfer.BookId == state.BookId && transfer.Product == state.Product,
            "transfer-identity", "导入格式、账套或产品不一致。");
        return Import(expectedRevision, transfer.Invoices);
    }

    public void Delete(long expectedRevision, ImmutableArray<Guid> ids)
    {
        var state = Current(expectedRevision);
        Require(!ids.IsDefaultOrEmpty && ids.Distinct().Count() == ids.Length, "selection", "请选择不重复的发票。");
        foreach (var id in ids) Editable(state, Find(state, id));
        Publish(state, state with { Documents = state.Documents.Where(x => !ids.Contains(x.Id)).ToImmutableArray() });
    }

    public void DeleteRows(long expectedRevision, ImmutableArray<InvoiceRowSelection> selection)
    {
        var state = Current(expectedRevision);
        Require(!selection.IsDefaultOrEmpty && selection.Distinct().Count() == selection.Length, "selection", "请选择不重复的发票行。");
        var documents = state.Documents.ToBuilder();
        foreach (var group in selection.GroupBy(x => x.DocumentId))
        {
            var doc = Find(state, group.Key);
            Editable(state, doc);
            var indices = group.Select(x => x.RowIndex).ToHashSet();
            Require(indices.All(x => x >= 0 && x < doc.Rows.Length), "selection", "选择的原行号已失效，请刷新。");
            var rows = doc.Rows.Where((_, index) => !indices.Contains(index)).ToImmutableArray();
            var location = documents.IndexOf(doc);
            if (rows.Length == 0) documents.RemoveAt(location);
            else documents[location] = doc with { Rows = rows, Version = doc.Version + 1, ContentDigest = Digest(rows) };
        }
        Publish(state, state with { Documents = documents.ToImmutable() });
    }

    public BatchDeleteResult DeleteBatch(long expectedRevision, ImmutableArray<Guid> ids)
    {
        var state = Current(expectedRevision);
        Require(!ids.IsDefaultOrEmpty && ids.Distinct().Count() == ids.Length, "selection", "请选择不重复的发票。");
        var removable = new HashSet<Guid>();
        var skipped = ImmutableArray.CreateBuilder<SkippedInvoice>();
        foreach (var id in ids)
        {
            var doc = Find(state, id);
            try { Editable(state, doc); removable.Add(id); }
            catch (InvoiceException ex) { skipped.Add(new(id, ex.Message)); }
        }
        if (removable.Count > 0) Publish(state, state with { Documents = state.Documents.Where(x => !removable.Contains(x.Id)).ToImmutableArray() });
        return new(removable.Count, skipped.ToImmutable(), state.Revision + (removable.Count == 0 ? 0 : 1));
    }

    /// <summary>Local review flag only; this is not tax authority certification.</summary>
    public void SetReviewed(long expectedRevision, Guid id, bool reviewed)
    {
        var state = Current(expectedRevision);
        var doc = Find(state, id);
        Require(doc.Key.Direction == InvoiceDirection.Output, "input-review-semantics",
            "进项 sh_bz 兼有原认证方式语义，未验证映射前不能用销项审核动作重写。");
        OpenForMutation(state, doc);
        Require(doc.IsUnprocessed && doc.Rows.All(NoBackLink), "processed", "已经后续处理，不能修改审核状态。");
        Require(doc.Rows.All(x => Flag(x, "sh_bz") is "0" or "1"), "unknown-review", "原审核/认证方式含未知值，需专用适配器处理。");
        var changed = doc with { Version = doc.Version + 1, Rows = doc.Rows.Select(x => x.Set("sh_bz", reviewed ? "1" : "0")).ToImmutableArray() };
        Publish(state, state with { Documents = Replace(state.Documents, changed) });
    }

    public InvoiceVoucherPlan CreateVoucherPlan(PlanRequest request) => Plan(store.Read(), request);

    /// <summary>Atomic closure in the module's synthetic journal store. A real ledger adapter must
    /// implement the transaction described in the handoff; no legacy book is opened here.</summary>
    public ImmutableArray<InvoiceJournal> CommitVoucherPlanToSandbox(InvoiceVoucherPlan plan)
    {
        var state = Current(plan.WorkspaceRevision);
        Require(state.BookId == plan.BookId && state.Product == plan.Product, "book-mismatch", "计划不属于当前账套及产品。");
        var fresh = Plan(state, plan.Request);
        Require(InvoiceJson.Serialize(fresh) == InvoiceJson.Serialize(plan), "plan-tampered", "计划内容已变化，请重新生成。");
        var journals = fresh.Vouchers.Select(x => new InvoiceJournal(Guid.NewGuid(), fresh.Request.VoucherMonth,
            fresh.Request.VoucherType, x.Number, false, false, x.SourceIds, x.Lines)).ToImmutableArray();
        var documents = state.Documents.Select(doc =>
        {
            var journal = journals.FirstOrDefault(x => x.SourceIds.Contains(doc.Id));
            if (journal is null) return doc;
            return doc with
            {
                Version = doc.Version + 1,
                Rows = doc.Rows.Select(x => x.Set("pz_bz", "1").Set("p_nf", journal.Period.Year)
                    .Set("p_yf", journal.Period.Month).Set("p_pzlx", journal.VoucherType).Set("p_pzbh", journal.Number)).ToImmutableArray()
            };
        }).ToImmutableArray();
        Publish(state, state with { Documents = documents, Journals = state.Journals.AddRange(journals) });
        return journals;
    }

    public void DeleteGeneratedVoucherFromSandbox(long expectedRevision, Guid journalId)
    {
        var state = Current(expectedRevision);
        var journal = state.Journals.FirstOrDefault(x => x.Id == journalId)
            ?? throw new InvoiceException("journal-missing", "未找到生成凭证。");
        Require(!journal.Reviewed && !journal.Posted, "journal-reviewed", "此凭证已经审核或过账，不能删除！");
        Require(journal.Period.CompareTo(state.OpenMonth) >= 0, "closed", "已经结账，不能删除！");
        foreach (var id in journal.SourceIds)
        {
            var doc = Find(state, id);
            OpenForMutation(state, doc);
            Require(doc.Rows.All(x => Flag(x, "pz_bz") == "1" && x.Number("p_nf") == journal.Period.Year
                && x.Number("p_yf") == journal.Period.Month && x.Number("p_pzlx") == journal.VoucherType
                && x.Number("p_pzbh") == journal.Number), "backlink", "凭证与发票回链不一致，未删除。");
        }
        var documents = state.Documents.Select(doc => !journal.SourceIds.Contains(doc.Id) ? doc : doc with
        {
            Version = doc.Version + 1,
            Rows = doc.Rows.Select(x => x.Set("pz_bz", "0").Set("p_nf", null).Set("p_yf", null)
                .Set("p_pzlx", null).Set("p_pzbh", null)).ToImmutableArray()
        }).ToImmutableArray();
        Publish(state, state with { Documents = documents, Journals = state.Journals.Remove(journal) });
    }

    public ImmutableArray<VatComparison> CompareVat(int year, bool quarterly, string outputTaxAccount,
        string inputTaxAccount, IEnumerable<LedgerTaxLine>? ledger)
    {
        var state = store.Read();
        Require(year is >= 1 and <= 9999, "year", "年度无效。");
        ValidateAccount(state, outputTaxAccount);
        ValidateAccount(state, inputTaxAccount);
        Require(outputTaxAccount != inputTaxAccount, "tax-account", "进销项税科目必须分别指定。");
        var entries = ledger?.ToArray();
        var result = ImmutableArray.CreateBuilder<VatComparison>();
        for (int period = 1; period <= (quarterly ? 4 : 12); period++)
        {
            bool Includes(DateOnly d) => d.Year == year && (quarterly ? (d.Month - 1) / 3 + 1 : d.Month) == period;
            var docs = state.Documents.Where(x => Includes(x.AccountingDate)).ToArray();
            // All recorded face values remain visible, including void/unknown states: no undocumented tax filter.
            decimal? FaceTax(InvoiceDirection direction)
            {
                var rows = docs.Where(x => x.Key.Direction == direction).SelectMany(x => x.Rows).ToArray();
                return rows.Any(x => x.Number("se") is null) ? null : rows.Sum(x => x.Number("se")!.Value);
            }
            result.Add(new(quarterly ? $"{year:0000}-Q{period}" : $"{year:0000}-{period:00}",
                FaceTax(InvoiceDirection.Output), FaceTax(InvoiceDirection.Input),
                entries?.Where(x => Includes(x.Date) && x.AccountCode == outputTaxAccount).Sum(x => x.Credit - x.Debit),
                entries?.Where(x => Includes(x.Date) && x.AccountCode == inputTaxAccount).Sum(x => x.Debit - x.Credit)));
        }
        return result.ToImmutable();
    }

    public ImmutableArray<LedgerTaxLine> ReadSandboxLedger() => store.Read().Journals.SelectMany(journal => journal.Lines
        .Select(line => new LedgerTaxLine(journal.Period.FirstDay, line.AccountCode, line.Debit, line.Credit))).ToImmutableArray();

    private static InvoiceVoucherPlan Plan(InvoiceWorkspace state, PlanRequest request)
    {
        Require(Enum.IsDefined(request.Direction) && Enum.IsDefined(request.Grouping) && Enum.IsDefined(request.SalesCategory), "option", "凭证选项无效。");
        Require(request.SourceMonth.Year is >= 1 and <= 9999 && request.SourceMonth.Month is >= 1 and <= 12
            && request.VoucherMonth.Year is >= 1 and <= 9999 && request.VoucherMonth.Month is >= 1 and <= 12, "period", "凭证期间无效。");
        Require(request.VoucherMonth.CompareTo(state.OpenMonth) >= 0, "closed", "凭证月份已经结账。");
        Require(request.VoucherType > 0 && request.FirstNumber > 0, "voucher-number", "凭证类型与起始编号必须为正整数。");
        Require(!request.SourceIds.IsDefaultOrEmpty && request.SourceIds.Distinct().Count() == request.SourceIds.Length, "selection", "请选择不重复的发票。");
        Require(request.EligibleInvoiceStatuses is not null && request.EligibleInvoiceStatuses.Count > 0, "status-policy", "请明确可处理的原发票状态。");
        var docs = request.SourceIds.Select(id => Find(state, id)).OrderBy(x => x.Key.Code, StringComparer.Ordinal)
            .ThenBy(x => x.Key.Number, StringComparer.Ordinal).ToArray();
        foreach (var doc in docs)
        {
            OpenForMutation(state, doc);
            Require(doc.Key.Direction == request.Direction && InvoiceMonth.From(doc.AccountingDate) == request.SourceMonth,
                "source-period", "发票方向或所属月份不一致。");
            Require(doc.IsUnprocessed && doc.Rows.All(NoBackLink), "processed", "发票已经生成凭证或后续单据，不能重复生成。");
            Require(doc.Rows.All(x => Flag(x, "sh_bz") is "0" or "1"), "unknown-review", "原审核/认证方式含未知值，需专用适配器处理。");
            Require(doc.Rows.All(x => request.EligibleInvoiceStatuses.Contains((x.Text("fpzt") ?? "").Trim())),
                "invoice-status", "发票状态没有明确处理规则，未生成凭证。");
            Require(doc.Rows.All(x => x.Number("je0") is not null && x.Number("se") is not null && x.Number("je1") is not null),
                "amount-missing", "金额、税额和价税合计必须完整。");
            foreach (var row in doc.Rows)
                Require(row.Number("je0") + row.Number("se") == row.Number("je1"), "gross-mismatch", "价税合计不等于金额加税额，未生成凭证。");
        }
        var groups = request.Grouping == VoucherGrouping.Monthly ? new[] { docs }
            : docs.Select(x => new[] { x }).ToArray();
        var vouchers = ImmutableArray.CreateBuilder<PlannedVoucher>();
        var number = request.FirstNumber;
        foreach (var group in groups)
        {
            Require(!state.Journals.Any(x => x.Period == request.VoucherMonth && x.VoucherType == request.VoucherType && x.Number == number),
                "duplicate-voucher", "已有重复凭证，不能生成！");
            var lines = ImmutableArray.CreateBuilder<PlannedLine>();
            foreach (var doc in group)
            {
                var summary = (request.Direction == InvoiceDirection.Output ? "销项发票 " : "进项发票 ") + doc.Key.Number + " " + doc.PartyName;
                if (request.Direction == InvoiceDirection.Output)
                {
                    Add(request.Accounts.Receivable, doc.Gross, true);
                    Add(request.SalesCategory == SalesCategory.Goods ? request.Accounts.GoodsRevenue : request.Accounts.ServiceRevenue, doc.Net, false);
                    Add(request.Accounts.OutputTax, doc.Tax, false);
                }
                else
                {
                    Add(request.Accounts.Material, request.SeparateInputTax ? doc.Net : doc.Gross, true);
                    if (request.SeparateInputTax) Add(request.Accounts.InputTax, doc.Tax, true);
                    Add(request.Accounts.Payable, doc.Gross, false);
                }
                void Add(string code, decimal signed, bool debit)
                {
                    ValidateAccount(state, code);
                    Require(decimal.Round(signed, 2) == signed, "precision", "凭证金额有分以下精度，请人工核对；系统不擅自调整尾差。");
                    if (signed == 0) return;
                    // Red invoices reverse debit/credit, never place a negative amount in a voucher column.
                    var positiveDebit = signed > 0 ? debit : !debit;
                    lines.Add(new(code, summary, positiveDebit ? Math.Abs(signed) : 0, positiveDebit ? 0 : Math.Abs(signed)));
                }
            }
            Require(lines.Count > 0, "zero-voucher", "生成凭证的金额为零，不需要生成凭证！");
            Require(lines.Sum(x => x.Debit) == lines.Sum(x => x.Credit), "unbalanced", "借贷不平！");
            vouchers.Add(new(number, group.Select(x => x.Id).ToImmutableArray(), lines.ToImmutable()));
            if (vouchers.Count < groups.Length) number = checked(number + 1);
        }
        return new(state.BookId, state.Product, state.Revision, request, vouchers.ToImmutable());
    }

    private static InvoiceDocument BuildDocument(InvoiceWorkspace state, Guid id, long version, InvoiceImport input)
    {
        Require(Enum.IsDefined(input.Direction) && Enum.IsDefined(input.Kind), "invoice-option", "发票方向或票种无效。");
        Require(!input.Rows.IsDefaultOrEmpty, "empty-invoice", "发票没有明细行。");
        Require(input.Direction != InvoiceDirection.Input || input.Rows.Length == 1, "input-row-count",
            "原进项表每票保存一条汇总记录，不能把重复记录当作多条商品行累加。");
        if (input.Rows.Length > 1)
        {
            var sequences = input.Rows.Select(x => x.Number("xh")).ToArray();
            Require(sequences.All(x => x is not null && decimal.Truncate(x.Value) == x.Value)
                && sequences.Distinct().Count() == sequences.Length, "line-sequence", "多行销项发票必须携带不重复的原行号 xh。");
        }
        var first = input.Rows[0];
        var key = new InvoiceKey(input.Direction, input.Kind, (first.Text("fpdm") ?? "").Trim(), (first.Text("fphm") ?? "").Trim());
        Require(key.Number.Length > 0, "invoice-number", "未输入发票号码！请输入后再存盘！");
        foreach (var row in input.Rows)
        {
            Require((row.Text("fpdm") ?? "").Trim() == key.Code && (row.Text("fphm") ?? "").Trim() == key.Number,
                "invoice-identity", "同一张发票的代码和号码必须一致。");
            Require(row.Date("rq") is not null, "invoice-date", "请输入开票日期。");
            Require(row.Date("rq") == first.Date("rq") && row.Date("rq_2") == first.Date("rq_2")
                && (row.Text("g_sh") ?? "").Trim() == (first.Text("g_sh") ?? "").Trim(), "invoice-header", "同一张发票的日期、认证日期和税号必须一致。");
            Require(InvoiceMonth.From(row.Date("rq")!.Value).CompareTo(state.OpenMonth) >= 0, "closed", "发票日期小于已经结账日期，不能存盘！");
            if (row.Date("rq_2") is { } certified)
                Require(InvoiceMonth.From(certified).CompareTo(state.OpenMonth) >= 0, "closed", "认证日期小于已经结账日期，不能存盘！");
            foreach (var name in new[] { "sl", "dj", "je0", "slv", "se", "je1", "nf", "yf", "p_nf", "p_yf", "p_pzlx", "p_pzbh", "xh" })
                _ = row.Number(name);
            if (input.Direction == InvoiceDirection.Output)
            {
                if (row.Number("sl") is { } quantity && row.Number("dj") is { } price && row.Number("je0") is { } net)
                    Require(Math.Abs(quantity * price - net) < .01m, "quantity-price", "金额不等于数量乘单价！");
                if (row.Number("slv") is { } rate && row.Number("je0") is { } amount && row.Number("se") is { } tax)
                    Require(Math.Abs(tax - amount * rate) < .02m, "tax-rate", "税额不等于金额乘税率！");
            }
        }
        return new(id, version, key, input.Rows, Digest(input.Rows));
    }

    private static string Digest(ImmutableArray<LegacyInvoiceRow> rows)
    {
        // Column and line enumeration order do not turn the same file into a new invoice.
        var canonical = rows.Select(row => JsonSerializer.Serialize(row.Fields.OrderBy(x => x.Key, StringComparer.Ordinal)
            .ToDictionary(x => x.Key, x => x.Value))).Order(StringComparer.Ordinal);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(canonical))));
    }
    private InvoiceWorkspace Current(long revision)
    {
        var state = store.Read();
        Require(state.Revision == revision, "stale", "数据已经变化，请刷新后重试。");
        return state;
    }
    private void Publish(InvoiceWorkspace state, InvoiceWorkspace next)
    {
        Require(store.TrySave(state.Revision, next with { Revision = checked(state.Revision + 1) }), "stale", "数据已经变化，本次操作未保存。");
    }
    private static InvoiceDocument Find(InvoiceWorkspace state, Guid id) => state.Documents.FirstOrDefault(x => x.Id == id)
        ?? throw new InvoiceException("invoice-missing", "未找到发票。");
    private static string Flag(LegacyInvoiceRow row, string name) => (row.Text(name) ?? "0").Trim();
    private static bool NoBackLink(LegacyInvoiceRow row) => new[] { "p_nf", "p_yf", "p_pzlx", "p_pzbh", "p_pjdh" }
        .All(name => string.IsNullOrWhiteSpace(row.Text(name)) || row.Text(name) == "0");
    private static void OpenForMutation(InvoiceWorkspace state, InvoiceDocument doc)
    {
        Require(InvoiceMonth.From(doc.IssueDate).CompareTo(state.OpenMonth) >= 0
            && InvoiceMonth.From(doc.AccountingDate).CompareTo(state.OpenMonth) >= 0, "closed", "已经结账，不能修改或删除！");
    }
    private static void Editable(InvoiceWorkspace state, InvoiceDocument doc)
    {
        OpenForMutation(state, doc);
        Require(doc.IsUnreviewed, "reviewed", "已经审核或含未知审核状态，不能修改或删除！");
        Require(doc.IsUnprocessed && doc.Rows.All(NoBackLink), "processed", "已经后续处理，不能修改或删除！");
    }
    private static ImmutableArray<InvoiceDocument> Replace(ImmutableArray<InvoiceDocument> docs, InvoiceDocument changed)
        => docs.Select(x => x.Id == changed.Id ? changed : x).ToImmutableArray();
    private static void ValidateAccount(InvoiceWorkspace state, string code)
    {
        var account = state.Accounts.FirstOrDefault(x => x.Code == code);
        Require(account is not null && account.Active && account.IsLeaf, "account", $"科目 {code} 不存在、停用或非明细科目，请在参数设置处核对。");
    }
    private static void Require([DoesNotReturnIf(false)] bool condition, string code, string message)
    {
        if (!condition) throw new InvoiceException(code, message);
    }
}
