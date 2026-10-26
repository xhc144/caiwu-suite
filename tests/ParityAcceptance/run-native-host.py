"""Use an actual larger Windows desktop; never resize or upscale the host's PNGs."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import struct
import subprocess
import sys


def main() -> int:
    if sys.platform != "win32" or len(sys.argv) != 4:
        raise RuntimeError("Requires actual Windows, dotnet executable, host DLL and output directory.")
    output = Path(sys.argv[3]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.EnumDisplaySettingsW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_void_p]
    user32.EnumDisplaySettingsW.restype = wintypes.BOOL
    user32.ChangeDisplaySettingsW.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    user32.ChangeDisplaySettingsW.restype = wintypes.LONG
    user32.GetSystemMetrics.argtypes = [ctypes.c_int]
    user32.GetSystemMetrics.restype = ctypes.c_int
    mode = ctypes.create_string_buffer(220)
    struct.pack_into("H", mode, 68, 220)
    if not user32.EnumDisplaySettingsW(None, 0xFFFFFFFF, mode):
        raise RuntimeError("Cannot read the native desktop mode.")
    original = mode.raw
    changed = False
    try:
        if user32.GetSystemMetrics(0) < 1920 or user32.GetSystemMetrics(1) < 1080:
            struct.pack_into("I", mode, 72, struct.unpack_from("I", mode, 72)[0] | 0x180000)
            struct.pack_into("II", mode, 172, 1920, 1080)
            if user32.ChangeDisplaySettingsW(mode, 2) != 0 or user32.ChangeDisplaySettingsW(mode, 0) != 0:
                raise RuntimeError("Native 1920x1080 is unavailable; no enlarged image will be fabricated.")
            changed = True
        width, height = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
        if width < 1920 or height < 1080:
            raise RuntimeError("Native mode change did not take effect.")
        subprocess.run([sys.argv[1], sys.argv[2], str(output)], check=True, timeout=80)
        captures = []
        for path in sorted(output.glob("*.png")):
            data = path.read_bytes()
            if data[:8] != b"\x89PNG\r\n\x1a\n":
                raise RuntimeError("Host output is not a PNG.")
            w, h = struct.unpack(">II", data[16:24])
            captures.append({"file": path.name, "width": w, "height": h})
        workbench = next(c for c in captures if c["file"] == "workbench.png")
        if workbench["width"] < 1440 or workbench["height"] < 900:
            raise RuntimeError("The actual main window was constrained; no image resizing is allowed.")
        (output / "native-display.json").write_text(json.dumps({
            "actualWindowsDesktop": True, "desktopWidth": width, "desktopHeight": height,
            "captures": captures, "resizedOrUpscaled": False,
            "mechanism": "Owner's actual WPF host renders each window at its original actual dimensions on a native 1920x1080-or-larger desktop.",
        }, indent=2) + "\n", encoding="utf-8")
        return 0
    finally:
        if changed:
            restore = ctypes.create_string_buffer(original, 220)
            if user32.ChangeDisplaySettingsW(restore, 0) != 0:
                raise RuntimeError("Could not restore the runner's original desktop mode.")


if __name__ == "__main__":
    raise SystemExit(main())
