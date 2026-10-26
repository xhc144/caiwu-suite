using System.Text.Json;
using Caiwu.Nonprofit.Reporting;
using Caiwu.Nonprofit.Writable;
using static Caiwu.Nonprofit.Tests.WritableLedgerFixture;

namespace Caiwu.Nonprofit.Tests;

public sealed class WritableLedgerTests
{
    [Fact]
    public void SavedReviewedPostedClosedReopenedAndReversedRoundTripIsReal()
    {
        using var f = new WritableLedgerFixture(); f.CompleteOrdinary();
        var prior = f.Service.GetSnapshot();
        var priorReport = new WritableNonprofitStatementDataSource(f.Service.GetSnapshot, f.Review()).Calculate(Clock);
        Assert.False(priorReport.BalanceSheet.HasAllRequiredValues); // Income has not yet been closed.
        var closing = f.CloseIncomeExpense(); f.Service.CloseMonth(1, f.Context, "closer");
        var readAgain = new NonprofitLedgerService(new AtomicNonprofitLedgerStore(f.FilePath), f.Authorization);
        var s = readAgain.GetSnapshot(); Assert.Equal(1, s.ClosedThroughMonth); Assert.Equal(5, s.Vouchers.Count);
        Assert.All(s.Vouchers, v => Assert.Equal(NonprofitVoucherState.Posted, v.State));
        Assert.All(s.Vouchers.SelectMany(v => v.Lines), l => Assert.NotEqual(Guid.Empty, l.Id));
        Assert.Equal(1230, readAgain.GetBalances(new(2026, 1, 31)).Where(b => b.AccountCode == "1002").Sum(b => b.NetDebit));
        var reports = new WritableNonprofitStatementDataSource(readAgain.GetSnapshot, f.Review()).Calculate(Clock);
        Assert.True(reports.HasCompleteReconciledCalculations, string.Join("\n", reports.Issues));
        var net = reports.ActivityStatement.Lines.Single(l => l.Key == "net-change");
        Assert.Equal(new decimal?[] { 80, 150, 230, 80, 150, 230 }, net.Values.Select(v => v.Amount));
        Assert.Equal(1080, reports.BalanceSheet.Lines.Single(l => l.Key == "net-assets.unrestricted").Values[1].Amount);
        Assert.Equal(150, reports.BalanceSheet.Lines.Single(l => l.Key == "net-assets.restricted").Values[1].Amount);
        Assert.False(reports.CanIssueAsFormal);
        Assert.Equal(priorReport.ActivityStatement.Lines.Single(l => l.Key == "donation").Values.Select(v => v.Amount),
            reports.ActivityStatement.Lines.Single(l => l.Key == "donation").Values.Select(v => v.Amount));
        Assert.Throws<NonprofitValidationException>(() => readAgain.ReversePost(1, 1, f.Context, "poster"));
        f.Service.ReopenLastMonth(f.Context, "closer"); f.Service.ReversePost(1, 1, f.Context, "poster");
        f.Service.CancelReview(closing.Id, f.Context, "reviewer"); f.Service.DeleteDraft(closing.Id, f.Context, "maker");
        Assert.Equal(1000, f.Service.GetBalances(new(2026, 1, 31)).Where(b => b.AccountCode == "1002").Sum(b => b.NetDebit));
        Assert.Equal(4, f.Service.GetSnapshot().Vouchers.Count);
        Assert.Contains(f.Service.GetSnapshot().Audit, a => a.Action == "ReversePost");
        Assert.True(prior.Revision < s.Revision);
    }

    [Fact]
    public void WrongBookStaleRevisionAndPermissionCannotWrite()
    {
        using var f = new WritableLedgerFixture(); var before = File.ReadAllBytes(f.FilePath); var stale = f.Context;
        Assert.Throws<NonprofitConcurrencyException>(() => f.Service.SaveDraft(Draft(Line("1002", 1, 0), Line("4101", 0, 1, U)), stale with { BookId = Guid.NewGuid() }, "maker"));
        f.Authorization.Deny = true;
        Assert.Throws<UnauthorizedAccessException>(() => f.Donation(1, U)); Assert.Equal(before, File.ReadAllBytes(f.FilePath));
        f.Authorization.Deny = false; f.Donation(1, U); var committed = File.ReadAllBytes(f.FilePath);
        Assert.Throws<NonprofitConcurrencyException>(() => f.Service.SaveDraft(Draft(Line("1002", 1, 0), Line("4101", 0, 1, U)), stale, "maker"));
        Assert.Equal(committed, File.ReadAllBytes(f.FilePath));
    }

