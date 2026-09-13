import type { KeyedSeries } from "../../insights/stats";
import Sparkline from "./Sparkline";
import { sentimentColor } from "./palette";

/** Shared row list for Themes and People: name · count ·
 * 8-week sparkline · sentiment tint · optional Rising/Fading badge. Click →
 * Journal filtered to the underlying entries. */
export default function KeyedRows({
  items,
  showTrend,
  onOpen,
}: {
  items: KeyedSeries[];
  showTrend: boolean;
  onOpen: (item: KeyedSeries) => void;
}) {
  if (items.length === 0) {
    return <p className="hint">Nothing yet. Save a few more entries.</p>;
  }
  return (
    <ul className="-mx-2 flex flex-col">
      {items.map((t) => (
        <li key={t.key}>
          <button
            onClick={() => onOpen(t)}
            className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-paper-deep"
            title={`Open the ${t.count} entr${t.count === 1 ? "y" : "ies"} behind this`}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: sentimentColor(t.sentiment) }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{t.key}</span>
            {showTrend && t.trend && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] ${
                  t.trend === "rising" ? "bg-ember-wash text-ember-deep" : "bg-paper-deep text-ink-faint"
                }`}
              >
                {t.trend === "rising" ? "rising" : "fading"}
              </span>
            )}
            <span className="w-8 text-right text-[12px] tabular-nums text-ink-faint">{t.count}×</span>
            <Sparkline values={t.spark} />
          </button>
        </li>
      ))}
    </ul>
  );
}
