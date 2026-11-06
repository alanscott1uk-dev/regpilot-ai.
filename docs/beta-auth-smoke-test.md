# RegPilot staging sign-in and persistence smoke test

New route: `/beta` on the development preview branch only.

## Prerequisites
- Vercel preview env vars: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Supabase Auth > URL Configuration: allow the actual protected preview origin and `/beta` callback. Do not wildcard unrelated domains.
- Supabase Auth > Email: verify OTP email delivery and email confirmation settings.
- Provision an initial organisation and membership through a trusted administrator. Self-service organisation creation is intentionally disabled.
- Do not use real customer or regulated data.

## Smoke test
1. Open the preview `/beta` page and send a sign-in email.
2. Follow the link; confirm that Supabase establishes a verified session.
3. With no membership, confirm the empty/invitation state.
4. Assign a synthetic user to a synthetic organisation as OWNER through a trusted admin operation.
5. Create a fictional supplier action and refresh the page; verify it persists.
6. Log in as a second synthetic user in another organisation; verify the first record is invisible.
7. Verify VIEWER cannot create and EDITOR cannot delete.
8. Sign out and confirm records are no longer displayed.

## Current limitations
- Staging has no self-service organisation bootstrap or invitations.
- Browser Supabase client uses the publishable key and RLS, not service-role credentials.
- No document upload or production use.
- Vercel preview builds may be delayed by account build-rate limits.
- Repository has no committed npm lockfile; dependency installation/build still needs verification.
