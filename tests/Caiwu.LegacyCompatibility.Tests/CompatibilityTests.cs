using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Caiwu.LegacyCompatibility;

namespace Caiwu.LegacyCompatibility.Tests;

public sealed class CompatibilityTests
{
    [Fact]
    public async Task FullSyntheticReadMapReconcileAndPublishKeepsLosslessSnapshot()
    {
        var fixture = new SyntheticLedger();
        var result = await fixture.Run();
        Assert.Equal(PreviewState.CorePreviewReconciled, result.Report.State);
        var projection = Assert.IsType<CoreProjection>(result.ProjectionForReview);
        Assert.Equal(2, projection.Accounts.Count);
        Assert.Equal(2, projection.Headers.Count);
        Assert.Equal(4, projection.Lines.Count);
        Assert.Equal(1, projection.Accounts[0].Level);
        Assert.Equal("D", projection.Accounts[0].RawBalanceDirection);
        Assert.Equal("?", projection.Accounts[0].RawDisabledFlag);
        Assert.Equal("X", projection.Accounts[0].RawFeatureFlags["xms"]);
        Assert.Equal("X01  ", projection.Accounts[0].DefaultDimensions["xmbm"]);
        Assert.Equal(2, projection.Headers[0].AttachmentCount);
        Assert.Equal(new DateOnly(2026, 1, 11), projection.Headers[0].ReviewDate);
        Assert.Equal(new DateOnly(2026, 1, 12), projection.Headers[0].PostingDate);
        Assert.Null(projection.Headers[1].ReviewDate);
        Assert.Equal("FAKE-CONTRACT", projection.Lines[0].Dimensions["htbh"]);
        Assert.Equal(new DateOnly(2026, 2, 2), projection.Lines[0].DueDate);
        Assert.Equal(SyntheticLedger.Amount.ToString("R", CultureInfo.InvariantCulture), projection.Lines[0].Debit.ToString());
        Assert.Equal("1.23456789", projection.Lines[0].ForeignAmount?.ToString());
        Assert.Equal("0.123456789", projection.Lines[0].Quantity?.ToString());
        Assert.Equal("7.123456789", projection.Lines[0].ExchangeRate?.ToString());
        Assert.Equal("10.00000001", projection.Lines[0].UnitPrice?.ToString());
        Assert.Equal("X01  ", projection.Lines[0].Table.Cell(projection.Lines[0].Source, "xmbm").Literal);
        Assert.Equal("FAKE-CONTRACT", projection.Lines[0].Table.Cell(projection.Lines[0].Source, "htbh").Literal);
        Assert.Equal("0.12345678901234567890", projection.Lines[0].Table.Cell(projection.Lines[0].Source, "future_column").Literal);
        Assert.Equal("?", projection.Accounts[0].Table.Cell(projection.Accounts[0].Source, "sybz").Literal);
        Assert.Equal("100.125", projection.Openings[0].BaseDebit?.ToString());
        Assert.Equal(6, projection.Original.Tables.Count);
        foreach (DataTable source in fixture.Data.Tables)
        {
            var captured = projection.Original.Tables.Single(t => t.Identity.Name == source.TableName);
            Assert.Equal(source.Columns.Count, captured.Columns.Count);
            Assert.Equal(source.Rows.Count, captured.Rows.Count);
            for (var row = 0; row < source.Rows.Count; row++)
                for (var column = 0; column < source.Columns.Count; column++)
                    Assert.Equal(LegacyCell.Capture(source.Rows[row][column]), captured.Rows[row].Cells[column]);
        }
        using var output = new TemporaryDirectory();
        var path = Path.Combine(output.Path, "preview.json");
        await PreviewReportPublisher.PublishNewAsync(result.Report, path, TestContext.Current.CancellationToken);
        using var json = JsonDocument.Parse(await File.ReadAllBytesAsync(path, TestContext.Current.CancellationToken));
        Assert.Equal("CorePreviewReconciled", json.RootElement.GetProperty("State").GetString());
        Assert.False(json.RootElement.GetProperty("ApplyAllowed").GetBoolean());
        Assert.Equal("not_assessed", json.RootElement.GetProperty("OriginalLedgerUsability").GetString());
        Assert.Equal("not_tested", json.RootElement.GetProperty("WindowsAcceptance").GetString());
        Assert.Equal("not_established", json.RootElement.GetProperty("InventoryToExtractionBinding").GetString());
        var serialized = await File.ReadAllTextAsync(path, TestContext.Current.CancellationToken);
        Assert.DoesNotContain("MAKER01", serialized);
        Assert.DoesNotContain("FAKE-CONTRACT", serialized);
        Assert.DoesNotContain("合成现金", serialized);
        Assert.DoesNotContain("synthetic-secret-not-for-report", serialized);
    }

