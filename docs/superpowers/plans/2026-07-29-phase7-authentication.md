# Phase 7 Authentication and Church Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add invite-only WorkOS authentication and prove that every database and HTTP operation is
confined to the church organization in the authenticated session.

**Architecture:** WorkOS owns passwords, invitations, and sessions. A trusted WorkOS organization
ID resolves to one SQLite church and its single territory. Node's `AsyncLocalStorage` carries that
resolved scope through one server request so the existing database API cannot run without a church
scope and cannot fall back to Temecula constants.

**Tech Stack:** Next.js 16 App Router, `@workos-inc/authkit-nextjs`, `@workos-inc/node`, Node
`AsyncLocalStorage`, SQLite, Node test runner.

## Global Constraints

- Invite-only email/password authentication; no public signup or social login.
- One WorkOS organization represents one church.
- Never trust a browser-supplied church identifier.
- Keep all version-one administrators at one permission level.
- Tests and builds must run without live WorkOS credentials.
- Work only on Phase 7 and stop at founder review.

---

### Task 1: Church scope replaces pilot constants

**Files:**
- Create: `web/db/migrations/019_auth_organizations.sql`
- Create: `web/lib/workspace-scope.ts`
- Create: `web/lib/workspace-scope.test.ts`
- Create: `web/test/workspace-fixtures.ts`
- Modify: `web/db/seed.mjs`
- Modify: `web/lib/database.ts`
- Modify: existing database and route tests that call scoped functions

**Interfaces:**
- Produces: `WorkspaceScope { churchId, territoryId, timeZone }`
- Produces: `runInWorkspace<T>(scope, operation): T`
- Produces: `getWorkspaceForOrganization(organizationId, filename?): WorkspaceScope`

- [ ] **Step 1: Write the failing scope and isolation test**

Add a test that migrates a temporary database, seeds Temecula with `org_test_temecula`, inserts a
second church/territory with `org_test_second`, and proves:

```ts
assert.deepEqual(getWorkspaceForOrganization('org_test_second', filename), {
  churchId: 'church-second-test',
  territoryId: 'territory-second-test',
  timeZone: 'America/New_York',
});
assert.throws(() => getWorkspaceForOrganization('org_missing', filename), /workspace/i);
assert.throws(() => getTerritoryWorkspace(filename), /workspace scope/i);
assert.equal(
  runInWorkspace(secondScope, () => getTerritoryWorkspace(filename)).churchName,
  'Second Test Church',
);
```

- [ ] **Step 2: Run the focused test and verify it fails because the scope API is absent**

Run: `node --experimental-strip-types --test web/lib/workspace-scope.test.ts`

- [ ] **Step 3: Add the organization/time-zone migration and minimal scope boundary**

Add nullable unique `churches.auth_organization_id`, required `churches.time_zone`, and
`AsyncLocalStorage`. Replace every `PILOT_CHURCH_ID`, `PILOT_TERRITORY_ID`, and
`PILOT_TIME_ZONE` database use with the required current scope. The organization lookup is the
only unscoped database query.

- [ ] **Step 4: Wrap existing test database helpers in the explicit Temecula test scope**

Keep test IDs in `web/test/workspace-fixtures.ts`; do not restore a production fallback.

- [ ] **Step 5: Run the focused test and the complete Node suite**

Run: `node --experimental-strip-types --test web/lib/workspace-scope.test.ts`

Run: `pnpm --dir web test`

### Task 2: WorkOS session boundary protects every route

