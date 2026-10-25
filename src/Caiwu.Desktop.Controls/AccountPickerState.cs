using Caiwu.Contracts;

namespace Caiwu.Desktop.Controls;

/// <summary>Pure selection logic. It never mutates the injected chart or commits a choice on highlight/cancel.</summary>
public sealed class AccountPickerState
{
    private readonly Dictionary<string, AccountChoice> all = new(StringComparer.Ordinal);
    private HashSet<string> treeCodes = new(StringComparer.Ordinal);
    public IReadOnlyList<AccountChoice> VisibleItems { get; private set; } = Array.Empty<AccountChoice>();
    public IReadOnlyList<AccountTreeNode> TreeItems { get; private set; } = Array.Empty<AccountTreeNode>();
    public string Query { get; private set; } = "";
    public bool OnlySelectable { get; private set; }
    public string? LoadError { get; }
    public AccountChoice? SelectedItem { get; private set; }
    public bool CanAccept => SelectedItem?.IsSelectable == true && treeCodes.Contains(SelectedItem.Code);
    public string StatusText => LoadError is not null ? LoadError : all.Count == 0 ? "暂无可选科目。" : VisibleItems.Count == 0 ? "没有匹配的科目，请调整搜索条件。" :
        SelectedItem is { } selected ? $"{selected.Code}  {selected.Name} · {selected.SelectionHint}" :
        $"匹配 {VisibleItems.Count} 项，可选明细 {VisibleItems.Count(i => i.IsSelectable)} 项。";

    public AccountPickerState(IEnumerable<Account> accounts, string? initialAccountCode = null)
    {
        ArgumentNullException.ThrowIfNull(accounts);
        var snapshot = accounts.ToArray();
        if (snapshot.Any(a => a is null || string.IsNullOrWhiteSpace(a.Code) || string.IsNullOrWhiteSpace(a.Name)))
        { LoadError = "科目目录包含空项或缺少代码、名称，暂不能选择。"; return; }
        if (snapshot.Select(a => a.Code).Distinct(StringComparer.Ordinal).Count() != snapshot.Length)
        { LoadError = "科目代码重复，暂不能选择。请刷新科目目录。"; return; }
        var byCode = snapshot.ToDictionary(a => a.Code, StringComparer.Ordinal);
        var parents = snapshot.Where(a => a.ParentCode is not null).Select(a => a.ParentCode!).ToHashSet(StringComparer.Ordinal);
        foreach (var account in snapshot)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal) { account.Code };
            var current = account;
            var activeAncestors = true;
            while (current.ParentCode is { } parent)
            {
                if (!seen.Add(parent) || seen.Count > 64 || !byCode.TryGetValue(parent, out current!))
                { LoadError = "科目目录的上级缺失、循环或层级过深，暂不能选择。请刷新科目目录。"; all.Clear(); return; }
                activeAncestors &= current.IsActive;
            }
            var selectable = account.IsActive && activeAncestors && !parents.Contains(account.Code);
            var hint = !account.IsActive ? "已停用，不可选择" : !activeAncestors ? "上级科目已停用，不可选择" :
                parents.Contains(account.Code) ? "汇总科目，请选择下级明细" : "启用的末级科目";
            all.Add(account.Code, new(account, selectable, hint));
        }
        Rebuild();
        Select(initialAccountCode);
    }

    public void SetQuery(string? query) { Query = query ?? ""; Rebuild(); }
    public void SetOnlySelectable(bool value) { OnlySelectable = value; Rebuild(); }
    public void Select(string? code) => SelectedItem = code is not null && treeCodes.Contains(code) ? all[code] : null;
    public void MoveSelection(int delta)
    {
        if (delta == 0) return;
        var choices = VisibleItems.Where(i => i.IsSelectable).ToArray();
        if (choices.Length == 0) { SelectedItem = null; return; }
        if (SelectedItem is null) { SelectedItem = delta > 0 ? choices[0] : choices[^1]; return; }
        var current = SelectedItem.Code;
        var next = delta > 0 ? choices.FirstOrDefault(i => StringComparer.Ordinal.Compare(i.Code, current) > 0) :
            choices.LastOrDefault(i => StringComparer.Ordinal.Compare(i.Code, current) < 0);
        if (next is not null) SelectedItem = next;
    }
    public SelectionResult<Account> AcceptSelection() => CanAccept ? SelectionResult<Account>.Accept(SelectedItem!.Account) : SelectionResult<Account>.Cancelled;
    public SelectionResult<Account> CancelSelection() => SelectionResult<Account>.Cancelled;

    private void Rebuild()
    {
        var terms = PickerSearch.Terms(Query);
        VisibleItems = Array.AsReadOnly(all.Values.Where(i => (!OnlySelectable || i.IsSelectable) && PickerSearch.Matches(terms, i.Code, i.Name))
            .OrderBy(i => i.Code, StringComparer.Ordinal).ToArray());
        treeCodes = VisibleItems.Select(i => i.Code).ToHashSet(StringComparer.Ordinal);
        foreach (var item in VisibleItems)
        {
            var current = item.Account;
            while (current.ParentCode is { } parent) { treeCodes.Add(parent); current = all[parent].Account; }
        }
        var children = all.Values.Where(i => i.Account.ParentCode is not null).ToLookup(i => i.Account.ParentCode!, StringComparer.Ordinal);
        AccountTreeNode Node(AccountChoice item) => new(item, children[item.Code].Where(i => treeCodes.Contains(i.Code))
            .OrderBy(i => i.Code, StringComparer.Ordinal).Select(Node));
        TreeItems = Array.AsReadOnly(all.Values.Where(i => i.Account.ParentCode is null && treeCodes.Contains(i.Code))
            .OrderBy(i => i.Code, StringComparer.Ordinal).Select(Node).ToArray());
        if (SelectedItem is not null && !VisibleItems.Any(i => i.Code == SelectedItem.Code)) SelectedItem = null;
    }
}
