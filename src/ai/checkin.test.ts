import { describe, expect, it } from "vitest";
import { feelingWords, formatCheckInForPrompt, toCheckInSummary } from "./checkin";
import type { CheckIn } from "../db/types";

const row: CheckIn = {
  date: "2026-09-10",
  mood: 4,
  energy: 3,
  sleep_hours: 6.5,
  feeling: " drained, a bit anxious ",
  on_mind: "the exam on Friday",
  habits: JSON.stringify({ gym: false, studying: true }),
  created_at: "2026-09-10T21:00:00",
  updated_at: "2026-09-10T21:00:00",
  bedtime: null,
  wake_time: null,
  sleep_latency_min: null,
  sleep_quality: null,
};

describe("toCheckInSummary", () => {
  it("reads a filled-in row", () => {
    expect(toCheckInSummary(row)).toEqual({
      mood: 4,
      energy: 3,
      sleepHours: 6.5,
      feeling: "drained, a bit anxious",
      onMind: "the exam on Friday",
      habits: { gym: false, studying: true },
      bedtime: null,
      wakeTime: null,
      sleepLatencyMin: null,
      sleepQuality: null,
    });
  });

  it("counts a sleep diary alone as a check-in", () => {
    const blank = { ...row, mood: null, energy: null, sleep_hours: null, feeling: null, on_mind: null, habits: "{}" };
    expect(toCheckInSummary({ ...blank, bedtime: "23:30" })?.bedtime).toBe("23:30");
  });

  it("treats a row with nothing filled in as no check-in", () => {
    const blank = { ...row, mood: null, energy: null, sleep_hours: null, feeling: "  ", on_mind: null, habits: "{}" };
    expect(toCheckInSummary(blank)).toBeNull();
    expect(toCheckInSummary(null)).toBeNull();
  });

  it("survives unreadable habits JSON and drops non-boolean values", () => {
    expect(toCheckInSummary({ ...row, habits: "nope" })?.habits).toEqual({});
    expect(toCheckInSummary({ ...row, habits: '{"gym":"yes","run":true}' })?.habits).toEqual({ run: true });
  });
});

describe("formatCheckInForPrompt", () => {
  it("lists only what was filled in, quoting their own words", () => {
    const text = formatCheckInForPrompt(toCheckInSummary(row));
    expect(text).toBe(
      [
        "- mood: 4/10",
        "- energy: 3/10",
        "- slept last night: 6.5h",
        '- feeling, in their words: "drained, a bit anxious"',
        '- on their mind: "the exam on Friday"',
        "- habits today: gym not done, studying done",
      ].join("\n"),
    );
    expect(formatCheckInForPrompt(null)).toBe("(not filled in today)");
  });

  it("adds the sleep diary when it was filled in", () => {
    const text = formatCheckInForPrompt(
      toCheckInSummary({ ...row, bedtime: "23:40", wake_time: "07:10", sleep_latency_min: 30, sleep_quality: 2 }),
    );
    expect(text).toContain("- in bed 23:40, up 07:10");
    expect(text).toContain("- took 30 min to fall asleep");
    expect(text).toContain("- sleep quality: 2/5");
  });
});

describe("feelingWords", () => {
  it("splits a feeling answer into short feeling words", () => {
    expect(feelingWords("Tired, a bit anxious and hopeful.")).toEqual(["tired", "a bit anxious", "hopeful"]);
    expect(feelingWords("I don't really know what I am feeling")).toEqual([]);
    expect(feelingWords(null)).toEqual([]);
  });
});