**Files:**
- Create: `web/lib/auth.ts`
- Create: `web/lib/auth.test.ts`
- Create: `web/lib/authenticated-route.ts`
- Create: `web/lib/authenticated-route.test.ts`
- Create: `web/proxy.ts`
- Create: `web/app/auth/callback/route.ts`
- Create: `web/app/login/route.ts`
- Modify: all files under `web/app/api/**/route.ts`
- Modify: existing route tests
- Modify: `web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `AdministratorSession { user, workspace }`
- Produces: `requireAdministratorSession(authLoader?): Promise<AdministratorSession>`
- Produces: `authenticatedRoute(handler, sessionLoader?): Next route handler`

- [ ] **Step 1: Write failing authentication tests**

Use complete WorkOS-shaped user fixtures and inject only the external session loader. Prove:

```ts
await assert.rejects(() => requireAdministratorSession(async () => ({ user: null })), /sign in/i);
await assert.rejects(
  () => requireAdministratorSession(async () => ({ user, organizationId: null })),
  /church workspace/i,
);
assert.equal(
  (await requireAdministratorSession(async () => ({
    user,
    organizationId: 'org_test_temecula',
  }))).workspace.churchId,
  'church-temecula-pilot',
);
```

Prove the route wrapper returns JSON `401` for no session, `403` for an unmapped organization, and
runs a handler inside the mapped scope for an authenticated session.

Add a route test that creates data for both churches, authenticates as church A, submits church B's
stable batch or packet ID, and asserts `404` or `409` with zero mutation in both churches.

- [ ] **Step 2: Run the focused tests and verify the expected failures**

Run: `node --experimental-strip-types --test web/lib/auth.test.ts web/lib/authenticated-route.test.ts`

- [ ] **Step 3: Install the two official WorkOS packages and implement the minimal boundary**

Run: `pnpm --dir web add @workos-inc/authkit-nextjs @workos-inc/node`

Use WorkOS `withAuth`, `handleAuth`, `getSignInUrl`, and `authkitProxy`. Do not implement passwords,
invitation delivery, session crypto, or a custom login form.

- [ ] **Step 4: Wrap every API route and adapt route tests with injected authenticated sessions**

The business handler receives no church ID from the request. It runs under the session's
`WorkspaceScope`. Unknown batch, packet, segment, and territory IDs therefore remain invisible
across churches.

- [ ] **Step 5: Run focused and complete Node tests**

Run: `node --experimental-strip-types --test web/lib/auth.test.ts web/lib/authenticated-route.test.ts`

Run: `pnpm --dir web test`

### Task 3: Authenticated page and two-church attack checks

**Files:**
- Modify: `web/app/layout.tsx`
- Modify: `web/app/page.tsx`
- Create: `web/components/AdministratorAccount.tsx`
- Create: `web/components/AdministratorAccount.test.tsx`
- Modify: `web/components/StreetlightWorkspace.tsx`
- Modify: `web/app/globals.css`

**Interfaces:**
- Consumes: `requireAdministratorSession`
- Consumes: `runInWorkspace`
- Produces: authenticated workspace render, administrator email, and WorkOS sign-out action

- [ ] **Step 1: Write a failing account-control test**

Render the real account control and assert that it identifies the current administrator and exposes
an accessible **Sign out** button.

- [ ] **Step 2: Run the focused test and verify it fails because the component is absent**

Run: `node --experimental-strip-types --test web/components/AdministratorAccount.test.tsx`

- [ ] **Step 3: Protect the server page and add the minimal account controls**

Wrap the layout in `AuthKitProvider`. The page requires an administrator session, loads coverage
inside its workspace scope, and supplies a WorkOS sign-out action. Add only the current
administrator email and a compact **Sign out** control to the existing header; visual redesign is
Phase 9.

- [ ] **Step 4: Run the focused test, Node suite, typecheck, and build**

Run: `pnpm --dir web test`

Run: `pnpm --dir web typecheck`

Run: `pnpm --dir web build`

### Task 4: Configuration, evidence, and review checkpoint

**Files:**
- Modify: `ENVIRONMENTS.md`
- Modify: `web/README.md`
- Modify: `IMPLEMENTATION_PLAN.md`

- [ ] **Step 1: Document only required WorkOS staging values**

Document `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`,
`NEXT_PUBLIC_WORKOS_REDIRECT_URI`, and `STREETLIGHT_PILOT_WORKOS_ORGANIZATION_ID`, including the
dashboard callback, login, logout, disabled-signup, password-only, organization, and invitation
settings.

- [ ] **Step 2: Run fresh canonical verification**

Run: `pnpm check`

Run: `git diff --check`

- [ ] **Step 3: Run local browser verification when staging credentials are available**

Verify unauthenticated redirect, invited sign-in, workspace load, sign-out, and two-organization
isolation. If credentials are not yet supplied, stop with those exact human-review requirements
rather than claiming the live flow passed.

- [ ] **Step 4: Update Phase 7 status and evidence, then stop**

Do not begin Phase 8.
