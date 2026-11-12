import { describe, expect, it } from "vitest";
import { RecurrenceError, nextOccurrence, occurrencesBetween, type RecurrenceRule } from "./recurrence";

const monthly = (startDate: string, extra: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: "monthly",
  interval: 1,
  startDate,
  ...extra,
});

describe("monthly rules", () => {
  it("lists occurrences in a range, inclusive of both ends", () => {
    expect(occurrencesBetween(monthly("2026-01-05"), "2026-03-05", "2026-06-05")).toEqual([
      "2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05",
    ]);
  });

  it("does not drift after short months (salary on the 31st)", () => {
    expect(occurrencesBetween(monthly("2026-01-31"), "2026-01-01", "2026-05-31")).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31",
    ]);
  });

  it("gives the same answer regardless of where the window starts", () => {
    const rule = monthly("2024-01-31");
    const full = occurrencesBetween(rule, "2024-01-01", "2027-12-31");
    expect(full).toHaveLength(48);
    expect(occurrencesBetween(rule, "2026-03-01", "2026-03-31")).toEqual(["2026-03-31"]);
    expect(occurrencesBetween(rule, "2026-02-28", "2026-02-28")).toEqual(["2026-02-28"]);
    expect(occurrencesBetween(rule, "2026-03-01", "2026-03-30")).toEqual([]);
  });

  it("never yields dates before the start or after the end date", () => {
    const rule = monthly("2026-06-10", { endDate: "2026-08-31" });
    expect(occurrencesBetween(rule, "2026-01-01", "2026-12-31")).toEqual([
      "2026-06-10", "2026-07-10", "2026-08-10",
    ]);
    expect(occurrencesBetween(rule, "2025-01-01", "2026-06-09")).toEqual([]);
  });

  it("supports quarterly as monthly with interval 3", () => {
    expect(occurrencesBetween(monthly("2026-01-15", { interval: 3 }), "2026-01-01", "2026-12-31")).toEqual([
      "2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15",
    ]);
    expect(occurrencesBetween(monthly("2026-01-15", { interval: 3 }), "2026-05-01", "2026-07-14")).toEqual([]);
  });
});

describe("weekly rules", () => {
  it("lists weekly and biweekly occurrences", () => {
    const weekly: RecurrenceRule = { frequency: "weekly", interval: 1, startDate: "2026-11-02" };
    expect(occurrencesBetween(weekly, "2026-11-01", "2026-11-30")).toEqual([
      "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30",
    ]);
    const biweekly: RecurrenceRule = { ...weekly, interval: 2 };
    expect(occurrencesBetween(biweekly, "2026-11-10", "2026-12-31")).toEqual([
      "2026-11-16", "2026-11-30", "2026-12-14", "2026-12-28",
    ]);
  });
});

describe("yearly rules", () => {
  it("handles a Feb 29 start (annual insurance)", () => {
    const rule: RecurrenceRule = { frequency: "yearly", interval: 1, startDate: "2024-02-29" };
    expect(occurrencesBetween(rule, "2024-01-01", "2028-12-31")).toEqual([
      "2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29",
    ]);
  });
});

describe("nextOccurrence", () => {
  it("finds the next date on or after a given day", () => {
    const rule = monthly("2026-01-25");
    expect(nextOccurrence(rule, "2026-11-12")).toBe("2026-11-25");
    expect(nextOccurrence(rule, "2026-11-25")).toBe("2026-11-25");
    expect(nextOccurrence(rule, "2026-11-26")).toBe("2026-12-25");
    expect(nextOccurrence(rule, "2020-01-01")).toBe("2026-01-25");
  });

  it("returns null once the rule has ended", () => {
    expect(nextOccurrence(monthly("2026-01-25", { endDate: "2026-06-30" }), "2026-07-01")).toBeNull();
  });
});

describe("validation", () => {
  it("rejects bad intervals and inverted ranges", () => {
    expect(() => occurrencesBetween(monthly("2026-01-01", { interval: 0 }), "2026-01-01", "2026-12-31")).toThrow(RecurrenceError);
    expect(() => occurrencesBetween(monthly("2026-01-01", { interval: 1.5 }), "2026-01-01", "2026-12-31")).toThrow(RecurrenceError);
    expect(() => occurrencesBetween(monthly("2026-05-01", { endDate: "2026-04-01" }), "2026-01-01", "2026-12-31")).toThrow(RecurrenceError);
  });
});
