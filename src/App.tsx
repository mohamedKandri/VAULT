import { LockScreen } from "./app/LockScreen";
import { ROUTES, useRoute } from "./app/routes";
import { Shell } from "./app/Shell";
import { LedgerProvider, useLedger } from "./data/LedgerContext";
import { Affordability } from "./features/affordability/Affordability";
import { Assistant } from "./features/assistant/Assistant";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Forecast } from "./features/forecast/Forecast";
import { Goals } from "./features/goals/Goals";
import { Planned } from "./features/Planned";
import { Settings } from "./features/settings/Settings";
import { Simulator } from "./features/simulator/Simulator";
import { Transactions } from "./features/transactions/Transactions";

function Screen() {
  const { status } = useLedger();
  const [route, navigate] = useRoute();
  const active = ROUTES.find((r) => r.id === route)!;

  if (status === "loading") return null;
  // Nothing of the app is rendered until the vault is unlocked.
  if (status === "setup" || status === "locked") return <LockScreen mode={status} />;

  return (
    <Shell route={route} onNavigate={navigate}>
      {route === "command-center" ? (
        <Dashboard />
      ) : route === "transactions" ? (
        <Transactions />
      ) : route === "settings" ? (
        <Settings />
      ) : route === "simulator" ? (
        <Simulator />
      ) : route === "goals" ? (
        <Goals />
      ) : route === "affordability" ? (
        <Affordability />
      ) : route === "forecast" ? (
        <Forecast />
      ) : route === "assistant" ? (
        <Assistant />
      ) : (
        <Planned route={active} />
      )}
    </Shell>
  );
}

export default function App() {
  return (
    <LedgerProvider>
      <Screen />
    </LedgerProvider>
  );
}
