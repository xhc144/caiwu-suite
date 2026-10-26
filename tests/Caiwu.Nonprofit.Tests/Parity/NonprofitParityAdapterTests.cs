using System.Text.Json;
using Caiwu.Contracts;
using Caiwu.Nonprofit.Parity;
using Caiwu.Nonprofit.Writable;

namespace Caiwu.Nonprofit.Tests.Parity;

/// <summary>Adapter contract tests only. ContractHost is deliberately not evidence of Core/SQLite behavior.</summary>
public sealed class NonprofitParityAdapterTests
{
    private static readonly DateTimeOffset At = new(2026, 1, 10, 0, 0, 0, TimeSpan.Zero);
    private sealed class Authorizer : INonprofitAuthorizer
    {
        internal bool Denied;
        public void Require(string operatorId, NonprofitPermission permission)
        { if (Denied) throw new UnauthorizedAccessException("synthetic contract authorization denied"); }
    }
    private static NonprofitBookDefinition Definition() => new(Guid.NewGuid(), "N1", "合成契约账", "a54", "synthetic:chart",
        2026, 1, [new("1002", "银行", null, "1002", NonprofitAccountKind.Asset, false, true, new(), []),
            new("4101", "捐赠", null, "4101", NonprofitAccountKind.Income, true, true, new(), [])],
        [new("grant", 1, "p", RestrictionSourceKind.ExternalProvider, "synthetic:grant", [new(RestrictionConditionKind.Purpose, "合成用途")])],
        [new("xt", "unknown_original_column", "numeric(24,8)", "12.34567891")]);
    private static NonprofitVoucherDraft Draft() => new(null, new(2026, 1, 10), "记", null, 0,
        NonprofitMovementRole.Activity, "synthetic:donation-recognition", [
            new(Guid.NewGuid(), "1002", "捐赠到账", 10, 0, null, null,
                new("USD", 1.23456789m, 8.100000001m, 2.34567891m, 4.56789123m, "箱", "p", "c", "d", "person", "cash", "settlement", "bill", "contract", new(2026, 12, 31)),
                [new("pz", "unknown_variant", "double", "1.23456789012345E+1")]),
            new(Guid.NewGuid(), "4101", "限定捐赠", 0, 10, new(RestrictionClass.Restricted, "grant", 1, "p"), null, new(), [])],
        [new("pzdj", "future_flag", "char(1)", "X")]);

    [Fact]
    public void CompleteDraftAndNormalizedLinesUseOneHostCallAndRemainJoinedAfterReopen()
    {
        var d = Definition(); var host = new ContractHost(d); var auth = new Authorizer(); var adapter = new NonprofitParityAdapter(host, auth);
        adapter.RegisterBookDefinition(host.GetModuleSnapshot(), d, "maker");
        var edited = host.GetModuleSnapshot(); var draft = Draft(); var id = Guid.NewGuid(); var receipt = adapter.AcceptDraft(edited, id, ["donation:stable-001"], draft, "maker");
        Assert.Equal(1, host.ProposalCalls); Assert.Equal(1, host.DocumentCalls);
        Assert.Equal(edited.Ledger.Revision + 1, receipt.Revision);
        Assert.Equal(VoucherStatus.Draft, host.GetModuleSnapshot().Ledger.Vouchers.Single().Status);
        var again = new NonprofitParityAdapter(host, auth).ReadAcceptedVouchers(host.GetModuleSnapshot()).Single();
        Assert.Equal(receipt.VoucherId, again.LedgerVoucher!.Id); Assert.Equal(draft.Lines[0].Id, again.Enriched.Draft.Lines[0].Id);
        Assert.Equal(draft.Lines[0].Dimensions, again.Enriched.Draft.Lines[0].Dimensions);
        Assert.Equal(draft.Lines[0].OriginalFields, again.Enriched.Draft.Lines[0].OriginalFields);
        Assert.Equal(draft.Lines[1].Classification, again.Enriched.Draft.Lines[1].Classification);
        Assert.Equal(draft.OriginalFields, again.Enriched.Draft.OriginalFields);
        Assert.Equal(d.OriginalFields, adapter.ReadBookDefinition(host.GetModuleSnapshot()).OriginalFields);
        Assert.Equal(ContractHost.UnrelatedJson, host.GetModuleSnapshot().Modules.Single(m => m.ModuleId == "another.module").Documents.Single().PayloadJson);
    }

