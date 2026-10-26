namespace Caiwu.Desktop.Shell;

[Flags]
public enum ShellModifiers { None = 0, Control = 1, Alt = 2, Shift = 4 }
public readonly record struct ShellGesture(string Key, ShellModifiers Modifiers);
public static class ShellShortcuts
{
    // The original metadata includes unmodified Delete; WPF KeyGestureConverter does not accept every such key.
    public static ShellGesture? Parse(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var parts = text.Split('+'); var modifiers = ShellModifiers.None;
        foreach (var token in parts.SkipLast(1))
        {
            var bit = token switch { "Ctrl" => ShellModifiers.Control, "Alt" => ShellModifiers.Alt, "Shift" => ShellModifiers.Shift, _ => (ShellModifiers)(-1) };
            if ((int)bit == -1 || modifiers.HasFlag(bit)) return null;
            modifiers |= bit;
        }
        var key = parts[^1];
        if (!(key.Length == 1 && char.IsAsciiLetter(key[0])) && key != "Delete" &&
            !(key.StartsWith('F') && int.TryParse(key.AsSpan(1), out var number) && number is >= 1 and <= 24)) return null;
        return new(key.ToUpperInvariant() == "DELETE" ? "Delete" : key.ToUpperInvariant(), modifiers);
    }
}
