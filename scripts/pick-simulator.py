#!/usr/bin/env python3
"""Pick an iPhone simulator to run Ember on.

`xcrun simctl list devices available -j` groups devices by runtime. Any
available iPhone will do; the newest runtime is preferred so the Control
Centre button (iOS 18) has somewhere to exist. Prints the device's UDID, or
nothing at all when the runner has no iPhone simulator, which the caller
treats as a failure.
"""

import json
import subprocess
import sys


def runtime_order(name: str) -> tuple[int, ...]:
    """Sort key from a runtime identifier like com.apple.CoreSimulator.SimRuntime.iOS-18-5."""
    digits = [int(p) for p in name.replace("-", ".").split(".") if p.isdigit()]
    return tuple(digits) or (0,)


def main() -> int:
    raw = subprocess.run(
        ["xcrun", "simctl", "list", "devices", "available", "-j"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    devices = json.loads(raw)["devices"]

    ios_runtimes = sorted(
        (r for r in devices if "iOS" in r),
        key=runtime_order,
        reverse=True,
    )
    for runtime in ios_runtimes:
        for device in devices[runtime]:
            if device.get("isAvailable") and "iPhone" in device.get("name", ""):
                print(device["udid"])
                print(f"{device['name']} on {runtime}", file=sys.stderr)
                return 0
    print("no available iPhone simulator", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