    [Fact]
    public void FailedHostCommitAndStaleTokenNeverSaveAuthorityInExternalState()
    {
        var d = Definition(); var host = new ContractHost(d); var adapter = new NonprofitParityAdapter(host, new Authorizer());
        adapter.RegisterBookDefinition(host.GetModuleSnapshot(), d, "maker"); var edited = host.GetModuleSnapshot(); var before = JsonSerializer.Serialize(edited);
        host.FailCommit = true; Assert.Throws<IOException>(() => adapter.AcceptDraft(edited, Guid.NewGuid(), ["source-1"], Draft(), "maker"));
        Assert.Equal(before, JsonSerializer.Serialize(host.GetModuleSnapshot()));
        host.FailCommit = false; host.Current = host.Current with { Ledger = host.Current.Ledger with { Revision = host.Current.Ledger.Revision + 1 } };
        Assert.Throws<StoreConcurrencyException>(() => adapter.AcceptDraft(edited, Guid.NewGuid(), ["source-1"], Draft(), "maker"));
        Assert.Empty(host.Current.Ledger.Vouchers); Assert.Empty(host.Current.ProposalReceipts);
    }

    [Fact]
    public void ConsumedSourcesRemainClaimedAfterDraftDeletionAndCoreEditsRequireEnrichedRepair()
    {
        var d = Definition(); var host = new ContractHost(d); var adapter = new NonprofitParityAdapter(host, new Authorizer());
        adapter.RegisterBookDefinition(host.Current, d, "maker"); adapter.AcceptDraft(host.Current, Guid.NewGuid(), ["source-1"], Draft(), "maker");
        var v = host.Current.Ledger.Vouchers.Single();
        host.Current = host.Current with { Ledger = host.Current.Ledger with { Vouchers = [v with { AttachmentCount = 4 }] } };
        Assert.Equal("NP_PARITY_VOUCHER_CHANGED", Assert.Throws<NonprofitValidationException>(() => adapter.ReadAcceptedVouchers(host.Current)).Code);
        host.Current = host.Current with { Ledger = host.Current.Ledger with { Vouchers = [] } };
        Assert.Null(adapter.ReadAcceptedVouchers(host.Current).Single().LedgerVoucher);
        Assert.Equal("NP_DUPLICATE_REQUEST", Assert.Throws<NonprofitValidationException>(() => adapter.AcceptDraft(host.Current, Guid.NewGuid(), ["source-1"], Draft(), "maker")).Code);
    }

    [Fact]
    public void MissingDefinitionWrongRegimeChangedChartAndPermissionCannotDowngradePayload()
    {
        var d = Definition(); var host = new ContractHost(d); var auth = new Authorizer(); var adapter = new NonprofitParityAdapter(host, auth);
        Assert.Equal("NP_METADATA_MISSING", Assert.Throws<NonprofitValidationException>(() => adapter.AcceptDraft(host.Current, Guid.NewGuid(), ["source-1"], Draft(), "maker")).Code);
        auth.Denied = true; Assert.Throws<UnauthorizedAccessException>(() => adapter.RegisterBookDefinition(host.Current, d, "maker")); Assert.Equal(0, host.DocumentCalls);
        auth.Denied = false; adapter.RegisterBookDefinition(host.Current, d, "maker");
        Assert.Equal("NP_METADATA_EXISTS", Assert.Throws<NonprofitValidationException>(() => adapter.RegisterBookDefinition(host.Current, d, "maker")).Code);
        var foreign = host.Current with { Ledger = host.Current.Ledger with { Book = host.Current.Ledger.Book with { Regime = AccountingRegime.Enterprise } } };
        Assert.Equal("NP_REGIME", Assert.Throws<NonprofitValidationException>(() => adapter.ReadBookDefinition(foreign)).Code);
        var chartChanged = host.Current with { Ledger = host.Current.Ledger with { Accounts = host.Current.Ledger.Accounts.Select(a => a with { Name = "changed" }).ToArray() } };
        Assert.Equal("NP_CHART_CHANGED", Assert.Throws<NonprofitValidationException>(() => adapter.ReadBookDefinition(chartChanged)).Code);
    }

    [Fact]
    public void HigherSchemaUnknownMembersAndDuplicateKeysAreExplicitReadFailures()
    {
        var d = Definition(); var host = new ContractHost(d); var adapter = new NonprofitParityAdapter(host, new Authorizer());
        adapter.RegisterBookDefinition(host.Current, d, "maker"); var good = host.Current;
        ModuleLedgerSnapshot Changed(LedgerModuleDocument doc) => good with { Modules = good.Modules.Select(m => m.ModuleId == NonprofitParityAdapter.ModuleId ? m with { Documents = [doc] } : m).ToArray() };
        var original = good.Modules.Single(m => m.ModuleId == NonprofitParityAdapter.ModuleId).Documents.Single();
        Assert.Throws<InvalidDataException>(() => adapter.ReadBookDefinition(Changed(original with { SchemaVersion = 2 })));
        Assert.Throws<JsonException>(() => adapter.ReadBookDefinition(Changed(original with { PayloadJson = original.PayloadJson.Insert(1, "\"FutureField\":1,") })));
        Assert.Throws<InvalidDataException>(() => adapter.ReadBookDefinition(Changed(original with { PayloadJson = original.PayloadJson.Insert(1, "\"BookCode\":\"N1\",") })));
    }

