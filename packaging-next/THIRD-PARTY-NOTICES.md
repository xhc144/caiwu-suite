# Delivery dependencies and license boundary

- Microsoft .NET SDK 10.0.402 / .NET and WindowsDesktop runtime 10.0.13: official Microsoft distribution. Runtime code is MIT; retain upstream runtime license and third-party notices present in the published runtime. https://github.com/dotnet/runtime/blob/main/LICENSE.TXT ; https://github.com/dotnet/wpf/blob/main/LICENSE.TXT
- Microsoft.Data.Sqlite 10.0.13: MIT. https://github.com/dotnet/efcore/blob/main/LICENSE.txt
- SQLitePCLRaw 2.1.13 (core, provider.e_sqlite3, bundle_e_sqlite3, lib.e_sqlite3): Apache-2.0; Copyright 2014-2024 SourceGear, LLC. The lock-version NuGet manifests declare this license. A copy is retained as `Apache-2.0.txt`. https://github.com/ericsink/SQLitePCL.raw/blob/master/LICENSE.TXT
- SQLite: public domain; this does not remove separate wrapper/library license obligations. https://www.sqlite.org/copyright.html
- NSIS 3.13: the official compiler, unmodified Unicode stubs and zlib compressor are used. Core/zlib component licensing permits commercial use with no purchase. `NSIS-COPYING.txt` retains the upstream notices; no LZMA compressor or third-party NSIS plugin is selected. https://nsis.sourceforge.io/License
- Python and SCons are build-only tools; SCons is not included in the application. SCons 4.11.1 is MIT. https://github.com/SCons/scons/blob/master/LICENSE

No commercial signing license, certificate, private key, or paid installer license is provided or acquired. A license inventory is distinct from production release approval. Recheck the notices when refreshing any tool/package lock. The local NSIS compiler is built from its pinned official source, while the installer stubs come from its pinned official distribution.
