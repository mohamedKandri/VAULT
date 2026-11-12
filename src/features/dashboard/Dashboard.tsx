import { CalendarClock, Gauge, Target } from "lucide-react";
import { useMemo } from "react";
import { useLedger } from "../../data/LedgerContext";
import { formatBps, formatMAD, ratioBps, type Centimes } from "../../engine";
import { MonthChart, type ChartMonth } from "../../ui/charts/MonthChart";
import { dayMonth, monthLong, monthShort } from "../../ui/format";
import { Delta, LegendKey, Money, Panel, Sparkline } from "../../ui/primitives";
import { UPCOMING_DAYS, buildDashboard, delta, type DashboardModel } from "./model";
import "./dashboard.css";

export function Dashboard() {
  const { ledger, today, setDemo } = useLedger();
  const model = useMemo(() => buildDashboard(ledger, today), [ledger, today]);

  if (!model.hasData) return <NoRecords onDemo={() => setDemo(true)} />;

  const months: ChartMonth[] = model.months.map((m) => ({
    key: m.month,
    label: monthShort(m.month),
    title: monthLong(m.month),
    partial: m.partial,
  }));
  const samePeriod = `vs 1–${dayMonth(model.samePeriodEnd)}`;
  const lastMonthEnd = `since end of ${monthShort(model.months.at(-2)?.month ?? model.month)}`;

  return (
    <div className="dash">
      <Position model={model} versus={lastMonthEnd} />

      <div className="dash__tiles">
        <StatTile
          label="Income"
          caption={`${monthLong(model.month)}, to date`}
          amount={model.current.income}
          trend={model.months.map((m) => m.income)}
          delta={<Delta amount={delta(model.current.income, model.samePeriodLastMonth?.income)} goodWhen="up" versus={samePeriod} />}
        />
        <StatTile
          label="Expenses"
          caption={`${monthLong(model.month)}, to date`}
          amount={model.current.expenses}
          trend={model.months.map((m) => m.expenses)}
          delta={<Delta amount={delta(model.current.expenses, model.samePeriodLastMonth?.expenses)} goodWhen="down" versus={samePeriod} />}
        />
        <StatTile
          label="Savings rate"
          caption="Net ÷ income, month to date"
          text={model.current.savingsRateBps === null ? null : formatBps(model.current.savingsRateBps)}
          trend={model.months.map((m) => m.savingsRateBps)}
          delta={
            <Delta
              bps={
                model.current.savingsRateBps !== null && model.samePeriodLastMonth?.savingsRateBps != null
                  ? model.current.savingsRateBps - model.samePeriodLastMonth.savingsRateBps
                  : null
              }
              unit="points"
              goodWhen="up"
              versus={samePeriod}
            />
          }
        />
        <StatTile
          label="Total savings"
          caption="Savings accounts"
          amount={model.position?.savings ?? null}
          trend={model.months.map((m) => m.position?.savings ?? null)}
          delta={<Delta amount={delta(model.position?.savings, model.previousPosition?.savings)} goodWhen="up" versus={lastMonthEnd} />}
        />
      </div>

      <Panel
        title="Income versus expenses"
        className="dash__wide"
        aside={
          <>
            <LegendKey color="var(--series-accent)" label="Income" />
            <LegendKey color="var(--series-2)" label="Expenses" />
          </>
        }
      >
        <MonthChart
          kind="columns"
          label="Income and expenses per month"
          months={months}
          series={[
            { name: "Income", color: "var(--series-accent)", values: model.months.map((m) => m.income) },
            { name: "Expenses", color: "var(--series-2)", values: model.months.map((m) => m.expenses) },
          ]}
        />
      </Panel>

      <Spending model={model} versus={samePeriod} />

      <Panel
        title="Monthly cash flow"
        className="dash__half"
        aside={<span>Income minus expenses</span>}
      >
        <MonthChart
          kind="signed"
          label="Net cash flow per month"
          months={months}
          series={[{ name: "Net cash flow", color: "var(--positive)", values: model.months.map((m) => m.net) }]}
        />
      </Panel>

      <Panel
        title="Savings evolution"
        className="dash__half"
        aside={
          <>
            <LegendKey color="var(--series-accent)" label="Savings" shape="line" />
            <LegendKey color="var(--series-2)" label="Available" shape="line" />
          </>
        }
      >
        <MonthChart
          kind="lines"
          label="Savings and available balance at each month end"
          months={months}
          series={[
            { name: "Savings", color: "var(--series-accent)", values: model.months.map((m) => m.position?.savings ?? null) },
            { name: "Available", color: "var(--series-2)", values: model.months.map((m) => m.position?.available ?? null) },
          ]}
        />
      </Panel>

      <Upcoming model={model} />

      <Panel title="Financial goals" className="dash__third" pending>
        <Pending icon={<Target size={18} strokeWidth={1.5} />} phase={4}>
          No goals yet. Purchase goals with their full cost of ownership will appear here, with progress and estimated dates.
        </Pending>
      </Panel>

      <Panel title="Spending limit and financial health" className="dash__third" pending>
        <Pending icon={<Gauge size={18} strokeWidth={1.5} />} phase={3}>
          Not calculated yet. The safe-to-spend figure needs your savings target and planned expenses, which are recorded in the next phase.
        </Pending>
      </Panel>
    </div>
  );
}

