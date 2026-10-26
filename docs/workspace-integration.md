# Shared demo workspace integration

The dashboard and industry configuration now share a browser-local company profile, department list and module selections.

## Implemented
- Company name and enabled modules appear on the dashboard
- Implemented module routes are navigable; unfinished modules are marked Planned
- The action form suggests configured departments in the owner field
- The register can filter actions whose owner field exactly matches a configured department
- Configuration validation has automated unit tests

## Important limitations
- This is a single-browser demonstration, not multi-tenant company storage
- Owner is a text field; a department is not a separate relational record
- Older pilot records with role-based owners (e.g. Quality lead) won't match department filters unless edited or reassigned
- Department access controls and account permissions are not enforced by the browser UI
- Changing industry templates replaces the selected department/module list

## Next stage
Move organisation, department and obligation data into the authenticated database. Use stable department IDs and explicit assignment relations, rather than matching free-text owner names. Implement access-controlled dashboards and cross-department reporting.
