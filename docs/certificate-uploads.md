# Certificate document attachments — browser demo

The Distribution > Certifications module now supports attaching a PDF, PNG or JPEG to an existing certificate record, with a 2 MB file-size limit.

Files are stored in the browser's IndexedDB on the current device. Certificate metadata remains in localStorage. They are not uploaded to Vercel or the GitHub repository.

## Limitations
- No authenticated user accounts or organisation access controls
- No encryption, cloud backup, audit trail, malware scanning or formal certificate verification
- Browser storage may be cleared and files lost
- No cross-device sync
- No proof of GMP/GDP compliance or supplier approval
- Basic file signature checking does not guarantee file safety

## Production requirements
Private object storage, server-side file validation, malware scanning, SHA-256 checksums, certificate versioning, expiry reminders, supplier qualification workflow, reviewer sign-off, retention policies and organisation-scoped access control.

Do not upload real confidential certificates or production records to this demo.
