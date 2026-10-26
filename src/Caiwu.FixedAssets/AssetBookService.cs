using System.Collections.Immutable;

namespace Caiwu.FixedAssets;

/// <summary>
/// Independent asset aggregate. New-engine arithmetic is decimal/2dp/AwayFromZero;
/// these policies require separate original-runtime verification before claiming parity.
/// </summary>
public sealed class AssetBookService(IAssetBookStore store, AssetBookIdentity identity)
{
    private static void Require(bool condition, string code, string message)
    {
        if (!condition) throw new AssetRuleException(code, message);
    }
    public static decimal RoundMoney(decimal value) => decimal.Round(value, 2, MidpointRounding.AwayFromZero);
    private static bool Money(decimal value) => value == RoundMoney(value);
    private static bool HasText(string? value) => !string.IsNullOrWhiteSpace(value);
    private static AssetPeriod Period(DateOnly date) => AssetPeriod.From(date);

    public AssetBookState Read()
    {
        var state = store.Load();
        Require(state.Identity == identity, "book-mismatch", "账套身份不一致，请重新打开固定资产模块。");
        return state;
    }

    private T Change<T>(long revision, Func<AssetBookState, (AssetBookState Next, T Result)> operation)
    {
        var state = Read();
        Require(state.Revision == revision, "stale-revision", "数据已被其他操作修改，请刷新后重试。");
        Require(!state.ReadOnly, "read-only", "当前账套为只读。");
        var (next, result) = operation(state);
        if (ReferenceEquals(next, state)) return result;
        next = next with { Revision = checked(state.Revision + 1) };
        ValidateSnapshot(next);
        Require(store.TrySave(identity, revision, next), "stale-revision", "数据已被其他操作修改，本次操作未保存。");
        return result;
    }

    private static void WritableDate(AssetBookState state, DateOnly date)
    {
        var period = Period(date);
        Require(period >= state.Settings.OpeningPeriod, "before-opening", "日期不能早于固定资产开始使用月份。");
        Require(state.ClosedThrough is null || period > state.ClosedThrough.Value, "closed-period", "该月份已结账，不能修改。");
        var last = state.Batches.Where(x => !x.Cancelled).OrderByDescending(x => x.Period).FirstOrDefault();
        Require(last is null || period > last.Period, "depreciated-period", "该月份已计提折旧，请先取消折旧。");
    }
    private static AssetCard Card(AssetBookState state, Guid id)
    {
        Require(state.Cards.ContainsKey(id), "asset-missing", "设备不存在。");
        return state.Cards[id];
    }
    private static void Editable(AssetCard card) => Require(card.DisposalDate is null, "asset-disposed", "设备已注销，不能修改。");
    private static void OrderedMovement(AssetBookState state, Guid id, DateOnly date)
    {
        Require(!state.Movements.Any(x => x.AssetId == id && x.Date > date), "movement-order", "变动日期不能早于该设备已有的后续变动。");
    }
    private static AssetBookState WithMovement(AssetBookState state, AssetCard? before, AssetCard after,
        AssetMovementKind kind, DateOnly date, string description) => state with
    {
        Cards = state.Cards.SetItem(after.Id, after),
        Movements = state.Movements.Add(new(Guid.NewGuid(), after.Id, kind, date, before, after, description))
    };

    public AssetCard AddCard(long revision, AssetCard card, DateOnly date) => Change(revision, state =>
    {
        WritableDate(state, date);
        Require(!state.Cards.ContainsKey(card.Id) && !state.Movements.Any(x => x.AssetId == card.Id), "duplicate-asset", "设备身份重复或已存在于历史记录。");
        Require(!state.Cards.Values.Any(x => x.Code == card.Code), "duplicate-code", "编号重复！");
        Require(card.DisposalDate is null, "new-disposed", "新增卡片不能直接设为已注销。");
        Require(card.PurchaseDate <= date, "purchase-date", "购置日期不能晚于增加日期。");
        ValidateCard(card, state.Settings.Catalog);
        return (WithMovement(state, null, card, AssetMovementKind.Addition, date, "增加固定资产"), card);
    });

