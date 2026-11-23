# RegPilot private beta — first login test

The secondary Vercel project `regpilot-ai-qnx6` has preview-only Supabase URL and publishable-key variables configured for `design/modern-workspace`. Redeploy the branch after changing environment variables so Next.js includes them in the browser build.

## Configure Supabase email redirect

In Supabase > Authentication > URL Configuration, add the exact approved preview callback:
`https://regpilot-ai-qnx6-git-design-modern-workspace-alanscott1uk-5933.vercel.app/beta`

Use this exact preview alias rather than a wildcard. The actual page may be behind Vercel deployment protection; an authorised tester must be able to open it.

## Smoke test
1. Open the preview /beta route.
2. Enter a test email and request a sign-in link.
3. Verify the email redirect returns to /beta with a valid session.
4. Create a synthetic organisation.
5. Add a fictional supplier record.
6. Refresh and confirm it persists.
7. Sign out and confirm records disappear.
8. Test a second account and separate organisation for isolation.

Do not enter real customer or regulated data. Do not remove deployment protection to bypass authentication.

## Caveats
- Authentication email delivery and redirect are not verified yet.
- Supabase Row Level Security is configured but real two-user isolation remains untested.
- The Prisma schema in GitHub is not the same as the Supabase staging SQL schema. Do not run Prisma migrations against this database.
