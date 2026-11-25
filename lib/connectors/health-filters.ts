export const workspaceConnectionFilters = [
  {value: 'all', label: 'All connections'},
  {value: 'collection-failed', label: 'Collection errors'},
  {value: 'overdue', label: 'Collection overdue'},
  {value: 'failed-checks', label: 'Latest read has failed checks'},
  {value: 'incomplete', label: 'Latest read incomplete'},
  {value: 'awaiting-read', label: 'Awaiting read on this configuration'},
] as const;

export type ConnectionFilter = typeof workspaceConnectionFilters[number]['value'];
