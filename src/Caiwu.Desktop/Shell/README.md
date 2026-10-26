# Accounting shell parity slice

This is a partial implementation of `qingsong/main`'s common accounting shell. It is not completion of the original products or original-book compatibility. The original gap-analysis and PR40 unknowns remain acceptance requirements.

`Logic/OriginalShellCatalog.cs` is a small production menu/navigation catalog from the already committed analysis at main `3b0c59b`. It contains the original menu hierarchy (including default-hidden entries), original shortcut metadata and known workbench anchors. No original program, image, installer or new full analysis output is included. Three workbench tabs use temporary `1/2/3` labels because original tab captions are unknown. Shapes are newly drawn; PBU anchors are used for relative layout, not asserted runtime pixel equivalence.

The public shell seam is `MainWindow.RegisterModuleWindows(ShellModuleWindows)`. Registration requires an actual handler, an explicit existing operator permission and exact `(Product, ObjectName, Entry)` keys. Main-menu entries use `m_frame_zw/<original menu item ID>`; voucher-operation entries use `m_work_pz_pzxsb/<ID>`; workbench entries use `w_main1/<control ID>.clicked`. `ShellModuleWindowContext.Session` captures the currently displayed authenticated ledger and revision. `DemandCurrent()` returns only the protected service. Adapters must preserve that context through confirmation/save, keep input on conflict and obtain the same-revision module snapshot from the protected parity interface after integration. Registry metadata alone does not make a new command executable.

`ShellLoginCoordinator` owns session transfer: cancellation, bad date, bad book or failed open logs out the new session. A successful result carries the actual book identity and the explicitly selected operation date. Current adapters support managed `.caiwu` and global local operators only. Original two-character codes, SQL Anywhere books, original users/rights, initialization templates and per-module calendars are not silently inferred.

`Wpf/MdiWorkspace` hosts coexisting accounting sheets with close/activate/minimize/restore/resize and cascade/horizontal/vertical/fill/icon arrangements. Existing accounting handlers keep their authenticated service and stale-session boundaries. The old `Pages` control is an invisible selection bridge; its contents are moved into actual sheets and no fixed business navigation tabs are shown. Voucher editing remains the old modal basic editor and is explicitly not certified against the full original editor contract.

The new parity facade compiles when the integrator's actual `src/Caiwu.Contracts/ParityModules.cs` exists. There is no copied/shadow contract. The production chain remains `AuthorizedLedgerService(PreviewLedgerService(LedgerService))`. Module writes require a composition-root `ParityModuleWritePolicy`; an unknown/unconfigured module is denied. `AcceptVoucherProposal` requires both `PrepareVoucher` and the configured module write permission under one identity-store access/lock; caller actor strings are ignored. Preview restrictions apply to module writes too. No nonprofit write approval is added: any future enablement must use the regimes owner's reviewed implementation and explicit verified template/capability policy, then be separately regression tested.

Run baseline synthetic checks from repository root:

```sh
tools/dotnet-local.sh run --project src/Caiwu.Desktop/Shell/Tests/Logic -- "$PWD"
tools/dotnet-local.sh build src/Caiwu.Desktop/Caiwu.Desktop.csproj --no-restore
tools/dotnet-local.sh build src/Caiwu.Desktop/Shell/Tests/Windows
```

After combining the integrator-owned real parity contract with this slice, run the additional authorization boundary tests:

```sh
tools/dotnet-local.sh run --project src/Caiwu.Desktop/Shell/Tests/Parity
```

The facade test deliberately uses a boundary probe for the unfinished Core module interface. It validates actor/permission/lock/context forwarding and preview protection, not Core/SQLite atomic module transactions. Baseline logic checks separately use real SQLite and existing real financial services with synthetic books.

On an actual Windows machine or the integration owner's Windows workflow, run:

```powershell
./src/Caiwu.Desktop/Shell/Tests/Windows/run.ps1 -OutputDirectory artifacts/parity-shell-native
```

This independent host uses the production controls and synthetic temporary accounts/books, records source SHA and captures its own new UI. It does not launch the original program or a production managed App session. Routed clicks/programmatic field entry do not prove physical keyboard, IME, original parity or installed-app behavior. It has only been cross-compiled in this slice; runtime and visual review are pending. The existing QA suites referring to old tabs/menu names also require adaptation by their owners, not false pass assertions.
