# Fixed assets parity handoff

2026-10-26 UTC. Module owner: assets. Private branch `codex/parity-assets-20261026`; independent checkout `/workspace/caiwu-assets`. Baseline/current source at start: `3b0c59b02d8941c32ac176309555c03c94bb4213`. This early checkpoint is a plan, not a completion claim; final SHA and verification will be appended.

## Ownership and source

Own only `src/Caiwu.FixedAssets/**`, `tests/Caiwu.FixedAssets.Tests/**`, this document. No changes to Contracts, Core, Persistence.Sqlite, Desktop/MainWindow, solution, shared props or workflows. No AGENTS.md exists in the checkout or its checked ancestors. Engineering-handoff-memory skill read; no Handoff MCP exposed, so evidence is recorded here.

Read original-analysis README, gap-analysis, minfeiqi/chengben asset windows/menu JSON, asset tables/DataWindows, PR38 engineering path, PR39 data compatibility, PR40 UI contract. User's later authorization permits replacing the implementation; PR38's earlier hold does not apply. Original program/installers and real books are not run/read. No new full derived materials are produced.

## First slice and API direction

Independent `net10.0` domain library and tests; optional `net10.0-windows` WPF subproject. Proposed `AssetBookService`: register/update card; original-cost adjustment, department/location transfer, disposal; atomic monthly depreciation/cancel latest month; build balanced voucher plans; ledger/detail queries. Repository boundary uses book ID + expected revision and atomic snapshot compare/exchange. Each mutation must fail without changing state on stale revision or business error.

Original windows: `w_zc_zcgl`/`m_work_zcgl` ledger and actions, `w_zcgl_kp` card, `w_zcgl_yztz` adjustments, `w_zcgl_delete` disposal, `w_zjjs` monthly calculation, `w_zc_qxfz` cancellation, `w_zjgl` query, `w_pz_build` voucher generation. Use-date month is not depreciated; next month starts (card's explicit hint). Original modal button positions are available; inner DataWindow field coordinates, complete method code mapping/algorithms and runtime display remain unknown. Never infer screen column order from schema order.

## Required shared integrations (integrator-owned)

1. Atomic module state persistence transaction scoped by original product + book identity + schema fingerprint, revision CAS, read-only/closed-period checks. Preserve all card/history/accessory/image fields and raw typed/null original values; do not collapse into current SQLite/DTO. `zc_gdzc`, `zc_yzjb`, `zc_yzzj`, `zc_fssb`, `zc_pic`, `zc_zcbdb`, reference tables and `xt` asset period/settings require lossless adapters. Existing tables.json retains major variants only.
2. Voucher port: exact source identity + batch/version, idempotency, valid active leaf accounts, department/purpose dimensions, voucher type/date/number, atomic link with module revision, confirmed draft/reviewed/posted state. A plan is not a posted voucher. Cancellation must not detach an existing voucher silently.
3. Original MDI/menu host must route asset entry points for minfeiqi/chengben, preserving inherited menus, shortcuts, window identities, permissions. Desktop MainWindow is integrator-owned. No asset entry for qingsong is inferred.
4. Original-format SQL Anywhere read/write and all variants remain separate compatibility work; synthetic snapshots do not establish original-book compatibility.

## Acceptance retained / initially unfinished

All original asset menu items remain acceptance requirements: card/accessories/pictures, reference maintenance, all depreciation methods/status rules/workload input, original-cost history, transfers, disposal, voucher generation/transfer/account reconciliation, depreciation query/distribution, ledger/detail/list/due/add/remove/distribution/label reports, initialization/settings, uniform editing, copy/import/export, navigation, print/preview and runtime menu/permission behavior. Unknown/static-hidden items are not deleted. Exact rounding and method-code mappings require original evidence; synthetic policy will be stated explicitly.

Initial tests: not run yet; SDK bootstrap in progress. Windows native interaction/visual acceptance: not run. Host integration: not performed. Original-book compatibility: not assessed. This checkpoint does not treat old 0.1.0.4 or build/test counts as parity completion.

## Implementation checkpoint (before shared-adapter work)

Independent domain service, immutable card/reference/history DTOs, CAS store, explicit synthetic file store/codec, ledger query and voucher plans implemented. WPF review surface includes ledger/card/accessories, original-cost adjustment, disposal, depreciation/query/cancel, and plan review. Known outer control bounds use PBU as an abstract Viewbox coordinate system; no pixels/PBU ratio is asserted. Card/accessory/query DataWindow inner field positions are not available: their functional field grids are provisional and NOT original-layout acceptance. The original inherited menu set is incomplete; unimplemented items remain above, no fake action is rendered.

Current synthetic checks: 29 domain tests pass; WPF cross-build succeeds with 0 warnings/errors (Linux, not native Windows). Arithmetic policy is explicit new-engine decimal/2dp/AwayFromZero, prospective remaining-basis/remaining-life straight line and unit-of-production with final residual clamp. Original method-code mapping/rounding/status/runtime cancellation order remains unverified. Disposal-month depreciation is included; following month excluded, and disposal plan uses completed disposal-month batch balances. Plans are persisted module records, not posted ledger vouchers.

## PR52 contract checkpoint feedback

Read exact `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` integration.md/ParityModules.cs (not claiming later floating branch implementation). Plan adapter against `ModuleLedgerSnapshot`, `SaveModuleDocuments`, registration. Whole-book revision will be authoritative; unrelated ledger/module commits invalidate an open asset decision. An external synthetic JSON store remains an independent fixture, never a cross-ledger transaction.

**Exact unresolved proposal field gap:** PR52 `VoucherProposal.Lines` uses four-field `VoucherLine(AccountCode, Summary, Debit, Credit)`. Asset plan lines retain `AssetId` and `DepartmentCode`; batch/source retains purpose/category/workload/foreign/quantity/original rows. Original `dw_pz` exposes bmbm/xmbm/dwbm/grbm/pz_wb/pz_hl/pz_sl/pz_dj/bz/dw and other columns. No automatic omission or summary-string encoding is acceptable. Request a versioned rich line DTO or an explicit, lossless voucher-line metadata document linked by voucher ID + stable line ID with Core/SQLite/reporting rules consuming it. Until defined and verified, adapter may save module documents but must reject converting dimension-bearing asset plans into four-field proposals. Original SQL Anywhere mapping remains not assessed.
