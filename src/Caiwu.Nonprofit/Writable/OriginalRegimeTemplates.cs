namespace Caiwu.Nonprofit.Writable;

public sealed record OriginalRegimeTemplate(string Id, int DisplayOrder, string Name,
    string Regime, IReadOnlyList<int>? CodeLengths, string ContentStatus);

/// <summary>Five priority identities only, transcribed from existing tables.json/templates.
/// Metadata is not the original chart, report binary or complete 44-template catalog.</summary>
public static class OriginalRegimeTemplates
{
    public const int OriginalVisibleTemplateCount = 44;
    public const string EvidencePath = "docs/original-analysis/json/tables.json#/templates";
    public static IReadOnlyList<OriginalRegimeTemplate> Priority { get; } = Array.AsReadOnly(new[]
    {
        new OriginalRegimeTemplate("a01", 1, "企业会计准则（科目级数4-3-3）", "Enterprise", Array.AsReadOnly(new[] {4,3,3}), "原科目与报表内容未取得"),
        new OriginalRegimeTemplate("a02", 2, "企业会计准则（科目级数4-2-2）", "Enterprise", Array.AsReadOnly(new[] {4,2,2}), "原科目与报表内容未取得"),
        new OriginalRegimeTemplate("a05", 3, "小企业会计准则（科目级数4-3-3）", "SmallBusiness", Array.AsReadOnly(new[] {4,3,3}), "原科目与报表内容未取得"),
        new OriginalRegimeTemplate("a52", 4, "小企业会计准则（科目级数4-2-2）", "SmallBusiness", Array.AsReadOnly(new[] {4,2,2}), "原科目与报表内容未取得"),
        new OriginalRegimeTemplate("a54", 5, "民间非营利组织会计准则(2026)", "Nonprofit", null, "原科目级长/科目与报表内容未取得；不能由官方56项快照替代")
    });
}
