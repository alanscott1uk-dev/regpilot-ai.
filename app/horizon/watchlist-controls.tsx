'use client';
import {useEffect, useRef, useState} from 'react';
import {workspaceHref} from '../../lib/client/workspace-context';
import {emptyHorizonView, MAX_WATCHLISTS, sameHorizonFilters, watchlistFilters, type HorizonFilters, type HorizonWatch, type WatchlistMutation} from '../../lib/horizon/watchlists';
import ui from './horizon.module.css';

type Props = {
  organizationId: string;
  watches: HorizonWatch[];
  filters: HorizonFilters;
  canManage: boolean;
  selected: HorizonWatch|null;
  setSelected: (watch: HorizonWatch|null) => void;
  apply: (filters: HorizonFilters) => void;
  save: (mutation: WatchlistMutation) => Promise<HorizonWatch>;
  reload: () => Promise<HorizonWatch[]>;
};

export function WatchlistControls({organizationId, watches, filters, canManage, selected, setSelected, apply, save, reload}: Props) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const creatingId = useRef<string|null>(null);
  const running = useRef(false);
  const mounted = useRef(false);
  const parsedFilters = watchlistFilters.safeParse(filters);
  const unsavedFilters = selected && (!parsedFilters.success ||
    !sameHorizonFilters(parsedFilters.data, selected.filters));
  const limitReached = !selected && watches.length >= MAX_WATCHLISTS;

  function choose(watch: HorizonWatch|null, resetFilters=true) {
    const url = new URL(window.location.href);
    if (url.searchParams.get('organizationId') === organizationId) {
      if (watch) url.searchParams.set('watchlistId',watch.id);
      else url.searchParams.delete('watchlistId');
      window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
    }
    setSelected(watch);
    setName(watch?.name ?? '');
    creatingId.current = null;
    setConfirmArchive(false);
    setError('');
    setMessage('');
    if (watch) apply(watch.filters);
    else if (resetFilters) apply(emptyHorizonView);
  }

  useEffect(() => {
    mounted.current = true;
    const params = new URLSearchParams(window.location.search);
    const linked = params.getAll('watchlistId');
    if (linked.length) {
      const watch = linked.length === 1 && params.getAll('organizationId').length === 1 &&
        params.get('organizationId') === organizationId && watches.find(row => row.id === linked[0]);
      if (watch) choose(watch);
      else setError('The linked watchlist is unavailable in this workspace.');
    }
    return () => { mounted.current = false; };
  }, []);

  async function write(archive=false) {
    if (running.current || !canManage || (archive && !selected)) return;
    running.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      creatingId.current ??= crypto.randomUUID();
      const mutation: WatchlistMutation = archive && selected
        ? {action:'archive',id:selected.id,version:selected.version}
        : {action:'save',id:selected?.id ?? creatingId.current,version:selected?.version ?? 0,name,filters};
      const saved = await save(mutation);
      if (!mounted.current) return;
      choose(saved.archived ? null : saved);
      setMessage(saved.archived ? 'Watchlist archived.' : 'Shared watchlist saved.');
    } catch (problem) {
      if (mounted.current) setError(problem instanceof Error ? problem.message : 'Refresh the watchlists to check the saved result.');
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function refresh() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const rows = await reload();
      if (!mounted.current) return;
      const id = selected?.id ?? creatingId.current;
      choose(rows.find(row => row.id === id) ?? null, Boolean(id));
      setMessage('Workspace watchlists refreshed.');
    } catch (problem) {
      if (mounted.current) setError(problem instanceof Error ? problem.message : 'Watchlists could not be refreshed.');
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <section className={ui.watchlists} aria-label="Shared watchlists">
    <div className={ui.watchToolbar}>
      <label>Shared watchlist<select aria-label="Shared watchlist" disabled={busy} value={selected?.id ?? ''} onChange={e=>choose(watches.find(row=>row.id===e.target.value) ?? null,false)}>
        <option value="">Custom filters</option>
        {watches.map(watch=><option key={watch.id} value={watch.id}>{watch.name}</option>)}
      </select></label>
      {selected&&<a href={workspaceHref('/horizon',organizationId,{watchlistId:selected.id})}>Link to saved watchlist</a>}
      <button type="button" disabled={busy} onClick={()=>void refresh()}>Refresh watchlists</button>
    </div>
    {unsavedFilters&&<p>Showing custom filters. The shared link opens the saved version.</p>}
    {canManage&&<details><summary>{selected?'Manage saved watchlist':'Save these filters for your team'}</summary>
      <form className={ui.watchToolbar} onSubmit={e=>{e.preventDefault();void write();}}>
        <label>Watchlist name<input value={name} disabled={busy} minLength={2} maxLength={80} required onChange={e=>setName(e.target.value)}/></label>
        <button type="submit" disabled={busy||limitReached||!parsedFilters.success||name.trim().length<2}>{selected?'Update watchlist':'Save new watchlist'}</button>
        {selected&&<button type="button" disabled={busy} onClick={()=>setConfirmArchive(!confirmArchive)}>Archive watchlist</button>}
      </form>
      {!parsedFilters.success&&<p>Use up to eight search phrases of 80 characters each to save this view.</p>}
      {limitReached&&<p>This workspace has 20 active watchlists. Archive one to save another.</p>}
      {confirmArchive&&selected&&<button type="button" disabled={busy} onClick={()=>void write(true)}>Confirm archive of {selected.name}</button>}
    </details>}
    {message&&<p role="status">{message}</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