function Position({ model, versus }: { model: DashboardModel; versus: string }) {
  const position = model.position;
  const savingsShare = position ? ratioBps(position.savings, position.netWorth) : null;
  const showSplit = position !== null && savingsShare !== null && position.available >= 0 && position.savings >= 0;
  return (
    <section className="position">
      <div className="position__label">Available balance</div>
      <Money amount={position?.available ?? null} size="hero" />
      <div className="position__delta">
        <Delta amount={delta(position?.available, model.previousPosition?.available)} goodWhen="up" versus={versus} />
      </div>

      <div className="position__split">
        {showSplit && (
          <div
            className="splitbar"
            role="img"
            aria-label={`Net worth: ${formatBps(10_000 - savingsShare)} available, ${formatBps(savingsShare)} savings`}
          >
            <span style={{ flexGrow: 10_000 - savingsShare, background: "var(--series-2)" }} />
            <span style={{ flexGrow: savingsShare, background: "var(--series-accent)" }} />
          </div>
        )}
        <dl className="position__facts">
          <div>
            <dt><LegendKey color="var(--series-2)" label="Available" /></dt>
            <dd><Money amount={position?.available ?? null} /></dd>
          </div>
          <div>
            <dt><LegendKey color="var(--series-accent)" label="Savings" /></dt>
            <dd><Money amount={position?.savings ?? null} /></dd>
          </div>
          <div>
            <dt>Net worth</dt>
            <dd><Money amount={position?.netWorth ?? null} /></dd>
          </div>
        </dl>
      </div>
      <p className="position__note">
        Calculated from opening balances and recorded transactions. VAULT has no connection to your bank.
      </p>
    </section>
  );
}

function StatTile(props: {
  label: string;
  caption: string;
  amount?: Centimes | null;
  text?: string | null;
  trend: (number | null)[];
  delta: React.ReactNode;
}) {
  return (
    <section className="tile">
      <div className="tile__head">
        <div>
          <h2 className="tile__label">{props.label}</h2>
          <p className="tile__caption">{props.caption}</p>
        </div>
        <Sparkline values={props.trend} label={`${props.label}, last ${props.trend.length} months`} />
      </div>
      <div className="tile__value">
        {props.text !== undefined ? (
          <span className="money money--figure" data-figure>{props.text ?? "—"}</span>
        ) : (
          <Money amount={props.amount ?? null} size="figure" />
        )}
      </div>
      {props.delta}
    </section>
  );
}

