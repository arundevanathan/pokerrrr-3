'use client';

import { useState, type FormEvent } from 'react';
type Player = {
  id: string;
  name: string;
};
export function PlayerLobby({
  player,
  players,
  activeGame,
  loading,
  busy,
  error,
  onLogin,
  onOpen,
  onPractice,
  onRetry,
  hasPending
}: {
  player: Player | null;
  players: Player[];
  activeGame: any;
  loading: boolean;
  busy: boolean;
  error: string;
  onLogin: (id: string, pin: string) => Promise<void>;
  onOpen: (settings: any) => Promise<void>;
  onPractice?: () => void;
  onRetry: () => void;
  hasPending: boolean;
}) {
  const [simulate, setSimulate] = useState(false),
    [opponents, setOpponents] = useState(5),
    [selected, setSelected] = useState(''),
    [pin, setPin] = useState(''),
    [bb, setBb] = useState(50),
    [rotation, setRotation] = useState(3),
    [timer, setTimer] = useState(15),
    [games, setGames] = useState(['NLH', 'PLO4', 'PLO5']);
  async function login(event: FormEvent) {
    event.preventDefault();
    const entered = pin;
    setPin('');
    await onLogin(selected, entered);
  }
  return <section className="setup">

    {loading ? <p role="status">Loading your table…</p> : !player ? <>

      <h2>Sign in</h2>

      <form onSubmit={login}>

        <label>Your name<select required value={selected} onChange={e => setSelected(e.target.value)}>
          <option value="">Select your name</option>
          {players.map(p => <option key={p.id} value={p.id}>
            {p.name}
          </option>)}
        </select></label>

        <label>4-digit PIN<input type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="current-password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} required /></label>

        <button className="primary full" disabled={busy || !players.length}>Sign in</button>

      </form>
      {!players.length && <p>No players have been added yet. Ask the owner to add your player record.</p>}

    </> : <>

      <h2>
        {activeGame ? 'A game is running right now' : simulate && onPractice ? 'Start Simulation' : 'Start Game'}
      </h2>

      {activeGame ? <p>{activeGame.players.map((p: any) => p.name).join(' · ') || 'Waiting for players'}<br />{activeGame.settings.sb} / {activeGame.settings.bb} blinds</p> : null}

      <form onSubmit={async e => {
        e.preventDefault();
        await onOpen({
          bb,
          rotation,
          timer,
          games,
          ...(onPractice && simulate ? {simulate:true, opponents} : {})
        });
      }}>

        {!activeGame && <>
          <fieldset className="game-options">
            <legend>Games</legend>
            {['NLH', 'PLO4', 'PLO5'].map(game => <label key={game}>
              <input type="checkbox" checked={games.includes(game)} onChange={e => setGames(old => e.target.checked ? [...old, game] : old.filter(g => g !== game))} />
              {game}
            </label>)}
          </fieldset>

          {onPractice && <><label className="simulation-choice"><input type="checkbox" checked={simulate} onChange={e=>setSimulate(e.target.checked)} /> Simulate players</label>{simulate && <label>Simulated opponents<select value={opponents} onChange={e=>setOpponents(Number(e.target.value))}>{[1,2,3,4,5,6,7].map(n=><option key={n} value={n}>{n} opponents · {n+1} total players</option>)}</select></label>}</>}
          <label>Big Blind<input type="number" min={2} max={100000} step={2} value={bb} onChange={e => setBb(Number(e.target.value))} required /><small>Small Blind: {bb > 0 ? bb / 2 : 0}</small></label>

          <label>Time to act<select value={timer} onChange={e => setTimer(Number(e.target.value))}>
            {[10, 15, 20, 30].map(n => <option key={n} value={n}>{n} seconds</option>)}
          </select></label>

          <label>Switch game every<select value={rotation} onChange={e => setRotation(Number(e.target.value))}>
            {[2, 3, 4].map(n => <option key={n} value={n}>{n} completed hands</option>)}
          </select></label>
        </>}

        <button className="primary full" disabled={busy || !activeGame && games.length === 0}>
          {busy ? 'Opening…' : activeGame ? 'Join Now' : simulate && onPractice ? 'Start Simulation' : 'Start Game'}
        </button>

      </form>

    </>}

    {error && <div className="error" role="alert">
      {error}
      {hasPending && <button type="button" onClick={onRetry}>Retry last action</button>}
    </div>}

    {onPractice && <div className="practice-row">
      <button onClick={onPractice}>Test UI</button>
    </div>}

  </section>;
}
export function PinSettings({
  onChange,
  busy,
  error
}: {
  onChange: (oldPin: string, newPin: string) => Promise<void>;
  busy: boolean;
  error: string;
}) {
  const [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [confirm, setConfirm] = useState(''),
    [localError, setLocalError] = useState('');
  return <>
    <h2>Change your PIN.</h2>
    <p>Use four digits. Your other devices will need to sign in again.</p>
    <form onSubmit={async e => {
      e.preventDefault();
      if (next !== confirm) {
        setLocalError('The new PINs do not match');
        return;
      }
      setLocalError('');
      const old = current,
        fresh = next;
      setCurrent('');
      setNext('');
      setConfirm('');
      await onChange(old, fresh);
    }}>

      {[['Current PIN', current, setCurrent], ['New PIN', next, setNext], ['Confirm new PIN', confirm, setConfirm]].map(([label, value, setter]: any) => <label key={label}>
        {label}
        <input type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} minLength={4} autoComplete={label === 'Current PIN' ? 'current-password' : 'new-password'} value={value} onChange={e => setter(e.target.value.replace(/\D/g, ''))} required />
      </label>)}

      {(localError || error) && <p className="error" role="alert">
        {localError || error}
      </p>}
      <button className="primary full" disabled={busy}>Update PIN</button>

    </form>
  </>;
}
