import { describe, expect, it } from "vitest";
import { allDayReminderIds, planDayReminders, pointFromNotification, DAY_ACTION_TYPE } from "./dayReminders";

const times = { lunch: "13:00", break: "17:30", dinner: "20:00" } as const;

function plan(overrides: Partial<Parameters<typeof planDayReminders>[0]> = {}, days = 2) {
  return planDayReminders(
    { now: "2026-09-19T09:00", enabled: true, times, answeredToday: [], ...overrides },
    days,
  );
}

describe("planDayReminders", () => {
  it("rings all three points today and tomorrow", () => {
    expect(plan().map((p) => p.at)).toEqual([
      "2026-09-19T13:00",
      "2026-09-19T17:30",
      "2026-09-19T20:00",
      "2026-09-20T13:00",
      "2026-09-20T17:30",
      "2026-09-20T20:00",
    ]);
  });

  it("plans nothing while the reminders are switched off", () => {
    expect(plan({ enabled: false })).toEqual([]);
  });

  it("leaves out a time that has already passed today, but keeps tomorrow's", () => {
    const at = plan({ now: "2026-09-19T18:00" }).map((p) => p.at);
    expect(at).not.toContain("2026-09-19T13:00");
    expect(at).not.toContain("2026-09-19T17:30");
    expect(at).toContain("2026-09-19T20:00");
    expect(at).toContain("2026-09-20T13:00");
  });

  it("leaves out a point today's check-in already answers, but not tomorrow's", () => {
    const at = plan({ answeredToday: ["lunch"] }).map((p) => p.at);
    expect(at).not.toContain("2026-09-19T13:00");
    expect(at).toContain("2026-09-20T13:00");
  });

  it("ignores a time that was never set or is malformed", () => {
    const at = plan({ times: { lunch: "13:00", break: "", dinner: "8pm" } }).map((p) => p.at);
    expect(at).toEqual(["2026-09-19T13:00", "2026-09-20T13:00"]);
  });

  it("gives every reminder its own id, all of them cancellable", () => {
    const planned = planDayReminders({ now: "2026-09-19T00:00", enabled: true, times, answeredToday: [] });
    const ids = planned.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cancellable = new Set(allDayReminderIds());
    for (const id of ids) expect(cancellable.has(id)).toBe(true);
  });

  it("keeps its ids clear of the evening (7000+) and task (100000+) reminders", () => {
    for (const id of allDayReminderIds()) {
      expect(id).toBeGreaterThanOrEqual(5100);
      expect(id).toBeLessThan(7000);
    }
  });
});

describe("pointFromNotification", () => {
  it("reads the point Ember attached when it scheduled the reminder", () => {
    expect(pointFromNotification({ extra: { emberDayPoint: "dinner" }, id: 1 })).toBe("dinner");
  });

  it("falls back to the notification's id", () => {
    const planned = planDayReminders({ now: "2026-09-19T00:00", enabled: true, times, answeredToday: [] }, 1);
    for (const item of planned) {
      expect(pointFromNotification({ id: item.id })).toBe(item.point);
    }
  });

  it("ignores a notification that isn't a day reminder", () => {
    expect(pointFromNotification({ id: 7000 })).toBeNull();
    expect(pointFromNotification({})).toBeNull();
  });

  it("names its action type, which the Swift side matches on", () => {
    expect(DAY_ACTION_TYPE).toBe("ember-day-point");
  });
});
