#!/usr/bin/env python3
"""Add Ember's native pieces to the generated Xcode project.

`tauri ios init` doesn't write an .xcodeproj by hand: it writes
`src-tauri/gen/apple/project.yml` and lets XcodeGen build the project from it.
That is lucky, because it means everything `BUILDING-ON-A-MAC.md` used to ask
someone to do by hand in Xcode is a few lines of YAML instead — and a build
server can do it, and check that it worked.

This script adds, to that project.yml:

  * the app target's own extra sources: the App Group bootstrap, the shared
    inbox, and the App Intents that put Ember in Shortcuts and Siri
  * EmberWidget  — the Home Screen widget and the Control Centre button
  * EmberShare   — "share to Ember" from any other app
  * the App Group all three share, as an entitlements file each
  * the two extensions as things the app embeds, so they ship inside it

Then run `xcodegen generate` in `src-tauri/gen/apple` and build as usual.

Safe to run twice: it replaces what it added last time rather than stacking.
"""

from __future__ import annotations

import argparse
import plistlib
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - the workflow installs it
    sys.exit("This needs PyYAML: pip3 install pyyaml")

APP_GROUP = "group.dev.abhij.ember.ios"
BUNDLE_ID = "dev.abhij.ember.ios"

WIDGET = "EmberWidget"
SHARE = "EmberShare"
OURS = (WIDGET, SHARE)

# project.yml sits in src-tauri/gen/apple, so the repo root is three up.
TO_ROOT = "../../.."


