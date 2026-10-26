# Document library — browser prototype

Route: `/documents`

This module supports general documentation across sectors: policies, SOPs, licences, certifications, contracts, supplier documents, import/export paperwork, audit reports, risk assessments and training records.

## Current features
- Category, department, owner, version, review/expiry date and status metadata
- Optional PDF/PNG/JPEG attachment, maximum 2 MB
- Local IndexedDB file storage and localStorage metadata
- Search, category filtering, download and deletion
- Navigation from the main dashboard and selected compliance modules

## Limitations
- No secure cloud storage, identity verification, audit trails, electronic signatures or document approval workflow
- Status labels are user-controlled demo fields, not actual approvals
- Files can be lost when browser data is cleared; they are not included in JSON backups
- No malware scanning, server-side encryption, access control or retention policy
- No genuine compliance document should be uploaded

## Production requirements
Organisation-scoped private object storage, verified users and department permissions, document version history, review assignments, approval signatures, expiry notifications, secure file inspection and backup/recovery.
