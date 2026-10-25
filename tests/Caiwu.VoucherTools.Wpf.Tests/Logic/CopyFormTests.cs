using System.Text.Json;
using Caiwu.Contracts;

namespace Caiwu.VoucherTools.Wpf.Tests;

public sealed class CopyFormTests
{
    private static CopyFormInput Valid() => new("2026-02-01", "转", "8", "0");
    private static CopyFormFeedback Validate(LedgerSnapshot shown, CopyFormInput input, string actor = "当前制单员") =>
        CopyForm.Validate(shown, shown.Vouchers[0].Id, actor, input, new VoucherCopyPlanner());

    [Fact]
    public void Empty_form_reports_each_required_field_and_does_not_ask_the_planner_to_guess()
    {
        var shown = SyntheticData.Snapshot();
        var planner = new RecordingPlanner();
        var input = new CopyFormInput("", "", "", "");
        var result = CopyForm.Validate(shown, shown.Vouchers[0].Id, "当前制单员", input, planner);
        Assert.Null(result.Plan);
        Assert.Equal(4, result.Errors.Count);
        Assert.Equal(0, planner.Calls);
        Assert.Equal(input, new CopyFormInput("", "", "", ""));
    }

    [Theory]
    [InlineData("2026-2-1")]
    [InlineData("02-01")]
    [InlineData("2026-02-30")]
    [InlineData("2026-02-01 ")]
    [InlineData("2026-02-01T00:00:00")]
    public void Partial_invalid_or_ambiguous_dates_stay_invalid_without_inferred_parts(string text)
    {
        var input = Valid() with { Date = text };
        var result = Validate(SyntheticData.Snapshot(), input);
        Assert.Null(result.Plan);
        Assert.Contains(result.Errors, e => e.Field == CopyField.Date);
        Assert.Equal(text, input.Date);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("1.0")]
    [InlineData("1,000")]
    [InlineData("2147483648")]
    [InlineData(" 8")]
    public void Malformed_or_out_of_range_numbers_are_field_errors(string text)
    {
        var result = Validate(SyntheticData.Snapshot(), Valid() with { Number = text });
        Assert.Null(result.Plan);
        Assert.Contains(result.Errors, e => e.Field == CopyField.Number);
    }

    [Theory]
    [InlineData("-1")]
    [InlineData("0.0")]
    [InlineData("2147483648")]
    public void Attachments_require_an_explicit_nonnegative_integer(string text)
    {
        var result = Validate(SyntheticData.Snapshot(), Valid() with { Attachments = text });
        Assert.Null(result.Plan);
        Assert.Contains(result.Errors, e => e.Field == CopyField.Attachments);
    }

    [Theory]
    [InlineData("period", "Date")]
    [InlineData("duplicate", "Number")]
    [InlineData("kind", "Kind")]
    [InlineData("actor", "PreparedBy")]
    [InlineData("inactive", "General")]
    public void Planner_issues_map_to_the_correct_field_without_losing_input(string mode, string expectedField)
    {
        var shown = SyntheticData.Snapshot();
        var input = Valid();
        var actor = "当前制单员";
        if (mode == "period") shown = shown with { Book = shown.Book with { ClosedThroughMonth = 2 } };
        if (mode == "duplicate") input = new("2026-01-05", "记", "7", "3");
        if (mode == "kind") input = input with { Kind = " 记 " };
        if (mode == "actor") actor = "";
        if (mode == "inactive") shown = shown with { Accounts = shown.Accounts.Select(a => a with { IsActive = false }).ToArray() };
        var before = JsonSerializer.Serialize(shown);
        var result = Validate(shown, input, actor);
        Assert.Null(result.Plan);
        Assert.Contains(result.Errors, e => e.Field.ToString() == expectedField);
        Assert.Equal(before, JsonSerializer.Serialize(shown));
    }

    [Fact]
    public void Valid_explicit_input_forwards_the_same_snapshot_and_current_actor_without_reloading()
    {
        var shown = SyntheticData.Snapshot();
        var planner = new RecordingPlanner();
        var input = Valid() with { Number = "2147483647", Attachments = "2147483647" };
        var before = JsonSerializer.Serialize(shown);
        var result = CopyForm.Validate(shown, shown.Vouchers[0].Id, "当前制单员", input, planner);
        Assert.Empty(result.Errors);
        var plan = Assert.IsType<VoucherCopyPlan>(result.Plan);
        Assert.Equal(1, planner.Calls);
        Assert.Same(shown, planner.Seen);
        Assert.Equal(int.MaxValue, plan.Draft.Number);
        Assert.Equal(int.MaxValue, plan.Draft.AttachmentCount);
        Assert.Equal(shown.Revision, plan.Draft.ExpectedRevision);
        Assert.Equal(shown.Book.Id, plan.Draft.ExpectedBookId);
        Assert.Equal("当前制单员", plan.PreparedBy);
        Assert.Null(plan.Draft.Id);
        Assert.Equal(before, JsonSerializer.Serialize(shown));
    }

    private sealed class RecordingPlanner : IVoucherCopyPlanner
    {
        internal int Calls { get; private set; }
        internal LedgerSnapshot? Seen { get; private set; }
        public VoucherCopyResult Plan(LedgerSnapshot displayedSnapshot, Guid sourceVoucherId, VoucherCopyOptions options)
        {
            Calls++;
            Seen = displayedSnapshot;
            return new VoucherCopyPlanner().Plan(displayedSnapshot, sourceVoucherId, options);
        }
    }
}