    [Fact]
    public void ReviewAndPostingUseExactHostContextAndReconstructPermanentLineClassification()
    {
        var d = Definition(); var host = new ContractHost(d); var adapter = new NonprofitParityAdapter(host, new Authorizer());
        adapter.RegisterBookDefinition(host.Current, d, "maker"); var id = Guid.NewGuid(); adapter.AcceptDraft(host.Current, id, ["stable-1"], Draft(), "maker");
        var unreviewed = host.GetModuleSnapshot(); adapter.ReviewAccepted(unreviewed, id, "reviewer");
        Assert.Throws<StoreConcurrencyException>(() => adapter.ReviewAccepted(unreviewed, id, "reviewer"));
        Assert.Equal("NP_OPENING_REQUIRED", Assert.Throws<NonprofitValidationException>(() => adapter.PostAccepted(host.Current, id, "poster")).Code);
        adapter.ConfirmOpeningClassification(host.Current, [], "synthetic:confirmed-zero-core-opening", "maker");
        adapter.PostAccepted(host.Current, id, "poster");
        var reconstructed = adapter.ReadWritableSnapshot(host.Current); var posted = reconstructed.Vouchers.Single();
        Assert.Equal(NonprofitVoucherState.Posted, posted.State); Assert.Equal("poster", posted.PostedBy);
        Assert.NotNull(posted.PostedAt); Assert.NotNull(posted.ReviewedAt);
        Assert.Equal(RestrictionClass.Restricted, posted.Lines[1].Classification!.Class);
        Assert.Equal("grant", posted.Lines[1].Classification!.RestrictionId);
        Assert.True(reconstructed.OpeningConfirmed);
        Assert.Equal(10, NonprofitLedgerService.Balances(reconstructed, new(2026, 1, 31)).Single(b => b.AccountCode == "1002").NetDebit);
    }

    [Fact]
    public void MismatchedOpeningOrMissingActualPostingAuditIsNeverInvented()
    {
        var d = Definition(); var host = new ContractHost(d); var adapter = new NonprofitParityAdapter(host, new Authorizer());
        adapter.RegisterBookDefinition(host.Current, d, "maker");
        Assert.Throws<NonprofitValidationException>(() => adapter.ConfirmOpeningClassification(host.Current,
            [new(Guid.NewGuid(), "1002", 1, 0, null, new(), []), new(Guid.NewGuid(), "4101", 0, 1, new(RestrictionClass.Unrestricted, null, null, null), new(), [])], "synthetic:mismatch", "maker"));
        adapter.ConfirmOpeningClassification(host.Current, [], "synthetic:zero", "maker"); var id = Guid.NewGuid();
        adapter.AcceptDraft(host.Current, id, ["stable-1"], Draft(), "maker"); adapter.ReviewAccepted(host.Current, id, "reviewer"); adapter.PostAccepted(host.Current, id, "poster");
        host.Current = host.Current with { Ledger = host.Current.Ledger with { AuditEvents = host.Current.Ledger.AuditEvents.Where(a => a.Action != "Post").ToArray() } };
        Assert.Equal("NP_AUDIT_PROVENANCE", Assert.Throws<NonprofitValidationException>(() => adapter.ReadWritableSnapshot(host.Current)).Code);
    }

