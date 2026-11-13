import { describe, expect, it } from "vitest";
import { assessPurchase, type AffordabilityInput } from "./affordability";
import type { Account } from "./balances";
import { forecastBalances } from "./forecast";
import { planGoal, type Goal } from "./goals";
import { dirhams, divideUp, parseAmount, unitsToCover } from "./money";
import { DEFAULT_SCENARIOS, projectSavings, projectScenarios, type ProjectionInput } from "./projection";
import type { Schedule } from "./schedule";
import type { Transaction } from "./summary";

describe("rounding-up helpers", () => {
  it("counts whole units needed", () => {
    expect(unitsToCover(dirhams(25_000), dirhams(1500))).toBe(17); // 16.67 -> 17
    expect(unitsToCover(dirhams(3000), dirhams(1500))).toBe(2);
    expect(unitsToCover(dirhams(0), dirhams(1500))).toBe(0);
    expect(unitsToCover(dirhams(-5), dirhams(1500))).toBe(0);
    expect(unitsToCover(dirhams(100), dirhams(0))).toBeNull();
    expect(unitsToCover(dirhams(100), dirhams(-10))).toBeNull();
  });

  it("divides up to the next centime", () => {
    expect(divideUp(dirhams(100), 3)).toBe(3334);
    expect(divideUp(dirhams(90), 3)).toBe(3000);
    expect(divideUp(parseAmount("0.01"), 2)).toBe(1);
  });
});

describe("projectSavings", () => {
  const input: ProjectionInput = {
    startingSavings: dirhams(10_000),
    monthlyIncome: dirhams(14_000),
    additionalIncome: dirhams(1000),
    monthlyExpenses: dirhams(9000),
    monthlyContribution: dirhams(1500),
    target: dirhams(25_000),
  };

  it("adds the contribution every month", () => {
    const p = projectSavings(input, 12, "2026-11");
    expect(p.surplus).toBe(dirhams(6000));
    expect(p.contribution).toBe(dirhams(1500));
    expect(p.shortfall).toBe(false);
    expect(p.points).toHaveLength(13);
    expect(p.points[0]).toEqual({ index: 0, month: "2026-11", savings: dirhams(10_000) });
    expect(p.points[3].savings).toBe(dirhams(14_500));
    expect(p.points[12]).toEqual({ index: 12, month: "2027-11", savings: dirhams(28_000) });
    expect(p.finalSavings).toBe(dirhams(28_000));
  });

  it("answers 'what happens if I save MAD 1,500 every month'", () => {
    // 15,000 still needed at 1,500 a month = 10 months
    expect(projectSavings(input, 6, "2026-11").monthsToTarget).toBe(10);
  });

  it("saves the whole surplus when no contribution is set", () => {
    const p = projectSavings({ ...input, monthlyContribution: null }, 3, "2026-11");
    expect(p.contribution).toBe(dirhams(6000));
    expect(p.finalSavings).toBe(dirhams(28_000));
    expect(p.monthsToTarget).toBe(3); // 15,000 / 6,000 = 2.5 -> 3
  });

  it("caps the contribution at the surplus and flags the shortfall", () => {
    const p = projectSavings({ ...input, monthlyContribution: dirhams(8000) }, 2, "2026-11");
    expect(p.shortfall).toBe(true);
    expect(p.contribution).toBe(dirhams(6000));
  });

  it("draws savings down when expenses exceed income, and never reaches the target", () => {
    const p = projectSavings({ ...input, monthlyExpenses: dirhams(16_000) }, 4, "2026-11");
    expect(p.contribution).toBe(dirhams(-1000));
    expect(p.finalSavings).toBe(dirhams(6000));
    expect(p.monthsToTarget).toBeNull();
  });

  it("reports a target already met, and no target", () => {
    expect(projectSavings({ ...input, target: dirhams(8000) }, 1, "2026-11").monthsToTarget).toBe(0);
    expect(projectSavings({ ...input, target: null }, 1, "2026-11").monthsToTarget).toBeNull();
  });

  it("applies scenarios as visible adjustments", () => {
    const [conservative, normal, aggressive] = projectScenarios({ ...input, monthlyContribution: null }, 12, "2026-11");
    // Conservative: expenses +10% (9,900), irregular income not counted -> surplus 4,100
    expect(conservative.expenses).toBe(dirhams(9900));
    expect(conservative.additionalIncome).toBe(0);
    expect(conservative.surplus).toBe(dirhams(4100));
    expect(conservative.finalSavings).toBe(dirhams(59_200));
    expect(normal.surplus).toBe(dirhams(6000));
    // Aggressive: expenses -10% (8,100) -> surplus 6,900
    expect(aggressive.surplus).toBe(dirhams(6900));
    expect(aggressive.finalSavings).toBe(dirhams(92_800));
    expect(DEFAULT_SCENARIOS.map((s) => s.id)).toEqual(["conservative", "normal", "aggressive"]);
  });

  it("rejects absurd horizons", () => {
    expect(() => projectSavings(input, -1, "2026-11")).toThrow(RangeError);
    expect(() => projectSavings(input, 2.5, "2026-11")).toThrow(RangeError);
  });
});