    [Fact]
    public async Task DataSetCaptureFreezesBinaryNullEmptySpacesAndInputMutation()
    {
        var fixture = new SyntheticLedger();
        var extractor = fixture.Extractor();
        var before = await extractor.ExtractAsync(TestContext.Current.CancellationToken);
        ((byte[])fixture["unmapped_module"].Rows[0]["blob"])[0] = 99;
        fixture["kmbm"].Rows[0]["km_mc"] = "CHANGED";
        var after = await extractor.ExtractAsync(TestContext.Current.CancellationToken);
        Assert.Equal(before.ContentFingerprint, after.ContentFingerprint);
        var extra = before.Tables.Single(t => t.Identity.Name == "unmapped_module");
        Assert.Equal("AP8BgA==", extra.Cell(extra.Rows[0], "blob").Literal);
        Assert.Equal(new LegacyCell(CellStorage.Null, null), extra.Cell(extra.Rows[0], "null"));
        Assert.Equal(new LegacyCell(CellStorage.Text, ""), extra.Cell(extra.Rows[0], "empty"));
        Assert.Equal("    ", extra.Cell(extra.Rows[0], "spaces").Literal);
        Assert.Equal("100.2500", extra.Cell(extra.Rows[0], "amount").Literal);
    }

    [Fact]
    public async Task ModuleReportPlanRetainsSameReviewedContextStableIdAndExplicitRules()
    {
        var result = await new SyntheticLedger().Run();
        var bookId = Guid.Parse("f7e051ab-c66e-4475-95e2-39a8155e6231");
        var captured = new CapturedModuleRevision(bookId, 29);
        var batch = CompatibilityModuleAdapter.PrepareReportArchival(result.Report, captured);
        var again = CompatibilityModuleAdapter.PrepareReportArchival(result.Report, captured);
        Assert.Same(captured, batch.Context);
        Assert.Equal("compat", batch.ModuleId);
        Assert.Equal(29, batch.Context.ExpectedRevision);
        Assert.Equal(bookId, batch.Context.ExpectedBookId);
        Assert.Equal(batch.Documents[0], again.Documents[0]);
        var differentRevision = CompatibilityModuleAdapter.PrepareReportArchival(result.Report, new CapturedModuleRevision(bookId, 30));
        Assert.NotEqual(batch.Documents[0].DocumentId, differentRevision.Documents[0].DocumentId);
        using var payload = JsonDocument.Parse(batch.Documents[0].PayloadJson);
        var report = payload.RootElement.GetProperty("preview");
        var rules = report.GetProperty("Interpretation");
        Assert.False(report.GetProperty("ApplyAllowed").GetBoolean());
        Assert.Equal("PreserveExact", rules.GetProperty("KeyPolicy").GetString());
        Assert.Equal("NativeBaseCurrencyRows", rules.GetProperty("OpeningBasis").GetString());
        Assert.Equal("P", rules.GetProperty("PostedCodes")[0].GetString());
        Assert.Equal("F004", report.GetProperty("DatabaseInputId").GetString());
        Assert.Throws<ArgumentException>(() => new CapturedModuleRevision(Guid.Empty, 0));
        Assert.Throws<ArgumentException>(() => new CapturedModuleRevision(bookId, -1));
    }