    public AssetCard UpdateCard(long revision, AssetCard replacement, DateOnly date) => Change(revision, state =>
    {
        WritableDate(state, date);
        var old = Card(state, replacement.Id); Editable(old); OrderedMovement(state, old.Id, date);
        Require(!state.Cards.Values.Any(x => x.Id != old.Id && x.Code == replacement.Code), "duplicate-code", "编号重复！");
        // Financial/custody changes have their own audit operations; card editing cannot rewrite booked history.
        Require(replacement.OriginalCost == old.OriginalCost && replacement.ResidualValue == old.ResidualValue &&
            replacement.ResidualRate == old.ResidualRate && replacement.PurchaseDate == old.PurchaseDate && replacement.UseDate == old.UseDate && replacement.Method == old.Method &&
            replacement.UsefulLifeMonths == old.UsefulLifeMonths && replacement.TotalWorkload == old.TotalWorkload &&
            replacement.AccumulatedDepreciation == old.AccumulatedDepreciation && replacement.DepreciatedMonths == old.DepreciatedMonths &&
            replacement.AccumulatedWorkload == old.AccumulatedWorkload && replacement.MonthlyDepreciation == old.MonthlyDepreciation &&
            replacement.MonthlyWorkload == old.MonthlyWorkload && replacement.DisposalDate == old.DisposalDate &&
            replacement.DisposalReasonCode == old.DisposalReasonCode && replacement.DepartmentCode == old.DepartmentCode &&
            replacement.PurposeCode == old.PurposeCode && replacement.CategoryCode == old.CategoryCode && replacement.Location == old.Location,
            "use-audited-operation", "金额、折旧参数和使用部门变动须使用专用变动操作。");
        ValidateCard(replacement, state.Settings.Catalog);
        return (WithMovement(state, old, replacement, AssetMovementKind.CardEdit, date, "修改固定资产卡片"), replacement);
    });

    public AssetCard AdjustOriginalCost(long revision, Guid id, DateOnly date, decimal cost, decimal residualValue,
        string description) => Change(revision, state =>
    {
        WritableDate(state, date); var old = Card(state, id); Editable(old); OrderedMovement(state, id, date);
        Require(HasText(description), "adjustment-description", "请输入调整说明。");
        Require(old.DepreciatedMonths < old.UsefulLifeMonths, "life-exhausted", "设备使用年限已满，须核实使用年限调整方案。");
        var next = old with { OriginalCost = cost, ResidualValue = residualValue };
        ValidateCard(next, state.Settings.Catalog);
        return (WithMovement(state, old, next, AssetMovementKind.OriginalCostAdjustment, date, description), next);
    });

    public AssetCard CancelOriginalCostAdjustment(long revision, Guid movementId) => Change(revision, state =>
    {
        var movement = state.Movements.SingleOrDefault(x => x.Id == movementId && x.Kind == AssetMovementKind.OriginalCostAdjustment);
        Require(movement is not null && movement.Before is not null, "adjustment-missing", "没有可删除的原值调整。");
        var adjustment = movement!; var current = Card(state, adjustment.AssetId);
        WritableDate(state, adjustment.Date); OrderedMovement(state, current.Id, adjustment.Date);
        Require(state.Movements.Last(x => x.AssetId == current.Id).Id == movementId && AssetSnapshotCodec.CardsEqual(current, adjustment.After),
            "later-movement", "调整后已有其他变动，不能删除此原值调整。");
        var restored = adjustment.Before!;
        var reversal = new AssetMovement(Guid.NewGuid(), current.Id, AssetMovementKind.OriginalCostAdjustmentReversal,
            adjustment.Date, current, restored, "删除原值调整（保留审计历史）", movementId);
        return (state with { Cards = state.Cards.SetItem(current.Id, restored), Movements = state.Movements.Add(reversal) }, restored);
    });

    public AssetCard Transfer(long revision, Guid id, DateOnly date, string departmentCode, string purposeCode,
        string location, string description) => Change(revision, state =>
    {
        WritableDate(state, date); var old = Card(state, id); Editable(old); OrderedMovement(state, id, date);
        Require(HasText(description), "transfer-description", "请输入变动说明。");
        var next = old with { DepartmentCode = departmentCode, PurposeCode = purposeCode, Location = location };
        ValidateCard(next, state.Settings.Catalog);
        return (WithMovement(state, old, next, AssetMovementKind.Transfer, date, description), next);
    });

