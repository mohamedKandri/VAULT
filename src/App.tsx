import { ROUTES, useRoute } from "./app/routes";
import { Shell } from "./app/Shell";
import { LedgerProvider } from "./data/LedgerContext";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Planned } from "./features/Planned";

export default function App() {
  const [route, navigate] = useRoute();
  const active = ROUTES.find((r) => r.id === route)!;
  return (
    <LedgerProvider>
      <Shell route={route} onNavigate={navigate}>
        {route === "command-center" ? <Dashboard /> : <Planned route={active} />}
      </Shell>
    </LedgerProvider>
  );
}
