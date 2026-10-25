using System.IO;
using System.Threading;
using Caiwu.Contracts;
using Caiwu.Core;
using Caiwu.Desktop;
using Caiwu.Desktop.Features;
using Caiwu.Desktop.Presentation;
using Caiwu.Desktop.Verification;
using Caiwu.Operators;
using Caiwu.Persistence.Sqlite;

namespace Caiwu.Desktop.Testing;

/// <summary>Independent test host only. Creates virtual identities through normal setup/login; no production switch or password.</summary>
internal static class SyntheticDesktopIdentity
{
    private const string Password = "Independent-Synthetic-Test-Only!2026";
    private static readonly Lazy<Fixture> Current = new(Create);
    public static string DataRoot => Current.Value.Root;
    public static LocalOperatorService Operators => Current.Value.Operators;
    public static OperatorSession Login => Current.Value.Maker;
    public static FeatureAuthentication Authentication => Current.Value.Authentication;
    public static FeatureAuthentication ReviewerAuthentication => Current.Value.ReviewerAuthentication;
    public static DesktopBackend Backend => App.CreateAuthenticatedBackend(Operators, Login);
    public static DesktopBackend ReviewerBackend => App.CreateAuthenticatedBackend(Operators, Current.Value.Reviewer);
    public static string ActorKey => Login.Identity.ActorKey;
    public static MainWindow CreateMain(DesktopBackend? backend = null, bool asReviewer = false)
        => new(backend ?? (asReviewer ? ReviewerBackend : Backend), asReviewer ? ReviewerAuthentication : Authentication);

    public static Guid SeedSample(string path)
    {
        // Source construction is test data, kept outside the product assembly. UI operations use Backend above.
        var fixtureBackend = new DesktopBackend(SqliteLedgerStore.Open, SqliteLedgerStore.Create,
            SqliteLedgerStore.RestoreBackup, store => new LedgerService(store), TemplateCatalog.All);
        return SampleLedger.Create(fixtureBackend, path);
    }

    private static Fixture Create()
    {
        var supplied = Environment.GetEnvironmentVariable("CAIWU_SYNTHETIC_OPERATOR_ROOT");
        var root = supplied is null ? Path.Combine(Path.GetTempPath(), "caiwu-independent-synthetic-operators-" + Guid.NewGuid().ToString("N")) : Path.GetFullPath(supplied);
        var service = new LocalOperatorService(new FileOperatorStore(root));
        if (service.IsFirstUse)
        {
            service.InitializeAdministrator("synthetic-admin", "虚构测试管理员", Password);
            var admin = service.Login("synthetic-admin", Password);
            service.AddOperator(admin, service.GetDirectory(admin).Revision, "synthetic-maker", "虚构测试制单人", Password,
                OperatorRoles.Administrator | OperatorRoles.Accountant | OperatorRoles.Preparer | OperatorRoles.Reviewer | OperatorRoles.Poster | OperatorRoles.PeriodCloser);
            service.AddOperator(admin, service.GetDirectory(admin).Revision, "synthetic-reviewer", "虚构测试审核人", Password,
                OperatorRoles.Administrator | OperatorRoles.Accountant | OperatorRoles.Reviewer | OperatorRoles.Poster | OperatorRoles.PeriodCloser);
            service.Logout(admin);
        }
        OperatorSession LoginWithBoundedLockRetry(string name)
        {
            for (var attempt = 0; ; attempt++)
            {
                try { return service.Login(name, Password); }
                catch (OperatorStorageException) when (attempt < 5) { Thread.Sleep(50); }
            }
        }
        var maker = LoginWithBoundedLockRetry("synthetic-maker"); var reviewer = LoginWithBoundedLockRetry("synthetic-reviewer");
        return new(root, service, maker, reviewer, new(service, maker), new(service, reviewer));
    }
    private sealed record Fixture(string Root, LocalOperatorService Operators, OperatorSession Maker, OperatorSession Reviewer,
        FeatureAuthentication Authentication, FeatureAuthentication ReviewerAuthentication);
}