    public AssetCard Dispose(long revision, Guid id, DateOnly date, string reasonCode) => Change(revision, state =>
    {
        WritableDate(state, date); var old = Card(state, id); Editable(old); OrderedMovement(state, id, date);
        Require(date >= old.PurchaseDate && date >= old.UseDate, "disposal-date", "注销日期不能早于购置或使用日期。");
        Require(state.Settings.Catalog.DisposalReasons.Any(x => x.Code == reasonCode), "disposal-reason", "请选择有效的注销原因。");
        var next = old with { DisposalDate = date, DisposalReasonCode = reasonCode };
        return (WithMovement(state, old, next, AssetMovementKind.Disposal, date, "注销固定资产"), next);
    });

    public void DeleteCard(long revision, Guid id) => Change(revision, state =>
    {
        var card = Card(state, id);
        Require(!state.Batches.Any(b => b.Lines.Any(l => l.AssetId == id)), "has-depreciation", "此设备已提折旧，不允许删除！");
        Require(card.AccumulatedDepreciation == 0 && card.DepreciatedMonths == 0, "has-depreciation", "此设备已提折旧，不允许删除！");
        Require(state.Movements.Where(m => m.AssetId == id).All(m => m.Kind == AssetMovementKind.Addition),
            "has-movement", "设备已有变动历史，不能删除。");
        Require(!state.VoucherPlans.Any(p => !p.Voided && p.Lines.Any(l => l.AssetId == id)), "plan-exists", "设备已有有效凭证计划。");
        var addition = state.Movements.Single(m => m.AssetId == id);
        WritableDate(state, addition.Date);
        // Preserve the audit record. Removal from cards is a deleted draft addition, not disposal.
        return (state with { Cards = state.Cards.Remove(id) }, true);
    });

    public AssetDepreciationBatch CalculateDepreciation(long revision, AssetPeriod period,
        IReadOnlyDictionary<Guid, decimal>? workloads = null) => Change(revision, state =>
    {
        WritableDate(state, period.LastDay);
        Require(period == state.NextDepreciationPeriod, "period-order", $"应计提月份为 {state.NextDepreciationPeriod}，不能跳月或重复计提。");
        Require(state.Cards.Count > 0, "no-assets", "没有固定资产，不能计提折旧。");
        workloads ??= ImmutableDictionary<Guid, decimal>.Empty;
        Require(workloads.Keys.All(state.Cards.ContainsKey), "workload-asset", "工作量包含未知设备。");
        var lines = ImmutableArray.CreateBuilder<AssetDepreciationLine>();
        var before = ImmutableDictionary.CreateBuilder<Guid, AssetCard>();
        var after = ImmutableDictionary.CreateBuilder<Guid, AssetCard>();
        foreach (var card in state.Cards.Values.OrderBy(x => x.Code, StringComparer.Ordinal))
        {
            // The snapshot can contain future-dated movements. Refuse their retroactive use; no silent current-value backdating.
            Require(!state.Movements.Any(m => m.AssetId == card.Id && m.Kind != AssetMovementKind.Addition && Period(m.Date) > period),
                "future-movement", "设备已有后续月份变动，请先核实变动与计提顺序。");
            if (Period(card.UseDate) >= period || card.PurchaseDate > period.LastDay ||
                state.Movements.Any(m => m.AssetId == card.Id && m.Kind == AssetMovementKind.Addition && m.Date > period.LastDay)) continue;
            if (card.DisposalDate is { } disposal && Period(disposal) < period) continue;
            ValidateCard(card, state.Settings.Catalog);
            before.Add(card.Id, card);
            var status = state.Settings.Catalog.Statuses.Single(x => x.Code == card.StatusCode);
            decimal amount = 0, workload = 0;
            var months = card.DepreciatedMonths;
            var remaining = card.OriginalCost - card.ResidualValue - card.AccumulatedDepreciation;
            if (status.Depreciates && remaining > 0)
            {
                if (card.Method == AssetDepreciationMethod.StraightLine && months < card.UsefulLifeMonths)
                {
                    var remainingMonths = card.UsefulLifeMonths - months;
                    amount = remainingMonths == 1 ? remaining : RoundMoney(remaining / remainingMonths);
                    months++;
                }
                else if (card.Method == AssetDepreciationMethod.UnitsOfProduction)
                {
                    Require(workloads.TryGetValue(card.Id, out workload), "workload-required", $"设备 {card.Code} 未输本月工作量。");
                    Require(workload >= 0 && workload <= card.TotalWorkload - card.AccumulatedWorkload,
                        "excess-workload", $"设备 {card.Code} 本月工作量过大或为负数。");
                    amount = card.AccumulatedWorkload + workload == card.TotalWorkload ? remaining :
                        Math.Min(remaining, RoundMoney(remaining * workload / (card.TotalWorkload - card.AccumulatedWorkload)));
                    if (workload > 0) months++;
                }
            }
            amount = Math.Min(remaining, amount);
            var next = card with { AccumulatedDepreciation = card.AccumulatedDepreciation + amount,
                MonthlyDepreciation = amount, DepreciatedMonths = months, MonthlyWorkload = workload,
                AccumulatedWorkload = card.AccumulatedWorkload + workload };
            after.Add(card.Id, next);
            lines.Add(new(card.Id, card.Code, card.Name, card.DepartmentCode, card.PurposeCode, card.Method,
                card.OriginalCost, card.ResidualValue, amount, workload, card.AccumulatedDepreciation,
                next.AccumulatedDepreciation, next.NetValue));
        }
        var batch = new AssetDepreciationBatch(Guid.NewGuid(), period, lines.ToImmutable(), before.ToImmutable(), after.ToImmutable(), false);
        return (state with { Cards = state.Cards.SetItems(batch.After), Batches = state.Batches.Add(batch) }, batch);
    });

