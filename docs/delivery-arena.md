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

- One active bot per user, with no global registration limit. The existing
  per-account upload rate limit remains. Only the newest version is queued
  for placement. An edit or withdrawal cancels obsolete queued matches; an
  in-flight match can finish, but cannot change the new version's rating.
- A new version plays up to six placement sets. A set is two games on one
  seeded map with starts and pickup priority swapped. The next opponent is
  selected near the updated rating estimate, with a wider check at the end.
  A win moves the estimate toward stronger opponents; a loss moves it down.
  Split sets keep more uncertainty than decisive ones. Placement does not
  affect the opponent's rating. Updates start from the last published rating
  with larger uncertainty and keep that version visible until placement ends.
- The **Live standings** table ranks published versions by estimated rating
  minus heuristic uncertainty, not by cumulative match points. Ratings are
  separate from contest Elo. A bot that never completes a valid game in
  placement is excluded until it is updated.
- Rated sets run continuously even if nobody updates their code. The scheduler
  starts from the rated bot whose regular turn is oldest, then looks for a
  similarly rated opponent. It generally avoids the last eight opponents,
  falls back to a rematch if necessary, and periodically tries a wider matchup.
  It rotates across short, long, and bottleneck maps. If both types of match
  are due, at most three consecutive placement sets take precedence before
  considering a regular set. The scheduler materializes only one open set
  (two jobs), not a full roster schedule.
- Weekly rounds are no longer scheduled. The default ladder mode also retires
  manual batch runs. Existing evaluation results and replay links remain
  accessible in **Past evaluations**; they are not converted into ratings.
- New public replays show queue wait, preparation (including compilation),
  compilation, execution, and cache hits, plus contested pickups, delivery base
  and bonus points, and expiration penalties. A reused result shows the original
  run's timing, not a new runtime.
- A rating change is applied transactionally once both mirrored games finish.
  Session or worker interruptions resume from the database. Infrastructure
  failures retry up to three times per match; a failed set does not affect
  ratings and the affected bots wait briefly before being queued again.

## Deployment

1. Take a DB backup, stop old arena writers/scheduling and drain their queue.
   Run `npm run db:delivery` on fresh databases, then
   `npm run db:delivery:ladder` on both fresh and upgraded databases, as the
   application database owner. The ladder migration adds two tables and
   indexes and queues already registered bots for placement. It is idempotent
   and preserves existing contests, submissions, arena evaluations and replays.
   Production requires a reviewed schema rollout before switching binaries.
2. Rebuild the Prisma client and web/worker images. Set
   `DELIVERY_ARENA_ENABLED=1` on the web process and the workers.
   The feature is off by default and does not access delivery tables while off.
3. Keep `JUDGE_SANDBOX=bubblewrap` on Linux workers and run `npm run judge:doctor`.
   Production does not fall back to an unisolated runner. Each courier has its
   own sandbox and workspace. New delivery jobs are not claimed while ordinary,
   heuristic, or package jobs are pending. After one match finishes, the worker
   checks those queues and can immediately start the next one.
4. Set `DELIVERY_LIVE_ENABLED=0` on workers to pause scheduling new sets
   while draining for maintenance. Existing replays and private trials stay
   available. `DELIVERY_LADDER_INTERVAL_SECONDS` sets the minimum spacing
   between regular sets (default 15); ordinary judge activity can delay them.
   `DELIVERY_WEEKLY_ENABLED` no longer schedules rounds.
5. Set `DELIVERY_MATCH_CONCURRENCY=2` on all intended workers only after checking
   CPU, normal judge latency, and timeouts. The default is one global match; the
   two-slot mode still fences claims in PostgreSQL. Running matches can finish
   when an ordinary job arrives, but no new delivery match starts until priority
   work clears.
6. Workers keep a bounded per-process cache of successful compilations for
   registered bot versions (48 entries, 32 MiB total, at most 4 MiB each).
   Supported artifacts are copied into new sandbox workspaces, never mounted
   in a shared writable directory. Oversized artifacts, Python/PyPy bytecode,
   and private trials are not cached. Set `DELIVERY_COMPILE_CACHE=0` to disable.
7. `DELIVERY_ARENA_MODE=legacy` retains the old capped batch view for regression
   checks or a small-field recovery. Keep web and worker mode consistent. Do not
   switch a field larger than the old cap to legacy mode; pause or disable the
   arena instead. No setting change is needed for the default ladder mode.

Run `npm run test:delivery` for rules and process tests. To run the DB integration
suite, migrate an isolated PostgreSQL database named `ojp_delivery_test`
on `127.0.0.1`, set `DELIVERY_TEST_DATABASE_URL` to that database, and run
`npm run test:delivery:integration`. The suite clears the arena tables there.
Judge Checks runs both `npm run test:delivery:http` (legacy) and
`npm run test:delivery:ladder:http` with a built web instance and isolated
workers to verify the full lifecycle.
