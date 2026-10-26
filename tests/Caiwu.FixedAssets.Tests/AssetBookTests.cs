using System.Collections.Immutable;
using Caiwu.FixedAssets;

namespace Caiwu.FixedAssets.Tests;

public sealed class AssetBookTests
{
    private static readonly DateOnly Jan = new(2026, 1, 1);
    private static readonly AssetPeriod January = new(2026, 1);
    private static readonly AssetPeriod February = new(2026, 2);
    private static readonly AssetBookIdentity Identity = new("minfeiqi", "SYNTHETIC-ASSETS-001", "synthetic", "fixture-v1");
    private static AssetCatalog Catalog => new()
    {
        Categories = [new("01", "合成设备", .05m, "1601")],
        Statuses = [new("01", "使用中", true), new("02", "不计提", false)],
        Departments = [new("01", "合成部门一"), new("02", "合成部门二")],
        Purposes = [new("01", "合成用途", "6602"), new("02", "合成用途二", "5001")],
        DisposalReasons = [new("01", "合成报废")],
        Accounts = [new("1601", true, true), new("1602", true, true), new("1606", true, true),
            new("6602", true, true), new("5001", true, true), new("1002", true, true),
            new("6", true, false), new("9999", false, true)]
    };
    private static AssetBookState Initial => new() { Identity = Identity,
        Settings = new(January, Catalog, "1602", "1606") };
    private static AssetCard A(string code = "A001", decimal cost = 1000, decimal residual = 100, int months = 3) => new()
    {
        Code = code, Name = "合成资产 " + code, CategoryCode = "01", StatusCode = "01", DepartmentCode = "01", PurposeCode = "01",
        PurchaseDate = Jan, UseDate = Jan, OriginalCost = cost, ResidualValue = residual, ResidualRate = .1m, UsefulLifeMonths = months
    };
    private static (InMemoryAssetBookStore Store, AssetBookService Service) Setup(AssetBookState? state = null)
    {
        var store = new InMemoryAssetBookStore(state ?? Initial);
        return (store, new(store, Identity));
    }
    private static AssetRuleException Fails(string code, Action action)
    {
        var ex = Assert.Throws<AssetRuleException>(action); Assert.Equal(code, ex.Code); return ex;
    }
    private static AssetDepreciationBatch Calc(AssetBookService service, AssetPeriod period,
        IReadOnlyDictionary<Guid, decimal>? workloads = null) => service.CalculateDepreciation(service.Read().Revision, period, workloads);