    [Fact]
    public async Task RealDataReaderBoundaryCapturesProviderRowsAndEnforcesCatalogueOrder()
    {
        var fixture = new SyntheticLedger();
        using var reader = fixture["pz"].CreateDataReader();
        var id = new TableIdentity(SyntheticLedger.Owner, "pz");
        var table = await RelationalReaderCapture.CaptureAsync(reader, id, fixture.Catalogue[id], cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(4, table.Rows.Count);
        Assert.Equal("FAKE-CONTRACT", table.Cell(table.Rows[0], "htbh").Literal);
        using var wrongReader = fixture["pz"].CreateDataReader();
        var wrong = fixture.Catalogue[id].Reverse().ToArray();
        var error = await Assert.ThrowsAsync<LegacyExtractionException>(async () =>
            await RelationalReaderCapture.CaptureAsync(wrongReader, id, wrong, cancellationToken: TestContext.Current.CancellationToken));
        Assert.Equal("reader_catalogue_column_order_mismatch", error.Message);
    }

    [Fact]
    public async Task ReaderBudgetNeverReturnsTruncatedTable()
    {
        var fixture = new SyntheticLedger();
        using var reader = fixture["pz"].CreateDataReader();
        var id = new TableIdentity(SyntheticLedger.Owner, "pz");
        var error = await Assert.ThrowsAsync<LegacyExtractionException>(async () =>
            await RelationalReaderCapture.CaptureAsync(reader, id, fixture.Catalogue[id], maxRows: 2, cancellationToken: TestContext.Current.CancellationToken));
        Assert.Equal("row_budget_exceeded_no_partial_snapshot", error.Message);
    }

    [Fact]
    public void UnsupportedAndNonfiniteProviderValuesNeverBecomeStringsOrZero()
    {
        foreach (var value in new object[] { double.NaN, double.PositiveInfinity, float.NegativeInfinity, new object() })
            Assert.Throws<LegacyExtractionException>(() => LegacyCell.Capture(value));
    }

    [Fact]
    public async Task MissingOriginalDriverIsExplicitAndNeverOriginalAcceptance()
    {
        var snapshot = await new SyntheticLedger().Snapshot();
        var result = await CompatibilityPreview.RunAsync(SyntheticLedger.Receipt(), new SqlAnywhereReadOnlyExtractor(),
            SyntheticLedger.Interpretation(snapshot), TestContext.Current.CancellationToken);
        Assert.Equal(PreviewState.ExtractionFailed, result.Report.State);
        Assert.Null(result.ProjectionForReview);
        Assert.Null(result.Report.ContentFingerprint);
        Assert.Equal("not_assessed", result.Report.CompatibilityStatus);
        var error = await Assert.ThrowsAsync<LegacyExtractionException>(async () => await new SqlAnywhereReadOnlyExtractor().ExtractAsync(TestContext.Current.CancellationToken));
        Assert.Equal("sql_anywhere_driver_and_verified_copy_session_unavailable", error.Message);
    }

    [Fact]
    public async Task ExternalSnapshotDoesNotBecomeVerifiedBySelfDeclaration()
    {
        var synthetic = await new SyntheticLedger().Snapshot();
        var external = new LegacySnapshot("external-copy-not-authenticated", ExtractionOrigin.ExternalCopyNotValidated, synthetic.Tables);
        var result = await CompatibilityPreview.RunAsync(SyntheticLedger.Receipt(), new FixedExtractor(external), SyntheticLedger.Interpretation(external), TestContext.Current.CancellationToken);
        Assert.Equal(PreviewState.Incomplete, result.Report.State);
        Assert.Null(result.ProjectionForReview);
        Assert.Contains(result.Report.Checks, c => c.Code == "external_copy_session_and_post_read_hash_not_validated");
    }

    [Theory]
    [InlineData("pz", "pz_jf", null, "numeric_null_or_non_numeric_value_no_zero_substitution")]
    [InlineData("pzdj", "nf", 0, "voucher_date_period_mismatch")]
    [InlineData("pzdj", "pzdj_rq", null, "date_field_not_losslessly_representable_as_calendar_date")]
    public async Task NullAndInvalidCoreValuesRejectWholeCandidate(string table, string field, object? value, string code)
    {
        var fixture = new SyntheticLedger();
        fixture[table].Rows[0][field] = value ?? DBNull.Value;
        var outcome = await fixture.Run();
        Assert.Equal(PreviewState.Rejected, outcome.Report.State);
        Assert.Null(outcome.ProjectionForReview);
        Assert.Contains(outcome.Report.Checks, c => c.Code == code && c.Status == CheckStatus.Mismatch);
    }

    [Fact]
    public async Task DoesNotTruncateDatetimeToVoucherDate()
    {
        var fixture = new SyntheticLedger();
        fixture["pzdj"].Rows[0]["pzdj_rq"] = new DateTime(2026, 1, 10, 1, 2, 3);
        var outcome = await fixture.Run();
        Assert.Equal(PreviewState.Rejected, outcome.Report.State);
        Assert.Contains(outcome.Report.Checks, c => c.Code == "date_field_not_losslessly_representable_as_calendar_date");
    }

    [Fact]
    public async Task DetectsOrphansAccountReferencesAndHeaderWithoutLines()
    {
        var fixture = new SyntheticLedger();
        fixture["pz"].Rows[0]["kmbm"] = "MISSING";
        fixture["pz"].Rows[0]["pzbh"] = 999;
        fixture["pz"].Rows.RemoveAt(1);
        var outcome = await fixture.Run();
        Assert.Equal(PreviewState.Rejected, outcome.Report.State);
        Assert.Null(outcome.ProjectionForReview);
        foreach (var code in new[] { "referenced_account_missing", "orphan_voucher_line", "voucher_header_without_lines" })
            Assert.Contains(outcome.Report.Checks, c => c.Code == code);
    }

    [Theory]
    [InlineData("kmbm", "account_key_collision_no_deduplication")]
    [InlineData("pzdj", "voucher_header_key_collision")]
    [InlineData("pz", "voucher_line_key_collision_no_renumbering")]
    [InlineData("nc", "opening_grain_collision_no_aggregation")]
    [InlineData("hz", "movement_grain_collision_no_aggregation")]
    public async Task NeverSilentlyDeduplicatesAnyCoreGrain(string name, string code)
    {
        var fixture = new SyntheticLedger();
        fixture[name].Rows.Add(fixture[name].Rows[0].ItemArray);
        var outcome = await fixture.Run();
        Assert.Equal(PreviewState.Rejected, outcome.Report.State);
        Assert.Null(outcome.ProjectionForReview);
        Assert.Contains(outcome.Report.Checks, c => c.Code == code);
        Assert.Equal(fixture[name].Rows.Count, outcome.Report.CapturedTables.Single(t => t.Identity.Name == name).Rows);
    }

    [Fact]
    public async Task ChangedSchemasAndNamespacesCannotReuseBinding()
    {
        var fixture = new SyntheticLedger();
        var old = await fixture.Snapshot();
        fixture["pz"].Columns.Add("new_unrecognised_column", typeof(string));
        var id = new TableIdentity(SyntheticLedger.Owner, "pz");
        fixture.Catalogue[id] = fixture.Catalogue[id].Append(new LegacyColumn("new_unrecognised_column", "varchar(80)", true)).ToArray();
        var changed = await fixture.Snapshot();
        Assert.NotEqual(old.Tables.Single(t => t.Identity == id).SchemaFingerprint, changed.Tables.Single(t => t.Identity == id).SchemaFingerprint);
        var outcome = await CompatibilityPreview.RunAsync(SyntheticLedger.Receipt(), new FixedExtractor(changed), SyntheticLedger.Interpretation(old), TestContext.Current.CancellationToken);
        Assert.Equal(PreviewState.Rejected, outcome.Report.State);
        Assert.Contains(outcome.Report.Checks, c => c.Code == "schema_fingerprint_mismatch");
        var renamed = new LegacySnapshot("synthetic", ExtractionOrigin.Synthetic, changed.Tables.Select(t => t.Identity == id
            ? new LegacyTable(new TableIdentity("other_owner", "pz"), t.Columns, t.Rows) : t));
        var error = Assert.Throws<LegacyMappingException>(() => CoreMapper.Map(renamed, SyntheticLedger.Bindings(changed), cancellationToken: TestContext.Current.CancellationToken));
        Assert.Equal("bound_table_missing", error.Message);
    }

    [Fact]
    public async Task MissingRequiredFieldFailsEvenWithNewlyBoundSchema()
    {
        var fixture = new SyntheticLedger();
        fixture["pz"].Columns.Remove("pz_df");
        var id = new TableIdentity(SyntheticLedger.Owner, "pz");
        fixture.Catalogue[id] = fixture.Catalogue[id].Where(c => c.Name != "pz_df").ToArray();
        var outcome = await fixture.Run();
        Assert.Equal(PreviewState.Rejected, outcome.Report.State);
        Assert.Contains(outcome.Report.Checks, c => c.Code == "core_required_columns_missing");
    }

    [Fact]
    public async Task CharPaddingRequiresExplicitPolicyAndPreservesRawValues()
    {
        var fixture = new SyntheticLedger();
        fixture["pz"].Rows[0]["kmbm"] = "1001   ";
        var exact = await fixture.Run();
        Assert.Equal(PreviewState.Rejected, exact.Report.State);
        var trimmed = await fixture.Run(s => SyntheticLedger.Interpretation(s, keyPolicy: CharacterKeyPolicy.TrimDeclaredCharPadding));
        Assert.Equal(PreviewState.CorePreviewReconciled, trimmed.Report.State);
        var line = trimmed.ProjectionForReview!.Lines[0];
        Assert.Equal("1001", line.AccountCode);
        Assert.Equal("1001   ", line.Table.Cell(line.Source, "kmbm").Literal);
        Assert.Equal("合成摘要  ", line.Table.Cell(line.Source, "pz_zy").Literal);
    }

    [Fact]
    public async Task ExplicitTrimCannotHideAccountCollisionOrTrimVarchar()
    {
        var fixture = new SyntheticLedger();
        fixture["kmbm"].Rows.Add(fixture["kmbm"].Rows[0].ItemArray);
        fixture["kmbm"].Rows[2]["kmbm"] = "1001 "; // VARCHAR is not trimmed by a CHAR-padding policy.
        var first = await fixture.Run(s => SyntheticLedger.Interpretation(s, keyPolicy: CharacterKeyPolicy.TrimDeclaredCharPadding));
        Assert.DoesNotContain(first.Report.Checks, c => c.Code == "account_key_collision_no_deduplication");
        var id = new TableIdentity(SyntheticLedger.Owner, "kmbm");
        fixture.Catalogue[id] = fixture.Catalogue[id].Select(c => c.Name == "kmbm" ? c with { DeclaredType = "char(20)" } : c).ToArray();
        var second = await fixture.Run(s => SyntheticLedger.Interpretation(s, keyPolicy: CharacterKeyPolicy.TrimDeclaredCharPadding));
        Assert.Equal(PreviewState.Rejected, second.Report.State);
        Assert.Contains(second.Report.Checks, c => c.Code == "account_key_collision_no_deduplication");
    }

    [Fact]
    public async Task UnknownStatusNeverUsesNonemptyPostedByAsPostedProof()
    {
        var fixture = new SyntheticLedger();
        var outcome = await fixture.Run(s => SyntheticLedger.Interpretation(s, knownStatuses: false));
        Assert.Equal(PreviewState.Incomplete, outcome.Report.State);
        Assert.Null(outcome.ProjectionForReview);
        Assert.Contains(outcome.Report.Checks, c => c.Code == "posting_status_not_interpreted_no_guess");
        Assert.DoesNotContain(outcome.Report.Checks, c => c.Code == "monthly_posted_debit");
    }

    [Fact]
    public async Task DraftsAreExcludedFromExplicitPostedOnlyMovementComparison()
    {
        var fixture = new SyntheticLedger();
        var outcome = await fixture.Run();
        Assert.Equal(PreviewState.CorePreviewReconciled, outcome.Report.State);
        Assert.All(outcome.Report.Checks.Where(c => c.Code.StartsWith("monthly_posted_", StringComparison.Ordinal)), c =>
            Assert.Equal(CheckStatus.Matched, c.Status));
        fixture["hz"].Rows[0]["jf"] = SyntheticLedger.Amount + 3.875;
        var includesDraft = await fixture.Run();
        Assert.Equal(PreviewState.Rejected, includesDraft.Report.State);
        Assert.Contains(includesDraft.Report.Checks, c => c.Code == "monthly_posted_debit" && c.Status == CheckStatus.Mismatch);
    }

    [Fact]
    public async Task OpeningAndBeforeOpeningAreBothReconciledWithoutRounding()
    {
        var fixture = new SyntheticLedger();
        fixture["nc"].Rows[0]["nc_jf"] = 100.1251;
        fixture["nc"].Rows[0]["jq_jf"] = 5.5556;
        var outcome = await fixture.Run();
        Assert.Equal(PreviewState.Rejected, outcome.Report.State);
        Assert.Contains(outcome.Report.Checks, c => c.Code == "opening_trial_balance" && c.Left == "100.1251" && c.Right == "100.125");
        Assert.Contains(outcome.Report.Checks, c => c.Code == "before_opening_trial_balance" && c.Status == CheckStatus.Mismatch);
    }

    [Fact]
    public async Task ConvertedOpeningRequiresAllBaseColumnsAndDoesNotUseNativeFallback()
    {
        var fixture = new SyntheticLedger();
        fixture["nc"].Rows[0]["nc_jf"] = 99999d;
        var success = await fixture.Run(s => SyntheticLedger.Interpretation(s, openingBasis: OpeningAmountBasis.ConvertedBaseColumns));
        Assert.Equal(PreviewState.CorePreviewReconciled, success.Report.State);
        fixture["nc"].Rows[0]["nc_jf_b"] = DBNull.Value;
        var incomplete = await fixture.Run(s => SyntheticLedger.Interpretation(s, openingBasis: OpeningAmountBasis.ConvertedBaseColumns));
        Assert.Equal(PreviewState.Incomplete, incomplete.Report.State);
        Assert.Null(incomplete.ProjectionForReview);
        Assert.Contains(incomplete.Report.Checks, c => c.Code == "base_opening_columns_missing_or_null");
    }

    [Fact]
    public async Task MissingBalanceRowsAndUndeclaredScopeDoNotBecomeZeroOrPass()
    {
        var fixture = new SyntheticLedger();
        fixture["nc"].Rows.RemoveAt(0);
        fixture["hz"].Rows.RemoveAt(0);
        var outcome = await fixture.Run(s => SyntheticLedger.Interpretation(s, completeScope: false,
            openingBasis: OpeningAmountBasis.NotConfirmed, postedBasis: false));
        Assert.Equal(PreviewState.Incomplete, outcome.Report.State);
        Assert.Null(outcome.ProjectionForReview);
        foreach (var code in new[] { "complete_leaf_scope_not_declared", "opening_amount_basis_unknown", "movement_posted_only_basis_unknown",
                     "opening_row_missing_or_ambiguous_no_zero_substitution" })
            Assert.Contains(outcome.Report.Checks, c => c.Code == code);
        var missingMovement = await fixture.Run();
        Assert.Contains(missingMovement.Report.Checks, c => c.Code == "movement_row_missing_or_ambiguous_no_zero_substitution");
    }

    [Fact]
    public async Task OtherCurrencyAndAuxiliaryRowsStayCapturedWithoutDoubleCounting()
    {
        var fixture = new SyntheticLedger();
        fixture["hz"].Rows.Add(fixture["hz"].Rows[0].ItemArray);
        fixture["hz"].Rows[2]["bz"] = "USD";
        fixture["hz"].Rows[2]["jf"] = 999d;
        fixture["hz"].Rows.Add(fixture["hz"].Rows[0].ItemArray);
        fixture["hz"].Rows[3]["xmlb"] = "X";
        fixture["hz"].Rows[3]["xmbm"] = "X01";
        fixture["hz"].Rows[3]["jf"] = 888d;
        var outcome = await fixture.Run();
        Assert.Equal(PreviewState.CorePreviewReconciled, outcome.Report.State);
        Assert.Equal(4, outcome.ProjectionForReview!.Movements.Count);
        Assert.Contains(outcome.Report.Checks, c => c.Code == "foreign_quantity_auxiliary_modules_preserved_not_reconciled");
    }

    [Fact]
    public async Task BinaryFloatingDifferenceIsReportedWithoutTolerance()
    {
        var fixture = new SyntheticLedger();
        fixture["pz"].Rows[0]["pz_jf"] = 0.1 + 0.2;
        fixture["pz"].Rows[1]["pz_df"] = 0.1 + 0.2;
        fixture["hz"].Rows[0]["jf"] = 0.3;
        fixture["hz"].Rows[1]["df"] = 0.3;
        var outcome = await fixture.Run();
        Assert.Equal(PreviewState.Rejected, outcome.Report.State);
        Assert.Contains(outcome.Report.Checks, c => c.Code == "monthly_posted_debit" && c.Left == "0.30000000000000004" && c.Right == "0.3");
        Assert.Contains(outcome.Report.Checks, c => c.Code == "roundtrip_decimal_arithmetic_not_original_binary_evaluation");
    }

    [Fact]
    public async Task NegativeReversalAmountsArePreservedRatherThanForcedPositive()
    {
        var fixture = new SyntheticLedger();
        fixture["pz"].Rows[0]["pz_jf"] = -SyntheticLedger.Amount;
        fixture["pz"].Rows[1]["pz_df"] = -SyntheticLedger.Amount;
        fixture["hz"].Rows[0]["jf"] = -SyntheticLedger.Amount;
        fixture["hz"].Rows[1]["df"] = -SyntheticLedger.Amount;
        var outcome = await fixture.Run();
        Assert.Equal(PreviewState.CorePreviewReconciled, outcome.Report.State);
        Assert.StartsWith("-", outcome.ProjectionForReview!.Lines[0].Debit.ToString());
    }

    [Fact]
    public async Task CancellationAndProviderFailureReturnNoCandidateOrSensitiveError()
    {
        var snapshot = await new SyntheticLedger().Snapshot();
        using var canceled = new CancellationTokenSource();
        canceled.Cancel();
        var cancel = await CompatibilityPreview.RunAsync(SyntheticLedger.Receipt(), new FixedExtractor(snapshot),
            SyntheticLedger.Interpretation(snapshot), canceled.Token);
        Assert.Equal(PreviewState.Canceled, cancel.Report.State);
        Assert.Null(cancel.ProjectionForReview);
        var failed = await CompatibilityPreview.RunAsync(SyntheticLedger.Receipt(), new ThrowingExtractor(), SyntheticLedger.Interpretation(snapshot), TestContext.Current.CancellationToken);
        Assert.Equal(PreviewState.ExtractionFailed, failed.Report.State);
        Assert.Null(failed.ProjectionForReview);
        Assert.DoesNotContain("fake-secret-password", JsonSerializer.Serialize(failed.Report));
    }

    [Fact]
    public async Task ReportFailureDoesNotOverwriteSourceOrLeaveStage()
    {
        var outcome = await new SyntheticLedger().Run();
        using var directory = new TemporaryDirectory();
        var existingSource = Path.Combine(directory.Path, "synthetic-source.db");
        byte[] sourceBytes = [0, 10, 255, 17, 8];
        await File.WriteAllBytesAsync(existingSource, sourceBytes, TestContext.Current.CancellationToken);
        await Assert.ThrowsAsync<IOException>(async () => await PreviewReportPublisher.PublishNewAsync(outcome.Report, existingSource, TestContext.Current.CancellationToken));
        Assert.Equal(sourceBytes, await File.ReadAllBytesAsync(existingSource, TestContext.Current.CancellationToken));
        Assert.Empty(Directory.GetFiles(directory.Path, ".caiwu-compat-*.tmp"));
        var occupied = Path.Combine(directory.Path, "occupied.json");
        Directory.CreateDirectory(occupied);
        await Assert.ThrowsAnyAsync<IOException>(async () => await PreviewReportPublisher.PublishNewAsync(outcome.Report, occupied, TestContext.Current.CancellationToken));
        Assert.Empty(Directory.GetFiles(directory.Path, ".caiwu-compat-*.tmp"));
        using var canceled = new CancellationTokenSource();
        canceled.Cancel();
        var unpublished = Path.Combine(directory.Path, "canceled.json");
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await PreviewReportPublisher.PublishNewAsync(outcome.Report, unpublished, canceled.Token));
        Assert.False(File.Exists(unpublished));
    }

