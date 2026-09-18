import { describe, expect, it } from "vitest";
import { inboxDayAnswer, inboxNote, parseInboxLine } from "./inbox";

const AT = "2026-09-19T13:04:22.511+05:30";

describe("parseInboxLine", () => {
  it("reads a note left by the widget or the share sheet", () => {
    expect(parseInboxLine(`{"v":1,"kind":"note","at":"${AT}","text":"ran into Priya"}`)).toEqual({
      v: 1,
      kind: "note",
      at: AT,
      text: "ran into Priya",
    });
  });

  it("reads a day reminder answered in the notification", () => {
    expect(parseInboxLine(`{"v":1,"kind":"day","at":"${AT}","point":"lunch","text":"lab all morning"}`)).toEqual({
      v: 1,
      kind: "day",
      at: AT,
      point: "lunch",
      text: "lab all morning",
      skipped: false,
    });
  });

  it("reads a skipped point with no text", () => {
    const line = parseInboxLine(`{"v":1,"kind":"day","at":"${AT}","point":"dinner","skipped":true}`);
    expect(line).toMatchObject({ kind: "day", point: "dinner", skipped: true, text: "" });
  });

  it("drops anything it can't understand rather than retrying it forever", () => {
    for (const raw of [
      "not json at all",
      "",
      "{}",
      `{"v":2,"kind":"note","at":"${AT}","text":"from a newer Ember"}`,
      `{"v":1,"kind":"note","at":"yesterday","text":"x"}`,
      `{"v":1,"kind":"note","at":"${AT}","text":""}`,
      `{"v":1,"kind":"day","at":"${AT}","point":"brunch"}`,
      `{"v":1,"kind":"something-else","at":"${AT}"}`,
    ]) {
      expect(parseInboxLine(raw)).toBeNull();
    }
  });

  it("reads back what it writes", () => {
    expect(parseInboxLine(inboxNote("a thought", AT))).toEqual({ v: 1, kind: "note", at: AT, text: "a thought" });
    expect(parseInboxLine(inboxDayAnswer("break", "walked", false, AT))).toEqual({
      v: 1,
      kind: "day",
      at: AT,
      point: "break",
      text: "walked",
      skipped: false,
    });
  });

  it("writes one line, so a note with newlines in it still parses", () => {
    const written = inboxNote("first line\nsecond line", AT);
    expect(written).not.toContain("\n");
    expect(parseInboxLine(written)).toMatchObject({ text: "first line\nsecond line" });
  });
});
