namespace Caiwu.Contracts;

public sealed class LedgerValidationException(string message) : Exception(message);

public sealed class StoreConcurrencyException(string message) : Exception(message);
