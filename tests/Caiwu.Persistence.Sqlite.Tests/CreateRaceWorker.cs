using System.Reflection;
using System.Runtime.ExceptionServices;
using Caiwu.Contracts;
using Caiwu.Persistence.Sqlite;

namespace Caiwu.Persistence.Sqlite.Tests;

// The same assembly is loaded normally by VSTest. Its executable entry point is
// used only by the subprocess regressions; no production test hook is required.
internal static class CreateRaceWorker
{
    internal const string Flag = "--publication-race-worker";

    internal static BookInfo Book(Guid id) => new(id, "合成账套-" + id,
        AccountingRegime.Enterprise, "synthetic-race-1", 2026, 1, 0,
        new DateTimeOffset(2026, 10, 25, 0, 0, 0, TimeSpan.Zero));

    internal static Account[] Accounts(Guid id) =>
        [new("1002", "合成银行-" + id, null, BalanceDirection.Debit, true, 123.45m, 0m)];

    internal static void Publish(string destination, Action<string> populate)
    {
        // Synchronize exactly after staging, at the filesystem publication
        // boundary. Real Create/Backup/Restore are also tested separately.
        var method = typeof(SqliteLedgerStore).GetMethod("PublishNew", BindingFlags.Static | BindingFlags.NonPublic)
            ?? throw new MissingMethodException("PublishNew");
        try { method.Invoke(null, [destination, populate]); }
        catch (TargetInvocationException ex) when (ex.InnerException is not null)
        {
            ExceptionDispatchInfo.Capture(ex.InnerException).Throw();
            throw;
        }
    }

    public static int Main(string[] args)
    {
        if (args.Length != 5 || args[0] != Flag) return 2;
        var mode = args[1];
        var destination = args[2];
        var id = Guid.Parse(args[3]);
        var source = args[4];
        try
        {
            void Ready()
            {
                Console.WriteLine("READY");
                Console.Out.Flush();
                if (Console.ReadLine() != "GO") throw new InvalidDataException("Missing start signal.");
            }

            if (mode == "publish")
            {
                Publish(destination, stage => { File.WriteAllText(stage, id.ToString()); Ready(); });
            }
            else
            {
                using var backupSource = mode == "backup" ? SqliteLedgerStore.Open(source) : null;
                Ready();
                switch (mode)
                {
                    case "create":
                        using (var created = SqliteLedgerStore.Create(destination, Book(id), Accounts(id)))
                            if (created.Read().Book != Book(id)) throw new InvalidDataException("Creator returned another book.");
                        break;
                    case "backup": backupSource!.BackupTo(destination); break;
                    case "restore": SqliteLedgerStore.RestoreBackup(source, destination); break;
                    default: throw new ArgumentException("Unknown operation.");
                }
                using var result = SqliteLedgerStore.Open(destination);
                if (result.Read().Book != Book(id)) throw new InvalidDataException("Published book was replaced.");
                result.CheckIntegrity();
            }
            Console.WriteLine("SUCCESS");
            return 0;
        }
        catch (IOException)
        {
            Console.WriteLine("IO_FAILURE");
            return 10;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            return 2;
        }
    }
}
