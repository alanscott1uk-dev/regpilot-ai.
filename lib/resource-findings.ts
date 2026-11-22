export function resourceSeries(externalId: string) {
  return /^(dbsync\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\/[a-f0-9]{32}\/)[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.exec(externalId)?.[1] ?? null;
}

type Outcome = 'PASS' | 'FAIL' | 'UNKNOWN';
type Reading = {
  id: string;
  at: string;
  hash: string;
  checks: {key: string; label: string; status: Outcome}[];
  available: boolean;
};

export function remediationTarget(observed?: string): number | null {
  if (!observed) return null;
  try {
    const days: unknown = JSON.parse(observed)?.remediationDays;
    return typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= 365 ? days : null;
  } catch {
    return null;
  }
}

export function findingRows(readings: Reading[], remediationDays: number | null = null) {
  const items = new Map<string, {label: string; events: {index: number; status: Outcome}[]}>();
  readings.forEach((reading, index) => {
    if (!reading.available) return;
    for (const check of reading.checks) {
      if (!/^item-[a-f0-9]{64}$/.test(check.key)) continue;
      const item = items.get(check.key) ?? {label: check.label, events: []};
      item.label = check.label;
      item.events.push({index, status: check.status});
      items.set(check.key, item);
    }
  });
  const latestIndex = readings.length - 1;
  const rows = Array.from(items, ([key, item]) => {
    const events = item.events;
    const latest = events[events.length - 1];
    const status: Outcome | 'UNOBSERVED' = latest.index === latestIndex ? latest.status : 'UNOBSERVED';
    const firstFail = events.find(event => event.status === 'FAIL');
    const lastFail = events.findLast(event => event.status === 'FAIL');
    const lastPass = events.findLast(event => event.status === 'PASS');
    // Gaps carry no evidence of a fix. A later explicit pass ends the failure episode.
    const afterPass = events.find(event => event.status === 'FAIL' && event.index > (lastPass?.index ?? -1));
    const firstInEpisode = afterPass ? readings[afterPass.index] : null;
    const passedAfterFailure = status === 'PASS' && !!lastFail && readings[latest.index].at > readings[lastFail.index].at;
    const deadline = firstInEpisode && remediationDays ? Date.parse(firstInEpisode.at) + remediationDays * 86400000 : null;
    const overdueAtReading = status === 'FAIL' && deadline !== null && Date.parse(readings[latestIndex].at) >= deadline;
    return {key, label: item.label, status, passedAfterFailure, overdueAtReading,
      dueAt: deadline !== null ? new Date(deadline).toISOString() : null,
      firstFailureAt: firstFail ? readings[firstFail.index].at : null,
      lastFailureAt: lastFail ? readings[lastFail.index].at : null,
      unresolvedSince: firstInEpisode?.at ?? null,
      history: events.map(event => ({receiptId: readings[event.index].id, at: readings[event.index].at,
        hash: readings[event.index].hash, status: event.status}))};
  });
  const order: Record<string, number> = {FAIL: 0, UNKNOWN: 1, UNOBSERVED: 2, PASS: 3};
  return rows.sort((a, b) => Number(b.overdueAtReading) - Number(a.overdueAtReading) || order[a.status] - order[b.status] ||
    (a.unresolvedSince ?? '').localeCompare(b.unresolvedSince ?? '') || a.label.localeCompare(b.label));
}
