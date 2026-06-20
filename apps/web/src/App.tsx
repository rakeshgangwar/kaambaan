import { TaskState } from '@kanbaan/contract';

/**
 * P0 placeholder. The live board (Durable Object WebSocket + drag-and-drop) lands in P1
 * (docs/07-realtime-and-ui.md). For now we render the canonical pipeline columns straight from
 * the shared contract to prove the workspace wiring end to end.
 */
const COLUMNS = ['submitted', 'working', 'input-required', 'completed'] as const;

export function App() {
  // Touch the contract enum so the workspace dependency is exercised at build time.
  const states = TaskState.options;

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Kanbaan</h1>
      <p style={{ color: '#666' }}>
        Orchestrating external AI agents · {states.length} canonical task states
      </p>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
        {COLUMNS.map((col) => (
          <section
            key={col}
            style={{
              flex: 1,
              border: '1px solid #ddd',
              borderRadius: 8,
              padding: '0.75rem',
              minHeight: 200,
            }}
          >
            <h2 style={{ fontSize: '0.9rem', textTransform: 'capitalize' }}>{col}</h2>
          </section>
        ))}
      </div>
    </main>
  );
}
