# Independent ACC002 / ACC003 revalidation

Reviewed fix: `53fe0f2d2744e557dab98bf2652ffa5fce644c25`. Contracts tree is byte-identical to main integration `ce6064dc9a6e0831560314b0340d45da63a2f140`; SQLite production tree also matches. This suite references those actual projects, not the Core owner's tests.

The original `Regression` suite/JSON remains the historical 037a075 baseline. Do not use its old catch-expression replay as evidence of the repaired WPF handler. This separate suite is the current targeted repair evidence.

```sh
CAIWU_REVIEW_SOURCE_ROOT=/absolute/path/to/53fe-checkout \
CAIWU_ACCEPTANCE_DOTNET=/absolute/path/to/dotnet \
  tests/Caiwu.Acceptance/Revalidation53fe/run.sh
```

The script verifies a clean production tree, pins the reviewed Core blob and integration Contracts tree, and places all build outputs under Acceptance `.build`. Output defaults to `evidence/revalidation-53fe0f2.json`. Actual independent run: **23 PASS / 0 FAIL**, with real SQLite, SDK 10.0.402, no WPF execution.

Every edit fixture captures the voucher and both tokens in one `BeginEdit` snapshot before competing writes. It never reads new tokens at Save or retry time. Wrong-book fixtures deliberately have identical voucher IDs and revision numbers; the CAS race uses a real second SQLite writer between token validation and the actual store write. Every rejected command compares the complete persisted snapshot including audit and revision.

Windows UI follow-up is the eighth probe `WPF-STALE-EDITOR-RETAINS-OPENING-TOKEN-AND-INPUT` in `../Wpf`. It holds a real editor open while a second real SQLite connection saves newer data; two Save attempts must retain the original token/input and reject without changing newer data. Actual two-application-window operation remains the coordinator's Windows check; the scripted probe is not a claim that it was performed here.
