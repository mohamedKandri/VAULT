import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Search, StickyNote } from "lucide-react";
import { useMemo, useState } from "react";
import { useLedger } from "../../data/LedgerContext";
import {
  addMonthsToYearMonth,
  formatMAD,
  monthOf,
  sub,
  sum,
  type Transaction,
  type TransactionKind,
  type YearMonth,
} from "../../engine";
import { Segmented } from "../../ui/forms";
import { dayMonth, monthLong } from "../../ui/format";
import { Money } from "../../ui/primitives";
import { queryTransactions, type SortKey, type TransactionRow } from "./filter";
import { TransactionDialog } from "./TransactionDialog";
import "./transactions.css";

export function Transactions() {
  const { ledger, today, canEdit, isDemo } = useLedger();
  const [month, setMonth] = useState<YearMonth | null>(monthOf(today));
  const [kind, setKind] = useState<TransactionKind | "all">("all");
  const [accountId, setAccountId] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [descending, setDescending] = useState(true);
  const [dialog, setDialog] = useState<{ transaction: Transaction | null } | null>(null);

  const rows = useMemo(
    () => queryTransactions(ledger, { month, kind, accountId, categoryId, search, sort, descending }),
    [ledger, month, kind, accountId, categoryId, search, sort, descending],
  );
  const income = sum(rows.filter((r) => r.kind === "income").map((r) => r.amount));
  const expenses = sum(rows.filter((r) => r.kind === "expense").map((r) => r.amount));
  const hasAccounts = ledger.accounts.some((a) => !a.archived);

  const sortBy = (key: SortKey) => {
    if (sort === key) setDescending(!descending);
    else {
      setSort(key);
      setDescending(key !== "description");
    }
  };
  const header = (key: SortKey, label: string, className = "") => (
    <th className={className} aria-sort={sort === key ? (descending ? "descending" : "ascending") : "none"}>
      <button className="tx__sort" onClick={() => sortBy(key)}>
        {label}
        {sort === key && (descending ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
      </button>
    </th>
  );

  if (!hasAccounts && ledger.transactions.length === 0) {
    return (
      <div className="tx__empty">
        <h2>Add an account first</h2>
        <p>
          Transactions belong to an account, such as your current account or savings. Create one with its opening
          balance, then start recording.
        </p>
        <a className="button button--primary" href="#/settings">Go to Settings</a>
      </div>
    );
  }

  return (
    <div className="tx">
      <div className="tx__toolbar">
        <div className="tx__month">
          <button className="icon-button" onClick={() => setMonth(addMonthsToYearMonth(month ?? monthOf(today), -1))} aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <span className="tx__month-label">{month ? monthLong(month) : "All time"}</span>
          <button className="icon-button" onClick={() => setMonth(addMonthsToYearMonth(month ?? monthOf(today), 1))} aria-label="Next month">
            <ChevronRight size={16} />
          </button>
          <button className="button button--quiet" onClick={() => setMonth(month ? null : monthOf(today))}>
            {month ? "All time" : "This month"}
          </button>
        </div>

        <Segmented
          label="Type"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "All" },
            { value: "income", label: "Income" },
            { value: "expense", label: "Expenses" },
            { value: "transfer", label: "Transfers" },
          ]}
        />

        <select className="select tx__select" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Account">
          <option value="all">All accounts</option>
          {ledger.accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select className="select tx__select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
          <option value="all">All categories</option>
          {ledger.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <label className="tx__search">
          <Search size={14} aria-hidden />
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" aria-label="Search transactions" />
        </label>

        <button
          className="button button--primary tx__add"
          onClick={() => setDialog({ transaction: null })}
          disabled={!canEdit || !hasAccounts}
          title={isDemo ? "Exit demo mode to record transactions" : undefined}
        >
          <Plus size={15} /> Add transaction
        </button>
      </div>

      <dl className="tx__totals">
        <div><dt>Income</dt><dd><Money amount={income} /></dd></div>
        <div><dt>Expenses</dt><dd><Money amount={expenses} /></dd></div>
        <div><dt>Net</dt><dd><Money amount={sub(income, expenses)} signed /></dd></div>
        <div><dt>Transactions</dt><dd className="tnum">{rows.length}</dd></div>
      </dl>

      {rows.length === 0 ? (
        <p className="tx__none">
          {ledger.transactions.length === 0 ? "No transactions recorded yet." : "No transactions match these filters."}
        </p>
      ) : (
        <div className="tx__table-wrap">
          <table className="tx__table">
            <thead>
              <tr>
                {header("date", "Date", "tx__col-date")}
                {header("description", "Description")}
                <th>Category</th>
                <th>Account</th>
                {header("amount", "Amount", "tx__col-amount")}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row key={row.id} row={row} onOpen={canEdit ? () => setDialog({ transaction: row }) : undefined} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && <TransactionDialog transaction={dialog.transaction} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Row({ row, onOpen }: { row: TransactionRow; onOpen?: () => void }) {
  return (
    <tr
      className={onOpen ? "is-clickable" : ""}
      onClick={onOpen}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <td className="tx__col-date tnum">{dayMonth(row.date)} <span className="tx__year">{row.date.slice(0, 4)}</span></td>
      <td className="tx__desc">
        <span>{row.description || <span className="quiet">No description</span>}</span>
        {row.notes && (
          <span className="tx__note" title={row.notes}>
            <StickyNote size={12} aria-label="Has notes" />
          </span>
        )}
      </td>
      <td>
        {row.categoryName}
        {row.kind === "expense" && row.isFixed && <span className="tx__fixed">Fixed</span>}
      </td>
      <td className="tx__account">
        {row.accountName}
        {row.transferAccountName && <> → {row.transferAccountName}</>}
      </td>
      <td className={`tx__col-amount tnum tx__amount--${row.kind}`} data-figure>
        {row.kind === "income" ? "+" : row.kind === "expense" ? "−" : ""}
        {formatMAD(row.amount, { code: false })}
      </td>
    </tr>
  );
}