    [Fact]
    public void ActualPr39SyntheticCliReportIsConsumedWithoutRehashingOrCompatibilityPromotion()
    {
        var receipt = SyntheticLedger.Receipt();
        Assert.True(receipt.InventoryComplete);
        Assert.Equal(4, receipt.Inputs.Count);
        Assert.True(receipt.UnresolvedGapCount > 0);
        Assert.All(receipt.Inputs, input => Assert.Matches("^[0-9a-f]{64}$", input.Sha256));
        var raw = Encoding.UTF8.GetString(SyntheticLedger.PreflightJson());
        Assert.DoesNotContain("selected_path", raw);
        Assert.DoesNotContain("synthetic-secret-not-for-report", raw);
    }

    [Fact]
    public async Task IncompleteInventoryStopsBeforeExtractorAndDoesNotGuessMissingFiles()
    {
        var json = JsonNode.Parse(SyntheticLedger.PreflightJson())!;
        json["inventory_status"] = "incomplete";
        json["files"]![0]!["status"] = "missing";
        json["files"]![0]!["sha256"] = null;
        json["files"]![0]!["bytes"] = null;
        var receipt = PreflightReceipt.Parse(Encoding.UTF8.GetBytes(json.ToJsonString()), "F004");
        var snapshot = await new SyntheticLedger().Snapshot();
        var never = new CountingExtractor(snapshot);
        var result = await CompatibilityPreview.RunAsync(receipt, never, SyntheticLedger.Interpretation(snapshot), TestContext.Current.CancellationToken);
        Assert.Equal(0, never.Calls);
        Assert.Equal(PreviewState.Incomplete, result.Report.State);
        Assert.Null(result.ProjectionForReview);
    }