describe("planGoal", () => {
  const motorcycle: Goal = {
    id: "moto", name: "Motorcycle", targetPrice: dirhams(25_000), savedAmount: dirhams(8000),
    targetDate: "2027-05-15", monthlyContribution: dirhams(2000), priority: 1, status: "active",
    costs: [
      { label: "Registration", amount: dirhams(1200), frequency: "once" },
      { label: "Insurance", amount: dirhams(2400), frequency: "yearly" },
      { label: "Fuel", amount: dirhams(400), frequency: "monthly" },
      { label: "Maintenance", amount: dirhams(1800), frequency: "yearly" },
    ],
  };
  const plan = planGoal(motorcycle, "2026-11-12", dirhams(5000));

  it("never treats the price as the whole cost", () => {
    expect(plan.oneOffCosts).toBe(dirhams(1200));
    expect(plan.upfrontTotal).toBe(dirhams(26_200));
    expect(plan.remaining).toBe(dirhams(18_200));
    expect(plan.monthlyOwnership).toBe(dirhams(750)); // 400 + (2400 + 1800) / 12
    expect(plan.firstYearCost).toBe(dirhams(35_200)); // 26,200 + 12 x 750
  });

  it("estimates the purchase date at the current contribution", () => {
    expect(plan.progressBps).toBe(3053); // 8,000 / 26,200
    expect(plan.monthsAtContribution).toBe(10); // 18,200 / 2,000 = 9.1 -> 10
    expect(plan.estimatedDate).toBe("2027-09-12");
  });

  it("computes what the target date requires", () => {
    expect(plan.monthsUntilTarget).toBe(6); // Nov -> May
    expect(plan.requiredMonthly).toBe(303_334); // 18,200 / 6 = 3,033.33.. -> 3,033.34
    expect(plan.onTrack).toBe(false);
    expect(planGoal({ ...motorcycle, monthlyContribution: dirhams(3100) }, "2026-11-12", null).onTrack).toBe(true);
  });

  it("measures the impact on monthly finances", () => {
    expect(plan.contributionShareBps).toBe(4000); // 2,000 of 5,000
    expect(plan.ownershipShareBps).toBe(1500); // 750 of 5,000
    expect(plan.surplusAfterPurchase).toBe(dirhams(4250));
  });

  it("handles no deadline, no contribution, no surplus and a fully funded goal", () => {
    const open = planGoal({ ...motorcycle, targetDate: null, monthlyContribution: dirhams(0) }, "2026-11-12", null);
    expect(open).toMatchObject({
      monthsAtContribution: null, estimatedDate: null, requiredMonthly: null, onTrack: null,
      contributionShareBps: null, surplusAfterPurchase: null,
    });
    const funded = planGoal({ ...motorcycle, savedAmount: dirhams(30_000) }, "2026-11-12", dirhams(-200));
    expect(funded).toMatchObject({ remaining: 0, progressBps: 10_000, monthsAtContribution: 0, requiredMonthly: 0, onTrack: true, ownershipShareBps: null });
  });

  it("compares a motorcycle with a car", () => {
    const car: Goal = {
      ...motorcycle, id: "car", name: "Car", targetPrice: dirhams(65_000),
      costs: [
        { label: "Registration", amount: dirhams(3500), frequency: "once" },
        { label: "Insurance", amount: dirhams(4800), frequency: "yearly" },
        { label: "Fuel", amount: dirhams(1200), frequency: "monthly" },
        { label: "Maintenance", amount: dirhams(3600), frequency: "yearly" },
      ],
    };
    const carPlan = planGoal(car, "2026-11-12", dirhams(5000));
    expect(carPlan.upfrontTotal).toBe(dirhams(68_500));
    expect(carPlan.monthsAtContribution).toBe(31); // 60,500 / 2,000 = 30.25 -> 31
    expect(carPlan.monthlyOwnership).toBe(dirhams(1900));
    expect(carPlan.surplusAfterPurchase).toBe(dirhams(3100));
    expect(carPlan.monthsAtContribution! - plan.monthsAtContribution!).toBe(21);
  });
});

