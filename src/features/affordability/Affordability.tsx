import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DEFAULT_THRESHOLDS,
  ZERO,
  assessPurchase,
  formatMAD,
  type Affordability as Result,
  type Centimes,
  type Verdict,
} from "../../engine";
import { MoneyInput, Segmented } from "../../ui/forms";
import { Panel } from "../../ui/primitives";
import { basisText, useBaseline } from "../planning/baseline";
import "../planning/planning.css";

const VERDICTS: Record<Verdict, { title: string; icon: typeof CircleCheck }> = {
  comfortable: { title: "Comfortable", icon: CircleCheck },
  caution: { title: "Possible, but requires caution", icon: TriangleAlert },
  risky: { title: "Financially risky", icon: CircleAlert },
};
const money = (amount: Centimes, signed = false) => formatMAD(amount, { decimals: "auto", signed });
const tenths = (value: number | null) => (value === null ? "—" : `${value < 0 ? "-" : ""}${Math.floor(Math.abs(value) / 10)}.${Math.abs(value) % 10} months`);
const monthsText = (value: number | null) => (value === null ? "Never at this rate" : value === 1 ? "1 month" : `${value} months`);

export function Affordability() {
  const base = useBaseline();
  const [price, setPrice] = useState(ZERO);
  const [savings, setSavings] = useState(base.savings);
  const [income, setIncome] = useState(base.income);
  const [expenses, setExpenses] = useState(base.expenses);
  const [method, setMethod] = useState<"cash" | "installments">("cash");
  const [down, setDown] = useState(ZERO);
  const [months, setMonths] = useState(12);
  const [monthly, setMonthly] = useState(ZERO);

  const result = useMemo<Result | null>(() => {
    // Without an income figure there is nothing to judge the purchase against.
    if (price <= 0 || income <= 0) return null;
    const count = Math.min(240, Math.max(1, Math.round(months) || 1));
    return assessPurchase({
      price,
      savings,
      monthlyIncome: income,
      monthlyExpenses: expenses,
      payment: method === "cash" ? { kind: "cash" } : { kind: "installments", downPayment: down, months: count, monthlyPayment: monthly },
      goalsSaved: base.goalsSaved,
      goalsMonthly: base.goalsMonthly,
    });
  }, [price, savings, income, expenses, method, down, months, monthly, base.goalsSaved, base.goalsMonthly]);

  const t = DEFAULT_THRESHOLDS;
  return (
    <div className="plan">
      <Panel title="The purchase" className="plan__inputs">
        <div className="plan__fields">
          <MoneyInput label="Purchase price" value={price} onChange={setPrice} />
          <Segmented
            label="Payment method"
            value={method}
            onChange={setMethod}
            options={[{ value: "cash", label: "Pay in full" }, { value: "installments", label: "Installments" }]}
          />
          {method === "installments" && (
            <>
              <MoneyInput label="Down payment" value={down} onChange={setDown} />
              <MoneyInput label="Monthly payment" value={monthly} onChange={setMonthly} />
              <label className="plan__number">
                Over
                <input className="input tnum" type="number" min={1} max={240} value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Number of monthly payments" />
                months
              </label>
            </>
          )}
          <MoneyInput label="Current savings" value={savings} onChange={setSavings} />
          <MoneyInput label="Monthly income" value={income} onChange={setIncome} />
          <MoneyInput label="Monthly expenses" value={expenses} onChange={setExpenses} />
        </div>
        <p className="plan__basis">{basisText(base.monthsUsed)}</p>
      </Panel>

      <div className="plan__results">
        {result === null ? (
          <Panel title="Assessment">
            <p className="quiet">
              {price > 0
                ? "Enter your monthly income and expenses to assess this purchase."
                : "Enter a purchase price to see whether it fits your finances."}
            </p>
          </Panel>
        ) : (
          <>
            <VerdictBanner result={result} />
            <Panel title="What it does to your finances">
              <dl className="facts">
                <div><dt>Paid today</dt><dd>{money(result.paidNow)}</dd></div>
                <div><dt>Savings afterwards</dt><dd>{money(result.savingsAfter, true)}<small>{tenths(result.bufferTenths)} of expenses</small></dd></div>
                <div><dt>Equals</dt><dd>{monthsText(result.monthsOfSaving)}<small>of what you have left each month</small></dd></div>
                <div><dt>Time to rebuild savings</dt><dd>{monthsText(result.recoveryMonths)}</dd></div>
                <div><dt>Left each month afterwards</dt><dd>{money(result.surplusAfter, true)}<small>was {money(result.surplus, true)}</small></dd></div>
                {method === "installments" && (
                  <>
                    <div><dt>Total paid</dt><dd>{money(result.totalPaid)}</dd></div>
                    <div><dt>Cost of paying in installments</dt><dd>{money(result.financingCost, true)}</dd></div>
                    <div><dt>Payment as share of what is left</dt><dd>{result.burdenBps === null ? "—" : `${Math.round(result.burdenBps / 100)}%`}</dd></div>
                  </>
                )}
                <div>
                  <dt>Your goals</dt>
                  <dd>{base.activeGoals.length === 0 ? "None set" : result.compromisesGoals ? "Affected" : "Not affected"}
                    {base.activeGoals.length > 0 && <small>{money(base.goalsSaved)} set aside, {money(base.goalsMonthly)} a month</small>}
                  </dd>
                </div>
              </dl>
            </Panel>
          </>
        )}
        <Panel title="The rules behind the assessment">
          <p className="plan__note" style={{ marginTop: 0 }}>
            <b>Risky</b> if savings do not cover what is due today, if less than {t.riskyBufferMonths} month of expenses would
            remain, if expenses already use all income, or if a monthly payment exceeds {t.riskyBurdenBps / 100}% of what is
            left each month. <b>Caution</b> if less than {t.cautionBufferMonths} months of expenses would remain, if rebuilding
            savings takes more than {t.cautionRecoveryMonths} months, if a monthly payment exceeds {t.cautionBurdenBps / 100}%,
            or if your goals are affected. Otherwise <b>comfortable</b>.
          </p>
          <p className="plan__note">These are guidance categories from fixed rules, not guarantees and not financial advice.</p>
        </Panel>
      </div>
    </div>
  );
}

function VerdictBanner({ result }: { result: Result }) {
  const { title, icon: Icon } = VERDICTS[result.verdict];
  return (
    <section className={`verdict verdict--${result.verdict}`} role="status">
      <Icon className="verdict__icon" size={22} strokeWidth={1.75} aria-hidden />
      <div>
        <h2 className="verdict__title">{title}</h2>
        {result.reasons.length === 0 ? (
          <p className="verdict__none">None of the caution rules below are triggered.</p>
        ) : (
          <ul className="verdict__reasons">
            {result.reasons.map((reason) => <li key={reason.text}>{reason.text}</li>)}
          </ul>
        )}
      </div>
    </section>
  );
}
