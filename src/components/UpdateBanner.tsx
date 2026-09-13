import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSetting, setSetting } from "../db/settings";
import { checkForUpdate, type Release } from "../update/update";

/**
 * Looks for a newer release once when Ember opens and, only
 * if there is one, shows a slim line at the top. Download opens the installer
 * in the browser; Later hides that version until the next one.
 */
export default function UpdateBanner() {
  const [release, setRelease] = useState<Release | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if ((await getSetting("update_auto_check")) !== "1") return;
      const result = await checkForUpdate(false);
      if (!cancelled && result.status === "available") setRelease(result.release);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!release) return null;

  return (
    <div className="fade-up sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule bg-sheet/95 px-5 py-2.5 text-[13.5px]">
      <span className="text-ink">
        Ember {release.version} is out.
        {release.notes && <span className="ml-1.5 text-ink-faint">{release.notes}</span>}
      </span>
      <span className="ml-auto flex gap-1.5">
        <button onClick={() => openUrl(release.downloadUrl).catch(() => {})} className="btn-subtle">
          Download
        </button>
        <button
          onClick={() => {
            setSetting("update_dismissed_version", release.version).catch(() => {});
            setRelease(null);
          }}
          className="btn-ghost"
        >
          Later
        </button>
      </span>
    </div>
  );
}
