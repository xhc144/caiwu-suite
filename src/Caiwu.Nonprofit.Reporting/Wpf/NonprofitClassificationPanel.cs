using System.Collections;
using System.Data;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using Caiwu.Contracts;
using Microsoft.Win32;

namespace Caiwu.Nonprofit.Reporting.Wpf;

/// <summary>Standalone hostable editor; inherits host theme/resources. No App/MainWindow, ledger writes or installer paths.</summary>
public sealed class NonprofitClassificationPanel : UserControl
{
    private readonly Func<LedgerSnapshot> readSnapshot;
    private readonly Func<DateTimeOffset> clock;
    private readonly ClassificationJsonStore files;
    private readonly ReportingPeriod period;
    private ClassificationEditorSession session;
    private LedgerSnapshotStatementDataSource? previewSource;
    private NonprofitStatementSet? preview;
    private ClassifiedLedgerPreview? boundPreview;
    private readonly DataGrid accounts=Grid(),lines=Grid(),balances=Grid(),components=Grid(true),limitations=Grid(true),issues=Grid();
    private readonly DataGrid balancePreview=Grid(),activityPreview=Grid();
    private readonly ContentControl reviewHost=new();
    private readonly TextBlock sourceText=new(){TextWrapping=TextWrapping.Wrap,Margin=new(8)};
    private readonly TextBlock status=new(){Text="先明确科目、分录与余额事实，再复核并计算。分类文件独立保存，不在主账套备份中。",TextWrapping=TextWrapping.Wrap,Margin=new(8)};
    private readonly Button save,exportCsv,exportHtml;
    public ClassificationEditorSession Editor=>session;
    public NonprofitStatementSet? Preview=>preview;