    [Fact]
    public void ContradictoryPromotedAndDuplicatePreflightReportsAreRejected()
    {
        var raw = Encoding.UTF8.GetString(SyntheticLedger.PreflightJson());
        Assert.Throws<FormatException>(() => PreflightReceipt.Parse(Encoding.UTF8.GetBytes(raw.Replace(
            "\"compatibility_status\": \"not_assessed\"", "\"compatibility_status\": \"passed\"")), "F004"));
        Assert.Throws<FormatException>(() => PreflightReceipt.Parse(Encoding.UTF8.GetBytes(raw.Replace(
            "\"inventory_status\": \"complete\"", "\"inventory_status\": \"incomplete\"")), "F004"));
        Assert.Throws<FormatException>(() => PreflightReceipt.Parse(Encoding.UTF8.GetBytes(raw.Replace(
            "\"tool_version\": \"0.1.1\"", "\"tool_version\": \"0.1.0\"")), "F004"));
        var duplicate = raw.Replace("\"inventory_status\":", "\"inventory_status\":\"incomplete\",\"inventory_status\":");
        Assert.Throws<FormatException>(() => PreflightReceipt.Parse(Encoding.UTF8.GetBytes(duplicate), "F004"));
        Assert.Throws<FormatException>(() => PreflightReceipt.Parse(SyntheticLedger.PreflightJson(), "F999"));
    }

