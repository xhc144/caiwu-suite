# Actual installed Desktop financial QA

Independent external UIA/native input controller. Only the installed launcher and normal authenticated full Desktop run as the product; this is not a WPF component host. Synthetic setup uses ordinary SQLite/identity/managed-registration APIs before product launch, releases its real leases, and records source provenance and hashes. No original application or real financial data is used.

The branch-scoped `windows-installed-financial-qa.yml` reuses the existing pinned Windows runner, candidate preparation and native installer. Production code, existing InstalledDesktop controller, release hold and publishing configuration are unchanged. Candidate is INTERNAL-UNVALIDATED; workflow uploads evidence only.

Cases: native cost grid80→84 / final250→254 / allocation / managed save and registration / reopen; explicit nonprofit input import and actual classification edit / two real report previews / new save, registration and reopen / invalid account error clears both old reports; native designer formula edit / preview / template save and registration / reopen. Finally initialize a real summary catalog, use the actual App backup and restore menus, and independently verify the new physical target, all five registered attachments across four codecs, exact SHA256 and native content/version. Single-book recovery must preserve original ledger/global identities.

Each case reports passed/failed/not-run in partial `financial-results.json` with exact payload source SHA and run URL. Native PNGs use the real desktop at 1920×1080 or above, never resized captures. Setup/build/menu entry alone is not business success. Nonprofit reports are synthetic calculation previews, with no claim of complete statutory compliance. Physical keyboard/IME, printing/PDF, other DPI, upgrades and broad legal completeness are outside this fixture.

Run only on a disposable authorized private Windows CI runner. Deadline is bounded by controller/workflow watchdogs. See `VALIDATION.md` for actual runs; source code describes intended coverage until a matching runtime report passes.
