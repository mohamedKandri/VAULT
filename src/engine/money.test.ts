import { describe, expect, it } from "vitest";
import {
  MoneyError,
  add,
  allocate,
  applyBps,
  centimes,
  changeBps,
  dirhams,
  formatBps,
  formatMAD,
  mulRatio,
  parseAmount,
  ratioBps,
  sub,
  sum,
  times,
} from "./money";

describe("centimes", () => {
  it("rejects fractions, NaN and unsafe integers", () => {
    expect(() => centimes(0.5)).toThrow(MoneyError);
    expect(() => centimes(Number.NaN)).toThrow(MoneyError);
    expect(() => centimes(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
  });

  it("normalises negative zero", () => {
    expect(Object.is(centimes(-0), 0)).toBe(true);
  });
});

describe("arithmetic", () => {
  it("is exact where floats are not", () => {
    // 0.1 + 0.2 !== 0.3 in floating point
    expect(add(parseAmount("0.10"), parseAmount("0.20"))).toBe(parseAmount("0.30"));
    expect(sum([parseAmount("19.99"), parseAmount("5.01"), parseAmount("0.07")])).toBe(2507);
  });

  it("subtracts and multiplies by whole counts", () => {
    expect(sub(dirhams(100), dirhams(250))).toBe(-15_000);
    expect(times(parseAmount("1499.99"), 12)).toBe(1_799_988);
    expect(() => times(dirhams(1), 1.5)).toThrow(MoneyError);
  });

  it("refuses to overflow silently", () => {
    expect(() => add(centimes(Number.MAX_SAFE_INTEGER), centimes(1))).toThrow(MoneyError);
    expect(() => sum([centimes(Number.MAX_SAFE_INTEGER), centimes(1)])).toThrow(MoneyError);
  });
});

describe("mulRatio / applyBps", () => {
  it("rounds half away from zero", () => {
    expect(mulRatio(centimes(5), 1, 2)).toBe(3); // 2.5 -> 3
    expect(mulRatio(centimes(-5), 1, 2)).toBe(-3); // -2.5 -> -3
    expect(mulRatio(centimes(4), 1, 3)).toBe(1); // 1.33 -> 1
    expect(mulRatio(centimes(5), 1, 3)).toBe(2); // 1.67 -> 2
    expect(mulRatio(centimes(5), -1, 2)).toBe(-3);
  });

  it("applies percentages in basis points", () => {
    expect(applyBps(dirhams(1000), 1800)).toBe(dirhams(180)); // 18%
    expect(applyBps(parseAmount("33.33"), 5000)).toBe(1667); // 16.665 -> 16.67
    expect(applyBps(dirhams(1000), -250)).toBe(dirhams(-25));
  });

  it("keeps precision when the intermediate product exceeds 2^53", () => {
    const large = centimes(9_000_000_000_000); // MAD 90 billion
    expect(mulRatio(large, 999_999, 1_000_000)).toBe(8_999_991_000_000);
  });

  it("rejects division by zero and non-integer ratios", () => {
    expect(() => mulRatio(dirhams(1), 1, 0)).toThrow(MoneyError);
    expect(() => mulRatio(dirhams(1), 0.5, 1)).toThrow(MoneyError);
  });
});

describe("ratioBps / changeBps", () => {
  it("computes shares in basis points", () => {
    expect(ratioBps(dirhams(1500), dirhams(10_000))).toBe(1500);
    expect(ratioBps(dirhams(1), dirhams(3))).toBe(3333);
    expect(ratioBps(dirhams(2), dirhams(3))).toBe(6667);
    expect(ratioBps(dirhams(-1), dirhams(4))).toBe(-2500);
  });

  it("returns null instead of dividing by zero", () => {
    expect(ratioBps(dirhams(5), centimes(0))).toBeNull();
    expect(changeBps(dirhams(5), centimes(0))).toBeNull();
  });

  it("computes relative change", () => {
    expect(changeBps(dirhams(590), dirhams(500))).toBe(1800); // +18%
    expect(changeBps(dirhams(400), dirhams(500))).toBe(-2000);
    expect(changeBps(dirhams(500), dirhams(500))).toBe(0);
  });
});

describe("allocate", () => {
  it("splits without losing a centime", () => {
    const parts = allocate(dirhams(100), 3);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(sum(parts)).toBe(dirhams(100));
  });

  it("handles negative totals and exact splits", () => {
    expect(allocate(centimes(-100), 3)).toEqual([-34, -33, -33]);
    expect(allocate(dirhams(65_000), 4)).toEqual(Array(4).fill(dirhams(16_250)));
    expect(allocate(centimes(2), 5)).toEqual([1, 1, 0, 0, 0]);
  });

  it("rejects invalid part counts", () => {
    expect(() => allocate(dirhams(1), 0)).toThrow(MoneyError);
    expect(() => allocate(dirhams(1), 2.5)).toThrow(MoneyError);
  });
});

describe("parseAmount", () => {
  it.each([
    ["1500", 150_000],
    ["1500.5", 150_050],
    ["1500.50", 150_050],
    ["1500,50", 150_050],
    ["1,500", 150_000],
    ["1,500.50", 150_050],
    ["1.500,50", 150_050],
    ["1 500,50", 150_050],
    ["1 500,50", 150_050],
    ["25,000", 2_500_000],
    ["1.005", 100_500],
    ["1.500", 150_000],
    ["1,234,567.89", 123_456_789],
    ["0.07", 7],
    ["-42.10", -4210],
    ["+42", 4200],
    ["  65000  ", 6_500_000],
    ["0", 0],
  ])("parses %j", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each([
    "", "abc", "12abc", "1.2.3", "1,234,56", "1234,567", "12.345.67.8", "0.500", "0,500", "01,500", "1.0055", "1e3",
    "--5", ".5", "5.", "1,,5", "MAD 5", "99999999999999999999",
  ])("rejects %j", (input) => {
    expect(() => parseAmount(input)).toThrow(MoneyError);
  });
});

describe("formatting", () => {
  it("formats dirhams with grouping and two decimals", () => {
    expect(formatMAD(dirhams(1500))).toBe("MAD 1,500.00");
    expect(formatMAD(centimes(123_456_789))).toBe("MAD 1,234,567.89");
    expect(formatMAD(centimes(7))).toBe("MAD 0.07");
    expect(formatMAD(centimes(0))).toBe("MAD 0.00");
    expect(formatMAD(centimes(-150_050))).toBe("-MAD 1,500.50");
  });

  it("supports compact and signed variants", () => {
    expect(formatMAD(dirhams(1500), { decimals: "auto" })).toBe("MAD 1,500");
    expect(formatMAD(centimes(150_050), { decimals: "auto" })).toBe("MAD 1,500.50");
    expect(formatMAD(dirhams(999), { code: false })).toBe("999.00");
    expect(formatMAD(dirhams(20), { signed: true })).toBe("+MAD 20.00");
    expect(formatMAD(centimes(0), { signed: true })).toBe("MAD 0.00");
  });

  it("round-trips through parseAmount", () => {
    for (const value of [0, 1, 99, 100, 150_050, 123_456_789, -4210]) {
      expect(parseAmount(formatMAD(centimes(value), { code: false }))).toBe(value);
    }
  });

  it("formats basis points as percentages", () => {
    expect(formatBps(1800)).toBe("18%");
    expect(formatBps(1250)).toBe("12.5%");
    expect(formatBps(1205)).toBe("12.05%");
    expect(formatBps(-333)).toBe("-3.33%");
    expect(formatBps(1800, { signed: true })).toBe("+18%");
    expect(formatBps(0)).toBe("0%");
  });
});