    [Theory]
    [InlineData("0.123456789012345678901234567890123456789", "0.123456789012345678901234567890123456789")]
    [InlineData("+00100.2500", "100.25")]
    [InlineData("-0.000", "0")]
    [InlineData("1.25e+4", "12500")]
    public void ExactNumericPreviewHasNoCentsRoundingOrDecimalRangeLoss(string input, string expected) =>
        Assert.Equal(expected, ExactNumber.Parse(input).ToString());

    [Fact]
    public void ExactArithmeticHandlesLargeSmallAndCancellationWithoutTolerance()
    {
        var large = ExactNumber.Parse("1e308");
        var small = ExactNumber.Parse("1e-324");
        Assert.Equal(small, (large + small) - large);
        Assert.Equal(ExactNumber.Parse("0.3"), ExactNumber.Parse("0.1") + ExactNumber.Parse("0.2"));
        Assert.NotEqual(ExactNumber.Parse("0.3"), ExactNumber.Parse("0.30000000000000004"));
        Assert.Equal(ExactNumber.Parse("1"), ExactNumber.Parse("1.000"));
        Assert.Throws<FormatException>(() => ExactNumber.Parse("1,234.56"));
        Assert.Throws<FormatException>(() => ExactNumber.Parse("NaN"));
        Assert.Throws<FormatException>(() => ExactNumber.Parse("1e1001"));
    }

