# Prototype deployment

This is a browser-local demo, not a production SaaS service.

1. Verify GitHub Actions passes.
2. Import the GitHub repository into a Next.js-compatible hosting service.
3. Configure build-time environment variables without committing secrets.
4. Visit `/`, `/prototype`, and `/api/health` after deployment.
5. Test action creation, persistence on reload, CSV export, and JSON backup restoration.

The health route confirms only that the server responds. It does not test PostgreSQL. The current interfaces use browser local storage and must not receive sensitive or real customer data.

Production requires authenticated sessions, tenant isolation, durable storage, audit protection, backup/recovery and security testing.
