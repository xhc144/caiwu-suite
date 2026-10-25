namespace Caiwu.Nonprofit.Reporting;

public enum NonprofitStatementForm { BalanceSheet, ActivityStatement }
/// <summary>Host-facing export session. Rechecks the live saved source before every export; DTOs remain immutable historical values.</summary>
public sealed class ClassifiedLedgerPreview
{
    private readonly LedgerSnapshotStatementDataSource source;
    public NonprofitStatementSet Statements {get;}
    internal ClassifiedLedgerPreview(LedgerSnapshotStatementDataSource source,NonprofitStatementSet statements)
    {this.source=source;Statements=statements;}
    public void RequireCurrentSource()=>source.RequireCurrentSource();
    public string ToCsv(NonprofitStatementForm form){RequireCurrentSource();return NonprofitStatementExporter.ToCsv(Select(form));}
    public string ToHtml(NonprofitStatementForm form,StatementHtmlOptions? options=null){RequireCurrentSource();return NonprofitStatementExporter.ToHtml(Select(form),options);}
    public void WriteCsv(NonprofitStatementForm form,Stream stream,bool leaveOpen=true)
    {RequireCurrentSource();NonprofitStatementExporter.WriteCsv(Select(form),stream,leaveOpen);}
    public void WriteHtml(NonprofitStatementForm form,Stream stream,StatementHtmlOptions? options=null,bool leaveOpen=true)
    {RequireCurrentSource();NonprofitStatementExporter.WriteHtml(Select(form),stream,options,leaveOpen);}
    private NonprofitStatement Select(NonprofitStatementForm form)=>form switch
    {NonprofitStatementForm.BalanceSheet=>Statements.BalanceSheet,NonprofitStatementForm.ActivityStatement=>Statements.ActivityStatement,_=>throw new ArgumentOutOfRangeException(nameof(form))};
}
