'use client';

import { useEffect, useRef, useState } from 'react';
import { reactionsEnabled } from '../lib/reactions.mjs';
import { useSocial } from '../lib/client/use-social';
import { ChatDrawer } from './table-chat';
import { showTestTools } from '../lib/client/environment';
import { currentSettlementWeek, settlementDate, settlementText } from '../lib/game-history.mjs';
const fmt = (n: number) => new Intl.NumberFormat('en-IN', {
  signDisplay: 'exceptZero'
}).format(n);
const unsigned = (n: number) => new Intl.NumberFormat('en-IN').format(n);
const date = (time: number) => new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'short'
}).format(time);
async function read(path: string, signal: AbortSignal) {
  const response = await fetch(path, {
    signal,
    cache: 'no-store'
  }),
    body = (await response.json()) as any;
  if (!response.ok) throw new Error(body.error || 'Could not load game history');
  return body;
}
export function GameHistory({
  refreshKey
}: {
  refreshKey: string;
}) {
  const [games, setGames] = useState<any[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [demo, setDemo] = useState(false),
    [demoAvailable, setDemoAvailable] = useState(false),
    [open, setOpen] = useState(false);
  const [viewerKey, setViewerKey] = useState<string | null>(null),
    [selected, setSelected] = useState<any>(null),
    [shareStatus, setShareStatus] = useState(''),
    [sharing, setSharing] = useState(false),
    [shareFile, setShareFile] = useState<File | null>(null);
  const [from, setFrom] = useState(() => currentSettlementWeek().from),
    [to, setTo] = useState(() => currentSettlementWeek().to),
    [result, setResult] = useState<any>(null),
    [calculating, setCalculating] = useState(false),
    [settleError, setSettleError] = useState('');
  const archiveSocial = useSocial(selected ? { ...selected, phase: 'closed', me: viewerKey, players: [] } : null, false, 'connected', reactionsEnabled(process.env.NEXT_PUBLIC_APP_ENV));
  const historyRequest = useRef<AbortController | null>(null),
    settlementRequest = useRef<AbortController | null>(null);
  async function load(next?: string) {
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        ...(showTestTools && demo && {
          demo: '1'
        }),
        ...(next && {
          cursor: next
        })
      });
      const data = await read(`/api/history?${query}`, controller.signal);
      if (controller.signal.aborted) return;
      setGames(old => next ? [...old, ...data.games] : data.games);
      setCursor(data.nextCursor);
      setDemoAvailable(showTestTools && data.demoAvailable);
      setViewerKey(data.viewerKey);
    } catch (e: any) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  function clearSettlement() {
    settlementRequest.current?.abort();
    setResult(null);
    setShareStatus('');
    setSettleError('');
    setCalculating(false);
  }
  useEffect(() => {
    setGames([]);
    setSelected(null);
    setCursor(null);
    clearSettlement();
    void load();
    return () => {
      historyRequest.current?.abort();
      settlementRequest.current?.abort();
    };
  }, [demo, refreshKey]);
  async function settle(event: React.FormEvent) {
    event.preventDefault();
    clearSettlement();
    const controller = new AbortController();
    settlementRequest.current = controller;
    setCalculating(true);
    try {
      const query = new URLSearchParams({
        from,
        to,
        ...(showTestTools && demo && {
          demo: '1'
        })
      }),
        data = await read(`/api/settlement?${query}`, controller.signal);
      if (!controller.signal.aborted) setResult(data);
    } catch (e: any) {
      if (!controller.signal.aborted) setSettleError(e.message);
    } finally {
      if (!controller.signal.aborted) setCalculating(false);
    }
  }
  useEffect(() => {
    let active = true;
    setShareFile(null);
    if (result) void settlementImage(settlementText(result)).then(file => {
      if (active) setShareFile(file);
    }).catch(() => { });
    return () => {
      active = false;
    };
  }, [result]);
  async function shareSettlement() {
    if (!result) return;
    setSharing(true);
    setShareStatus('');
    try {
      const file = shareFile || await settlementImage(settlementText(result));
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        download(file);
        setShareStatus('Settlement image saved.');
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setShareStatus('Could not share the image. Please try again.');
    } finally {
      setSharing(false);
    }
  }
  async function exportHands(format: 'csv' | 'json') {
    if (!selected?.code) return;
    setShareStatus('');
    try {
      const response = await fetch(`/api/hand-history?${new URLSearchParams({ code: selected.code, format })}`, { cache: 'no-store' });
      if (!response.ok) {
        const body: any = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not prepare hand history');
      }
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `dunzo-club-hand-history-${selected.code}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setShareStatus(e.message || 'Could not prepare hand history');
    }
  }
  return <section className="game-history" aria-label="Previous games">

    <div className="history-toolbar">
      <h2>Previous Games</h2>
      <button className="primary" onClick={() => setOpen(true)}>Settle Up</button>
    </div>

    {showTestTools && demoAvailable && <label className="demo-history-toggle"><input type="checkbox" checked={demo} onChange={e => setDemo(e.target.checked)} />Show Simulated History</label>}

    {demo && <p className="demo-notice" role="status">Simulated data only. Real games are excluded from this view and its settlement.</p>}

    {error && <div className="error" role="alert">
      {error}
      <button className="text-button" onClick={() => load()}>Retry</button>
    </div>}

    {loading && !games.length ? <p role="status">Loading game history…</p> : !games.length && !error ? <p>No completed games.</p> : games.length > 0 && <>
      <div className="history-table-scroll">
        <table>
          <caption>Win / loss in chips · Dates in India time</caption>
          <thead>
            <tr>
              <th>Game Ended</th>
              <th>Your Win / Loss</th>
            </tr>
          </thead>
          <tbody>
            {games.map(g => {
              const p = g.players.find((p: any) => p.key === viewerKey);
              return <tr key={g.code}>
                <td>
                  <button className="text-button" onClick={() => setSelected(g)} aria-label={`View everyone’s results for ${date(g.closedAt)}`}>
                    {date(g.closedAt)}
                  </button>
                </td>
                <td className={p ? p.net > 0 ? 'positive' : p.net < 0 ? 'negative' : '' : ''}>
                  {p ? fmt(p.net) : 'Did not play'}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {cursor && <button className="secondary" disabled={loading} onClick={() => load(cursor)}>
        {loading ? 'Loading…' : 'Load More'}
      </button>}
    </>}

    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="game-results-heading" onClick={e => e.stopPropagation()}>
        <button className="modal-close icon-button" aria-label="Close game results" onClick={() => setSelected(null)}>×</button>
        {reactionsEnabled(process.env.NEXT_PUBLIC_APP_ENV) && !demo && <button className="secondary" onClick={() => archiveSocial.setOpen(true)}>View Game Chat</button>}
        <h2 id="game-results-heading">Game Results{demo ? ' · Simulated' : ''}</h2>
        <p>
          {date(selected.closedAt)}
        </p>
        <div className="post-hand-actions"><button className="secondary" onClick={() => void exportHands('csv')}>Download Action Log CSV</button><button className="secondary" onClick={() => void exportHands('json')}>Download JSON</button></div>
        {shareStatus && <p role="status">{shareStatus}</p>}
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Win / Loss · chips</th>
            </tr>
          </thead>
          <tbody>
            {selected.players.map((p: any) => <tr key={p.key}>
              <td>
                {p.name}
              </td>
              <td className={p.net > 0 ? 'positive' : p.net < 0 ? 'negative' : ''}>
                {fmt(p.net)}
              </td>
            </tr>)}
          </tbody>
        </table>
      </section>
    </div>}

    {selected && archiveSocial.open && <ChatDrawer key={selected.code} room={{ ...selected, phase: 'closed' }} social={archiveSocial} myTurn={false} />}
    {open && <div className="modal-backdrop" onClick={() => {
      clearSettlement();
      setOpen(false);
    }}>
      <section className="modal wide" role="dialog" aria-modal="true" aria-labelledby="settle-heading" onClick={e => e.stopPropagation()}>
        <button className="modal-close icon-button" aria-label="Close settlement" onClick={() => {
          clearSettlement();
          setOpen(false);
        }}>×</button>
        <h2 id="settle-heading">Settle Up{demo ? ' · Simulated' : ''}</h2>
        <form onSubmit={settle}>
          <div className="field-row">
            <label>From<input type="date" value={from} max={to} required onChange={e => {
              clearSettlement();
              setFrom(e.target.value);
            }} /><small>
                {from && settlementDate(from)}
              </small></label>
            <label>To<input type="date" value={to} min={from} required onChange={e => {
              clearSettlement();
              setTo(e.target.value);
            }} /><small>
                {to && settlementDate(to)}
              </small></label>
          </div>
          <p className="settlement-note">Monday–Sunday cycle. Includes games completed on these dates in India time.</p>
          <button className="primary full" disabled={calculating}>
            {calculating ? 'Calculating…' : 'Settle Up'}
          </button>
        </form>

        {settleError && <p className="error" role="alert">
          {settleError}
        </p>}

        {result && <div className="settlement-result" role="status">
          <h3>{result.gameCount} completed {result.gameCount === 1 ? 'game' : 'games'}</h3>
          {result.gameCount > 0 && <>
            <div className="settlement-totals">
              <h3>Player Win / Loss Totals</h3>
              <div className="history-table-scroll">
                <table>
                  <caption>Totals in chips</caption>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Games</th>
                      <th>Win / Loss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.totals.map((p: any) => <tr key={p.key}>
                      <td>
                        {p.name}
                      </td>
                      <td>
                        {p.games}
                      </td>
                      <td className={p.net > 0 ? 'positive' : p.net < 0 ? 'negative' : ''}>
                        {fmt(p.net)}
                      </td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </div>
            <h3>Suggested Payments</h3>
            {result.payments.length ? result.payments.map((p: any, i: number) => <div className="payment" key={i}>
              <span><strong>
                {p.fromName}
              </strong> → <strong>
                  {p.toName}
                </strong></span>
              <b>Rs.{unsigned(p.amount)}</b>
            </div>) : <p>Nothing to settle.</p>}
            <button className="secondary share-settlement" disabled={sharing} onClick={shareSettlement}>
              {sharing ? 'Preparing…' : 'Share Settlement'}
            </button>
            <p role="status">
              {shareStatus}
            </p>
          </>}
        </div>}

      </section>
    </div>}

  </section>;
}
async function settlementImage(text: string) {
  const lines = text.split('\n'),
    canvas = document.createElement('canvas');
  canvas.width = 1200;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image unavailable');
  ctx.font = '28px sans-serif';
  const wrapped: string[] = [];
  for (const line of lines) {
    let row = '';
    for (const word of line.split(' ')) {
      if (ctx.measureText(`${row} ${word}`).width > 1080 && row) {
        wrapped.push(row);
        row = word;
      } else row = row ? `${row} ${word}` : word;
    }
    wrapped.push(row);
  }
  canvas.height = 100 + wrapped.length * 46;
  ctx.fillStyle = '#192622';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '28px sans-serif';
  wrapped.forEach((line, i) => {
    ctx.fillStyle = i === 0 ? '#d9bb82' : '#eeeae1';
    ctx.fillText(line, 60, 65 + i * 46);
  });
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Image unavailable')), 'image/png'));
  return new File([blob], 'dunzo-club-settlement.png', {
    type: 'image/png'
  });
}
function download(file: File) {
  const url = URL.createObjectURL(file),
    a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
