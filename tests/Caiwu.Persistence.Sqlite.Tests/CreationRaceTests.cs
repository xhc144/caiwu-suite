using System.Diagnostics;
using System.Security.Cryptography;
using Caiwu.Persistence.Sqlite;
using Xunit;

namespace Caiwu.Persistence.Sqlite.Tests;

public sealed class CreationRaceTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "caiwu-publish-合成-" + Guid.NewGuid().ToString("N"));

    public CreationRaceTests() => Directory.CreateDirectory(directory);
    public void Dispose() => Directory.Delete(directory, recursive: true);

    [Fact]
    public async Task StagedPublishersOnDedicatedThreadsCannotReplaceEachOther()
    {
        for (var round = 0; round < 64; round++)
        {
            var destination = Path.Combine(directory, $"threads-{round}.txt");
            var stages = new string[2];
            using var barrier = new Barrier(2);
            Task<Exception?> Attempt(int index) => Task.Factory.StartNew(() => (Exception?)Record.Exception(() =>
                CreateRaceWorker.Publish(destination, stage =>
                {
                    stages[index] = stage;
                    File.WriteAllText(stage, index.ToString());
                    Assert.True(barrier.SignalAndWait(TimeSpan.FromSeconds(15)), "Both stages must be ready.");
                })), CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);

            var results = await Task.WhenAll(Attempt(0), Attempt(1));
            var winner = Assert.Single(Enumerable.Range(0, 2), i => results[i] is null);
            Assert.IsType<IOException>(results[1 - winner]);
            Assert.NotEqual(stages[0], stages[1]);
            Assert.Equal(winner.ToString(), File.ReadAllText(destination));
            Assert.All(stages, stage => Assert.False(File.Exists(stage)));
            Assert.DoesNotContain(Directory.GetFiles(directory), path => Path.GetFileName(path).StartsWith(".caiwu-"));
        }
    }

    [Theory]
    [InlineData("create")]
    [InlineData("backup")]
    [InlineData("restore")]
    [InlineData("publish")]
    public async Task SeparateProcessesHaveOneWinnerAndPreserveItsContents(string mode)
    {
        var ids = new[] { Guid.NewGuid(), Guid.NewGuid() };
        var sources = ids.Select((_, i) => Path.Combine(directory, $"source-{i}.db")).ToArray();
        for (var i = 0; i < ids.Length; i++)
            using (SqliteLedgerStore.Create(sources[i], CreateRaceWorker.Book(ids[i]), CreateRaceWorker.Accounts(ids[i]))) { }
        var sourceBytes = sources.Select(File.ReadAllBytes).ToArray();

        for (var round = 0; round < 16; round++)
        {
            var destination = Path.Combine(directory, $"{mode}-{round}.db");
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            using var first = StartWorker(mode, destination, ids[0], sources[0]);
            using var second = StartWorker(mode, destination, ids[1], sources[1]);
            try
            {
                var workers = new[] { first, second };
                var ready = await Task.WhenAll(workers.Select(p => p.StandardOutput.ReadLineAsync(timeout.Token).AsTask()));
                Assert.All(ready, line => Assert.Equal("READY", line));
                await Task.WhenAll(workers.Select(p => p.StandardInput.WriteLineAsync("GO")));
                var outcomes = await Task.WhenAll(workers.Select(p => p.StandardOutput.ReadToEndAsync(timeout.Token)));
                await Task.WhenAll(workers.Select(p => p.WaitForExitAsync(timeout.Token)));
                var errors = await Task.WhenAll(workers.Select(p => p.StandardError.ReadToEndAsync(timeout.Token)));
                var winner = Assert.Single(Enumerable.Range(0, 2), i => workers[i].ExitCode == 0);
                Assert.True(workers[1 - winner].ExitCode == 10, string.Join(Environment.NewLine, outcomes.Concat(errors)));
                Assert.Equal("SUCCESS", outcomes[winner].Trim());
                Assert.Equal("IO_FAILURE", outcomes[1 - winner].Trim());
                if (mode == "publish") Assert.Equal(ids[winner].ToString(), File.ReadAllText(destination));
                else
                {
                    using var result = SqliteLedgerStore.Open(destination);
                    var snapshot = result.Read();
                    Assert.Equal(CreateRaceWorker.Book(ids[winner]), snapshot.Book);
                    Assert.Equal(CreateRaceWorker.Accounts(ids[winner]), snapshot.Accounts.ToArray());
                    Assert.Equal(0, snapshot.Revision);
                    result.CheckIntegrity();
                }
                // A subsequent loser must leave even the winner's bytes intact.
                var before = SHA256.HashData(File.ReadAllBytes(destination));
                Assert.Throws<IOException>(() => SqliteLedgerStore.Create(destination,
                    CreateRaceWorker.Book(Guid.NewGuid()), []));
                Assert.Equal(before, SHA256.HashData(File.ReadAllBytes(destination)));
                Assert.DoesNotContain(Directory.GetFiles(directory), path => Path.GetFileName(path).StartsWith(".caiwu-"));
            }
            finally
            {
                foreach (var worker in new[] { first, second })
                    if (!worker.HasExited) { worker.Kill(entireProcessTree: true); await worker.WaitForExitAsync(); }
            }
        }
        for (var i = 0; i < sources.Length; i++) Assert.Equal(sourceBytes[i], File.ReadAllBytes(sources[i]));
    }

    [Fact]
    public void DestinationAppearingAfterStagingIsNeverChangedOrRemoved()
    {
        var destination = Path.Combine(directory, "late-existing.txt");
        var before = new byte[] { 0, 255, 17, 42 };
        Assert.Throws<IOException>(() => CreateRaceWorker.Publish(destination, stage =>
        {
            File.WriteAllText(stage, "candidate");
            using var existing = new FileStream(destination, FileMode.CreateNew, FileAccess.Write);
            existing.Write(before);
        }));
        Assert.Equal(before, File.ReadAllBytes(destination));
        Assert.Single(Directory.GetFiles(directory));
    }

    [Fact]
    public void FailedPopulationCleansOnlyItsOwnTemporaryFiles()
    {
        var destination = Path.Combine(directory, "never-published.db");
        var unrelated = Path.Combine(directory, ".caiwu-unrelated.tmp");
        File.WriteAllText(unrelated, "keep");
        Assert.Throws<InvalidDataException>(() => CreateRaceWorker.Publish(destination, stage =>
        {
            File.WriteAllText(stage, "incomplete");
            foreach (var suffix in new[] { "-journal", "-wal", "-shm" }) File.WriteAllText(stage + suffix, "owned");
            throw new InvalidDataException("Synthetic staging failure.");
        }));
        Assert.False(File.Exists(destination));
        Assert.Equal("keep", File.ReadAllText(unrelated));
        Assert.Equal(new[] { unrelated }, Directory.GetFiles(directory));
    }

    private static Process StartWorker(string mode, string destination, Guid id, string source)
    {
        var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
        {
            UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        foreach (var argument in new[] { typeof(CreationRaceTests).Assembly.Location, CreateRaceWorker.Flag,
                     mode, destination, id.ToString(), source }) start.ArgumentList.Add(argument);
        return Process.Start(start) ?? throw new InvalidOperationException("Could not start synthetic race worker.");
    }
}
