import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  createBoard,
  getBoard,
  createCard,
  moveCard,
  openBoardSocket,
  DEFAULT_STAGES,
  type BoardSnapshot,
} from './api';

const BOARD_KEY = 'kaambaan.boardId';

export function App() {
  const [board, setBoard] = useState<BoardSnapshot | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const boardId = useRef<string | null>(null);

  async function refresh(): Promise<void> {
    if (!boardId.current) return;
    try {
      setBoard(await getBoard(boardId.current));
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    let socket: WebSocket | undefined;
    void (async () => {
      try {
        let id = localStorage.getItem(BOARD_KEY);
        if (id) {
          try {
            await getBoard(id);
          } catch {
            id = null; // stale id — recreate
          }
        }
        if (!id) {
          id = await createBoard('My Board', DEFAULT_STAGES);
          localStorage.setItem(BOARD_KEY, id);
        }
        boardId.current = id;
        await refresh();
        socket = openBoardSocket(id, refresh);
        socket.addEventListener('open', () => setConnected(true));
        socket.addEventListener('close', () => setConnected(false));
      } catch (e) {
        setError(String(e));
      }
    })();
    return () => socket?.close();
  }, []);

  async function onAdd(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!boardId.current || title.trim() === '') return;
    try {
      await createCard(boardId.current, title.trim());
      setTitle('');
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function onDropCard(stageKey: string, cardId: string): Promise<void> {
    if (!boardId.current) return;
    const res = await moveCard(boardId.current, cardId, stageKey);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? `Move failed (${res.status})`);
    } else {
      setError(null);
    }
    await refresh();
  }

  if (!board) {
    return (
      <main className="app">
        <h1 className="brand">Kaambaan</h1>
        <p className="muted">{error ?? 'Loading board…'}</p>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <h1 className="brand">
          Kaambaan <span className="muted">/ {board.name}</span>
        </h1>
        <span className={`dot ${connected ? 'live' : 'off'}`}>{connected ? 'live' : 'offline'}</span>
      </header>

      <form className="composer" onSubmit={onAdd}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New card title…"
          aria-label="New card title"
        />
        <button type="submit">Add card</button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="board">
        {board.stages.map((stage) => {
          const cards = board.cards.filter((c) => c.currentStageKey === stage.key);
          const overLimit = stage.wipLimit !== undefined && cards.length >= stage.wipLimit;
          return (
            <section
              key={stage.key}
              className="column"
              onDragOver={(e: DragEvent<HTMLElement>) => e.preventDefault()}
              onDrop={(e: DragEvent<HTMLElement>) => {
                e.preventDefault();
                const cardId = e.dataTransfer.getData('text/plain');
                if (cardId) void onDropCard(stage.key, cardId);
              }}
            >
              <div className="column-head">
                <span className="column-name">{stage.name}</span>
                <span className={`count ${overLimit ? 'full' : ''}`}>
                  {cards.length}
                  {stage.wipLimit !== undefined ? ` / ${stage.wipLimit}` : ''}
                </span>
                {stage.gate === 'approval' && <span className="gate">⛳</span>}
              </div>
              <div className="cards">
                {cards.map((card) => (
                  <article
                    key={card.id}
                    className="card"
                    draggable
                    onDragStart={(e: DragEvent<HTMLElement>) => e.dataTransfer.setData('text/plain', card.id)}
                  >
                    <div className="card-title">{card.title}</div>
                    <div className="card-meta">{card.ownerUserId}</div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