    public AssetDepreciationBatch CancelDepreciation(long revision, Guid batchId) => Change(revision, state =>
    {
        var batch = state.Batches.SingleOrDefault(x => x.Id == batchId);
        Require(batch is not null && !batch.Cancelled, "batch-missing", "没有可取消的折旧批次。");
        var current = batch!;
        Require(state.ClosedThrough is null || current.Period > state.ClosedThrough, "closed-period", "该月份已结账，不能取消折旧。");
        Require(!state.Batches.Any(x => !x.Cancelled && x.Period > current.Period), "cancel-order", "请先取消最后月份的折旧。");
        Require(!state.VoucherPlans.Any(x => !x.Voided && (x.SourceId == batchId ||
            x.Kind == AssetVoucherKind.Disposal && Period(x.Date) == current.Period && x.Lines.Any(l => current.After.ContainsKey(l.AssetId)))), "plan-exists", "折旧已有有效凭证计划，请先撤销计划。");
        Require(!state.Movements.Any(x => current.After.ContainsKey(x.AssetId) && x.Date > current.Period.LastDay),
            "later-movement", "计提后设备已有后续月份变动，不能覆盖后续历史。");
        foreach (var (id, card) in current.After)
            Require(state.Cards.TryGetValue(id, out var value) && AssetSnapshotCodec.CardsEqual(value, card), "later-movement", "计提后设备已有变动，不能覆盖后续变动。");
        var cancelled = current with { Cancelled = true };
        return (state with { Cards = state.Cards.SetItems(current.Before),
            Batches = state.Batches.Replace(current, cancelled) }, cancelled);
    });

    private static void Account(AssetBookState state, string code)
    {
        Require(HasText(code), "account-required", "请先进行固定资产科目设置。");
        Require(state.Settings.Catalog.Accounts.Any(x => x.Code == code && x.IsActive && x.IsLeaf), "invalid-account", $"科目 {code} 不存在、已停用或非明细科目。");
    }

    private static string StableSourceKey(AssetBookState state, AssetVoucherKind kind, Guid sourceId)
    {
        var prefix = $"assets/{state.Identity.Product}/{state.Identity.BookId}";
        if (kind == AssetVoucherKind.Depreciation)
        {
            var batch = state.Batches.SingleOrDefault(x => x.Id == sourceId && !x.Cancelled);
            Require(batch is not null, "batch-missing", "请先计提折旧。");
            return $"{prefix}/depreciation/{batch!.Period}";
        }
        Require(Enum.IsDefined(kind), "voucher-kind", "不支持的凭证类型。");
        var movement = state.Movements.SingleOrDefault(x => x.Id == sourceId);
        Require(movement is not null && (kind == AssetVoucherKind.Addition ? movement.Kind == AssetMovementKind.Addition :
            movement.Kind == AssetMovementKind.Disposal), "movement-source", "凭证来源与业务类型不一致。");
        return $"{prefix}/{kind}/{movement!.AssetId:D}";
    }

