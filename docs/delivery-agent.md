# Delivery Duel agent integration

The local connector runs the user's existing coding agent outside OJP. OJP
does not receive an AI provider API key. The agent can fetch the protocol,
queue private non-ranked trials and read its own results, and optionally
prepare a registration draft. It cannot approve or replace a ranked bot.

## CLI

On an OJP instance with the integration enabled, sign in and open **Coding
agent connection** from the profile or Delivery Duel page. Create a token
and enable draft creation only if needed. The value is displayed once.
Pass it via a private environment variable, not in source, command arguments,
chat, or shared configuration. Tokens expire after 30 days and can be revoked.
Use separate tokens for different clients.

From an OJP checkout with Node and `npm ci` completed:

```powershell
$env:OJP_AGENT_URL = 'http://127.0.0.1:3118'
$env:OJP_AGENT_TOKEN = Read-Host 'OJP agent token' -MaskInput
npm run agent:delivery -- game
npm run agent:delivery -- trial python .\courier.py
npm run agent:delivery -- result TRIAL_ID
npm run agent:delivery -- draft TRIAL_ID "My courier" python .\courier.py
```

The example uses PowerShell 7 and a local test origin. Omit `OJP_AGENT_URL`
for the production origin after the feature is enabled there. Only HTTPS or
loopback HTTP origins are accepted. Use the trial ID from the previous command.
A pending trial is not a failure; use the returned retry interval before
requesting its result again. The trial command accepts an optional UUID
request key so retrying an interrupted submission does not queue a second job.

## MCP

Register a local stdio server in an MCP-compatible coding agent. Set its
command to `node` and its arguments to the absolute path of
`scripts/ojp-agent.mjs` followed by `mcp`. Pass the token via the client's
private environment/secret settings and set the origin if not using production.
This process does not bind a port. It exposes only:

| Tool | Purpose |
| --- | --- |
| `get_game` | Fetch the Delivery Duel protocol and starter code |
| `run_trial` | Send code content to a private, unranked trial |
| `get_trial` | Read the caller's trial status, summary, and replay URL |
| `prepare_registration` | Create a browser review link from the exact tested code |

The MCP tools accept code content, not arbitrary filesystem paths. Only the
interactive CLI can read an explicitly supplied local source file. MCP
stdout carries protocol messages, not diagnostics or tokens.

## Browser approval

Preparing a draft requires a completed agent trial with 100 turns and no
fault on the user's bot. The language and source must have the same digest
as the trial; a loss to the standard bot is allowed. Drafts expire after
15 minutes or when the token expires, whichever comes first. Open the review
link or choose the pending draft in the connection settings. Compare the
code with the current version and approve from the signed-in browser.

The same transaction checks code, token, owner, and previous registered
version before applying the registration. A changed baseline requires a new
draft. Retrying approval cannot create a duplicate version. Revocation
invalidates pending drafts, and applied drafts discard their source copy.
Revocation does not interrupt trials that were already accepted.

## HTTP and deployment

The bearer API at `/api/agent/v1/delivery` uses:

- `GET /game` (read scope).
- `POST /trials` with `language`, `sourceCode`, and a UUID
  `Idempotency-Key` header (trial scope). An identical retry returns the
  existing job; reusing the key for different code is rejected.
- `GET /trials/:id` (read scope, owner only).
- `POST /drafts` with `trialId`, `name`, `language`, and `sourceCode`
  (optional draft scope).

All other agent operations are browser-session and same-origin only. The
proxy forwards only these exact method/path combinations to the bearer
handlers. It never treats a bearer token as a site session. The API does not
expose opponent source, hidden cases, administrative actions, or a ranked
submission endpoint. Trials share the existing per-user and global queue
limits and isolated workers; additional tokens do not increase those limits.

After applying the existing Delivery Duel schema, apply
`npm run db:delivery:agent` as the application database owner. It adds the
three integration tables without modifying existing matches or standings.
Rebuild the Prisma client and app, then set `DELIVERY_AGENT_ENABLED=1` on the
web process. The integration also requires `DELIVERY_ARENA_ENABLED=1` and the
existing isolated worker. Production schema changes require reviewed rollout.

`npm run test:delivery:agent:http` exercises the CLI, stdio MCP client, scoped
Bearer API, real isolated judging, and browser approval on a dedicated local
test database. See the `delivery` job in Judge Checks for the required fixture
environment.
