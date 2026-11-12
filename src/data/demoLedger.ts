/**
 * DEMO DATA. Fictional sample records for exploring the interface.
 *
 * Never mixed with real records: the demo ledger exists only in memory while
 * demo mode is on, and the UI shows a permanent "Demo data" marker.
 * Deterministic (no randomness): the same date always gives the same ledger.
 */

import {
  addMonthsToYearMonth,
  centimes,
  daysInMonth,
  dirhams,
  monthOf,
  parseAmount,
  parseYearMonth,
  toIsoDate,
  type Centimes,
  type IsoDate,
  type Schedule,
  type Transaction,
  type YearMonth,
} from "../engine";
import type { Category, Ledger } from "./ledger";

const MONTHS_OF_HISTORY = 12;

const categories: Category[] = [
  { id: "salary", name: "Salary", kind: "income" },
  { id: "freelance", name: "Freelance", kind: "income" },
  { id: "rent", name: "Rent", kind: "expense" },
  { id: "food", name: "Food", kind: "expense" },
  { id: "transport", name: "Transportation", kind: "expense" },
  { id: "bills", name: "Bills", kind: "expense" },
  { id: "subscriptions", name: "Subscriptions", kind: "expense" },
  { id: "shopping", name: "Shopping", kind: "expense" },
  { id: "other", name: "Other", kind: "expense" },
];

// Month-to-month variation, indexed by position in the history window.
const FOOD = ["2380", "2615.50", "2490", "2710", "2555.75", "2840", "2460", "2690", "2925.40", "2580", "2745", "2630"];
const TRANSPORT = ["540", "610", "575", "690", "520", "640", "600", "735", "560", "625", "590", "696.20"];
const UTILITIES = ["412.30", "455.80", "498.10", "431.60", "389.90", "376.40", "402.75", "448.20", "467.35", "421.10", "439.60", "458.90"];
const SHOPPING = ["650", "0", "1240", "380", "0", "890", "1575", "420", "0", "760", "1120", "540"];
const OTHER = ["180", "320", "95", "410", "150", "260", "0", "385", "210", "140", "305", "175"];
const FREELANCE = ["0", "2500", "0", "0", "3200", "0", "1800", "0", "0", "4000", "0", "2500"];

export function buildDemoLedger(today: IsoDate): Ledger {
  const currentMonth = monthOf(today);
  const firstMonth = addMonthsToYearMonth(currentMonth, -(MONTHS_OF_HISTORY - 1));
  const openingDate = `${firstMonth}-01`;
  const transactions: Transaction[] = [];
  let sequence = 0;

  const day = (month: YearMonth, dayOfMonth: number): IsoDate => {
    const { year, month: m } = parseYearMonth(month);
    return toIsoDate({ year, month: m, day: Math.min(dayOfMonth, daysInMonth(year, m)) });
  };

  const record = (
    date: IsoDate,
    kind: Transaction["kind"],
    amount: string | Centimes,
    categoryId: string | null,
    description: string,
    options: { isFixed?: boolean; accountId?: string; transferAccountId?: string } = {},
  ) => {
    const value = typeof amount === "string" ? parseAmount(amount) : amount;
    if (value === 0 || date > today) return; // nothing is ever recorded in the future
    transactions.push({
      id: `demo-${sequence++}`,
      accountId: options.accountId ?? "demo-current",
      date,
      kind,
      amount: value,
      categoryId,
      transferAccountId: options.transferAccountId ?? null,
      isFixed: options.isFixed ?? false,
      description,
    });
  };

  for (let i = 0; i < MONTHS_OF_HISTORY; i++) {
    const month = addMonthsToYearMonth(firstMonth, i);
    record(day(month, 1), "income", "14000", "salary", "Monthly salary");
    record(day(month, 2), "expense", "3800", "rent", "Apartment rent", { isFixed: true });
    record(day(month, 5), "expense", "249", "subscriptions", "Streaming, cloud, gym", { isFixed: true });
    record(day(month, 8), "expense", UTILITIES[i], "bills", "Electricity and water", { isFixed: true });
    record(day(month, 15), "expense", "299", "bills", "Fibre internet", { isFixed: true });
    record(day(month, 18), "income", FREELANCE[i], "freelance", "Freelance project");
    record(day(month, 28), "transfer", "4000", null, "Monthly savings", { transferAccountId: "demo-savings" });

    // Variable spending, split across the month.
    const food = parseAmount(FOOD[i]);
    const foodParts = [4, 11, 19, 26];
    foodParts.forEach((d, part) => {
      const share = Math.floor(food / foodParts.length) + (part === 0 ? food % foodParts.length : 0);
      record(day(month, d), "expense", centimes(share), "food", "Groceries and dining");
    });
    const transport = parseAmount(TRANSPORT[i]);
    const half = Math.floor(transport / 2);
    record(day(month, 7), "expense", centimes(half), "transport", "Fuel and taxis");
    record(day(month, 21), "expense", centimes(transport - half), "transport", "Fuel and taxis");
    record(day(month, 13), "expense", SHOPPING[i], "shopping", "Shopping");
    record(day(month, 23), "expense", OTHER[i], "other", "Miscellaneous");
  }

  const monthly = (startDay: number) => ({
    frequency: "monthly" as const,
    interval: 1,
    startDate: day(firstMonth, startDay),
  });
  const schedules: Schedule[] = [
    { id: "demo-s-salary", rule: monthly(1), accountId: "demo-current", kind: "income", amount: dirhams(14_000), categoryId: "salary", description: "Monthly salary", isFixed: false },
    { id: "demo-s-rent", rule: monthly(2), accountId: "demo-current", kind: "expense", amount: dirhams(3800), categoryId: "rent", description: "Apartment rent", isFixed: true },
    { id: "demo-s-subs", rule: monthly(5), accountId: "demo-current", kind: "expense", amount: dirhams(249), categoryId: "subscriptions", description: "Streaming, cloud, gym", isFixed: true },
    { id: "demo-s-net", rule: monthly(15), accountId: "demo-current", kind: "expense", amount: dirhams(299), categoryId: "bills", description: "Fibre internet", isFixed: true },
    { id: "demo-s-save", rule: monthly(28), accountId: "demo-current", kind: "transfer", amount: dirhams(4000), categoryId: null, transferAccountId: "demo-savings", description: "Monthly savings", isFixed: true },
    { id: "demo-s-insurance", rule: { frequency: "yearly", interval: 1, startDate: day(addMonthsToYearMonth(currentMonth, 1), 10) }, accountId: "demo-current", kind: "expense", amount: dirhams(2650), categoryId: "bills", description: "Annual insurance", isFixed: true },
  ];

  return {
    accounts: [
      { id: "demo-current", name: "Current account", kind: "current", openingBalance: dirhams(4200), openingDate },
      { id: "demo-savings", name: "Savings account", kind: "savings", openingBalance: dirhams(30_000), openingDate },
    ],
    categories,
    transactions,
    schedules,
  };
}