    public AssetVoucherPlan CreateVoucherPlan(long revision, AssetVoucherKind kind, Guid sourceId,
        DateOnly date, string voucherType, int voucherNumber, string? additionCreditAccount = null) => Change(revision, state =>
    {
        Require(HasText(voucherType) && voucherNumber > 0, "voucher-identity", "请选择凭证类型并输入凭证编号。");
        Require(state.ClosedThrough is null || Period(date) > state.ClosedThrough, "closed-period", "该月份已结账，不能生成凭证计划。");
        var key = StableSourceKey(state, kind, sourceId);
        var existing = state.VoucherPlans.SingleOrDefault(x => x.SourceKey == key && !x.Voided);
        if (existing is not null)
        {
            Require(existing.Date == date && existing.VoucherType == voucherType && existing.VoucherNumber == voucherNumber && (kind != AssetVoucherKind.Addition ||
                existing.Lines.Any(x => x.Credit > 0 && x.AccountCode == additionCreditAccount)),
                "plan-conflict", "该来源已有不同凭证计划，请先撤销计划。");
            return (state, existing);
        }
        Require(!state.VoucherPlans.Any(x => !x.Voided && Period(x.Date) == Period(date) &&
            x.VoucherType == voucherType && x.VoucherNumber == voucherNumber), "duplicate-voucher", "已有重复凭证计划。");
        var lines = ImmutableArray.CreateBuilder<AssetVoucherLine>();
        void Line(Guid assetId, string account, string department, string summary, decimal debit, decimal credit)
        {
            Account(state, account);
            if (debit != 0 || credit != 0) lines.Add(new(assetId, account, department, summary, debit, credit));
        }
        if (kind == AssetVoucherKind.Depreciation)
        {
            var batch = state.Batches.SingleOrDefault(x => x.Id == sourceId && !x.Cancelled);
            Require(batch is not null, "batch-missing", "请先计提折旧。");
            Require(Period(date) == batch!.Period, "voucher-date", "折旧凭证日期须在计提月份内。");
            foreach (var row in batch.Lines.Where(x => x.Amount > 0))
            {
                var purpose = state.Settings.Catalog.Purposes.Single(x => x.Code == row.PurposeCode);
                Line(row.AssetId, purpose.ExpenseAccount, row.DepartmentCode, $"{batch.Period}折旧 {row.AssetCode}", row.Amount, 0);
                Line(row.AssetId, state.Settings.AccumulatedDepreciationAccount, row.DepartmentCode, $"{batch.Period}折旧 {row.AssetCode}", 0, row.Amount);
            }
        }
        else
        {
            Require(Enum.IsDefined(kind), "voucher-kind", "不支持的凭证类型。");
            var movement = state.Movements.SingleOrDefault(x => x.Id == sourceId);
            Require(movement is not null && (kind == AssetVoucherKind.Addition ? movement.Kind == AssetMovementKind.Addition :
                movement.Kind == AssetMovementKind.Disposal), "movement-source", "凭证来源与业务类型不一致。");
            var m = movement!;
            Require(state.Cards.ContainsKey(m.AssetId), "asset-missing", "设备已删除，不能生成凭证计划。");
            Require(Period(date) == Period(m.Date), "voucher-date", "凭证日期须在变动月份内。");
            var card = m.After;
            var assetAccount = state.Settings.Catalog.Categories.Single(x => x.Code == card.CategoryCode).AssetAccount;
            if (kind == AssetVoucherKind.Addition)
            {
                Require(card.AccumulatedDepreciation == 0, "opening-asset", "带期初累计折旧的资产不能当作新增采购生成凭证。");
                Line(card.Id, assetAccount, card.DepartmentCode, $"增加固定资产 {card.Code}", card.OriginalCost, 0);
                Line(card.Id, additionCreditAccount ?? "", card.DepartmentCode, $"增加固定资产 {card.Code}", 0, card.OriginalCost);
            }
            else
            {
                var disposalBatch = state.Batches.SingleOrDefault(x => !x.Cancelled && x.Period == Period(m.Date));
                Require(disposalBatch is not null, "disposal-depreciation", "请先完成注销月份的折旧计提，再生成注销凭证计划。");
                card = disposalBatch!.After.GetValueOrDefault(card.Id, card);
                Line(card.Id, state.Settings.DisposalClearingAccount, card.DepartmentCode, $"注销固定资产 {card.Code}", card.NetValue, 0);
                Line(card.Id, state.Settings.AccumulatedDepreciationAccount, card.DepartmentCode, $"注销固定资产 {card.Code}", card.AccumulatedDepreciation, 0);
                Line(card.Id, assetAccount, card.DepartmentCode, $"注销固定资产 {card.Code}", 0, card.OriginalCost);
            }
        }
        Require(lines.Count > 0, "no-voucher-data", "无数据，不能生成凭证计划。");
        Require(lines.Sum(x => x.Debit) == lines.Sum(x => x.Credit), "unbalanced", "借贷不平，不能存凭证！");
        var plan = new AssetVoucherPlan(Guid.NewGuid(), key, kind, sourceId, date, voucherType, voucherNumber, lines.ToImmutable(), false);
        return (state with { VoucherPlans = state.VoucherPlans.Add(plan) }, plan);
    });