describe("assessPurchase", () => {
  const base: AffordabilityInput = {
    price: dirhams(8000), savings: dirhams(60_000), monthlyIncome: dirhams(14_000), monthlyExpenses: dirhams(9000),
    payment: { kind: "cash" }, goalsSaved: dirhams(0), goalsMonthly: dirhams(0),
  };

  it("is comfortable when the buffer and recovery are fine", () => {
    const a = assessPurchase(base);
    expect(a.verdict).toBe("comfortable");
    expect(a.reasons).toEqual([]);
    expect(a.savingsAfter).toBe(dirhams(52_000));
    expect(a.bufferTenths).toBe(57); // 52,000 / 9,000 = 5.77
    expect(a.monthsOfSaving).toBe(2); // 8,000 / 5,000 = 1.6 -> 2
    expect(a.recoveryMonths).toBe(2);
    expect(a.financingCost).toBe(0);
  });

  it("asks for caution when the buffer is thin or recovery is long", () => {
    const thin = assessPurchase({ ...base, price: dirhams(40_000) });
    expect(thin.verdict).toBe("caution");
    expect(thin.bufferTenths).toBe(22); // 20,000 / 9,000
    expect(thin.recoveryMonths).toBe(8);
    expect(thin.reasons.map((r) => r.severity)).toEqual(["caution", "caution"]);
  });

  it("is risky when savings do not cover it, the buffer is under a month, or there is no surplus", () => {
    expect(assessPurchase({ ...base, price: dirhams(65_000) }).verdict).toBe("risky");
    expect(assessPurchase({ ...base, price: dirhams(55_000) }).verdict).toBe("risky"); // 5,000 left = 0.5 month
    expect(assessPurchase({ ...base, monthlyExpenses: dirhams(14_500) }).verdict).toBe("risky");
  });

  it("evaluates installments: financing cost, burden and what is left", () => {
    const a = assessPurchase({
      ...base, price: dirhams(25_000),
      payment: { kind: "installments", downPayment: dirhams(5000), months: 24, monthlyPayment: dirhams(950) },
    });
    expect(a.paidNow).toBe(dirhams(5000));
    expect(a.totalPaid).toBe(dirhams(27_800));
    expect(a.financingCost).toBe(dirhams(2800));
    expect(a.burdenBps).toBe(1900); // 950 of 5,000
    expect(a.surplusAfter).toBe(dirhams(4050));
    expect(a.verdict).toBe("comfortable");
    const heavy = assessPurchase({
      ...base, price: dirhams(65_000),
      payment: { kind: "installments", downPayment: dirhams(10_000), months: 48, monthlyPayment: dirhams(2300) },
    });
    expect(heavy.burdenBps).toBe(4600);
    expect(heavy.verdict).toBe("risky");
  });

  it("flags purchases that compromise goals", () => {
    const usesGoalMoney = assessPurchase({ ...base, price: dirhams(20_000), goalsSaved: dirhams(45_000) });
    expect(usesGoalMoney.compromisesGoals).toBe(true);
    expect(usesGoalMoney.verdict).toBe("caution");
    const squeezes = assessPurchase({
      ...base, goalsMonthly: dirhams(4500),
      payment: { kind: "installments", downPayment: dirhams(0), months: 10, monthlyPayment: dirhams(800) },
    });
    expect(squeezes.compromisesGoals).toBe(true);
  });

  it("rejects invalid input", () => {
    expect(() => assessPurchase({ ...base, price: dirhams(0) })).toThrow(RangeError);
    expect(() => assessPurchase({ ...base, payment: { kind: "installments", downPayment: dirhams(0), months: 0, monthlyPayment: dirhams(1) } })).toThrow(RangeError);
  });
});