def entitlements(path: Path) -> None:
    """An App Group entitlement, so the app and its extensions share a folder."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        plistlib.dump({"com.apple.security.application-groups": [APP_GROUP]}, handle)


def app_target_name(project: dict) -> str:
    """cargo-mobile2 names it <crate>_iOS; find it rather than assume."""
    for name, target in project.get("targets", {}).items():
        if target.get("type") == "application":
            return name
    sys.exit("No application target in project.yml — has `tauri ios init` run?")


def widget_target() -> dict:
    return {
        "type": "app-extension",
        "platform": "iOS",
        # From iOS 17 a widget must declare its own background, and
        # containerBackground doesn't exist before that.
        "deploymentTarget": "17.0",
        "sources": [
            {"path": f"{TO_ROOT}/ios/{WIDGET}"},
            {"path": f"{TO_ROOT}/ios/Shared"},
        ],
        "info": {
            "path": f"{WIDGET}/Info.plist",
            "properties": {
                "CFBundleDisplayName": "Ember note",
                "NSExtension": {
                    "NSExtensionPointIdentifier": "com.apple.widgetkit-extension",
                },
            },
        },
        "settings": {
            "base": {
                "PRODUCT_BUNDLE_IDENTIFIER": f"{BUNDLE_ID}.widget",
                # The name of the built .appex and of its Swift module, so it
                # must differ from the app's own ("Ember") and have no spaces
                # in it. What a person sees is CFBundleDisplayName above.
                "PRODUCT_NAME": WIDGET,
                "CODE_SIGN_ENTITLEMENTS": f"{TO_ROOT}/ios/{WIDGET}/{WIDGET}.entitlements",
                "SWIFT_VERSION": "5.0",
                "SKIP_INSTALL": "YES",
            }
        },
        "dependencies": [
            {"sdk": "WidgetKit.framework"},
            {"sdk": "SwiftUI.framework"},
            {"sdk": "AppIntents.framework"},
        ],
    }


def share_target() -> dict:
    return {
        "type": "app-extension",
        "platform": "iOS",
        "deploymentTarget": "16.0",
        "sources": [
            {"path": f"{TO_ROOT}/ios/{SHARE}"},
            # Only the inbox: the share sheet saves the note itself and has no
            # use for the intents.
            {"path": f"{TO_ROOT}/ios/Shared/EmberInbox.swift"},
        ],
        "info": {
            "path": f"{SHARE}/Info.plist",
            "properties": {
                "CFBundleDisplayName": "Ember",
                "NSExtension": {
                    "NSExtensionPointIdentifier": "com.apple.share-services",
                    # No storyboard: ShareViewController draws its own one line.
                    "NSExtensionPrincipalClass": "$(PRODUCT_MODULE_NAME).ShareViewController",
                    "NSExtensionAttributes": {
                        "NSExtensionActivationRule": {
                            "NSExtensionActivationSupportsText": True,
                            "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
                        }
                    },
                },
            },
        },
        "settings": {
            "base": {
                "PRODUCT_BUNDLE_IDENTIFIER": f"{BUNDLE_ID}.share",
                # Not "Ember": that is the app's PRODUCT_NAME, and two targets
                # building Ember.swiftmodule is an error, not a warning.
                "PRODUCT_NAME": SHARE,
                "CODE_SIGN_ENTITLEMENTS": f"{TO_ROOT}/ios/{SHARE}/{SHARE}.entitlements",
                "SWIFT_VERSION": "5.0",
                "SKIP_INSTALL": "YES",
            }
        },
        "dependencies": [
            {"sdk": "UIKit.framework"},
        ],
    }


def patch(spec_path: Path, repo_root: Path, with_extensions: bool) -> None:
    project = yaml.safe_load(spec_path.read_text(encoding="utf-8"))
    app = app_target_name(project)
    target = project["targets"][app]

    # ---- the app's own extra sources ----
    #
    # EmberBootstrap.mm hands Rust the App Group path before main() runs, and
    # the intents have to live in the app for Shortcuts and Siri to find them.
    wanted = [
        f"{TO_ROOT}/ios/App",
        f"{TO_ROOT}/ios/Shared",
    ]
    sources = [s for s in target.get("sources", []) if str(s.get("path", s)) not in wanted]
    sources.extend({"path": p} for p in wanted)
    target["sources"] = sources

    app_entitlements = f"{TO_ROOT}/ios/App/Ember.entitlements"
    target.setdefault("settings", {}).setdefault("base", {})
    if with_extensions:
        target["settings"]["base"]["CODE_SIGN_ENTITLEMENTS"] = app_entitlements
        entitlements(repo_root / "ios/App/Ember.entitlements")
    else:
        target["settings"]["base"].pop("CODE_SIGN_ENTITLEMENTS", None)

    # ---- the extensions ----
    for name in OURS:
        project["targets"].pop(name, None)
    deps = [d for d in target.get("dependencies", []) if d.get("target") not in OURS]

    if with_extensions:
        project["targets"][WIDGET] = widget_target()
        project["targets"][SHARE] = share_target()
        entitlements(repo_root / f"ios/{WIDGET}/{WIDGET}.entitlements")
        entitlements(repo_root / f"ios/{SHARE}/{SHARE}.entitlements")
        # embed: the extension is copied into Ember.app/PlugIns.
        deps.append({"target": WIDGET, "embed": True})
        deps.append({"target": SHARE, "embed": True})
    target["dependencies"] = deps

    spec_path.write_text(
        yaml.safe_dump(project, sort_keys=False, width=1000, allow_unicode=True),
        encoding="utf-8",
    )
    added = ", ".join(OURS) if with_extensions else "nothing"
    print(f"Patched {spec_path}")
    print(f"  app target:  {app}")
    print(f"  extensions:  {added}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--spec",
        default="src-tauri/gen/apple/project.yml",
        help="the XcodeGen spec `tauri ios init` wrote",
    )
    parser.add_argument(
        "--no-extensions",
        action="store_true",
        help="add only the app's own sources, leaving the widget and share sheet out",
    )
    args = parser.parse_args()

    spec = Path(args.spec).resolve()
    if not spec.exists():
        sys.exit(f"{spec} doesn't exist — run `tauri ios init` first.")
    # spec is <root>/src-tauri/gen/apple/project.yml
    repo_root = spec.parent.parent.parent.parent
    patch(spec, repo_root, not args.no_extensions)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
