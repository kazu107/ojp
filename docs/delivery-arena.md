# Delivery Duel

Delivery Duel is a bot-versus-bot game at `/games/delivery`. It is separate from
the single-player heuristic problems, contest rating, and ordinary judge queue.
Registered source and trial replays are visible only to their owners.
Evaluation replays are public after publication and never include source code.

## Game

- Both couriers share a seeded 15-by-15 map and receive an observation before
  each of the 100 turns. They choose one action independently. They may share
  tiles; walls and the edge cannot be crossed.
- Orders appear during the match. An order can be picked up at its origin
  and delivered at its destination. Each order takes one or two units of
  capacity, and each courier has two units.
- If both couriers pick up the same order in one turn, alternating priority
  resolves it. The first turn's priority comes from the seed.
- A delivery through the deadline turn earns `base + min(20, 2 * (deadline - turn))`.
  After the deadline turn, an undelivered, carried order subtracts its base
  points from that courier. Unclaimed orders expire without a penalty.
- A well-formed but inapplicable action becomes `WAIT`. Malformed output,
  crashes, and timeouts forfeit the match. A double forfeit earns neither bot a
  standing point. Otherwise, equal scores mean a draw.

### Bot protocol

Read these lines on every turn, using zero-based coordinates from the top-left:

```text
turn seat H W x y opponentX opponentY load scoreA scoreB N
<H rows of . and #>
<N rows: id pickupX pickupY dropoffX dropoffY deadline base size owner>
```

`seat` and `owner` are 0 (A) or 1 (B); `owner=-1` means unclaimed.
Output exactly one of `UP`, `DOWN`, `LEFT`, `RIGHT`, `WAIT`,
`PICKUP id`, or `DELIVER id`, then a newline. Flush the output. Stop when the
header is `END`. The editor includes a working Python/PyPy starter using BFS.
The trial runs against the trusted standard courier on a fixed seed for
comparison. The runner allows 2.5s for the first move, 250ms per later move,
32s wall time and 128 MiB per bot, with process and output limits.

## Evaluation

- Each user can register one active bot. This beta accepts up to eight active
  users. An update replaces the active version without changing any scheduled
  evaluation; withdrawal also preserves scheduled versions.
- Weekly evaluation uses the versions active at Monday 03:00 JST. A worker
  schedules the latest cutoff when the delivery queue can run. If fewer than
  two bots were active at the cutoff, that week is not evaluated. Administrators
  can start an extra evaluation using the current versions.
- Every pair plays three seeded maps twice, with starting positions and
  initial priority swapped on the second run. Eight bots produce 168 matches.
  Wins earn three points, draws one, losses zero. Equal points share a rank.
  Raw delivery scores are shown separately. There is no league or rating.
- No partial standings are published. The previous evaluation stays visible
  while others run. Infrastructure failures are retried up to three times;
  an administrator can retry the failed matches without redoing completed ones.

## Deployment

1. Take a DB backup. Apply the additive migration to the intended database
   with `npm run db:delivery`; it is idempotent and does not modify existing
   problem, user, or submission rows. The release schema gate requires this
   step before a production rollout.
2. Rebuild the Prisma client and web/worker images. Set
   `DELIVERY_ARENA_ENABLED=1` on the web process and the workers.
   The feature is off by default and does not access delivery tables while off.
3. Keep `JUDGE_SANDBOX=bubblewrap` on Linux workers and run `npm run judge:doctor`.
   Production does not fall back to an unisolated runner. Each courier has its
   own sandbox and workspace, and the DB lease admits one arena match globally
   at a time. Ordinary judge/package work is checked first.
4. Enable `DELIVERY_WEEKLY_ENABLED=1` on workers for automatic weekly rounds.
   With it off, admin evaluation and private trials still work.

Run `npm run test:delivery` for rules and process tests. To run the DB integration
suite, migrate an isolated PostgreSQL database named `ojp_delivery_test`
on `127.0.0.1`, set `DELIVERY_TEST_DATABASE_URL` to that database, and run
`npm run test:delivery:integration`. The suite clears the arena tables there.
Judge Checks also runs `npm run test:delivery:http` with a built web instance
and two isolated workers to verify the full lifecycle.