describe("forecastBalances", () => {
  const accounts: Account[] = [
    { id: "cur", name: "Current", kind: "current", openingBalance: dirhams(10_000), openingDate: "2026-11-01" },
    { id: "sav", name: "Savings", kind: "savings", openingBalance: dirhams(30_000), openingDate: "2026-11-01" },
  ];
  const monthly = (id: string, day: string, kind: Schedule["kind"], amount: number, extra: Partial<Schedule> = {}): Schedule => ({
    id, rule: { frequency: "monthly", interval: 1, startDate: `2026-10-${day}` }, accountId: "cur", kind,
    amount: dirhams(amount), categoryId: "c", description: id, isFixed: true, ...extra,
  });
  const schedules = [
    monthly("salary", "01", "income", 14_000),
    monthly("rent", "02", "expense", 4000),
    monthly("save", "28", "transfer", 3000, { transferAccountId: "sav", categoryId: null }),
  ];
  const noTx: Transaction[] = [];
  const base = { accounts, transactions: noTx, schedules, today: "2026-11-15", months: 3, monthlyVariable: dirhams(3000) };

  it("projects month ends from schedules and the stated variable spending", () => {
    const f = forecastBalances(base);
    expect(f.start).toEqual({ available: dirhams(10_000), savings: dirhams(30_000), netWorth: dirhams(40_000) });
    // Rest of November (16-30 = 15 of 30 days): -1,500 variable, -3,000 transfer
    expect(f.months[0]).toMatchObject({ month: "2026-11", income: 0, available: dirhams(5500), savings: dirhams(33_000) });
    // December: +14,000 - 4,000 - 3,000 variable - 3,000 transfer = +4,000
    expect(f.months[1]).toMatchObject({ month: "2026-12", income: dirhams(14_000), expenses: dirhams(7000), available: dirhams(9500), savings: dirhams(36_000) });
    expect(f.months[2]).toMatchObject({ available: dirhams(13_500), savings: dirhams(39_000), netWorth: dirhams(52_500) });
    expect(f.firstWarning).toBeNull();
  });

  it("pays planned purchases from savings first and adds ownership costs afterwards", () => {
    const f = forecastBalances({
      ...base, months: 4,
      purchases: [{ name: "Motorcycle", date: "2026-12-20", amount: dirhams(26_200), monthlyOwnership: dirhams(750) }],
    });
    expect(f.months[1]).toMatchObject({ purchases: dirhams(26_200), savings: dirhams(9800), available: dirhams(9500) });
    // January: +14,000 - 4,000 - 3,000 - 750 ownership - 3,000 transfer = +3,250
    expect(f.months[2]).toMatchObject({ expenses: dirhams(7750), available: dirhams(12_750), savings: dirhams(12_800) });
  });

  it("warns when a purchase or spending exceeds the funds", () => {
    const tooBig = forecastBalances({ ...base, purchases: [{ name: "Car", date: "2026-12-10", amount: dirhams(68_500) }] });
    expect(tooBig.firstWarning).toBe("2026-12");
    expect(tooBig.months[1].warnings[0]).toContain("Car");
    const overspend = forecastBalances({ ...base, monthlyVariable: dirhams(12_000) });
    expect(overspend.months[0].available).toBe(dirhams(1000));
    expect(overspend.months[1].available).toBe(dirhams(-4000));
    expect(overspend.firstWarning).toBe("2026-12");
    expect(overspend.months[1].warnings).toEqual(["Projected expenses exceed available funds."]);
  });

  it("returns nothing when there is no position to start from", () => {
    expect(forecastBalances({ ...base, accounts: [] })).toEqual({ start: null, months: [], firstWarning: null });
    expect(() => forecastBalances({ ...base, months: 0 })).toThrow(RangeError);
  });
});
