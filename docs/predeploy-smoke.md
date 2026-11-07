# Local pre-deployment smoke tests (no Vercel)

Run:
```bash
npm install
npm run db:generate
npm run build
npm run test:smoke
```

The script starts the built Next.js application on a temporary local port with both production workspace and paid AI **disabled**, checks ten key pages, asserts the private API routes return 503 without configuration, and confirms the root redirect. It does not fetch GOV.UK or call a model, Supabase Auth or Vercel.

The tests are added to GitHub Actions after the PostgreSQL security and tenant-access tests. This is a coarse routing / fail-closed gate, **not** a replacement for browser automation, WCAG/mobile accessibility testing, source accuracy evaluation or end-to-end authenticated AI requests.

Keep Vercel preview deployments disabled during development. Stage a single release after security, consent, database migrations, evidence storage, backups and qualified user testing are ready.