    public void VoidVoucherPlan(long revision, Guid planId) => Change(revision, state =>
    {
        var plan = state.VoucherPlans.SingleOrDefault(x => x.Id == planId && !x.Voided);
        Require(plan is not null, "plan-missing", "没有可撤销的凭证计划。");
        Require(!state.VoucherReceipts.Any(x => x.PlanId == planId || x.SourceKeys.Contains(plan!.SourceKey)),
            "voucher-accepted", "计划已有总账凭证收据，不能直接撤销。请先按总账流程处理。");
        Require(state.ClosedThrough is null || Period(plan!.Date) > state.ClosedThrough, "closed-period", "该月份已结账，不能撤销凭证计划。");
        return (state with { VoucherPlans = state.VoucherPlans.Replace(plan!, plan! with { Voided = true }) }, true);
    });

    public ImmutableArray<AssetLedgerRow> Ledger(bool includeDisposed = true) => Read().Cards.Values
        .Where(x => includeDisposed || x.DisposalDate is null).OrderBy(x => x.Code, StringComparer.Ordinal)
        .Select(x => new AssetLedgerRow(x.Id, x.Code, x.Name, x.CategoryCode, x.DepartmentCode, x.UseDate,
            x.OriginalCost, x.ResidualValue, x.AccumulatedDepreciation, x.NetValue, x.DisposalDate)).ToImmutableArray();
    public ImmutableArray<AssetMovement> Movements(Guid id) => Read().Movements.Where(x => x.AssetId == id).OrderBy(x => x.Date).ToImmutableArray();
    public ImmutableArray<AssetDepreciationLine> DepreciationQuery(int year, int firstMonth, int lastMonth, bool hideZero)
    {
        Require(year is >= 1 and <= 9999 && firstMonth >= 1 && lastMonth <= 12 && firstMonth <= lastMonth, "query-range", "月份范围不正确。");
        return Read().Batches.Where(x => !x.Cancelled && x.Period.Year == year && x.Period.Month >= firstMonth && x.Period.Month <= lastMonth)
            .OrderBy(x => x.Period).SelectMany(x => x.Lines).Where(x => !hideZero || x.Amount != 0).ToImmutableArray();
    }

