import { describe, expect, it } from "vitest";
import {
  DateError,
  addDays,
  addMonths,
  addMonthsToYearMonth,
  daysBetween,
  daysInMonth,
  isLeapYear,
  monthBounds,
  monthOf,
  monthsBetween,
  parseIsoDate,
  today,
} from "./dates";

describe("calendar basics", () => {
  it("knows leap years", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it("knows month lengths", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("parses valid dates and rejects impossible ones", () => {
    expect(parseIsoDate("2026-11-12")).toEqual({ year: 2026, month: 11, day: 12 });
    for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-1-5", "12/11/2026", "", "2025-02-29"]) {
      expect(() => parseIsoDate(bad)).toThrow(DateError);
    }
  });

  it("derives months and their bounds", () => {
    expect(monthOf("2026-11-12")).toBe("2026-11");
    expect(monthBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthBounds("2028-02").end).toBe("2028-02-29");
    expect(() => monthBounds("2026-13")).toThrow(DateError);
  });
});

describe("month arithmetic", () => {
  it("crosses year boundaries in both directions", () => {
    expect(addMonthsToYearMonth("2026-11", 3)).toBe("2027-02");
    expect(addMonthsToYearMonth("2026-01", -1)).toBe("2025-12");
    expect(addMonthsToYearMonth("2026-06", 24)).toBe("2028-06");
    expect(addMonthsToYearMonth("2026-03", -15)).toBe("2024-12");
  });

  it("counts months between", () => {
    expect(monthsBetween("2026-11", "2027-11")).toBe(12);
    expect(monthsBetween("2026-11", "2026-08")).toBe(-3);
    expect(monthsBetween("2026-11", "2026-11")).toBe(0);
  });

  it("clamps to the end of shorter months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 12)).toBe("2027-11-15");
  });

  it("restores the anchor day after a short month", () => {
    const feb = addMonths("2026-01-31", 1, 31);
    expect(feb).toBe("2026-02-28");
    expect(addMonths(feb, 1, 31)).toBe("2026-03-31");
    expect(addMonths(feb, 1)).toBe("2026-03-28"); // without an anchor the day would drift
  });
});

describe("day arithmetic", () => {
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-12", 0)).toBe("2026-11-12");
  });

  it("is unaffected by daylight-saving transitions", () => {
    // Around typical DST changes, each step must still be exactly one calendar day.
    let date = "2026-03-01";
    for (let i = 0; i < 400; i++) {
      const next = addDays(date, 1);
      expect(daysBetween(date, next)).toBe(1);
      date = next;
    }
    expect(date).toBe("2027-04-05");
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(daysBetween("2028-01-01", "2029-01-01")).toBe(366);
    expect(daysBetween("2026-11-12", "2026-11-01")).toBe(-11);
  });
});

describe("today", () => {
  it("uses the local calendar date of the given instant", () => {
    expect(today(new Date(2026, 10, 12, 23, 59))).toBe("2026-11-12");
    expect(today(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
});
