import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSetting, setSetting } from "../db/settings";
import { checkForUpdate, updateCheckDue, type Release } from "../update/update";

/** How often the banner asks itself whether a look is due. Asking reads two
 *  settings; only a due look reaches GitHub (update.ts, updateCheckDue). */
const ASK_EVERY_MS = 30 * 60 * 1000;

/**
 * Looks for a newer release when Elytra opens, and keeps looking while it
 * runs: whenever the window comes back into view, and every half hour, it
 * checks again if the last successful look is six hours old. Only if there is
 * a newer release does it show a card at the top. Download opens the
 * installer in the browser; Later hides that version until the next one.
 *
 * The keeping-on matters on a computer, where Elytra sits in the tray for
 * days; a phone mostly reopens it fresh, which checks anyway.
 * The switch in Settings > Updates & feedback turns all of it off.
 */
export default function UpdateBanner() {
  const [release, setRelease] = useState<Release | null>(null);
  const shownRef = useRef(false);
  shownRef.current = release !== null;

  useEffect(() => {
    let cancelled = false;
    let looking = false;
    let lastTry = 0;
    const look = async (atLaunch: boolean) => {
      if (looking || shownRef.current) return;
      looking = true;
      try {
        if ((await getSetting("update_auto_check")) !== "1") return;
        const now = Date.now();
        if (!atLaunch && !updateCheckDue(await getSetting("update_checked_at"), lastTry, now)) return;
        lastTry = now;
        const result = await checkForUpdate(false);
        if (!cancelled && result.status === "available") setRelease(result.release);
      } catch {
        // Not worth interrupting anyone over.
      } finally {
        looking = false;
      }
    };
    void look(true);
    const timer = setInterval(() => void look(false), ASK_EVERY_MS);
    const onBack = () => {
      if (document.visibilityState === "visible") void look(false);
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, []);

  if (!release) return null;

  return (
    <div className="fade-up sticky top-0 z-20 border-b border-line bg-surface/95 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 shrink-0 rounded-full bg-moss" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-snug text-fg">Elytra {release.version} is ready</p>
          {release.notes && <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-fg-faint">{release.notes}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => {
              setSetting("update_dismissed_version", release.version).catch(() => {});
              setRelease(null);
            }}
            className="btn-ghost !min-h-[36px] !px-3"
          >
            Later
          </button>
          <button
            onClick={() => openUrl(release.downloadUrl).catch(() => {})}
            className="btn-primary !min-h-[36px] !px-4 !py-1.5 !text-[13.5px]"
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
