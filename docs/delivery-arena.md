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

- Each user can register one active bot. The default limit is 16 active
  users. Updates and withdrawals do not alter official evaluation snapshots.
- The **Live standings** tab evaluates the current registered versions without
  waiting for an official round. An idle worker checks for roster changes every
  two seconds. Each pair plays a single fixed map (seed 54832924) twice, with
  starting positions and priority reversed. Results from the last published
  live round are reused for the same pair of bot versions. With 16 active bots
  the live schedule has 240 games, or 30 new games for one changed version.
  Starting at 32 active bots, each bot instead plays eight assigned opponents
  twice. A deterministic balanced pairing keeps opponents unchanged when only
  code changes. At 32 bots this gives 256 games, or 16 new games for one change.
  Changes can supersede a still-queued live snapshot without stopping its
  in-flight match. The visible standings refresh automatically. Completion time
  depends on the queue and the submitted programs.
- Weekly evaluation uses the versions active at Monday 03:00 JST. A worker
  schedules the latest cutoff when the delivery queue can run. If fewer than
  two bots were active at the cutoff, that week is not evaluated. Administrators
  can start an extra evaluation using the current versions. View these rounds
  under **Official evaluations**.
- In official rounds every pair plays three map categories twice: short deliveries,
  long deliveries, and cross-city orders through a narrow passage. Starts and
  priority swap on the second run. Weekly and manual rounds always use all pairs.
  Wins earn three points, draws one, losses zero. Equal points share a rank.
  Raw delivery scores are shown separately. There is no league or rating.
- New public replays show queue wait, preparation (including compilation),
  compilation, execution, and cache hits, plus contested pickups, delivery base
  and bonus points, and expiration penalties. A reused result shows the original
  run's timing, not a new runtime.
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
   own sandbox and workspace. New delivery jobs are not claimed while ordinary,
   heuristic, or package jobs are pending. After one match finishes, the worker
   checks those queues and can immediately start the next one.
4. Enable `DELIVERY_WEEKLY_ENABLED=1` on workers for automatic weekly rounds.
   With it off, live evaluation, admin evaluation, and private trials still work.
   Live standings are on by default when the arena is enabled. Set
   `DELIVERY_LIVE_ENABLED=0` on both the web process and workers to disable
   scheduling new live rounds without hiding official results.
5. Set `DELIVERY_ENTRY_LIMIT` on web and workers to an integer from 2 to 64 to
   override the default of 16. Decreasing the limit does not remove existing bots.
   Set `DELIVERY_MATCH_CONCURRENCY=2` on all intended workers only after checking
   CPU, normal judge latency, and timeouts. The default is one global match; the
   two-slot mode still fences claims in PostgreSQL. Running matches can finish
   when an ordinary job arrives, but no new delivery match starts until priority
   work clears.
6. Workers keep a bounded per-process cache of successful compilations for
   registered bot versions (48 entries, 32 MiB total, at most 4 MiB each).
   Supported artifacts are copied into new sandbox workspaces, never mounted
   in a shared writable directory. Oversized artifacts, Python/PyPy bytecode,
   and private trials are not cached. Set `DELIVERY_COMPILE_CACHE=0` to disable.

Run `npm run test:delivery` for rules and process tests. To run the DB integration
suite, migrate an isolated PostgreSQL database named `ojp_delivery_test`
on `127.0.0.1`, set `DELIVERY_TEST_DATABASE_URL` to that database, and run
`npm run test:delivery:integration`. The suite clears the arena tables there.
Judge Checks also runs `npm run test:delivery:http` with a built web instance
and two isolated workers to verify the full lifecycle.
