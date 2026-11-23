# Private evidence storage — staging implementation

Bucket: `regpilot-private-evidence`, public=false, maximum object size 10 MiB, allowed MIME types PDF/PNG/JPEG.

## Applied
- Private bucket created in staging Supabase.
- Read policy allows authenticated organisation members to read only objects whose path identifies a document in their organisation AND whose `document_records.storage_path` matches the object key.
- No browser INSERT, UPDATE or DELETE policy has been granted.
- Document metadata registration and action linking are separate from actual file uploads.

## Before enabling uploads
1. Implement authenticated server upload endpoint with strict organisation/role checks.
2. Accept files into isolated quarantine; inspect magic bytes, reject active content and enforce limits server-side.
3. Run malware scanning and record scan engine/version, timestamp, SHA-256 digest and result.
4. Promote clean files to immutable, versioned private object keys; never allow overwrite.
5. Store object path, digest, size, MIME, uploader and approval metadata atomically where possible.
6. Require a separate reviewer for approval, and audit each transition.
7. Test cross-tenant denials, revoked access, concurrent version updates and signed URL expiry.
8. Confirm storage RLS query plans and avoid casts that can throw on malformed object names before broader rollout.

Do not use this bucket for real customer evidence until these checks pass. No claim of virus-free files or regulatory approval is warranted.