    public NonprofitClassificationPanel(Func<LedgerSnapshot> readSnapshot,ReportingPeriod period,string userDataDirectory,Func<DateTimeOffset>? clock=null)
    {
        ArgumentNullException.ThrowIfNull(readSnapshot);this.readSnapshot=readSnapshot;this.period=period;this.clock=clock??(()=>DateTimeOffset.Now);
        files=new(userDataDirectory);session=new(readSnapshot(),period,this.clock());
        var root=new DockPanel();var top=new StackPanel();DockPanel.SetDock(top,Dock.Top);root.Children.Add(top);
        top.Children.Add(sourceText);top.Children.Add(new TextBlock{Text="按步骤明确分类。转类两侧须用同一组ID；限定侧须填限制范围。不能根据摘要、名称或余额方向猜测业务。",TextWrapping=TextWrapping.Wrap,Margin=new(8,0,8,4)});var actions=new WrapPanel{Margin=new(4)};top.Children.Add(actions);
        Add(actions,"校验并预览",()=>Calculate());Add(actions,"导入分类JSON",Import);
        save=Add(actions,"另存新分类JSON",Save);Add(actions,"读取新快照并重新分类",Reset);
        exportCsv=Add(actions,"导出当前表CSV",()=>Export(false));exportHtml=Add(actions,"导出当前表HTML",()=>Export(true));
        exportCsv.IsEnabled=exportHtml.IsEnabled=false;top.Children.Add(status);
        var tabs=new TabControl();root.Children.Add(tabs);
        ConfigureAccounts();ConfigureLines();ConfigureBalances();ConfigureComponents();ConfigureLimitations();
        tabs.Items.Add(Tab("1 科目语义",WithActions(accounts,[("所选为普通余额科目且明确无余额",ConfirmNoBalanceAccounts)])));
        tabs.Items.Add(Tab("2 分录分类",WithActions(lines,[("所选为余额对方行",()=>BulkLines(false)),("所选为普通非限定损益",()=>BulkLines(true))])));
        tabs.Items.Add(Tab("3 余额事实",WithActions(balances,[("所选事实有据确认为零",ConfirmZeros)])));
        tabs.Items.Add(Tab("4 组成明细",components));tabs.Items.Add(Tab("5 复核声明",reviewHost));tabs.Items.Add(Tab("6 已知未覆盖事项",limitations));
        issues.IsReadOnly=true;Text(issues,"代码","Code",true,240);Text(issues,"位置","Path",true,300);Text(issues,"缺失/校验说明","Detail",true,600);tabs.Items.Add(Tab("校验清单",issues));
        balancePreview.IsReadOnly=true;balancePreview.AutoGenerateColumns=true;activityPreview.IsReadOnly=true;activityPreview.AutoGenerateColumns=true;
        ConfigurePreview(balancePreview);ConfigurePreview(activityPreview);var balanceTab=Tab("资产负债表预览",balancePreview);var activityTab=Tab("业务活动表预览",activityPreview);tabs.Items.Add(balanceTab);tabs.Items.Add(activityTab);
        tabs.SelectionChanged+=(_,_)=>{if(tabs.SelectedItem==balanceTab)selectedForm="会民非01表";else if(tabs.SelectedItem==activityTab)selectedForm="会民非02表";};
        Content=root;Bind();
    }
    private string selectedForm="会民非02表";
    public NonprofitStatementSet Calculate()
    {
        CommitEdits();var source=new LedgerSnapshotStatementDataSource(readSnapshot,session.BuildManifest());var bound=source.CreateBoundPreview(clock());var result=bound.Statements;boundPreview=bound;
        previewSource=source;preview=result;issues.ItemsSource=result.Issues;balancePreview.ItemsSource=Table(result.BalanceSheet);activityPreview.ItemsSource=Table(result.ActivityStatement);
        status.Text=result.HasCompleteReconciledCalculations?"计算及两表勾稽通过；仍为待复核预览，不能签发正式报表。":"输入尚未完整；请按校验清单补齐，缺失值不会显示为0。";
        exportCsv.IsEnabled=exportHtml.IsEnabled=true;save.IsEnabled=true;return result;
    }
    public string SaveClassification(string fileName)
    {
        CommitEdits();var manifest=session.BuildManifest();var source=new LedgerSnapshotStatementDataSource(readSnapshot,manifest);source.RequireCurrentSource();
        return files.SaveNew(fileName,manifest);
    }
    public void ImportClassification(string fileName)
    {
        var snapshot=readSnapshot();var manifest=files.Load(fileName,snapshot);
        if(manifest.Period!=period)throw new ArgumentException("导入清单期间与本面板期间不同；请由宿主按所需期间打开新面板。");
        session=new(snapshot,manifest);Bind();ClearPreview();status.Text="已读取分类清单；请查看并重新校验计算。未改账簿。";
    }
    private void Bind()
    {
        accounts.ItemsSource=session.Accounts;lines.ItemsSource=session.Lines;balances.ItemsSource=session.Balances;components.ItemsSource=session.Components;limitations.ItemsSource=session.Limitations;
        sourceText.Text=$"{session.BookName}  |  BookId {session.Binding.BookId}  |  revision {session.Binding.Revision}  |  {period.From:yyyy-MM-dd} 至 {period.To:yyyy-MM-dd}\n分类目录：{files.UserDataDirectory}；保存时只创建新文件，独立于主账套备份。";
        reviewHost.Content=ReviewForm(session.Review);
    }
    private void ClearPreview(){preview=null;previewSource=null;boundPreview=null;balancePreview.ItemsSource=null;activityPreview.ItemsSource=null;issues.ItemsSource=null;exportCsv.IsEnabled=exportHtml.IsEnabled=false;}
    private void CommitEdits()
    {
        foreach(var grid in new[]{accounts,lines,balances,components,limitations})
            if(!grid.CommitEdit(DataGridEditingUnit.Cell,true)||!grid.CommitEdit(DataGridEditingUnit.Row,true))throw new ArgumentException("表格输入尚未通过格式校验，请修正当前单元格。");
        // Text boxes use PropertyChanged binding, so review data is already in the edit buffer.
    }
    private void BulkLines(bool ordinary)
    {
        CommitEdits();foreach(var row in lines.SelectedItems.Cast<LineClassificationRow>())
        {if(ordinary)row.SetOrdinaryUnrestricted();else row.SetBalanceOnly();if(string.IsNullOrWhiteSpace(row.EvidenceReference))row.EvidenceReference=session.Review.EvidenceReference;}
        lines.Items.Refresh();ClearPreview();
    }
    private void ConfirmNoBalanceAccounts()
    {
        CommitEdits();if(string.IsNullOrWhiteSpace(session.Review.EvidenceReference))throw new ArgumentException("先填写复核依据，再明确选择普通余额科目。非零余额仍会被校验阻断。");
        foreach(var row in accounts.SelectedItems.Cast<AccountClassificationRow>())
        {row.Semantic=LedgerAccountSemantic.OtherBalance;row.ActivityFact=null;row.NoBalanceExpectedConfirmed=true;row.EvidenceReference=session.Review.EvidenceReference;}
        accounts.Items.Refresh();ClearPreview();
    }
    private void ConfirmZeros()
    {
        CommitEdits();if(string.IsNullOrWhiteSpace(session.Review.EvidenceReference))throw new ArgumentException("先在复核声明填写依据，再由用户明确选择哪些余额事实不存在。");
        foreach(var row in balances.SelectedItems.Cast<BalanceMappingRow>())row.ConfirmZero(session.Review.EvidenceReference);balances.Items.Refresh();ClearPreview();
    }
    private void Reset()
    {
        if(MessageBox.Show("读取新快照会创建未分类的新清单，当前未保存编辑不会自动沿用。继续？","重新核对分类",MessageBoxButton.OKCancel,MessageBoxImage.Question)!=MessageBoxResult.OK)return;
        session=new(readSnapshot(),period,clock());Bind();ClearPreview();save.IsEnabled=true;status.Text="已读取新快照；需要重新分类，旧JSON文件保留。";
    }
    private void Import()
    {
        var dialog=new OpenFileDialog{Title="从宿主用户数据目录导入分类",InitialDirectory=files.UserDataDirectory,Filter="分类JSON|*.json",CheckFileExists=true};
        if(dialog.ShowDialog()!=true)return;RequireUserDirectory(dialog.FileName);ImportClassification(Path.GetFileName(dialog.FileName));
    }
    private void Save()
    {
        var dialog=new SaveFileDialog{Title="另存新的分类文件（不覆盖）",InitialDirectory=files.UserDataDirectory,Filter="分类JSON|*.json",FileName=$"nonprofit-{period.To:yyyyMMdd}-rev{session.Binding.Revision}-{clock():yyyyMMddHHmmss}.json",OverwritePrompt=false};
        if(dialog.ShowDialog()!=true)return;RequireUserDirectory(dialog.FileName);var path=SaveClassification(Path.GetFileName(dialog.FileName));status.Text="分类已另存："+path+"；请另行保管此文件，它未接入主账套备份。";
    }
    private void RequireUserDirectory(string path)
    {
        if(!string.Equals(Path.GetFullPath(Path.GetDirectoryName(path)!),Path.GetFullPath(files.UserDataDirectory),StringComparison.OrdinalIgnoreCase))throw new ArgumentException("分类JSON只在宿主指定的用户数据目录读写；请选择面板显示的目录。");
    }
    private void Export(bool html)
    {
        if(preview is null||previewSource is null||boundPreview is null)throw new InvalidOperationException("请先计算预览。");
        // Rebuild after edits, rather than exporting a stale edit-buffer preview.
        var current=new LedgerSnapshotStatementDataSource(readSnapshot,session.BuildManifest());
        if(current.ClassificationFingerprint!=previewSource.ClassificationFingerprint)throw new InvalidOperationException("分类已修改，请重新计算后导出。");
        previewSource.RequireCurrentSource();var report=selectedForm=="会民非01表"?preview.BalanceSheet:preview.ActivityStatement;
        var dialog=new SaveFileDialog{Title="导出计算预览（创建新文件）",InitialDirectory=files.UserDataDirectory,Filter=html?"HTML|*.html":"CSV|*.csv",FileName=$"{report.OfficialForm}-{period.To:yyyyMMdd}"+(html?".html":".csv"),OverwritePrompt=false};
        if(dialog.ShowDialog()!=true)return;previewSource.RequireCurrentSource();if(File.Exists(dialog.FileName))throw new IOException("导出目标已存在，请选择新文件名；原文件未修改。");
        using(var output=new FileStream(dialog.FileName,FileMode.CreateNew,FileAccess.Write,FileShare.None))
        {var form=selectedForm=="会民非01表"?NonprofitStatementForm.BalanceSheet:NonprofitStatementForm.ActivityStatement;if(html)boundPreview.WriteHtml(form,output);else boundPreview.WriteCsv(form,output);}
        status.Text="已导出计算预览："+dialog.FileName+"；打印请由宿主打开本地HTML后预览。";
    }
    private void Run(Action action)
    {
        try{action();}
        catch(ClassificationStaleException ex){ClearPreview();status.Text=ex.Message;issues.ItemsSource=new[]{ex.Reason};exportCsv.IsEnabled=exportHtml.IsEnabled=save.IsEnabled=false;}
        catch(Exception ex)when(ex is ArgumentException or InvalidOperationException or IOException or System.Text.Json.JsonException or OverflowException)
        {ClearPreview();status.Text=ex.Message;issues.ItemsSource=new[]{new MissingReason("NP_EDITOR_VALIDATION","Editor",ex.Message)};}
    }
    private Button Add(Panel panel,string label,Action action)
    {var b=new Button{Content=label,Margin=new(4),Padding=new(10,5,10,5)};b.Click+=(_,_)=>Run(action);panel.Children.Add(b);return b;}
    private UIElement WithActions(DataGrid grid,(string Label,Action Action)[] actions)
    {var dock=new DockPanel();var bar=new WrapPanel();DockPanel.SetDock(bar,Dock.Top);dock.Children.Add(bar);foreach(var a in actions)Add(bar,a.Label,a.Action);dock.Children.Add(grid);return dock;}
    private static TabItem Tab(string title,object content)=>new(){Header=title,Content=content};
    private static DataGrid Grid(bool add=false)=>new(){AutoGenerateColumns=false,CanUserAddRows=add,CanUserDeleteRows=add,SelectionMode=DataGridSelectionMode.Extended,SelectionUnit=DataGridSelectionUnit.FullRow,Margin=new(8),EnableRowVirtualization=true,EnableColumnVirtualization=true};
    private static Binding Edit(string property)=>new(property){Mode=BindingMode.TwoWay,UpdateSourceTrigger=UpdateSourceTrigger.PropertyChanged,ValidatesOnExceptions=true,NotifyOnValidationError=true};
    private static void Text(DataGrid grid,string header,string property,bool readOnly=false,double width=140)=>grid.Columns.Add(new DataGridTextColumn{Header=header,Binding=readOnly?new Binding(property){Mode=BindingMode.OneWay}:Edit(property),IsReadOnly=readOnly,Width=width});
    private static void Choice<T>(DataGrid grid,string header,string property,bool nullable=false)where T:struct,Enum=>grid.Columns.Add(new DataGridComboBoxColumn{Header=header,ItemsSource=ClassificationLabels.Choices<T>(nullable),SelectedValuePath="Value",DisplayMemberPath="Label",SelectedValueBinding=Edit(property),Width=180});
    private static void Check(DataGrid grid,string header,string property)=>grid.Columns.Add(new DataGridCheckBoxColumn{Header=header,Binding=Edit(property),Width=130});
    private void ConfigureAccounts()
    {Text(accounts,"代码","Code",true,90);Text(accounts,"名称（仅显示）","Name",true,170);Text(accounts,"账簿方向","DirectionLabel",true,90);Choice<LedgerAccountSemantic>(accounts,"明确科目语义","Semantic");Choice<ActivityFact>(accounts,"损益/前期调整项目","ActivityFact",true);Check(accounts,"明确无期初/期末余额","NoBalanceExpectedConfirmed");Text(accounts,"复核依据","EvidenceReference",false,260);}
    private void ConfigureLines()
    {Text(lines,"日期","Date",true,105);Text(lines,"字","Kind",true,70);Text(lines,"号","Number",true,55);Text(lines,"分录序号(0起)","LineIndex",true,100);Text(lines,"科目","AccountCode",true,90);Text(lines,"摘要（不作推断）","Summary",true,180);Text(lines,"借","Debit",true,95);Text(lines,"贷","Credit",true,95);Choice<SourceLineRole>(lines,"明确业务角色","Role");Choice<RestrictionClass>(lines,"类别","Class",true);Text(lines,"限制ID","RestrictionId");Text(lines,"限制版本","RestrictionVersion",false,90);Text(lines,"项目ID","ProjectId");Choice<RestrictionSourceKind>(lines,"限制来源","SourceKind",true);Text(lines,"限制证据","RestrictionEvidence",false,220);Text(lines,"成本组成ID","ComponentId");Text(lines,"同凭证转类组ID","MovementGroupId");Text(lines,"分录判断依据","EvidenceReference",false,220);Text(lines,"凭证ID","VoucherId",true,260);}
    private void ConfigureBalances()
    {Text(balances,"余额事实","Label",true,250);Text(balances,"事实键","Fact",true,180);Text(balances,"固定金额口径","NormalSide",true,100);Choice<BalanceMappingMode>(balances,"明确取数方式","Mode");Text(balances,"末级代码（分号分隔）","AccountCodes",false,240);Text(balances,"年初分析金额","YearOpeningAnalysis",false,140);Text(balances,"期末分析金额","ClosingAnalysis",false,140);Text(balances,"取数/零值/分析依据","EvidenceReference",false,300);}
    private void ConfigureComponents(){Text(components,"组成ID","Id");Text(components,"显示名称","Label",false,220);Choice<ActivityComponentKind>(components,"组成类别","Kind");}
    private void ConfigureLimitations(){Text(limitations,"缺失/未覆盖代码","Code",false,240);Text(limitations,"位置","Path",false,180);Text(limitations,"明确未完事项","Detail",false,500);}
    private static FrameworkElement ReviewForm(ReviewEditorRow review)
    {
        var panel=new StackPanel{DataContext=review,Margin=new(12)};
        panel.Children.Add(new TextBlock{Text="确认必须基于实际复核，不是消除missing的开关。全年覆盖不足、未知分类或未归属余额仍会阻断。",TextWrapping=TextWrapping.Wrap,Margin=new(0,0,0,10)});
        foreach(var item in new[]{("金额已确认按人民币元提供","CnyAmountsConfirmed"),("已完整核对1月1日至报告期末发生额","CompleteYearToDateConfirmed"),("科目语义、余额归属及分析已复核","AccountMappingReviewed"),("各已记账分录角色、类别和业务证据已复核","LineClassificationReviewed"),("业务成本项目/服务/业务组成已完整区分","BusinessBreakdownComplete"),("非零限定性所得税已获专门复核","RestrictedIncomeTaxTreatmentReviewed")})
        {var box=new CheckBox{Content=item.Item1,Margin=new(0,5,0,5)};box.SetBinding(System.Windows.Controls.Primitives.ToggleButton.IsCheckedProperty,Edit(item.Item2));panel.Children.Add(box);}
        foreach(var item in new[]{("募捐成本披露适用性",nameof(ReviewEditorRow.FundraisingDisclosure),typeof(FundraisingDisclosure)),("年初依据",nameof(ReviewEditorRow.YearOpeningBasis),typeof(YearOpeningBasis))})
        {panel.Children.Add(new TextBlock{Text=item.Item1,Margin=new(0,8,0,2)});var box=new ComboBox{ItemsSource=Enum.GetValues(item.Item3).Cast<Enum>().Select(v=>new ClassificationChoice(v,ClassificationLabels.For(v))).ToArray(),SelectedValuePath="Value",DisplayMemberPath="Label",MinWidth=320,HorizontalAlignment=HorizontalAlignment.Left};box.SetBinding(System.Windows.Controls.Primitives.Selector.SelectedValueProperty,Edit(item.Item2));panel.Children.Add(box);}
        foreach(var item in new[]{("整体复核/完整覆盖依据",nameof(ReviewEditorRow.EvidenceReference)),("限定性所得税专门复核依据",nameof(ReviewEditorRow.RestrictedIncomeTaxReviewEvidence))})
        {panel.Children.Add(new TextBlock{Text=item.Item1,Margin=new(0,8,0,2)});var box=new TextBox{MinWidth=400,HorizontalAlignment=HorizontalAlignment.Stretch};box.SetBinding(TextBox.TextProperty,Edit(item.Item2));panel.Children.Add(box);}
        return new ScrollViewer{Content=panel,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};
    }
    private static void ConfigurePreview(DataGrid grid)
    {
        grid.AutoGeneratingColumn+=(_,e)=>
        {
            e.Column.Width=e.PropertyName=="项目"?280:180;
            if(e.Column is DataGridTextColumn text)
            {var style=new Style(typeof(TextBlock),text.ElementStyle);style.Setters.Add(new Setter(TextBlock.TextWrappingProperty,TextWrapping.Wrap));if(e.PropertyName!="项目")style.Setters.Add(new Setter(TextBlock.TextAlignmentProperty,TextAlignment.Right));text.ElementStyle=style;}
        };
    }
    private static DataView Table(NonprofitStatement report)
    {
        var table=new DataTable();table.Columns.Add("项目");foreach(var col in report.Columns)table.Columns.Add(col.Label);
        foreach(var line in report.Lines)table.Rows.Add(new[]{line.Label}.Concat(line.Values.Select(v=>v.Amount?.ToString("F2",System.Globalization.CultureInfo.InvariantCulture)??"缺失："+string.Join("；",v.MissingReasons.Select(r=>r.Code+" "+r.Detail)))).Cast<object>().ToArray());
        return table.DefaultView;
    }
}