    [Fact]
    public void StoreCompareAndSwapDoesNotOverwriteAnotherWriter()
    {
        using var f = new WritableLedgerFixture(); var first = f.Service.GetSnapshot(); var second = new AtomicNonprofitLedgerStore(f.FilePath);
        f.Donation(1, U); var committed = File.ReadAllBytes(f.FilePath);
        Assert.Throws<NonprofitConcurrencyException>(() => second.Commit(new(first.BookId, first.Revision), first with { Revision = first.Revision + 1 }));
        Assert.Equal(committed, File.ReadAllBytes(f.FilePath));
        using var lease = new FileStream(f.FilePath + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        Assert.Throws<NonprofitConcurrencyException>(() => f.Donation(2, U)); Assert.Equal(committed, File.ReadAllBytes(f.FilePath));
    }

    [Fact]
    public void ReviewSeparationPostingSkipsDraftAndOpeningRemainsLockedAfterReverse()
    {
        using var f = new WritableLedgerFixture(); var v = f.Donation(1, U); var draft = f.Donation(2, R);
        Assert.Equal("NP_REVIEW", Assert.Throws<NonprofitValidationException>(() => f.Service.Review(v.Id, f.Context, "maker")).Code);
        f.Service.Review(v.Id, f.Context, "reviewer"); var result = f.Service.PostMonth(1, f.Context, "poster");
        Assert.Equal([v.Id], result.Posted); Assert.Equal([draft.Id], result.SkippedUnreviewed);
        Assert.Throws<NonprofitValidationException>(() => f.Service.CancelReview(v.Id, f.Context, "reviewer"));
        Assert.Throws<NonprofitValidationException>(() => f.Service.CloseMonth(1, f.Context, "closer"));
        f.Service.ReversePost(1, 1, f.Context, "poster");
        Assert.Equal("NP_OPENING_LOCKED", Assert.Throws<NonprofitValidationException>(() => f.Service.SetOpening([], f.Context, "maker")).Code);
    }

    [Fact]
    public void MissingOpeningUnbalancedSubCentDuplicateIdsAndMissingRestrictionAreRejectedAtomically()
    {
        using var f = new WritableLedgerFixture(confirmOpening: false); var v = f.Donation(1, U); f.ReviewAll();
        Assert.Equal("NP_OPENING_REQUIRED", Assert.Throws<NonprofitValidationException>(() => f.Service.PostMonth(1, f.Context, "poster")).Code);
        var before = File.ReadAllBytes(f.FilePath);
        Assert.Throws<NonprofitValidationException>(() => f.Save(Draft(Line("1002", 2, 0), Line("4101", 0, 1, U))));
        Assert.Throws<NonprofitValidationException>(() => f.Save(Draft(Line("1002", .001m, 0), Line("4101", 0, .001m, U))));
        var line = Line("1002", 1, 0); Assert.Throws<NonprofitValidationException>(() => f.Save(Draft(line, line)));
        Assert.Throws<NonprofitValidationException>(() => f.Donation(1, R with { RestrictionVersion = 2 }));
        Assert.Equal(before, File.ReadAllBytes(f.FilePath)); Assert.NotEqual(Guid.Empty, v.Id);
    }

    [Fact]
    public void EveryOriginalFieldAndHighPrecisionAuxiliaryDimensionSurvivesEditReviewPostAndReload()
    {
        var flags = new AccountDimensions(ForeignCurrency: true, Quantity: true, Project: true, Counterparty: true,
            Department: true, Person: true, CashFlow: true, Bank: true, Settlement: true);
        var fx = new NonprofitLedgerAccount("1009", "合成复币数量账户", null, "1009", NonprofitAccountKind.Asset, false, true, flags,
            [new("kmbm", "fbs", "char(1)", "1"), new("kmbm", "sls", "char(1)", "1")]);
        using var f = new WritableLedgerFixture(additional: [fx]);
        var dims = new LineDimensions("USD", 1.23456789m, 7.123456789m, .123456789m, 8.7654321m,
            "箱", "p", "c", "d", "person", "cash", "settle", "bill", "contract", new(2026, 12, 31));
        OriginalField[] original = [new("pz", "pz_jf", "double", "1.23456789012345E+2"), new("pz", "unknown_variant_column", "numeric(24,8)", "123.45678901"), new("pz", "null_value", "char(10)", null)];
        var v = f.Save(Draft(Line("1009", 10, 0, dimensions: dims, fields: original), Line("1002", 0, 10)) with { OriginalFields = [new("pzdj", "pzdj_bz", "char(1)", "0")] });
        var edited = f.Service.SaveDraft(new(v.Id, v.Date, v.Kind, v.Number, 3, v.Role, v.EvidenceReference,
            v.Lines.Select(l => l with { Summary = "修改规范摘要", OriginalFields = [] }).ToArray(), []), f.Context, "maker");
        f.ReviewAll(); f.Service.PostMonth(1, f.Context, "poster"); var saved = new AtomicNonprofitLedgerStore(f.FilePath).Read().Vouchers.Single();
        Assert.Equal(original, saved.Lines[0].OriginalFields); Assert.Equal(dims, saved.Lines[0].Dimensions);
        Assert.Equal(v.Lines[0].Id, edited.Lines[0].Id); Assert.Equal(3, saved.AttachmentCount);
        Assert.Single(saved.OriginalFields); Assert.Equal(fx.OriginalFields, f.Service.GetSnapshot().Accounts.Single(a => a.Code == "1009").OriginalFields);
    }

    [Fact]
    public void ReportMissingAnalysisAndChangedOriginalDimensionNeverBecomeCompleteOrReuseReview()
    {
        using var f = new WritableLedgerFixture(); f.CompleteOrdinary(); f.CloseIncomeExpense();
        var source = new WritableNonprofitStatementDataSource(f.Service.GetSnapshot, f.Review(completeAnalyses: false));
        Assert.False(source.Calculate(Clock).HasCompleteReconciledCalculations);
        var snapshot = f.Service.GetSnapshot(); var review = f.Review();
        var changed = snapshot with { OriginalFields = [new("xt", "extra", "varchar(100)", "changed without revision")] };
        Assert.Throws<ClassificationStaleException>(() => new WritableNonprofitStatementDataSource(() => changed, review));
        f.Donation(1, U); Assert.Throws<ClassificationStaleException>(() => source.Calculate(Clock));
        Assert.Throws<ArgumentException>(() => new WritableNonprofitStatementDataSource(f.Service.GetSnapshot,
            f.Review() with { BalanceAnalyses = [new(BalanceFact.BankDeposits, 0, 0, "override")] }));
    }

    [Fact]
    public void NegativeDonationClosingIsBalancedAndExcludedFromOrdinaryTurnover()
    {
        using var f = new WritableLedgerFixture();
        f.Save(Draft(Line("4101", 15, 0, U), Line("1002", 0, 15))); f.ReviewAll(); f.Service.PostMonth(1, f.Context, "poster");
        var closing = f.CloseIncomeExpense(); Assert.All(closing.Lines, l => Assert.True(l.Debit >= 0 && l.Credit >= 0));
        var result = new WritableNonprofitStatementDataSource(f.Service.GetSnapshot, f.Review()).Calculate(Clock);
        Assert.True(result.HasCompleteReconciledCalculations, string.Join("\n", result.Issues));
        Assert.Equal(-15, result.ActivityStatement.Lines.Single(l => l.Key == "donation").Values[0].Amount);
        Assert.Equal(985, result.BalanceSheet.Lines.Single(l => l.Key == "net-assets.unrestricted").Values[1].Amount);
    }

    [Fact]
    public void NumberGapsRequireExplicitAcknowledgementAndRecordedRenumbering()
    {
        using var f = new WritableLedgerFixture(); f.Save(Draft(Line("1002", 10, 0), Line("1002", 0, 10)) with { Number = 3 });
        f.ReviewAll(); f.Service.PostMonth(1, f.Context, "poster");
        Assert.Equal("NP_NUMBER_GAP", Assert.Throws<NonprofitValidationException>(() => f.Service.CloseMonth(1, f.Context, "closer")).Code);
        Assert.Throws<NonprofitValidationException>(() => f.Service.RenumberMonth(1, false, f.Context, "closer"));
        f.Service.RenumberMonth(1, true, f.Context, "closer"); f.Service.CloseMonth(1, f.Context, "closer");
        Assert.Equal(1, f.Service.GetSnapshot().Vouchers.Single().Number); Assert.Contains(f.Service.GetSnapshot().Audit, a => a.Action == "RenumberMonth" && a.Detail.Contains("3->1"));
    }

    [Fact]
    public void CorruptionFutureFieldsDuplicateKeysAndOriginalFileExtensionsAreRejected()
    {
        using var f = new WritableLedgerFixture(); var good = File.ReadAllText(f.FilePath);
        File.WriteAllText(f.FilePath, good.Replace("\"Revision\": 1", "\"Revision\": 99", StringComparison.Ordinal));
        Assert.Throws<InvalidDataException>(() => f.Store.Read());
        File.WriteAllText(f.FilePath, good.Replace("\"SchemaVersion\": 1", "\"SchemaVersion\": 1,\"futureField\":true", StringComparison.Ordinal));
        Assert.Throws<JsonException>(() => f.Store.Read());
        File.WriteAllText(f.FilePath, good.Replace("\"Revision\": 1", "\"Revision\": 999,\"Revision\":1", StringComparison.Ordinal));
        Assert.Throws<InvalidDataException>(() => f.Store.Read());
        Assert.Throws<ArgumentException>(() => new AtomicNonprofitLedgerStore(Path.Combine(f.DirectoryPath, "original.db")));
    }

    [Fact]
    public void OppositeClassBalancesDoNotMasqueradeAsClosedProfitLoss()
    {
        using var f = new WritableLedgerFixture();
        f.Donation(10, U); f.Save(Draft(Line("4101", 10, 0, R), Line("1002", 0, 10)));
        f.ReviewAll(); f.Service.PostMonth(1, f.Context, "poster");
        var result = new WritableNonprofitStatementDataSource(f.Service.GetSnapshot, f.Review()).Calculate(Clock);
        Assert.False(result.BalanceSheet.HasAllRequiredValues);
        Assert.Equal("NP_CLOSING_REQUIRED", Assert.Throws<NonprofitValidationException>(() => f.Service.CloseMonth(1, f.Context, "closer")).Code);
    }

    [Fact]
    public void PostingBalanceOverflowRollsBackTheCompleteCommand()
    {
        using var f = new WritableLedgerFixture(); var value = 92233720368547758.07m;
        var v = f.Donation(value, U); f.ReviewAll(); var before = File.ReadAllBytes(f.FilePath);
        Assert.Equal("NP_TOTAL_OVERFLOW", Assert.Throws<NonprofitValidationException>(() => f.Service.PostMonth(1, f.Context, "poster")).Code);
        Assert.Equal(before, File.ReadAllBytes(f.FilePath)); Assert.Equal(NonprofitVoucherState.Reviewed, f.Service.GetSnapshot().Vouchers.Single(x => x.Id == v.Id).State);
    }

    [Fact]
    public void SourceClaimsSurviveDraftDeletionAndCannotBeReboundDuringEdit()
    {
        using var f = new WritableLedgerFixture(); var proposal = Guid.NewGuid();
        var draft = Draft(Line("1002", 1, 0), Line("4101", 0, 1, U)) with { SourceProposalId = proposal };
        var v = f.Save(draft);
        Assert.Equal("NP_REQUEST_ID_CONFLICT", Assert.Throws<NonprofitValidationException>(() => f.Save(draft with { Id = v.Id, SourceProposalId = Guid.NewGuid() })).Code);
        var retained = f.Save(draft with { Id = v.Id, SourceProposalId = null }); Assert.Equal(proposal, retained.SourceProposalId);
        f.Service.DeleteDraft(v.Id, f.Context, "maker");
        Assert.Equal("NP_DUPLICATE_REQUEST", Assert.Throws<NonprofitValidationException>(() => f.Save(draft)).Code);
    }
}
