namespace Caiwu.Persistence.Sqlite;

internal static class Schema
{
    internal const int Version = 1;
    internal const int ApplicationId = 0x43415755;

    internal const string Create = """
        PRAGMA application_id = 1128355669;
        PRAGMA user_version = 1;
        CREATE TABLE ledger (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            revision INTEGER NOT NULL CHECK (revision >= 0),
            book_id TEXT NOT NULL,
            name TEXT NOT NULL,
            regime INTEGER NOT NULL CHECK (regime BETWEEN 0 AND 2),
            template_version TEXT NOT NULL,
            fiscal_year INTEGER NOT NULL,
            start_month INTEGER NOT NULL,
            closed_through_month INTEGER NOT NULL,
            created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE accounts (
            code TEXT PRIMARY KEY NOT NULL,
            ordinal INTEGER NOT NULL UNIQUE CHECK (ordinal >= 0),
            name TEXT NOT NULL,
            parent_code TEXT REFERENCES accounts(code) DEFERRABLE INITIALLY DEFERRED,
            direction INTEGER NOT NULL CHECK (direction IN (0, 1)),
            is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
            opening_debit_cents INTEGER NOT NULL,
            opening_credit_cents INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE vouchers (
            id TEXT PRIMARY KEY NOT NULL,
            ordinal INTEGER NOT NULL UNIQUE CHECK (ordinal >= 0),
            date TEXT NOT NULL,
            kind TEXT NOT NULL,
            number INTEGER NOT NULL,
            attachment_count INTEGER NOT NULL,
            prepared_by TEXT NOT NULL,
            reviewed_by TEXT,
            status INTEGER NOT NULL CHECK (status BETWEEN 0 AND 2)
        ) STRICT;
        CREATE TABLE voucher_lines (
            voucher_id TEXT NOT NULL REFERENCES vouchers(id) DEFERRABLE INITIALLY DEFERRED,
            ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
            account_code TEXT NOT NULL REFERENCES accounts(code) DEFERRABLE INITIALLY DEFERRED,
            summary TEXT NOT NULL,
            debit_cents INTEGER NOT NULL,
            credit_cents INTEGER NOT NULL,
            PRIMARY KEY (voucher_id, ordinal)
        ) STRICT;
        CREATE INDEX ix_voucher_lines_account ON voucher_lines(account_code);
        CREATE TABLE audit_events (
            id TEXT PRIMARY KEY NOT NULL,
            ordinal INTEGER NOT NULL UNIQUE CHECK (ordinal >= 0),
            at TEXT NOT NULL,
            operator_name TEXT NOT NULL,
            action TEXT NOT NULL,
            voucher_id TEXT,
            detail TEXT NOT NULL
        ) STRICT;
        """;
    // Audit references intentionally survive deletion of a draft voucher.
}
