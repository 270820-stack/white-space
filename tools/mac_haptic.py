"""Tap the MacBook trackpad. Other computers ignore the call."""

from __future__ import annotations

import sys
import threading
import time

_ready = None


def _bind():
    import ctypes
    from ctypes import c_float, c_int, c_int32, c_uint32, c_uint64, c_void_p

    mt = ctypes.CDLL("/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport")
    cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    mt.MTDeviceCreateList.restype = c_void_p
    cf.CFArrayGetCount.argtypes = [c_void_p]
    cf.CFArrayGetCount.restype = c_int
    cf.CFArrayGetValueAtIndex.argtypes = [c_void_p, c_int]
    cf.CFArrayGetValueAtIndex.restype = c_void_p
    mt.MTActuatorCreateFromDeviceID.argtypes = [c_uint64]
    mt.MTActuatorCreateFromDeviceID.restype = c_void_p
    mt.MTActuatorOpen.argtypes = [c_void_p]
    mt.MTActuatorOpen.restype = c_int
    mt.MTActuatorClose.argtypes = [c_void_p]
    mt.MTActuatorClose.restype = c_int
    mt.MTActuatorActuate.argtypes = [c_void_p, c_int32, c_uint32, c_float, c_float]
    mt.MTActuatorActuate.restype = c_int
    cf.CFRelease.argtypes = [c_void_p]

    dev = None
    devices = mt.MTDeviceCreateList()
    count = cf.CFArrayGetCount(devices) if devices else 0
    for i in range(count):
        ptr = cf.CFArrayGetValueAtIndex(devices, i)
        raw = ctypes.cast(ptr, ctypes.POINTER(ctypes.c_uint8))
        dev = ctypes.cast(ctypes.addressof(raw.contents) + 64, ctypes.POINTER(c_uint64)).contents.value
        if dev:
            break
    return mt, cf, dev


def _pulse(mt, cf, dev, waveform):
    actuator = mt.MTActuatorCreateFromDeviceID(dev)
    if not actuator:
        return
    try:
        if mt.MTActuatorOpen(actuator) != 0:
            return
        mt.MTActuatorActuate(actuator, waveform, 0, 0.0, 0.0)
    finally:
        mt.MTActuatorClose(actuator)
        cf.CFRelease(actuator)


def haptic_hit():
    if sys.platform != "darwin":
        return False

    def run():
        global _ready
        try:
            if _ready is None:
                _ready = _bind()
            mt, cf, dev = _ready
            if not dev:
                return
            _pulse(mt, cf, dev, 6)
            time.sleep(0.036)
            _pulse(mt, cf, dev, 4)
        except Exception:
            return

    threading.Thread(target=run, daemon=True).start()
    return True
