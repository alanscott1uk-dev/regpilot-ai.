# Local development database

Requires Docker, Node.js 20+ and a PostgreSQL password chosen by the developer.

```bash
export POSTGRES_PASSWORD='replace-with-a-strong-local-password'
docker compose up -d postgres
cp .env.example .env
# Edit DATABASE_URL in .env to use the same password, URL-encoded if needed.
npm install
npm run db:validate
npm run db:generate
npm run db:migrate
npm run dev
```

This database is for local development only. Do not expose PostgreSQL publicly. Do not put secrets in Git or run destructive migration commands against a production database. The browser UI still uses localStorage; database records are not yet displayed there.

The initial migration is generated locally by Prisma. Review it before committing it and before applying it to any shared environment.