    [Fact]
    public async Task UnknownEnumPoliciesCannotSkipOpeningReconciliation()
    {
        var snapshot = await new SyntheticLedger().Snapshot();
        Assert.Throws<ArgumentException>(() => SyntheticLedger.Interpretation(snapshot, openingBasis: (OpeningAmountBasis)99));
        Assert.Throws<ArgumentException>(() => SyntheticLedger.Interpretation(snapshot, keyPolicy: (CharacterKeyPolicy)99));
        Assert.Throws<LegacyMappingException>(() => CoreMapper.Map(snapshot, SyntheticLedger.Bindings(snapshot),
            (CharacterKeyPolicy)99, TestContext.Current.CancellationToken));
        Assert.Throws<ArgumentException>(() => new LegacyRow(1, [new LegacyCell((CellStorage)99, "data")]));
    }

    private sealed class FixedExtractor(LegacySnapshot snapshot) : ILegacyReadOnlyExtractor
    {
        public ValueTask<LegacySnapshot> ExtractAsync(CancellationToken cancellationToken = default) => ValueTask.FromResult(snapshot);
    }
    private sealed class ThrowingExtractor : ILegacyReadOnlyExtractor
    {
        public ValueTask<LegacySnapshot> ExtractAsync(CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("User=fake;Password=fake-secret-password;Path=/sensitive");
    }
    private sealed class CountingExtractor(LegacySnapshot snapshot) : ILegacyReadOnlyExtractor
    {
        public int Calls { get; private set; }
        public ValueTask<LegacySnapshot> ExtractAsync(CancellationToken cancellationToken = default) { Calls++; return ValueTask.FromResult(snapshot); }
    }
    private sealed class TemporaryDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "caiwu-compat-test-" + Guid.NewGuid().ToString("N"));
        public TemporaryDirectory() => Directory.CreateDirectory(Path);
        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
