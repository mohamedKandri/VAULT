import { LockScreen } from "./app/LockScreen";
import { ROUTES, useRoute } from "./app/routes";
import { Shell } from "./app/Shell";
import { LedgerProvider, useLedger } from "./data/LedgerContext";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Planned } from "./features/Planned";
import { Settings } from "./features/settings/Settings";
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