    public static void ValidateCard(AssetCard card, AssetCatalog catalog)
    {
        Require(card.Id != Guid.Empty && HasText(card.Code), "asset-code", "请输入设备编号！");
        Require(HasText(card.Name), "asset-name", "请输入设备名称！");
        Require(catalog.Categories.Count(x => x.Code == card.CategoryCode) == 1, "asset-category", "请输入类别！");
        Require(catalog.Statuses.Count(x => x.Code == card.StatusCode) == 1, "asset-status", "请输入状态！");
        Require(catalog.Purposes.Count(x => x.Code == card.PurposeCode) == 1, "asset-purpose", "请输入用途！");
        Require(catalog.Departments.Count(x => x.Code == card.DepartmentCode) == 1, "asset-department", "请选择使用部门。");
        Require(card.UseDate > new DateOnly(1900, 1, 1) && card.PurchaseDate > new DateOnly(1900, 1, 1), "asset-date", "请输入有效的购置和使用日期！");
        Require(card.UseDate >= card.PurchaseDate, "use-date", "使用日期不能早于购置日期。");
        Require(card.OriginalCost > 0 && Money(card.OriginalCost), "asset-cost", "请输入大于零且精确到分的原值！");
        Require(card.ResidualRate is >= 0 and <= 1 && card.ResidualValue >= 0 && card.ResidualValue <= card.OriginalCost && Money(card.ResidualValue),
            "asset-residual", "预计残值须在零与原值之间，残值率须在0与1之间。");
        Require(card.UsefulLifeMonths > 0 && card.DepreciatedMonths >= 0 &&
            (card.Method != AssetDepreciationMethod.StraightLine || card.DepreciatedMonths <= card.UsefulLifeMonths), "asset-life", "请输入有效的使用年限(月)！");
        Require(card.AccumulatedDepreciation >= 0 && Money(card.AccumulatedDepreciation) &&
            card.AccumulatedDepreciation + card.ResidualValue <= card.OriginalCost, "asset-accumulated", "原值扣除累计折旧后不能小于预计残值。");
        Require(card.MonthlyDepreciation >= 0 && Money(card.MonthlyDepreciation), "asset-monthly", "月折旧额须为非负且精确到分。");
        Require(card.Quantity >= 0 && card.TotalWorkload >= 0 && card.AccumulatedWorkload >= 0 && card.MonthlyWorkload >= 0,
            "asset-quantity", "数量和工作量不能为负数。");
        Require(Enum.IsDefined(card.Method), "asset-method", "请输入支持的折旧方法！");
        Require(card.Method != AssetDepreciationMethod.UnitsOfProduction || card.TotalWorkload > 0 && card.AccumulatedWorkload <= card.TotalWorkload,
            "asset-workload", "工作量法须输入总工作量，累计工作量不能超过总工作量。");
        Require(card.Method != AssetDepreciationMethod.UnitsOfProduction || card.AccumulatedWorkload < card.TotalWorkload ||
            card.AccumulatedDepreciation + card.ResidualValue == card.OriginalCost, "workload-exhausted", "工作量已用完但可折旧基础未结清，请核实期初资料。");
        Require(card.Accessories.Select(x => x.Code).Distinct(StringComparer.Ordinal).Count() == card.Accessories.Length,
            "accessory-duplicate", "附属设备编号不能重复！");
        Require(card.Accessories.All(x => HasText(x.Code) && HasText(x.Name) && x.Quantity >= 0 && x.UnitPrice >= 0 && x.Amount >= 0),
            "accessory-invalid", "附属设备编号、名称或金额不正确。");
    }

    public static void ValidateSnapshot(AssetBookState state)
    {
        Require(state.Identity.Product is "minfeiqi" or "chengben" && HasText(state.Identity.BookId), "book-identity", "固定资产账套身份不正确。");
        Require(state.Revision >= 0, "revision", "账套版本不正确。");
        _ = state.Settings.OpeningPeriod.FirstDay;
        Require(state.Cards.Values.Select(x => x.Code).Distinct(StringComparer.Ordinal).Count() == state.Cards.Count,
            "duplicate-code", "编号重复！");
        foreach (var (id, card) in state.Cards)
        {
            Require(id == card.Id, "asset-identity", "卡片身份不一致。");
            ValidateCard(card, state.Settings.Catalog);
        }
        var active = state.Batches.Where(x => !x.Cancelled).OrderBy(x => x.Period).ToArray();
        var expected = state.Settings.OpeningPeriod;
        foreach (var batch in active)
        {
            Require(batch.Period == expected, "period-order", "折旧月份不连续或重复。"); expected = expected.Next();
            Require(batch.Lines.All(x => x.Amount >= 0 && Money(x.Amount) && x.AccumulatedAfter == x.AccumulatedBefore + x.Amount),
                "batch-amount", "折旧明细金额不正确。");
        }
        foreach (var plan in state.VoucherPlans)
            Require(plan.Lines.Length > 0 && plan.DebitTotal == plan.CreditTotal && plan.Lines.All(x =>
                x.Debit >= 0 && x.Credit >= 0 && Money(x.Debit) && Money(x.Credit) && (x.Debit == 0 || x.Credit == 0)),
                "unbalanced", "凭证计划借贷不平。");
    }
}
