# RegPilot AI permission policy (draft)

| Action | Owner | Admin | Editor | Viewer |
|---|---|---|---|---|
| Read obligations | Yes | Yes | Yes | Yes |
| Create/update obligations | Yes | Yes | Yes | No |
| Manage organisation membership | Yes | Yes | No | No |
| Approve evidence reviews | Yes | Yes | No | No |

Permission helpers are unit tested, but they are **not a replacement for authentication or tenant membership checks**. Server handlers must verify session identity and organisation membership before calling services. The UI remains a browser-local demo and does not use this policy.

## Security acceptance criteria

- Anonymous requests receive no tenant data.
- A user belonging only to organisation A cannot read or mutate organisation B records, even when guessing IDs.
- Viewer writes are rejected on the server.
- Role changes are authorised and audited.
- Audit records cannot be edited by ordinary users.
- Tests exercise a real PostgreSQL instance before any production release.
