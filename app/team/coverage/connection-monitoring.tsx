'use client';

import {useEffect, useState} from 'react';
import {workspaceHref, type useWorkspaceContext} from '../../../lib/client/workspace-context';
import {workspaceConnectionFilters, type ConnectionFilter} from '../../../lib/connectors/health-filters';
import type {getConnectorHealth} from '../../../lib/server/connector-health-service';
import css from './coverage.module.css';

type Result = Awaited<ReturnType<typeof getConnectorHealth>>;
type Workspace = ReturnType<typeof useWorkspaceContext>;
const format = (value: string | null) => value ? new Date(value).toLocaleString('en-GB') : 'Never';

export function ConnectionMonitoring({workspace, refresh}: {workspace: Workspace; refresh: number}) {
  const {organizationId, request, capture} = workspace;
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState({q: '', filter: 'all' as ConnectionFilter, page: 1});
  const [result, setResult] = useState<{key: string; data: Result} | null>(null);
  const [problem, setProblem] = useState('');
  const [exporting, setExporting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const href = (path: string, values: Record<string, string> = {}) => workspaceHref(path, organizationId, values);
  const endpoint = '/api/workspace/connectors/health?' + new URLSearchParams({
    organizationId, q: query.q, filter: query.filter, page: String(query.page),
  });
  const key = [refresh, attempt, endpoint].join('|');
  const data = result?.key === key ? result.data : null;

  useEffect(() => {
    const controller = new AbortController();
    const valid = capture();
    setProblem('');
    request(endpoint, {signal: controller.signal}).then((value: Result) => {
      if (controller.signal.aborted || !valid()) return;
      if (value.organizationId !== organizationId || !Array.isArray(value.items) || !value.countsByFilter) {
        throw Error('The connection inventory could not be verified.');
      }
      setResult({key, data: value});
    }).catch(error => {
      if (!controller.signal.aborted && valid()) setProblem(error.message || 'Could not load connections.');
    });
    return () => controller.abort();
  }, [endpoint, key, organizationId, request, capture]);

  async function exportMatches() {
    if (!data || exporting) return;
    const valid = capture();
    setExporting(true);
    setProblem('');
    try {
      const report = await request(endpoint + '&format=csv');
      if (!valid()) return;
      if (report.organizationId !== organizationId || typeof report.csv !== 'string') throw Error('The export could not be verified.');
      const url = URL.createObjectURL(new Blob([report.csv], {type: 'text/csv;charset=utf-8'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'regpilot-connection-monitoring.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 500);
    } catch (error) {
      if (valid()) setProblem(error instanceof Error ? error.message : 'Could not export the connections.');
    } finally {
      if (valid()) setExporting(false);
    }
  }

  return <section id="connection-health" className={css.sectors} aria-label="Connected evidence health">
    <div className={css.heading}><h2>Evidence integration health</h2><a href={href('/team/operations?view=connections')}>Manage connections</a></div>
    <form className={css.filters} onSubmit={event => {event.preventDefault(); setQuery({...query, q: term.trim(), page: 1});}}>
      <input type="search" aria-label="Search evidence connections" placeholder="Provider, target, control or owner" maxLength={160} value={term} disabled={exporting} onChange={event => setTerm(event.target.value)}/>
      <button className={css.primary} disabled={exporting}>Search connections</button>
      <select aria-label="Filter evidence connections" value={query.filter} disabled={exporting} onChange={event => setQuery({q: term.trim(), filter: event.target.value as ConnectionFilter, page: 1})}>
        {workspaceConnectionFilters.map(option => <option key={option.value} value={option.value}>{option.label}{data ? ' (' + data.countsByFilter[option.value] + ')' : ''}</option>)}
      </select>
    </form>
    {problem && <p role="alert" className={css.error}>{problem} <button type="button" onClick={() => setAttempt(value => value + 1)}>Reload connections</button></p>}
    {!data && !problem && <p role="status">Loading connection health…</p>}
    {data && <>
      <p aria-live="polite"><strong>{data.matched} matching</strong> of {data.configured} configured connections.</p>
      {data.items.length > 0 && <p className={css.pageHealth}>On this page, {data.observed} connections have clean recent observations and {data.needsAttention} need investigation.</p>}
      <div className={css.actions}>
        <button type="button" disabled={!data.matched || exporting} onClick={() => void exportMatches()}>{exporting ? 'Exporting…' : 'Export all matches (CSV)'}</button>
        {data.pages > 1 && <><button type="button" disabled={data.page <= 1 || exporting} onClick={() => setQuery({...query, page: data.page - 1})}>Previous connections</button>
          <span>Page {data.page} of {data.pages}</span>
          <button type="button" disabled={data.page >= data.pages || exporting} onClick={() => setQuery({...query, page: data.page + 1})}>Next connections</button></>}
      </div>
      {!data.items.length ? <p className={css.empty}>{data.configured ? 'No connections match these filters.' : 'No evidence connections configured.'}</p> :
      <div className={css.connectionGrid}>{data.items.map(c=><article key={c.id} className={css.connection} aria-label={c.target}>
       <div className={css.sourceTop}><span>{c.provider}</span><span className={css.state} data-state={c.status==="observed"?"current":["failed","revoked"].includes(c.status)?"failed":"stale"}>{c.status.replaceAll("-"," ")}</span></div>
       <h3>{c.target}</h3><p>{c.reason}</p>
       <p>Owner {c.owner||"unassigned"} · {c.checksSeen} checks · expires {format(c.expiresAt)}</p>
       {c.sourceUrl&&<p><a href={c.sourceUrl} rel="noreferrer" target="_blank">Provider source</a> · captured {format(c.sourceCapturedAt)}</p>}
       {c.findings?.length>0&&<details><summary>Last recorded provider checks ({c.findings.length} of {c.checksSeen})</summary>{c.findings.map(check=><div key={check.id} className={css.finding}><strong>{check.label} · {check.status}</strong><p>{check.observed}</p>{check.status!=="PASS"&&<p>{check.nextStep}</p>}{check.sourceUrl&&<a href={check.sourceUrl} target="_blank" rel="noreferrer">Source record</a>}</div>)}</details>}
       {c.openTasks?.map(task=><p key={task.id}><a href={href("/team/work",{taskId:task.id})}>{task.title}</a> · {task.ownerName}</p>)}
       {c.history?.length>0&&<details><summary>Recent collection and recovery history</summary><ol>{c.history.map(e=><li key={e.id}>{format(e.at)} · {e.action.replace("connector.","").replaceAll("_"," ")} {e.code||e.outcome||""}</li>)}</ol></details>}
       <small>{c.resultHash ? c.checksFailed+" failing checks · "+c.checksUnknown+" unknown" : "No verified check results are available"}. Last successful collection {format(c.lastSuccessAt)}.</small>
       {c.controls?.length>0&&<p>Used by {c.controls.length} active control{c.controls.length===1?'':'s'}: {c.controls.map(control=>control.title).join(', ')}. {c.status!=='observed'&&'Review these controls before relying on this connection.'}</p>}
       <a href={href("/team/operations",{view:"connections",connectionId:c.id})}>Inspect connection and actual signals →</a>
      </article>)}</div>}
      <p className={css.disclaimer}>An overdue collection has passed its configured interval since the last success. The check filters use the last run recorded for the current configuration.</p>
    </>}
  </section>;
}