function Spending({ model, versus }: { model: DashboardModel; versus: string }) {
  const largest = model.categories[0]?.total ?? 0;
  return (
    <Panel title="Spending distribution" className="dash__narrow" aside={<span>{monthShort(model.month)}, to date</span>}>
      {model.categories.length === 0 ? (
        <p className="quiet">No expenses recorded this month.</p>
      ) : (
        <>
          <ul className="rank">
            {model.categories.map((c) => (
              <li className="rank__row" key={c.id} title={c.changeBps === null ? undefined : `${formatBps(c.changeBps, { signed: true })} ${versus}`}>
                <span className="rank__name">{c.name}</span>
                <span className="rank__amount tnum" data-figure>{formatMAD(c.total, { code: false, decimals: "auto" })}</span>
                <span className="rank__share tnum">{formatBps(Math.round(c.shareBps / 100) * 100)}</span>
                <span className="rank__track">
                  <span className="rank__bar" style={{ width: `${largest > 0 ? (c.total / largest) * 100 : 0}%` }} />
                </span>
              </li>
            ))}
          </ul>
          <div className="rank__foot">
            <span>Fixed <b className="tnum">{formatMAD(model.current.fixedExpenses, { decimals: "auto" })}</b></span>
            <span>Variable <b className="tnum">{formatMAD(model.current.variableExpenses, { decimals: "auto" })}</b></span>
          </div>
        </>
      )}
    </Panel>
  );
}

function Upcoming({ model }: { model: DashboardModel }) {
  return (
    <Panel title="Upcoming" className="dash__third" aside={<span>Next {UPCOMING_DAYS} days</span>}>
      {model.upcoming.length === 0 ? (
        <Pending icon={<CalendarClock size={18} strokeWidth={1.5} />}>No scheduled items in the next {UPCOMING_DAYS} days.</Pending>
      ) : (
        <>
          <ul className="upcoming">
            {model.upcoming.map((item) => (
              <li className="upcoming__row" key={`${item.scheduleId}-${item.date}`}>
                <span className="upcoming__date tnum">{dayMonth(item.date)}</span>
                <span className="upcoming__what">{item.description}</span>
                <span className={`upcoming__amount tnum upcoming__amount--${item.kind}`} data-figure>
                  {item.kind === "income" ? "+" : item.kind === "transfer" ? "→ " : ""}
                  {formatMAD(item.amount, { code: false, decimals: "auto" })}
                </span>
              </li>
            ))}
          </ul>
          <div className="rank__foot">
            <span>Scheduled expenses <b className="tnum">{formatMAD(model.upcomingExpenseTotal, { decimals: "auto" })}</b></span>
            <span>→ to savings</span>
          </div>
        </>
      )}
    </Panel>
  );
}

function Pending(props: { icon: React.ReactNode; phase?: number; children: React.ReactNode }) {
  return (
    <div className="pending">
      <span className="pending__icon" aria-hidden>{props.icon}</span>
      <p>{props.children}</p>
      {props.phase && <span className="pending__phase">Planned for phase {props.phase}</span>}
    </div>
  );
}

function NoRecords({ onDemo }: { onDemo: () => void }) {
  return (
    <div className="norecords">
      <div className="norecords__card">
        <div className="position__label">Available balance</div>
        <Money amount={null} size="hero" />
        <h2 className="norecords__title">No records yet</h2>
        <p className="norecords__body">
          Every figure in VAULT is calculated from what you record, so there is nothing to show until you add accounts
          and transactions. Recording and encrypted storage arrive in the next phase.
        </p>
        <p className="norecords__body">
          Until then you can explore the interface with fictional sample data. It is clearly marked, kept in memory only,
          and never mixed with real records.
        </p>
        <button className="button button--primary" onClick={onDemo}>
          Explore with demo data
        </button>
      </div>
    </div>
  );
}
