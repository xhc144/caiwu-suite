using Caiwu.Persistence.Sqlite;
using Xunit;
using Xunit.Abstractions;

namespace Caiwu.BookTools.Tests;

public sealed class ConcurrentPublicationTests(ITestOutputHelper output)
{
    [Fact]
    public async Task Two_independent_services_copying_different_sources_to_one_target_have_exactly_one_winner()
    {
        var observations = new List<string>();
        var violations = new List<string>();
        // Release both callers only after each has passed the final destination precheck.
        // Repetition exercises the small runtime File.Move publication race rather than
        // accepting the ordinary case where the second caller sees an existing path.
        for (var iteration = 0; iteration < 30; iteration++)
        {
            using var a = new SyntheticBook(); using var b = new SyntheticBook();
            using var publicationBarrier = new Barrier(2);
            var targetPath = a.Destination;
            var sourceAHash = SyntheticBook.Hash(a.Source); var sourceBHash = SyntheticBook.Hash(b.Source);
            BookCopyService MakeService()
            {
                var validations = 0;
                return new(validateDestination: _ =>
                {
                    if (Interlocked.Increment(ref validations) != 2) return;
                    if (!publicationBarrier.SignalAndWait(TimeSpan.FromSeconds(10)))
                        throw new TimeoutException("publication barrier");
                });
            }
            var serviceA = MakeService(); var serviceB = MakeService();
            var planA = serviceA.Preview(a.Read(), new(a.Source, targetPath, "并发目标A", BookCopyScope.FullLedger, "合成A"));
            var planB = serviceB.Preview(b.Read(), new(b.Source, targetPath, "并发目标B", BookCopyScope.FullLedger, "合成B"));
            Task<Outcome> Run(BookCopyService service, BookCopyPlan plan) => Task.Factory.StartNew(() =>
            {
                try
                {
                    var result = service.Execute(plan);
                    return new Outcome(result, null, SyntheticBook.Hash(result.DestinationPath));
                }
                catch (Exception error) { return new Outcome(null, error, null); }
            }, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
            var results = await Task.WhenAll(Run(serviceA, planA), Run(serviceB, planB));
            using var saved = SqliteLedgerStore.Open(targetPath);
            var actual = saved.Read();
            var successes = results.Where(r => r.Result is not null).ToArray();
            observations.Add($"iteration={iteration + 1}; successes={successes.Length}; savedBookId={actual.Book.Id:D}; " +
                $"A={results[0].Result?.Book.Id.ToString() ?? results[0].Error?.GetType().Name}; " +
                $"B={results[1].Result?.Book.Id.ToString() ?? results[1].Error?.GetType().Name}");
            output.WriteLine(observations[^1]);
            if (successes.Length != 1) violations.Add($"iteration {iteration + 1}: {successes.Length} callers reported success");
            else
            {
                Assert.Equal(successes[0].Result!.Book, actual.Book);
                Assert.IsType<IOException>(Assert.Single(results, r => r.Error is not null).Error);
                var winnerHash = SyntheticBook.Hash(targetPath);
                Assert.Equal(successes[0].PublishedHash, winnerHash);
                saved.CheckIntegrity();
                Assert.Equal(winnerHash, SyntheticBook.Hash(targetPath));
            }
            // Both tasks have returned, including the losing service's cleanup.
            Assert.True(File.Exists(targetPath));
            Assert.Equal(sourceAHash, SyntheticBook.Hash(a.Source)); Assert.Equal(sourceBHash, SyntheticBook.Hash(b.Source));
            Assert.Empty(Directory.GetDirectories(a.Root)); Assert.Empty(Directory.GetDirectories(b.Root));
        }
        Assert.True(violations.Count == 0, string.Join(Environment.NewLine, violations.Concat(observations)));
    }

    private sealed record Outcome(BookCopyResult? Result, Exception? Error, string? PublishedHash);
}
