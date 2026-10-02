"""Move a native window using physical XTest input; refuses non-Xvfb displays."""
import ctypes
import os
from pathlib import Path
import re
import sys
import time

match = re.fullmatch(r":(\d+)(?:\.\d+)?", os.environ.get("DISPLAY", ""))
if not match:
    raise RuntimeError("Native pointer tests require a local private Xvfb display")
server_pid = int(Path(f"/tmp/.X{match[1]}-lock").read_text().strip())
server_command = Path(f"/proc/{server_pid}/cmdline").read_bytes().split(b"\0")[0].decode()
if Path(server_command).name != "Xvfb":
    raise RuntimeError("Refusing pointer input outside an Xvfb test display")

x11 = ctypes.CDLL("libX11.so.6")
xtest = ctypes.CDLL("libXtst.so.6")
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
xtest.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
xtest.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
display = x11.XOpenDisplay(None)
if not display:
    raise RuntimeError("Cannot open private test display")
x, y, dx, dy = map(int, sys.argv[1:])
try:
    xtest.XTestFakeMotionEvent(display, -1, x, y, 0)
    x11.XFlush(display)
    time.sleep(0.1)
    xtest.XTestFakeButtonEvent(display, 1, 1, 0)
    x11.XFlush(display)
    time.sleep(0.1)
    for step in range(1, 11):
        xtest.XTestFakeMotionEvent(display, -1, x + dx * step // 10, y + dy * step // 10, 0)
        x11.XFlush(display)
        time.sleep(0.03)
finally:
    xtest.XTestFakeButtonEvent(display, 1, 0, 0)
    x11.XFlush(display)
    x11.XCloseDisplay(display)
