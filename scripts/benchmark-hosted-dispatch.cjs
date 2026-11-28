const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { db } = require('../lib/server/db.ts'),
  { assuranceFixture } = require('../tests/helpers/assurance-fixture.ts');
const { productMonitorCommand } = require('../lib/server/product-monitor-service.ts');
const { runConnectorBatch } = require('../lib/server/connector-service.ts');
const { verifiedObservation } = require('../lib/server/connector-observation.ts');
const { productReads } = require('../lib/connectors/product-recipes.ts');
const { profiles, profileFields } = require('../lib/connectors/resource-control.ts');
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      ['/regpilot', '/postgres'].includes(url.pathname) &&
      url.username === 'regpilot',
    'Use a disposable local database.',
  );
  assert.equal(
    await db.evidenceConnector.count(),
    0,
    'Use an empty connector database for the dispatch benchmark.',
  );
  const revision = process.env.REGPILOT_SOURCE_REVISION;
  assert.match(revision ?? '', /^[a-f0-9]{40}$/);
  const phases = [];
  Object.assign(process.env, {
    VERCEL_ENV: 'preview',
    REGPILOT_WORKSPACE_ENABLED: 'true',
    REGPILOT_CONNECTORS_ENABLED: 'true',
    REGPILOT_CONNECTOR_ENCRYPTION_KEY: 'ed'.repeat(32),
    REGPILOT_PIPEDREAM_PROJECT_ID: 'proj_fleet',
    REGPILOT_PIPEDREAM_CLIENT_ID: 'fleet-test',
    REGPILOT_PIPEDREAM_CLIENT_SECRET: 'fixture',
    REGPILOT_PIPEDREAM_ENVIRONMENT: 'development',
    SUPABASE_URL: 'https://auth.invalid',
    SUPABASE_PUBLISHABLE_KEY: 'fixture',
  });
  const fixtures = [];
  for (let n = 0; n < 4; n++) fixtures.push(await assuranceFixture());
  process.env.REGPILOT_AI_ALLOWED_EMAILS = fixtures.flatMap((f) => f.users.map((u) => u.email)).join(',');
  const products = [...new Map(productReads.map((r) => [r.family, r])).values()];
  const byAccount = new Map(),
    byScope = new Map(),
    byId = new Map();
  const profileNames = Object.keys(profiles);
  const past = new Date(Date.now() - 60000).toISOString(),
    future = new Date(Date.now() + 86400000).toISOString();
  const facts = {
    mfaEnabled: true,
    orphaned: false,
    accessReviewedAt: past,
    encrypted: true,
    supported: true,
    lastSeenAt: past,
    lastBackupAt: past,
    restoredAt: past,
    certificateId: 'certificate',
    validUntil: future,
    inRange: true,
    sampledAt: past,
    approved: true,
    authorisedReviewer: true,
    reviewerId: 'reviewer',
    authorId: 'author',
    decidedAt: past,
    modifiedAt: past,
    approverId: 'approver',
    deployedAt: past,
    approvedAt: past,
    verified: true,
    requesterId: 'requester',
    paidAt: past,
    qualified: true,
    qualificationExpiresAt: future,
    operatorId: 'operator',
    completed: true,
    assessed: true,
    expiresAt: future,
  };
  let changed = false,
    upstream = 0;
  const original = global.fetch;
  global.fetch = async (input, opts) => {
    const u = new URL(String(input));
    assert.equal(u.origin, 'https://api.pipedream.com');
    if (u.pathname.endsWith('/oauth/token'))
      return Response.json({ access_token: 'fixture', expires_in: 3600 });
    if (u.pathname.endsWith('/accounts')) {
      const row = byScope.get([u.searchParams.get('external_user_id'), u.searchParams.get('app')].join('/'));
      assert.ok(row);
      return Response.json({
        data: [{ id: row.account, healthy: true, app: { name_slug: row.product.app } }],
        page_info: { total_count: 1 },
      });
    }
    assert.ok(u.pathname.endsWith('/actions/run'));
    const b = JSON.parse(opts.body);
    const grant = Object.values(b.configured_props).find(
      (v) => typeof v === 'object' && v?.authProvisionId,
    )?.authProvisionId;
    const row = byAccount.get(grant);
    assert.ok(row);
    assert.equal(b.external_user_id, 'regpilot-' + row.org);
    assert.equal(b.version, row.product.version);
    assert.equal(b.id, row.product.app + '-' + row.product.action);
    const rule = profiles[row.policy.profile].rules[0];
    const settings = changed ? { ...facts, [rule.field]: rule.type === 'present' ? '' : false } : facts;
    upstream++;
    return Response.json({
      ret: [
        {
          id: 'same-resource',
          settings,
          disabled: false,
          archived: true,
          delete_branch_on_merge: true,
          security_and_analysis: {
            secret_scanning: { status: 'enabled' },
            secret_scanning_push_protection: { status: 'enabled' },
          },
        },
      ],
    });
  };
  try {
    const start = Date.now();
    const setupResults = await Promise.allSettled(
      fixtures.map(async (f, tenant) => {
        const programme = await db.programmeImport.create({
          data: {
            organizationId: f.a.id,
            createdById: f.o.userId,
            inputHash: f.a.id,
            method: 'SEARCH',
            status: 'ACCEPTED',
            evidenceManifest: [],
          },
        });
        const control = await db.managedControl.create({
          data: {
            organizationId: f.a.id,
            importId: programme.id,
            proposalKey: 'bench',
            title: 'Fixture fleet',
            description: 'Local fixture',
            testProcedure: 'Read the pinned action',
            theme: 'quality',
            ownerId: f.editor.id,
            scheduledById: f.owner.id,
            intervalDays: 30,
            nextReviewAt: new Date(),
          },
        });
        for (let i = tenant; i < products.length; i += fixtures.length) {
          const product = products[i],
            name = profileNames[i % profileNames.length],
            account = 'apn_fleet' + i;
          const policy = {
            profile: name,
            mapping: Object.fromEntries(profileFields(name).map((k) => [k, 'settings.' + k])),
          };
          const row = { account, org: f.a.id, product, policy };
          byAccount.set(account, row);
          byScope.set('regpilot-' + f.a.id + '/' + product.app, row);
          const select = { app: product.app, action: product.action, account, policy };
          const preview = await productMonitorCommand(f.o, { op: 'PREVIEW', ...select });
          assert.ok(preview.observable);
          const saved = await productMonitorCommand(f.o, {
            op: 'APPROVE',
            ...select,
            controlId: control.id,
            consent: true,
            digest: preview.digest,
            reviewDigest: preview.reviewDigest,
          });
          byId.set(saved.id, row);
        }
      }),
    );
    for (const result of setupResults) if (result.status === 'rejected') throw result.reason;
    assert.equal(byId.size, products.length);
    const approvalMs = Date.now() - start;
    const scope = { organizationId: { in: fixtures.map((f) => f.a.id) }, provider: 'PIPEDREAM_READ' };
    for (const phase of [false, true]) {
      changed = phase;
      const begun = Date.now(),
        startReads = upstream;
      if (phase) await db.evidenceConnector.updateMany({ where: scope, data: { nextRunAt: new Date(0) } });
      let processed = 0,
        batches = 0;
      while (processed < products.length) {
        const r = await runConnectorBatch(512, 4, Date.now() + 12000, 'hosted-hourly');
        assert.ok(r.processed > 0, 'Queue lost due work before completion');
        assert.ok(
          r.outcomes.every((v) => v === (phase ? 'FOLLOW_UP' : 'OBSERVED')),
          JSON.stringify([...new Set(r.outcomes)]),
        );
        processed += r.processed;
        batches++;
      }
      const runs = await db.connectorRun.findMany({
        where: { organizationId: scope.organizationId, outcome: phase ? 'FOLLOW_UP' : 'OBSERVED' },
      });
      const unique = new Set();
      for (const r of runs) {
        const obs = verifiedObservation(r),
          row = byId.get(r.connectorId);
        assert.ok(row && obs);
        unique.add(row.product.family);
        assert.equal(obs.checks.find((c) => c.id === 'approved-resources').status, 'PASS');
        assert.equal(obs.checks.find((c) => c.id === 'unreviewed-resources').status, 'PASS');
        assert.equal(
          obs.checks.find(
            (c) =>
              c.id === 'mapped-' + row.policy.profile + '-' + profiles[row.policy.profile].rules[0].field,
          ).status,
          phase ? 'FAIL' : 'PASS',
        );
      }
      assert.equal(unique.size, products.length);
      assert.equal(runs.length, products.length);
      assert.equal(upstream - startReads, products.length);
      phases.push({
        phase: phase ? 'injected field failure' : 'all settings healthy',
        families: unique.size,
        workspaces: fixtures.length,
        receipts: runs.length,
        upstreamFixtureReads: upstream - startReads,
        batches,
        elapsedMs: Date.now() - begun,
      });
    }
    const report = {
      revision,
      environment:
        'Disposable PostgreSQL, simulated Pipedream grants and product responses, accelerated dispatch times',
      approvalMs,
      distinctFamilies: products.length,
      profiles: profileNames,
      phases,
    };
    writeFileSync('hosted-dispatch-fixture.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally {
    global.fetch = original;
    for (const f of fixtures) await f.cleanup();
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
