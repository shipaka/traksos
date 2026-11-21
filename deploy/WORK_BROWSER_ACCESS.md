# TrakSOS: browser-based supervised testing

## What is possible

The Work cloud browser can inspect the real application at
`https://sandbox.traksos.ru` **once that origin actually serves the isolated
sandbox deployment**. Connecting the GitHub repository does not grant a
browser session or VPS shell by itself. This document is a deployment/runbook,
not a claim that the production server was changed.

## One-time infrastructure prerequisites (VPS operator)

1. Merge an approved, fully green candidate into main only after review.
   Publish the **sandbox** application image by a pinned, fully tested commit.
   Keep its PostgreSQL DB, volume, secrets and networks separate from
   production; never copy customer data or production auth tokens.
2. Point the DNS record for `sandbox.traksos.ru` to the VPS and obtain a
   valid HTTPS certificate. Confirm the domain is not an alias for production.
3. Set `SANDBOX_URL=https://sandbox.traksos.ru` and an identical
   `SANDBOX_SHARED_SECRET` on the production admin gateway and isolated
   sandbox; set `SANDBOX_DOMAIN` and a **different** database password on
   the sandbox host. All secrets belong only in protected VPS files/GitHub
   secrets, **never** in a chat message or GitHub commit.
4. Start `sandbox-db` and `sandbox-app` with
   `deploy/docker-compose.sandbox.yml`, using the project name
   `traksos-test` and the sandbox-only `.env.sandbox`; run
   `server/src/seedSandbox.ts` inside the sandbox app.
5. Keep `sandbox_private` and `sandbox_public` internal. Attach **only
   the existing Caddy container** to the sandbox public Docker network,
   never attach the sandbox app to the production default network.
   Merge `deploy/Caddy.sandbox.snippet` into the Caddyfile only after
   checking the sandbox app/network, and validate Caddy before reload.
6. Verify both HTTPS health endpoints return their correct flags:
   `traksos.ru/api/health` must say `sandbox:false`, and
   `sandbox.traksos.ru/api/health` must say `sandbox:true,db:true`.
   Require a real `buildRevision`; check actual deployment revisions and
   the signed handoff protocol. Test read-only VPS preflight separately.
7. Do not grant general SSH/root, live payment, production DB or API
   secrets to a browser or a test account. Never enable SMS, real push,
   live acquiring or live bank transfers in the sandbox.

The existing read-only VPS monitor intentionally cannot perform these
changes. Production deploy requires its **separate** explicit release
approval and write-capable credentials, and sandbox deployment needs its
own narrowly scoped publishing mechanism. Do not bypass either gate.

## Using ChatGPT Work as the browser operator

1. Switch this task to **Work mode** in ChatGPT; its cloud browser is a
   separate capability from the ordinary chat or the connected GitHub
   integration. Give it the sandbox URL (and optionally the public URL for
   read-only visual comparison).
2. Sign into the ordinary production administrator **in the protected
   browser UI** once; do not paste your password, SMS code or SSH secrets
   into a chat. Open `#/admin/test-center/admin` to request a signed,
   one-use entry into the isolated sandbox.
3. After the admin handoff, the sandbox stores a **12-hour supervisor
   session**, only in that browser tab. The top TEST banner includes a
   role switcher for 12 fictional accounts. Switching sends a request to
   `/api/sandbox/switch-role` and creates a separate, at most 2-hour,
   role-scoped session, without SMS or repeat login.
4. The supervisor token is **not** the role token: a client, driver or
   switched-admin role cannot mint any other role. The supervisor exists
   only in the separate sandbox database. The production site exposes no
   role-switch endpoint.
5. Run end-to-end scenarios between these accounts. Record screenshots
   and reproduce UI/navigation problems, then change code on a separate
   branch, require all CI checks, merge approved changes, and update the
   appropriate isolated deployment. Never report a production update until
   HTTPS health reports the exact SHA.
6. The service session expires. For another browser tab or after the
   12-hour admin grant expires, return to the protected admin test center
   for a fresh signed entry. There is intentionally **no** permanent
   shared "900000000..." password or public auto-login.

## Known release boundary

CI demonstrates real browser access to a disposable sandbox; it does
**not** deploy `sandbox.traksos.ru`. That host must still pass DNS, TLS,
separate-network/DB and real website checks before we can use Work
there. The UI role switch should remain in draft until CI passes it
and it is validated against a persistent staging instance.
