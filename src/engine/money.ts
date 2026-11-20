/**
 * Money primitives.
 *
 * Every monetary amount in VAULT is an integer number of centimes
 * (1 MAD = 100 centimes). Floating-point numbers never represent money:
 * 0.1 + 0.2 !== 0.3 in IEEE-754, and those errors compound across
 * projections. Integers are exact up to Number.MAX_SAFE_INTEGER
 * (about 90 trillion MAD), and every operation here verifies it stays
 * inside that range.
 *
 * Rates and percentages are integers too, in basis points (1 bps = 0.01%).
 * Multiplication and division go through BigInt so the intermediate
 * product cannot lose precision, and round half away from zero.
 */

declare const centimesBrand: unique symbol;

/** Integer amount of centimes. Construct with `centimes()` or `parseAmount()`. */
export type Centimes = number & { readonly [centimesBrand]: true };

export const BPS_SCALE = 10_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Assert that `value` is a safe integer and brand it as Centimes. */
export function centimes(value: number): Centimes {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Not a safe integer amount of centimes: ${value}`);
  }
  return (value === 0 ? 0 : value) as Centimes; // normalise -0
}

export const ZERO = centimes(0);

/** Whole dirhams to centimes, e.g. `dirhams(25_000)`. */
export function dirhams(wholeDirhams: number): Centimes {
  if (!Number.isSafeInteger(wholeDirhams)) {
    throw new MoneyError(`Not a whole number of dirhams: ${wholeDirhams}`);
  }
  return centimes(wholeDirhams * 100);
}

export function add(a: Centimes, b: Centimes): Centimes {
  return centimes(a + b);
}

export function sub(a: Centimes, b: Centimes): Centimes {
  return centimes(a - b);
}

export function sum(amounts: Iterable<Centimes>): Centimes {
  let total = 0;
  for (const amount of amounts) {
    total += amount;
    if (!Number.isSafeInteger(total)) {
      throw new MoneyError("Sum exceeds the safe integer range");
    }
  }
  return centimes(total);
}

export function negate(a: Centimes): Centimes {
  return centimes(-a);
}

/** Multiply by a whole number (e.g. a monthly amount over N months). */
export function times(amount: Centimes, count: number): Centimes {
  if (!Number.isSafeInteger(count)) {
    throw new MoneyError(`Multiplier must be an integer: ${count}`);
  }
  return centimes(amount * count);
}

function divRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let quotient = n / d;
  if ((n % d) * 2n >= d) quotient += 1n;
  return negative ? -quotient : quotient;
}

/**
 * amount × numerator ÷ denominator, rounded half away from zero.
 * The single place where a money amount is scaled by a ratio.
 */
export function mulRatio(amount: Centimes, numerator: number, denominator: number): Centimes {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new MoneyError("Ratio terms must be integers");
  }
  if (denominator === 0) throw new MoneyError("Division by zero");
  const result = divRoundHalfAwayFromZero(BigInt(amount) * BigInt(numerator), BigInt(denominator));
  return centimes(Number(result));
}

/** Apply a rate in basis points: `applyBps(dirhams(1000), 1800)` is 18% of MAD 1,000. */
export function applyBps(amount: Centimes, bps: number): Centimes {
  return mulRatio(amount, bps, BPS_SCALE);
}

/**
 * `part` as a share of `whole`, in basis points, rounded half away from zero.
 * Returns null when `whole` is zero: the ratio is undefined, and callers must
 * show that honestly rather than display 0% or infinity.
 */
export function ratioBps(part: Centimes, whole: Centimes): number | null {
  if (whole === 0) return null;
  const result = divRoundHalfAwayFromZero(BigInt(part) * BigInt(BPS_SCALE), BigInt(whole));
  const asNumber = Number(result);
  if (!Number.isSafeInteger(asNumber)) throw new MoneyError("Ratio exceeds the safe integer range");
  return asNumber === 0 ? 0 : asNumber;
}

/**
 * Relative change from `previous` to `current` in basis points
 * (+1800 = 18% more). Null when `previous` is zero.
 */
export function changeBps(current: Centimes, previous: Centimes): number | null {
  if (previous === 0) return null;
  return ratioBps(sub(current, previous), centimes(Math.abs(previous)));
}

/**
 * Split `total` into `parts` amounts that differ by at most one centime and
 * sum exactly to `total` (e.g. installments). Leftover centimes go to the
 * earliest parts.
 */
export function allocate(total: Centimes, parts: number): Centimes[] {
  if (!Number.isSafeInteger(parts) || parts <= 0) {
    throw new MoneyError(`Parts must be a positive integer: ${parts}`);
  }
  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);
  const base = Math.floor(magnitude / parts);
  const remainder = magnitude - base * parts;
  return Array.from({ length: parts }, (_, i) => centimes(sign * (base + (i < remainder ? 1 : 0))));
}

/**
 * Parse user-entered text into centimes without ever going through a float.
 *
 * Accepted: "1500", "1500.5", "1500,50", "1,500.50", "1.500,50", "1 500,50".
 * A final separator followed by 1-2 digits is the decimal mark; separators
 * followed by exactly 3 digits are thousands grouping, so "1.500" and "1,500"
 * are both MAD 1,500 (a grouped number cannot start with 0: "0.500" is
 * rejected). Anything else ambiguous, or more precise than a centime, is
 * rejected rather than silently rounded. Input fields must echo the parsed
 * value back so the user sees how it was read.
 */
export function parseAmount(input: string): Centimes {
  const text = input.replace(/[\s  ]/g, "");
  const match = /^([+-]?)(\d[\d.,]*)$/.exec(text);
  if (!match) throw new MoneyError(`Not a valid amount: "${input}"`);
  const negative = match[1] === "-";
  const body = match[2];

  const lastSeparator = Math.max(body.lastIndexOf("."), body.lastIndexOf(","));
  let integerDigits: string;
  let fractionDigits = "";

  if (lastSeparator === -1) {
    integerDigits = body;
  } else {
    const tail = body.slice(lastSeparator + 1);
    const head = body.slice(0, lastSeparator);
    if (tail.length === 1 || tail.length === 2) {
      const decimalMark = body[lastSeparator];
      const grouped = /^[1-9]\d{0,2}([.,])\d{3}(\1\d{3})*$/.exec(head);
      if (grouped) {
        if (grouped[1] === decimalMark) {
          throw new MoneyError(`Ambiguous separators in amount: "${input}"`);
        }
      } else if (!/^\d+$/.test(head)) {
        throw new MoneyError(`Not a valid amount: "${input}"`);
      }
      integerDigits = head.replace(/[.,]/g, "");
      fractionDigits = tail;
    } else if (tail.length === 3) {
      if (!/^[1-9]\d{0,2}([.,])\d{3}(\1\d{3})*$/.test(body)) {
        throw new MoneyError(`Not a valid amount: "${input}"`);
      }
      integerDigits = body.replace(/[.,]/g, "");
    } else {
      throw new MoneyError(`Amounts cannot be more precise than one centime: "${input}"`);
    }
  }

  const value = BigInt(integerDigits) * 100n + BigInt(fractionDigits.padEnd(2, "0") || "0");
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError(`Amount is too large: "${input}"`);
  }
  return centimes(Number(negative ? -value : value));
}

export interface FormatOptions {
  /** "always" shows two decimals; "auto" hides them for whole dirhams. Default "always". */
  decimals?: "always" | "auto";
  /** Include the "MAD" currency code. Default true. */
  code?: boolean;
  /** Prefix positive amounts with "+". Default false. */
  signed?: boolean;
}

/** Format centimes as e.g. "MAD 1,500.00". Deterministic; independent of system locale. */
export function formatMAD(amount: Centimes, options: FormatOptions = {}): string {
  const { decimals = "always", code = true, signed = false } = options;
  const magnitude = Math.abs(amount);
  const whole = Math.floor(magnitude / 100);
  const fraction = magnitude % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const showDecimals = decimals === "always" || fraction !== 0;
  const number = showDecimals ? `${grouped}.${String(fraction).padStart(2, "0")}` : grouped;
  const sign = amount < 0 ? "-" : signed && amount > 0 ? "+" : "";
  return `${sign}${code ? "MAD " : ""}${number}`;
}

/** Format basis points as a percentage: 1800 -> "18%", 1234 -> "12.34%". */
export function formatBps(bps: number, options: { signed?: boolean } = {}): string {
  if (!Number.isSafeInteger(bps)) throw new MoneyError(`Basis points must be an integer: ${bps}`);
  const magnitude = Math.abs(bps);
  const whole = Math.floor(magnitude / 100);
  const fraction = magnitude % 100;
  const digits =
    fraction === 0 ? `${whole}` : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
  const sign = bps < 0 ? "-" : options.signed && bps > 0 ? "+" : "";
  return `${sign}${digits}%`;
}

/**
 * How many whole `unit`s are needed to reach `amount`, rounding up:
 * months of saving, number of installments. Null when `unit` is not positive
 * (the target is never reached).
 */
export function unitsToCover(amount: Centimes, unit: Centimes): number | null {
  if (amount <= 0) return 0;
  if (unit <= 0) return null;
  const a = BigInt(amount);
  const u = BigInt(unit);
  return Number(a / u + (a % u === 0n ? 0n : 1n));
}

/** `amount` divided by `count`, rounded up to the next centime (a required monthly saving must not fall short). */
export function divideUp(amount: Centimes, count: number): Centimes {
  if (!Number.isSafeInteger(count) || count <= 0) throw new MoneyError(`Divisor must be a positive integer: ${count}`);
  const q = BigInt(amount) / BigInt(count);
  const exact = BigInt(amount) % BigInt(count) === 0n;
  return centimes(Number(exact || amount < 0 ? q : q + 1n));
}