    private sealed class ContractHost : IParityLedgerService, ILedgerService
    {
        internal const string UnrelatedJson = "{ \"unknown\":123.456789012345678901,\"raw\":\"保留\" }";
        internal ModuleLedgerSnapshot Current;
        internal bool FailCommit;
        internal int ProposalCalls, DocumentCalls;
        internal ContractHost(NonprofitBookDefinition d) => Current = new(new(0,
            new(d.BookId, d.Name, AccountingRegime.Nonprofit, "synthetic", 2026, 1, 0, At),
            d.Accounts.Select(a => new Account(a.Code, a.Name, a.ParentCode, a.CreditNormal ? BalanceDirection.Credit : BalanceDirection.Debit, a.Active, 0, 0)).ToArray(), [], []),
            [new("another.module", [new("other", 7, UnrelatedJson)])], []);
        public ModuleLedgerSnapshot GetModuleSnapshot() => JsonSerializer.Deserialize<ModuleLedgerSnapshot>(JsonSerializer.Serialize(Current))!;
        private void Check(LedgerMutationContext c)
        {
            if (c.ExpectedBookId != Current.Ledger.Book.Id || c.ExpectedRevision != Current.Ledger.Revision) throw new StoreConcurrencyException("synthetic stale context");
            if (FailCommit) throw new IOException("synthetic atomic commit failure");
        }
        private IReadOnlyList<ModuleDocumentCollection> Changes(string moduleId, IReadOnlyList<ModuleDocumentChange> changes)
        {
            var docs = Current.Modules.SingleOrDefault(m => m.ModuleId == moduleId)?.Documents.ToDictionary(d => d.DocumentId) ?? [];
            foreach (var c in changes) { if (c.Document is null) docs.Remove(c.DocumentId); else docs[c.DocumentId] = c.Document; }
            return Current.Modules.Where(m => m.ModuleId != moduleId).Append(new(moduleId, docs.Values.ToArray())).ToArray();
        }
        public void SaveModuleDocuments(ModuleDocumentBatch batch, string operatorName)
        {
            Check(batch.Context); var modules = Changes(batch.ModuleId, batch.Changes);
            Current = Current with { Ledger = Current.Ledger with { Revision = Current.Ledger.Revision + 1 }, Modules = modules }; DocumentCalls++;
        }
        public ModuleVoucherReceipt AcceptVoucherProposal(VoucherProposal p, string operatorName)
        {
            Check(p.Context); var modules = Changes(p.ModuleId, p.Changes); var next = Current.Ledger.Revision + 1;
            var v = new Voucher(Guid.NewGuid(), p.Date, p.Kind.Trim(), p.Number ?? 1, p.AttachmentCount, operatorName, null, VoucherStatus.Draft,
                p.Lines.Select(l => l with { AccountCode = l.AccountCode.Trim(), Summary = l.Summary.Trim() }).ToArray());
            var receipt = new ModuleVoucherReceipt(p.ProposalId, p.ModuleId, p.SourceKeys, v.Id, next);
            Current = new(Current.Ledger with { Revision = next, Vouchers = Current.Ledger.Vouchers.Append(v).ToArray() }, modules, Current.ProposalReceipts.Append(receipt).ToArray());
            ProposalCalls++; return receipt;
        }
        public LedgerSnapshot GetSnapshot() => GetModuleSnapshot().Ledger;
        private void Change(Guid id, string actor, LedgerMutationContext? context, string action, Func<Voucher, Voucher> change)
        {
            Check(context ?? throw new StoreConcurrencyException("missing synthetic context")); var v = Current.Ledger.Vouchers.Single(v => v.Id == id);
            var changed = change(v); var audit = new AuditEvent(Guid.NewGuid(), DateTimeOffset.UtcNow, actor, action, id, "synthetic host event");
            Current = Current with { Ledger = Current.Ledger with { Revision = Current.Ledger.Revision + 1,
                Vouchers = Current.Ledger.Vouchers.Select(v => v.Id == id ? changed : v).ToArray(), AuditEvents = Current.Ledger.AuditEvents.Append(audit).ToArray() } };
        }
        public void Review(Guid id, string reviewer, LedgerMutationContext? context = null) => Change(id, reviewer, context, "Review", v =>
            v.Status == VoucherStatus.Draft && v.PreparedBy != reviewer ? v with { Status = VoucherStatus.Reviewed, ReviewedBy = reviewer } : throw new InvalidOperationException("synthetic review guard"));
        public void Post(Guid id, string actor, LedgerMutationContext? context = null) => Change(id, actor, context, "Post", v =>
            v.Status == VoucherStatus.Reviewed ? v with { Status = VoucherStatus.Posted } : throw new InvalidOperationException("synthetic posting guard"));
        public void CancelReview(Guid id, string actor, LedgerMutationContext? context = null) => Change(id, actor, context, "CancelReview", v =>
            v.Status == VoucherStatus.Reviewed ? v with { Status = VoucherStatus.Draft, ReviewedBy = null } : throw new InvalidOperationException("synthetic review guard"));
        public void DeleteDraft(Guid id, string actor, LedgerMutationContext? context = null) => throw new NotSupportedException("not used by this contract host");
        public void SaveAccount(Account a, string actor, LedgerMutationContext? context = null) => throw new NotSupportedException("not used by this contract host");
        public void DeleteAccount(string code, string actor, LedgerMutationContext? context = null) => throw new NotSupportedException("not used by this contract host");
        public void SetOpeningBalances(IReadOnlyList<OpeningBalance> values, string actor, LedgerMutationContext? context = null) => throw new NotSupportedException("not used by this contract host");
        public Voucher SaveDraft(VoucherDraft draft, string actor) => throw new NotSupportedException("not used by this contract host");
        public void CloseMonth(int month, string actor, LedgerMutationContext? context = null) => throw new NotSupportedException("not used by this contract host");
        public IReadOnlyList<TrialBalanceRow> GetTrialBalance(DateOnly from, DateOnly to) => throw new NotSupportedException("not used by this contract host");
        public IReadOnlyList<LedgerEntryRow> GetLedger(string account, DateOnly from, DateOnly to) => throw new NotSupportedException("not used by this contract host");
    }
}
