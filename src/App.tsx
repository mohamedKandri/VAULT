// Placeholder until the Phase 2 application shell. It deliberately shows no
// financial figures: nothing is displayed that does not come from real data.
export default function App() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#0b0c0d",
        color: "#e6e7e8",
        fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ letterSpacing: "0.4em", fontSize: 28, fontWeight: 600 }}>VAULT</div>
        <p style={{ color: "#8a8f94", marginTop: 12 }}>
          Foundation build. The interface arrives in Phase 2.
        </p>
      </div>
    </main>
  );
}
