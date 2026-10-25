using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Contracts;
using Caiwu.Nonprofit.Reporting;
using Caiwu.Nonprofit.Reporting.Wpf;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var output=Path.GetFullPath(args.Length==1?args[0]:Path.Combine(Path.GetTempPath(),"caiwu-np-wpf-"+Guid.NewGuid().ToString("N")));
        Directory.CreateDirectory(output);var checks=new List<string>();var errors=new StringWriter();
        PresentationTraceSources.DataBindingSource.Listeners.Add(new TextWriterTraceListener(errors));PresentationTraceSources.DataBindingSource.Switch.Level=SourceLevels.Error;
        Application? app=null;Window? window=null;
        try
        {
            app=new Application{ShutdownMode=ShutdownMode.OnExplicitShutdown};
            app.Resources.MergedDictionaries.Add(new ResourceDictionary{Source=new Uri("pack://application:,,,/PresentationFramework.Fluent;component/Themes/Fluent.xaml")});
            var now=new DateTimeOffset(2026,7,1,0,0,0,TimeSpan.Zero);var book=new BookInfo(Guid.NewGuid(),"Synthetic WPF nonprofit",AccountingRegime.Nonprofit,"np2026-synthetic",2026,1,0,now);
            var incomeId=Guid.NewGuid();var closeId=Guid.NewGuid();
            LedgerSnapshot snapshot=new(1,book,[new("1002","Synthetic bank",null,BalanceDirection.Debit,true,100,0),new("3101","Synthetic unrestricted",null,BalanceDirection.Credit,true,0,100),new("4101","Synthetic donation",null,BalanceDirection.Credit,true,0,0)],
                [new(incomeId,new(2026,6,1),"synthetic",1,0,"maker","reviewer",VoucherStatus.Posted,[new("1002","no semantic inference",10,0),new("4101","no semantic inference",0,10)]),
                 new(closeId,new(2026,6,30),"synthetic",2,0,"maker","reviewer",VoucherStatus.Posted,[new("4101","synthetic closing",10,0),new("3101","synthetic closing",0,10)])],[]);
            var period=new ReportingPeriod(new(2026,6,1),new(2026,6,30),ReportingPeriodKind.Monthly);
            var panel=new NonprofitClassificationPanel(()=>snapshot,period,Path.Combine(output,"user-data"),()=>now);
            window=new Window{Title="Synthetic nonprofit classification probe",Width=1440,Height=900,Content=panel};window.Show();Pump();window.UpdateLayout();
            var accountGrid=Find<DataGrid>(panel).Single(g=>ReferenceEquals(g.ItemsSource,panel.Editor.Accounts));
            var bank=panel.Editor.Accounts.Single(a=>a.Code=="1002");accountGrid.SelectedItem=bank;accountGrid.CurrentCell=new(bank,accountGrid.Columns[3]);accountGrid.ScrollIntoView(bank);accountGrid.Focus();Pump();
            Require(accountGrid.BeginEdit(),"account semantic cell begins edit");Pump();
            var combo=accountGrid.Columns[3].GetCellContent(bank) as ComboBox??throw new InvalidOperationException("Semantic editor is not a ComboBox");
            combo.SelectedValue=LedgerAccountSemantic.OtherBalance;accountGrid.CommitEdit(DataGridEditingUnit.Cell,true);accountGrid.CommitEdit(DataGridEditingUnit.Row,true);Pump();
            Require(bank.Semantic==LedgerAccountSemantic.OtherBalance,"actual DataGrid enum SelectedValue writes edit buffer");checks.Add("actual-enum-cell-edit");
            var incomeRow=panel.Editor.Accounts.Single(a=>a.Code=="4101");accountGrid.SelectedItem=incomeRow;accountGrid.CurrentCell=new(incomeRow,accountGrid.Columns[4]);accountGrid.ScrollIntoView(incomeRow);accountGrid.Focus();Pump();
            Require(accountGrid.BeginEdit(),"nullable activity project cell begins edit");Pump();
            var factCombo=accountGrid.Columns[4].GetCellContent(incomeRow) as ComboBox??throw new InvalidOperationException("Activity editor is not a ComboBox");factCombo.SelectedValue=ActivityFact.DonationIncome;
            accountGrid.CommitEdit(DataGridEditingUnit.Cell,true);accountGrid.CommitEdit(DataGridEditingUnit.Row,true);Pump();Require(incomeRow.ActivityFact==ActivityFact.DonationIncome,"nullable enum writes edit buffer");checks.Add("nullable-enum-cell-edit");
            foreach(var a in panel.Editor.Accounts)
            {a.Semantic=a.Code switch{"1002"=>LedgerAccountSemantic.OtherBalance,"3101"=>LedgerAccountSemantic.UnrestrictedNetAssets,_=>LedgerAccountSemantic.IncomeExpense};a.ActivityFact=a.Code=="4101"?ActivityFact.DonationIncome:null;a.EvidenceReference="synthetic-operator-review";}
            foreach(var l in panel.Editor.Lines)
            {
                l.EvidenceReference="synthetic-line-review";
                if(l.VoucherId==incomeId&&l.AccountCode=="1002")l.SetBalanceOnly();
                else{l.Role=l.VoucherId==closeId?SourceLineRole.IncomeExpenseClosing:SourceLineRole.RecognizedActivity;l.Class=RestrictionClass.Unrestricted;}
            }
            foreach(var b in panel.Editor.Balances)b.ConfirmZero("synthetic-explicit-no-balance");
            var bankFact=panel.Editor.Balances.Single(b=>b.Fact==BalanceFact.BankDeposits);bankFact.Mode=BalanceMappingMode.AccountBalances;bankFact.AccountCodes="1002";
            var net=panel.Editor.Balances.Single(b=>b.Fact==BalanceFact.UnrestrictedNetAssets);net.Mode=BalanceMappingMode.AccountBalances;net.AccountCodes="3101";
            var r=panel.Editor.Review;r.CnyAmountsConfirmed=r.CompleteYearToDateConfirmed=r.AccountMappingReviewed=r.LineClassificationReviewed=r.BusinessBreakdownComplete=true;
            r.FundraisingDisclosure=FundraisingDisclosure.NotApplicableConfirmed;r.YearOpeningBasis=YearOpeningBasis.Reviewed2026TransitionLedger;r.EvidenceReference="synthetic-complete-period-review";
            var preview=panel.Calculate();Require(preview.HasCompleteReconciledCalculations,"editor calculates complete reconciled preview");checks.Add("classified-two-statement-preview");
            Require(preview.BalanceSheet.Lines.Single(l=>l.Key=="assets.total").Values[1].Amount==110,"saved source balance110");
            panel.SaveClassification("probe.json");panel.ImportClassification("probe.json");Require(panel.Calculate().HasCompleteReconciledCalculations,"save/import/preview round trip");checks.Add("json-round-trip");
            var tabs=Find<TabControl>(panel).First();tabs.SelectedIndex=tabs.Items.Count-2;Pump();window.UpdateLayout();
            Capture(window,Path.Combine(output,"nonprofit-classification.png"));
            snapshot=snapshot with{Revision=2};
            var calculate=Find<Button>(panel).First(b=>b.Content as string=="校验并预览");calculate.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));Pump();
            Require(Find<TextBlock>(panel).Any(t=>t.Text.Contains("NP_CLASSIFICATION_STALE",StringComparison.Ordinal)),"stale source visibly requests review");
            Require(Find<Button>(panel).Where(b=>b.Content as string is "导出当前表CSV" or "导出当前表HTML").All(b=>!b.IsEnabled),"stale source disables exports");checks.Add("stale-source-visible-and-export-disabled");
            Require(string.IsNullOrWhiteSpace(errors.ToString()),"no WPF binding errors: "+errors);checks.Add("no-binding-errors");
            File.WriteAllText(Path.Combine(output,"result.json"),JsonSerializer.Serialize(new{success=true,checks},new JsonSerializerOptions{WriteIndented=true}));return 0;
        }
        catch(Exception ex)
        {File.WriteAllText(Path.Combine(output,"result.json"),JsonSerializer.Serialize(new{success=false,checks,error=ex.ToString(),bindingErrors=errors.ToString()},new JsonSerializerOptions{WriteIndented=true}));Console.Error.WriteLine(ex);return 1;}
        finally{window?.Close();app?.Shutdown();}
    }
    private static void Pump()=>Dispatcher.CurrentDispatcher.Invoke(()=>{},DispatcherPriority.ApplicationIdle);
    private static void Require(bool value,string detail){if(!value)throw new InvalidOperationException(detail);}
    private static IEnumerable<T> Find<T>(DependencyObject root)where T:DependencyObject
    {if(root is T t)yield return t;for(var i=0;i<VisualTreeHelper.GetChildrenCount(root);i++)foreach(var child in Find<T>(VisualTreeHelper.GetChild(root,i)))yield return child;}
    private static void Capture(FrameworkElement target,string path)
    {var image=new RenderTargetBitmap((int)Math.Ceiling(target.ActualWidth),(int)Math.Ceiling(target.ActualHeight),96,96,PixelFormats.Pbgra32);image.Render(target);var png=new PngBitmapEncoder();png.Frames.Add(BitmapFrame.Create(image));using var file=new FileStream(path,FileMode.CreateNew);png.Save(file);}
}
