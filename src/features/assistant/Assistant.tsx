import { ArrowUp, Cpu, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, hasBackend } from "../../data/api";
import { useLedger } from "../../data/LedgerContext";
import { Field, Segmented, useSubmit } from "../../ui/forms";
import { Panel, Tag } from "../../ui/primitives";
import { answerBuiltIn, type Answer } from "./builtin";
import { askModel } from "./model";
import { unverifiedFigures } from "./tools";
import "./assistant.css";

interface Turn {
  id: number;
  question: string;
  answer: Answer | null;
  source: string;
  error?: string;
}

interface AiStatus {
  settings: { enabled: boolean; model: string; endpoint: string };
  installedModels: string[] | null;
}

const EXAMPLES = [
  "How much did I spend this month?",
  "What are my biggest expenses?",
  "How much can I safely spend?",
  "Compare my spending over the last three months",
  "What happens if I save MAD 1,500 every month?",
  "Which goal should I prioritize?",
];

export function Assistant() {
  const { ledger, today, status, isDemo } = useLedger();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"builtin" | "model">("builtin");
  const [ai, setAi] = useState<AiStatus | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const canUseModel = hasBackend && status === "ready" && !isDemo;

  const refreshAi = async () => {
    if (canUseModel) setAi(await api.aiStatus());
  };
  useEffect(() => {
    refreshAi().catch(() => setAi(null));
  }, [canUseModel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  const modelOn = canUseModel && !!ai?.settings.enabled;
  const useModel = mode === "model" && modelOn;

  const ask = async (text: string) => {
    const asked = text.trim();
    if (!asked || busy) return;
    const id = Date.now();
    const source = useModel ? `Local model · ${ai!.settings.model}` : "Built-in answer";
    setQuestion("");
    setBusy(true);
    setTurns((t) => [...t, { id, question: asked, answer: null, source }]);
    try {
      const context = { ledger, today };
      const answer = useModel ? await askModel(asked, context, api.aiChat) : answerBuiltIn(asked, context);
      setTurns((t) => t.map((turn) => (turn.id === id ? { ...turn, answer } : turn)));
    } catch (e) {
      setTurns((t) => t.map((turn) => (turn.id === id ? { ...turn, error: e instanceof Error ? e.message : String(e) } : turn)));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(question);
  };

  return (
    <div className="assistant">
      <section className="assistant__chat">
        <div className="assistant__turns">
          {turns.length === 0 && (
            <div className="assistant__intro">
              <h2>Ask about your records</h2>
              <p>
                Every figure in an answer comes from a calculation on your data, and each answer shows the calculations
                behind it. It explains and suggests; it is not financial advice.
              </p>
              <div className="assistant__examples">
                {EXAMPLES.map((example) => (
                  <button key={example} className="button button--quiet" onClick={() => ask(example)}>{example}</button>
                ))}
              </div>
            </div>
          )}
          {turns.map((turn) => <TurnView key={turn.id} turn={turn} />)}
          <div ref={end} />
        </div>

        <form className="assistant__form" onSubmit={submit}>
          {modelOn && (
            <Segmented
              label="Answer with"
              value={mode}
              onChange={setMode}
              options={[{ value: "builtin", label: "Built-in" }, { value: "model", label: "Local model" }]}
            />
          )}
          <input
            className="input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about your finances"
            aria-label="Your question"
            maxLength={500}
            disabled={busy}
          />
          <button className="button button--primary" disabled={busy || !question.trim()} aria-label="Ask">
            <ArrowUp size={16} />
          </button>
        </form>
      </section>

      <aside className="assistant__side">
        <Panel title="How answers are produced">
          <p className="assistant__text">
            <b>Built-in answers</b> recognise common questions and run the matching calculations. No AI, nothing to
            install, nothing leaves this computer. They understand less than a language model would.
          </p>
        </Panel>
        {canUseModel ? <LocalModel ai={ai} onChange={refreshAi} /> : (
          <Panel title="Local language model">
            <p className="assistant__text">
              {isDemo ? "Unavailable in demo mode." : "Available in the desktop application once a vault is unlocked."}
            </p>
          </Panel>
        )}
      </aside>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const flagged = turn.answer ? unverifiedFigures(turn.answer.text, turn.answer.calls) : [];
  return (
    <article className="turn">
      <p className="turn__question">{turn.question}</p>
      {turn.error ? (
        <p className="form-error" role="alert">{turn.error}</p>
      ) : !turn.answer ? (
        <p className="turn__waiting">Working…</p>
      ) : (
        <div className="turn__answer">
          <p className="turn__text selectable">{turn.answer.text}</p>
          {flagged.length > 0 && (
            <p className="turn__flag" role="note">
              <TriangleAlert size={14} aria-hidden />
              <span>
                {flagged.join(", ")} {flagged.length === 1 ? "does" : "do"} not appear in any calculation below. Treat
                {flagged.length === 1 ? " it" : " them"} as unverified.
              </span>
            </p>
          )}
          <div className="turn__meta">
            <Tag>{turn.source}</Tag>
            {turn.answer.calls.length > 0 && (
              <details>
                <summary>How this was calculated ({turn.answer.calls.length})</summary>
                {turn.answer.calls.map((call, index) => (
                  <div className="turn__call" key={index}>
                    <div className="turn__call-name">
                      {call.name}
                      {Object.keys(call.args).length > 0 && <span> {JSON.stringify(call.args)}</span>}
                    </div>
                    <pre className="selectable">{JSON.stringify(call.result, null, 2)}</pre>
                  </div>
                ))}
              </details>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function LocalModel({ ai, onChange }: { ai: AiStatus | null; onChange: () => Promise<void> }) {
  const [model, setModel] = useState(ai?.settings.model ?? "llama3.1");
  const [log, setLog] = useState<{ at: string; model: string; destination: string; bytesSent: number; ok: boolean }[] | null>(null);
  useEffect(() => {
    if (ai) setModel(ai.settings.model);
  }, [ai?.settings.model]); // eslint-disable-line react-hooks/exhaustive-deps
  const enabled = !!ai?.settings.enabled;

  const toggle = useSubmit(async () => {
    await api.aiConfigure(!enabled, model);
    await onChange();
  });

  return (
    <Panel title="Local language model" aside={<Tag tone={enabled ? "positive" : "neutral"}>{enabled ? "On" : "Off"}</Tag>}>
      <p className="assistant__text">
        Optional. Understands freer wording by using a model that runs <b>on this computer</b> through Ollama. When on,
        your question and the results of the calculations it asks for are sent to {ai?.settings.endpoint ?? "127.0.0.1"} —
        an address on this machine only. Your transaction list is never sent, and nothing goes over the internet.
      </p>
      <form className="assistant__model" onSubmit={toggle.submit}>
        <Field label="Model name" hint="A model you have installed with Ollama, with tool support.">
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} disabled={enabled} maxLength={80} />
        </Field>
        <button className={`button ${enabled ? "button--plain" : "button--primary"}`} disabled={toggle.busy}>
          <Cpu size={14} /> {enabled ? "Turn off" : "Turn on"}
        </button>
      </form>
      {toggle.error && <p className="form-error" role="alert">{toggle.error}</p>}
      {enabled && (
        <p className="assistant__text" role="status">
          {ai?.installedModels === null
            ? "No Ollama server is answering on this computer. Start Ollama, or keep using the built-in answers."
            : ai?.installedModels.some((m) => m === model || m.startsWith(`${model}:`))
              ? "The model is installed and ready."
              : `Ollama is running but "${model}" is not installed. Installed: ${ai?.installedModels?.join(", ") || "none"}.`}
        </p>
      )}
      <button className="budget__toggle" onClick={async () => setLog(log ? null : await api.aiLog())}>
        {log ? "Hide the request log" : "Show the request log"}
      </button>
      {log && (
        <ul className="assistant__log">
          {log.length === 0 && <li>No request has ever been sent.</li>}
          {log.map((entry, index) => (
            <li key={index} className="tnum">
              {entry.at.replace("T", " ").replace("Z", " UTC")} · {entry.model} · {entry.destination} · {entry.bytesSent.toLocaleString("en-US")} bytes · {entry.ok ? "ok" : "failed"}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
