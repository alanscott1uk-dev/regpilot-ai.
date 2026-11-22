'use client';
import {useState} from 'react';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';
import {workspaceHref} from '../../../lib/client/workspace-context';
import type {resourceFindingReport} from '../../../lib/server/customer-api-service';

type Workspace = ReturnType<typeof useWorkspaceContext>;
type Report = Awaited<ReturnType<typeof resourceFindingReport>>;
const date = (value: string) => new Date(value).toLocaleString('en-GB', {timeZone: 'UTC'});

export default function ResourceFindings({workspace, id}: {workspace: Workspace; id: string}) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  async function load() {
    const current = workspace.capture();
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({organizationId: workspace.organizationId});
      const data = await workspace.request('/api/workspace/developers/observations/' + id + '/findings?' + params);
      if (current()) setReport(data);
    } catch (problem) {
      if (current()) {setReport(null); setError(problem instanceof Error ? problem.message : 'Could not load findings.');}
    } finally {
      if (current()) setBusy(false);
    }
  }
  function download(value: Report) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'resource-findings-' + id + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const rows = report?.rows.filter(row => filter === 'all' || (filter === 'recovered' ? row.passedAfterFailure : filter === 'overdue' ? row.overdueAtReading : row.status === filter)) ?? [];
  return <section aria-label="Resource remediation history"><h4>Resource remediation history</h4>
    <button type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Loading findings…' : report ? 'Refresh findings' : 'Inspect affected resources'}</button>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p>{report.reads.length} comparable submissions through this reading. Times are UTC.
        {report.limited && ' Showing the latest 50. Earlier failures may exist.'}
        {report.unavailable > 0 && ' Unusable readings in this window: ' + report.unavailable + '.'}</p>
      {report.targetDays && <p>Remediation target: {report.targetDays} days from the first recorded failure in this window. Deadlines are evaluated at the selected reading.</p>}
      {!report.selectedCurrent && <p>This is a historical submission. {report.reason}</p>}
      <label>Show resources <select value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="all">All</option><option value="overdue">Overdue at this reading</option><option value="FAIL">Failed</option><option value="UNKNOWN">Unknown</option>
        <option value="UNOBSERVED">Omitted from selected reading</option><option value="recovered">Passed after failure</option>
      </select></label>{' '}<button type="button" onClick={() => download(report)}>Download findings and receipt history</button>
      {!rows.length && <p>No resources match this view.</p>}
      {rows.map(row => <details key={row.key}><summary>{row.label} · {row.status === 'UNOBSERVED' ? 'Unobserved' : row.status}
        {row.overdueAtReading ? ' · overdue' : ''}{row.passedAfterFailure ? ' · passed after failure' : ''}</summary>
        {row.unresolvedSince && <p>First failure since the last observed pass in this window: {date(row.unresolvedSince)} UTC.</p>}
        {row.dueAt && <p>Remediation due {date(row.dueAt)} UTC.</p>}
        <ul>{row.history.map(event => <li key={event.receiptId}><a href={workspaceHref('/team/developers', workspace.organizationId, {observationId: event.receiptId})}>
          {date(event.at)} UTC · {event.status}</a></li>)}</ul></details>)}
    </>}
  </section>;
}