    [Fact]
    public void UseMonthIsZero_NextMonthStarts_ResidualIsExact_AndQueryTracksLedger()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan);
        Assert.Equal(0, Calc(s, January).Total);
        Assert.Equal(300m, Calc(s, February).Total);
        Assert.Equal(300m, Calc(s, new(2026, 3)).Total);
        Assert.Equal(300m, Calc(s, new(2026, 4)).Total);
        Assert.Equal(0, Calc(s, new(2026, 5)).Total);
        var row = Assert.Single(s.Ledger()); Assert.Equal(900m, row.AccumulatedDepreciation); Assert.Equal(100m, row.NetValue);
        Assert.Equal(3, s.Read().Cards[a.Id].DepreciatedMonths);
        Assert.Equal(3, s.DepreciationQuery(2026, 1, 5, true).Length);
    }

    [Theory]
    [InlineData(2024, 2, 29, 2024, 3)]
    [InlineData(2025, 12, 31, 2026, 1)]
    public void LeapAndYearBoundariesUseCalendarMonths(int y, int m, int d, int nextYear, int nextMonth)
    {
        var date = new DateOnly(y, m, d); var opening = new AssetPeriod(y, m);
        var (_, s) = Setup(Initial with { Settings = Initial.Settings with { OpeningPeriod = opening } });
        s.AddCard(0, A() with { PurchaseDate = date, UseDate = date }, date);
        Assert.Equal(0, Calc(s, opening).Total);
        Assert.Equal(300m, Calc(s, new(nextYear, nextMonth)).Total);
    }

    [Theory]
    [InlineData("100.00", "0.00", 3)]
    [InlineData("0.05", "0.01", 7)]
    [InlineData("1234.56", "234.56", 12)]
    public void RoundingNeverCrossesResidualAndFinalInstalmentClearsBasis(string cost, string residual, int months)
    {
        var c = decimal.Parse(cost, System.Globalization.CultureInfo.InvariantCulture);
        var r = decimal.Parse(residual, System.Globalization.CultureInfo.InvariantCulture);
        var (_, s) = Setup(); s.AddCard(0, A(cost:c, residual:r, months:months), Jan); Calc(s, January);
        var total = 0m; var p = February;
        for (var i = 0; i < months; i++, p = p.Next())
        {
            total += Calc(s, p).Total; Assert.True(Assert.Single(s.Ledger()).NetValue >= r);
        }
        Assert.Equal(c - r, total); Assert.Equal(r, Assert.Single(s.Ledger()).NetValue);
    }

    [Fact]
    public void HalfCentRoundsAwayFromZero() => Assert.Equal(.01m, AssetBookService.RoundMoney(.005m));

    [Fact]
    public void DuplicateSkippedAndBackdatedPeriodsLeaveStateUntouched()
    {
        var (store, s) = Setup(); s.AddCard(0, A(), Jan);
        var before = store.Load(); Fails("period-order", () => Calc(s, February)); Assert.Same(before, store.Load());
        Calc(s, January); before = store.Load(); Fails("depreciated-period", () => Calc(s, January)); Assert.Same(before, store.Load());
        Fails("before-opening", () => Calc(s, new(2025, 12))); Assert.Same(before, store.Load());
    }

    [Fact]
    public void WorkloadRequiresExplicitInput_RejectsExcess_AndFinishesAtResidual()
    {
        var (store, s) = Setup(); var a = A() with { Method = AssetDepreciationMethod.UnitsOfProduction, TotalWorkload = 7 };
        s.AddCard(0, a, Jan); Calc(s, January); var before = store.Load();
        Fails("workload-required", () => Calc(s, February)); Assert.Same(before, store.Load());
        Fails("excess-workload", () => Calc(s, February, new Dictionary<Guid, decimal> { [a.Id] = 8 })); Assert.Same(before, store.Load());
        Fails("excess-workload", () => Calc(s, February, new Dictionary<Guid, decimal> { [a.Id] = -1 }));
        Assert.Equal(257.14m, Calc(s, February, new Dictionary<Guid, decimal> { [a.Id] = 2 }).Total);
        Assert.Equal(642.86m, Calc(s, new(2026, 3), new Dictionary<Guid, decimal> { [a.Id] = 5 }).Total);
        Assert.Equal(100m, Assert.Single(s.Ledger()).NetValue);
    }

    [Fact]
    public void AnyBadCardMakesWholeDepreciationAtomic()
    {
        var (store, s) = Setup(); var a = A("A"); var b = A("B") with { Method = AssetDepreciationMethod.UnitsOfProduction, TotalWorkload = 7 };
        s.AddCard(0, a, Jan); s.AddCard(1, b, Jan); Calc(s, January); var before = store.Load();
        Fails("workload-required", () => Calc(s, February)); Assert.Same(before, store.Load());
        Assert.All(s.Ledger(), x => Assert.Equal(0, x.AccumulatedDepreciation));
    }

    [Fact]
    public void NonDepreciatingStatusAndFutureUseDoNotAccrue()
    {
        var (_, s) = Setup(); s.AddCard(0, A("A") with { StatusCode = "02" }, Jan);
        s.AddCard(1, A("B") with { UseDate = new(2026, 3, 1) }, Jan);
        Calc(s, January); Assert.Equal(0, Calc(s, February).Total); Assert.Equal(0, Calc(s, new(2026, 3)).Total);
        Assert.Equal(300m, Calc(s, new(2026, 4)).Total);
    }

    [Fact]
    public void CancelLatestOnly_RestoresEntireCardIncludingMonthlyWorkload_ThenRecalculate()
    {
        var (_, s) = Setup(); var a = A() with { MonthlyDepreciation = 12.34m, MonthlyWorkload = 3 };
        s.AddCard(0, a, Jan); var jan = Calc(s, January); var feb = Calc(s, February);
        Fails("cancel-order", () => s.CancelDepreciation(s.Read().Revision, jan.Id));
        s.CancelDepreciation(s.Read().Revision, feb.Id);
        Assert.Equal(feb.Before[a.Id], s.Read().Cards[a.Id]);
        s.CancelDepreciation(s.Read().Revision, jan.Id); Assert.Equal(a, s.Read().Cards[a.Id]);
        Assert.Empty(s.DepreciationQuery(2026, 1, 12, false));
        Assert.Equal(0, Calc(s, January).Total); Assert.Equal(300m, Calc(s, February).Total);
    }

    [Fact]
    public void LaterMovementCannotBeOverwrittenByCancel()
    {
        var (store, s) = Setup(); var a = A(); s.AddCard(0, a, Jan); Calc(s, January); var feb = Calc(s, February);
        s.Transfer(s.Read().Revision, a.Id, new(2026, 3, 1), "02", "02", "新位置", "合成调拨"); var before = store.Load();
        Fails("later-movement", () => s.CancelDepreciation(s.Read().Revision, feb.Id)); Assert.Same(before, store.Load());
    }

    [Fact]
    public void OriginalCostAdjustmentIsProspectiveAndHistoryHasBeforeAfter()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan); Calc(s, January); Calc(s, February);
        s.AdjustOriginalCost(s.Read().Revision, a.Id, new(2026, 3, 1), 1400m, 100m, "合成改造");
        Assert.Equal(500m, Calc(s, new(2026, 3)).Total); Assert.Equal(500m, Calc(s, new(2026, 4)).Total);
        var adjustment = s.Movements(a.Id).Single(x => x.Kind == AssetMovementKind.OriginalCostAdjustment);
        Assert.Equal(1000m, adjustment.Before!.OriginalCost); Assert.Equal(1400m, adjustment.After.OriginalCost);
        Assert.Equal(100m, Assert.Single(s.Ledger()).NetValue);
    }

    [Fact]
    public void DisposalMonthAccrues_FollowingMonthDoesNot_DisposalPlanBalances()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan); Calc(s, January);
        s.Dispose(s.Read().Revision, a.Id, new(2026, 2, 20), "01");
        var feb = Calc(s, February); Assert.Equal(300m, feb.Total);
        var march = Calc(s, new(2026, 3)); Assert.Equal(0, march.Total); Assert.Empty(s.Ledger(false));
        var disposal = s.Movements(a.Id).Single(x => x.Kind == AssetMovementKind.Disposal);
        var plan = s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Disposal, disposal.Id, new(2026, 2, 20), "记", 1);
        Assert.Equal(1000, plan.DebitTotal); Assert.Equal(plan.DebitTotal, plan.CreditTotal);
        Assert.Equal(700m, plan.Lines.Single(x => x.AccountCode == "1606").Debit);
        Assert.Equal(300m, plan.Lines.Single(x => x.AccountCode == "1602").Debit);
        s.CancelDepreciation(s.Read().Revision, march.Id);
        Fails("plan-exists", () => s.CancelDepreciation(s.Read().Revision, feb.Id));
    }

    [Fact]
    public void DepreciationPlanIsBalancedIdempotentAndMustBeVoidedBeforeCancel()
    {
        var (store, s) = Setup(); s.AddCard(0, A(), Jan); Calc(s, January); var feb = Calc(s, February);
        var plan = s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Depreciation, feb.Id, February.LastDay, "记", 1);
        Assert.Equal(300m, plan.DebitTotal); Assert.Equal(plan.DebitTotal, plan.CreditTotal);
        var before = store.Load(); Assert.Equal(plan, s.CreateVoucherPlan(before.Revision, AssetVoucherKind.Depreciation, feb.Id, February.LastDay, "记", 1));
        Assert.Same(before, store.Load()); Fails("plan-exists", () => s.CancelDepreciation(before.Revision, feb.Id));
        s.VoidVoucherPlan(before.Revision, plan.Id); s.CancelDepreciation(s.Read().Revision, feb.Id);
        Fails("batch-missing", () => s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Depreciation, feb.Id, February.LastDay, "记", 2));
        Assert.True(Assert.Single(s.Read().VoucherPlans).Voided);
    }

    [Fact]
    public void AdditionAndDepartmentAllocationPlansKeepSourceIdentity()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan);
        var movement = Assert.Single(s.Movements(a.Id));
        var plan = s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Addition, movement.Id, Jan, "记", 1, "1002");
        Assert.Equal(1000, plan.DebitTotal); Assert.Equal("1601", plan.Lines[0].AccountCode);
        Assert.All(plan.Lines, x => Assert.Equal("01", x.DepartmentCode));
        Assert.Contains(Identity.BookId, plan.SourceKey);
        s.Transfer(s.Read().Revision, a.Id, Jan, "02", "02", "L", "合成后续调拨");
        Assert.Equal("02", s.Read().Cards[a.Id].DepartmentCode);
        Assert.All(s.Read().VoucherPlans.Single().Lines, x => Assert.Equal("01", x.DepartmentCode));
    }

    [Theory]
    [InlineData("6")]
    [InlineData("9999")]
    [InlineData("missing")]
    public void VoucherRequiresActiveLeafAccounts(string account)
    {
        var (store, s) = Setup(); var a = A(); s.AddCard(0, a, Jan); var before = store.Load();
        Fails("invalid-account", () => s.CreateVoucherPlan(before.Revision, AssetVoucherKind.Addition,
            Assert.Single(s.Movements(a.Id)).Id, Jan, "记", 1, account)); Assert.Same(before, store.Load());
    }

    [Fact]
    public void CrossBookReadAndStaleMutationFailWithoutWrites()
    {
        var (store, s) = Setup(); s.AddCard(0, A(), Jan); var before = store.Load();
        Fails("stale-revision", () => s.AddCard(0, A("B"), Jan)); Assert.Same(before, store.Load());
        Fails("book-mismatch", () => new AssetBookService(store, Identity with { BookId = "wrong" }).Read());
    }

    [Fact]
    public void RepositoryCASRejectsConcurrentCommitAndLeavesLosingOperationAbsent()
    {
        var (store, _) = Setup(); var interfering = new RacingStore(store);
        var s = new AssetBookService(interfering, Identity);
        Fails("stale-revision", () => s.AddCard(0, A(), Jan)); Assert.Empty(store.Load().Cards); Assert.Equal(1, store.Load().Revision);
    }
    private sealed class RacingStore(InMemoryAssetBookStore inner) : IAssetBookStore
    {
        public AssetBookState Load() => inner.Load();
        public bool TrySave(AssetBookIdentity identity, long revision, AssetBookState next)
        {
            var state = inner.Load(); inner.TrySave(identity, revision, state with { Revision = revision + 1 });
            return inner.TrySave(identity, revision, next);
        }
    }

    [Fact]
    public void ReadOnlyAndClosedPeriodAreEnforced()
    {
        var (_, readOnly) = Setup(Initial with { ReadOnly = true }); Fails("read-only", () => readOnly.AddCard(0, A(), Jan));
        var (_, closed) = Setup(Initial with { ClosedThrough = January }); Fails("closed-period", () => closed.AddCard(0, A(), Jan));
    }

    [Theory]
    [InlineData(-1, 0, "asset-cost")]
    [InlineData(100, 101, "asset-residual")]
    [InlineData(100, -1, "asset-residual")]
    public void InvalidCostAndResidualCannotCreateCards(int cost, int residual, string code)
    {
        var (store, s) = Setup(); Fails(code, () => s.AddCard(0, A(cost:cost, residual:residual), Jan)); Assert.Empty(store.Load().Cards);
    }

    [Fact]
    public void DuplicateAndInvalidDatesAndDirectFinancialRewriteAreRejected()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan);
        Fails("duplicate-code", () => s.AddCard(1, A(), Jan));
        Fails("use-date", () => s.AddCard(1, A("B") with { UseDate = Jan.AddDays(-1) }, Jan));
        Fails("use-audited-operation", () => s.UpdateCard(1, a with { OriginalCost = 2000 }, Jan));
        Fails("before-opening", () => s.Dispose(1, a.Id, Jan.AddDays(-1), "01"));
    }

    [Fact]
    public void DeleteDepreciatedAssetIsBlocked()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan); Calc(s, January); Calc(s, February);
        Fails("has-depreciation", () => s.DeleteCard(s.Read().Revision, a.Id));
    }

    [Fact]
    public void FullSyntheticSnapshotRoundTripPreservesOriginalNullBinaryAndAccessoriesAndCanCancel()
    {
        var (_, s) = Setup(); var a = A() with
        {
            ForeignAmount = null, CurrencyCode = "USD", ReferenceNumber = "ref", Specification = "fixture",
            Accessories = [new("01", "合成附属设备", 2, 3.25m, 6.50m, "说明", [])],
            Images = [new("synthetic.bin", "application/octet-stream", [0, 1, 255])],
            OriginalRows = [new("zc_gdzc", "synthetic-row-1", ImmutableDictionary<string, OriginalCell>.Empty
                .Add("unknown_null", new("char(20)", true, null, []))
                .Add("unknown_raw", new("double", false, "1.2345678901", [0, 255]))) ]
        };
        s.AddCard(0, a, Jan); Calc(s, January); var feb = Calc(s, February);
        var json = AssetSnapshotCodec.Serialize(s.Read()); var restored = AssetSnapshotCodec.Deserialize(json);
        var restoredCard = restored.Cards[a.Id]; Assert.Null(restoredCard.ForeignAmount);
        Assert.Equal(new byte[] { 0, 1, 255 }, restoredCard.Images[0].Bytes); Assert.Equal(6.50m, restoredCard.Accessories[0].Amount);
        Assert.True(restoredCard.OriginalRows[0].Cells["unknown_null"].IsNull);
        Assert.Equal("1.2345678901", restoredCard.OriginalRows[0].Cells["unknown_raw"].Text);
        var (_, copy) = Setup(restored); copy.CancelDepreciation(restored.Revision, feb.Id);
        Assert.Equal(0, copy.Read().Cards[a.Id].AccumulatedDepreciation);
    }
    [Fact]
    public void DurableSyntheticWorkspaceReopensAndRejectsStaleWriter()
    {
        var directory = Path.Combine(Path.GetTempPath(), "caiwu-assets-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var path = Path.Combine(directory, "test.assets.synthetic.json");
            var store = SyntheticJsonAssetBookStore.Create(path, Initial);
            Assert.Throws<IOException>(() => SyntheticJsonAssetBookStore.Create(path, Initial));
            var second = SyntheticJsonAssetBookStore.Open(path, Identity);
            var stale = second.Load(); var service = new AssetBookService(store, Identity); var a = A();
            service.AddCard(0, a, Jan); Calc(service, January); var feb = Calc(service, February);
            Assert.False(second.TrySave(Identity, 0, stale with { Revision = 1 }));
            var reopened = new AssetBookService(SyntheticJsonAssetBookStore.Open(path, Identity), Identity);
            Assert.Equal(300m, Assert.Single(reopened.Ledger()).AccumulatedDepreciation);
            reopened.CancelDepreciation(reopened.Read().Revision, feb.Id);
            Assert.Equal(0m, Assert.Single(new AssetBookService(SyntheticJsonAssetBookStore.Open(path, Identity), Identity).Ledger()).AccumulatedDepreciation);
            Assert.Throws<ArgumentException>(() => SyntheticJsonAssetBookStore.Open(Path.Combine(directory, "real.db"), Identity));
            Assert.Equal("book-mismatch", Assert.Throws<AssetRuleException>(() => SyntheticJsonAssetBookStore.Open(path, Identity with { BookId = "wrong" })).Code);
            Assert.Empty(Directory.GetFiles(directory, "*.tmp"));
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public void ModuleCodecPreservesRichStateAndRejectsDuplicateUnknownAndFutureFields()
    {
        var (_, service) = Setup(); service.AddCard(0, A(), Jan); Calc(service, January); Calc(service, February);
        var json = AssetModuleDocumentCodec.Serialize(service.Read());
        var restored = AssetModuleDocumentCodec.Deserialize(json);
        Assert.Equal(300m, restored.Cards.Values.Single().AccumulatedDepreciation);
        Assert.Throws<FormatException>(() => AssetModuleDocumentCodec.Deserialize(json.Replace("\"Version\":1", "\"Version\":2")));
        Assert.Throws<FormatException>(() => AssetModuleDocumentCodec.Deserialize(json.Replace("\"Version\":1", "\"Version\":1,\"Version\":1")));
        Assert.Throws<System.Text.Json.JsonException>(() => AssetModuleDocumentCodec.Deserialize(json.Replace("\"Version\":1", "\"Version\":1,\"unknown\":1")));
    }

    [Fact]
    public void CostAdjustmentCanBeReversedOnlyBeforeLaterMovementOrDepreciation()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan);
        s.AdjustOriginalCost(1, a.Id, Jan, 1300m, 100m, "合成调整");
        var movement = s.Movements(a.Id).Last(); var restored = s.CancelOriginalCostAdjustment(2, movement.Id);
        Assert.Equal(1000m, restored.OriginalCost);
        Assert.Equal(movement.Id, s.Movements(a.Id).Last().ReversesMovementId);
        Fails("later-movement", () => s.CancelOriginalCostAdjustment(3, movement.Id));
        s.AdjustOriginalCost(3, a.Id, Jan, 1200m, 100m, "合成调整二"); var second = s.Movements(a.Id).Last();
        Calc(s, January); Fails("depreciated-period", () => s.CancelOriginalCostAdjustment(s.Read().Revision, second.Id));
    }

    [Fact]
    public void DisposalPlanRequiresCompletedMonthAndDateAndNoDuplicateVoucherNumbers()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan); Calc(s, January);
        s.Dispose(s.Read().Revision, a.Id, February.FirstDay, "01"); var source = s.Movements(a.Id).Last();
        Fails("disposal-depreciation", () => s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Disposal, source.Id, February.LastDay, "记", 1));
        var batch = Calc(s, February);
        var depPlan = s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Depreciation, batch.Id, February.LastDay, "记", 1);
        Fails("duplicate-voucher", () => s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Disposal, source.Id, February.LastDay, "记", 1));
        Fails("voucher-date", () => s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Disposal, source.Id, new(2026, 3, 1), "记", 2));
        s.VoidVoucherPlan(s.Read().Revision, depPlan.Id);
        Assert.Equal(700, s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Disposal, source.Id, February.LastDay, "记", 1).Lines.Single(x => x.AccountCode == "1606").Debit);
    }

    [Fact]
    public void DeletedDraftAssetCannotReuseItsStableIdentity()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan); s.DeleteCard(1, a.Id);
        Fails("duplicate-asset", () => s.AddCard(2, a, Jan));
        Assert.Empty(s.Ledger()); Assert.Single(s.Movements(a.Id));
    }

    [Fact]
    public void RecalculationKeepsBusinessSourceKeyStableEvenWithNewBatchIdentity()
    {
        var (_, s) = Setup(); s.AddCard(0, A(), Jan); Calc(s, January); var first = Calc(s, February);
        var plan = s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Depreciation, first.Id, February.LastDay, "记", 1);
        s.VoidVoucherPlan(s.Read().Revision, plan.Id); s.CancelDepreciation(s.Read().Revision, first.Id);
        var recalculated = Calc(s, February);
        var secondPlan = s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Depreciation, recalculated.Id, February.LastDay, "记", 1);
        Assert.NotEqual(first.Id, recalculated.Id); Assert.NotEqual(plan.Id, secondPlan.Id);
        Assert.Equal(plan.SourceKey, secondPlan.SourceKey); Assert.Contains("2026-02", plan.SourceKey);
    }

    [Fact]
    public void ShippedSyntheticFixtureRunsCardAdjustmentDepreciationPlanCancellationLedgerLoop()
    {
        var fixture = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "empty.assets.synthetic.json"));
        var state = AssetSnapshotCodec.Deserialize(fixture);
        var store = new InMemoryAssetBookStore(state); var service = new AssetBookService(store, state.Identity);
        var card = A(); service.AddCard(0, card, Jan); service.AdjustOriginalCost(1, card.Id, Jan, 1300, 100, "合成价值增加");
        Calc(service, January); var feb = Calc(service, February); Assert.Equal(400m, feb.Total);
        var plan = service.CreateVoucherPlan(service.Read().Revision, AssetVoucherKind.Depreciation, feb.Id, February.LastDay, "记", 1);
        Assert.Equal(400m, plan.DebitTotal); Assert.Equal(plan.DebitTotal, plan.CreditTotal);
        service.VoidVoucherPlan(service.Read().Revision, plan.Id); service.CancelDepreciation(service.Read().Revision, feb.Id);
        Assert.Equal(0, Assert.Single(service.Ledger()).AccumulatedDepreciation);
        Assert.Equal(400m, Calc(service, February).Total);
        service.Dispose(service.Read().Revision, card.Id, new(2026, 3, 10), "01"); var march = Calc(service, new(2026, 3));
        Assert.Equal(400m, march.Total); Assert.Empty(service.Ledger(false));
        var disposal = service.Movements(card.Id).Last();
        var disposalPlan = service.CreateVoucherPlan(service.Read().Revision, AssetVoucherKind.Disposal, disposal.Id, new(2026, 3, 10), "记", 2);
        Assert.Equal(1300m, disposalPlan.DebitTotal); Assert.Equal(800m, disposalPlan.Lines.Single(x => x.AccountCode == "1602").Debit);
        Assert.Equal(500m, disposalPlan.Lines.Single(x => x.AccountCode == "1606").Debit);
        Assert.Equal(AssetModuleDocumentCodec.Serialize(service.Read()), AssetModuleDocumentCodec.Serialize(AssetModuleDocumentCodec.Deserialize(AssetModuleDocumentCodec.Serialize(service.Read()))));
    }

    [Fact]
    public void WorkloadCostIncreaseIsSpreadProspectivelyOverRemainingWorkload()
    {
        var (_, s) = Setup(); var a = A() with { Method = AssetDepreciationMethod.UnitsOfProduction, TotalWorkload = 9 };
        s.AddCard(0, a, Jan); Calc(s, January); Assert.Equal(300m, Calc(s, February, new Dictionary<Guid, decimal> { [a.Id] = 3 }).Total);
        s.AdjustOriginalCost(s.Read().Revision, a.Id, new(2026, 3, 1), 1600m, 100m, "合成扩建");
        Assert.Equal(400m, Calc(s, new(2026, 3), new Dictionary<Guid, decimal> { [a.Id] = 2 }).Total);
        Assert.Equal(800m, Calc(s, new(2026, 4), new Dictionary<Guid, decimal> { [a.Id] = 4 }).Total);
        Assert.Equal(100m, Assert.Single(s.Ledger()).NetValue);
    }

}
