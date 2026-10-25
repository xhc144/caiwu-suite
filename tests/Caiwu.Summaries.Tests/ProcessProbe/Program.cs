using Caiwu.Summaries;

// Synthetic child process used to verify that optimistic versions and the lock work across processes.
try
{
    var location = new SummaryCatalogLocation(args[0], args[1], Guid.Parse(args[2]));
    var catalog = JsonSummaryCatalog.Open(location);
    var expected = new CatalogVersion(Guid.Parse(args[3]), long.Parse(args[4], System.Globalization.CultureInfo.InvariantCulture), args[5]);
    catalog.AddCategory(args[6], expected);
    return 0;
}
catch (SummaryConflictException) { return 3; }
catch (SummaryBusyException) { return 4; }
