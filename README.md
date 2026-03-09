# OJP (AtCoder-like Platform MVP)

`atcoder_like_platform_spec_draft.md` 繧偵ｂ縺ｨ縺ｫ縲¨ext.js App Router 縺ｧ螳溯｣・＠縺・AtCoder鬚ｨ繝励Λ繝・ヨ繝輔か繝ｼ繝縺ｮMVP繝励Ο繝医ち繧､繝励〒縺吶・
## 螳溯｣・ｸ医∩讖溯・

- 蝠城｡御ｸ隕ｧ / 蝠城｡瑚ｩｳ邏ｰ
- 蝠城｡御ｽ懈・ / 蝠城｡檎ｷｨ髮・- 謠仙・繝輔か繝ｼ繝 / 謠仙・荳隕ｧ / 謠仙・隧ｳ邏ｰ
- 繧ｳ繝ｳ繝・せ繝井ｸ隕ｧ / 繧ｳ繝ｳ繝・せ繝郁ｩｳ邏ｰ / 鬆・ｽ崎｡ｨ
- 繧ｳ繝ｳ繝・せ繝井ｽ懈・ / 繧ｳ繝ｳ繝・せ繝育ｷｨ髮・/ 蜿ょ刈
- 繝励Ο繝輔ぅ繝ｼ繝ｫ邱ｨ髮・ｼ郁｡ｨ遉ｺ蜷阪・閾ｪ蟾ｱ邏ｹ莉具ｼ・- 騾壼ｱ菴懈・
- 邂｡逅・・判髱｢・磯壼ｱ邂｡逅・√Θ繝ｼ繧ｶ繝ｼ蜃咲ｵ舌∝撫鬘・繧ｳ繝ｳ繝・せ繝磯撼蜈ｬ髢句喧・・- 邂｡逅・・判髱｢・磯壼ｱ邂｡逅・√Θ繝ｼ繧ｶ繝ｼ蜃咲ｵ・隗｣髯､縲∽ｽ懈・繝ｭ繝ｼ繝ｫ螟画峩縲∝撫鬘・繧ｳ繝ｳ繝・せ繝磯撼蜈ｬ髢句喧・・- 蜀阪ず繝｣繝・ず隕∵ｱ・
## 莉墓ｧ倥→縺ｮ蟇ｾ蠢・
- 蜈ｬ髢狗ｯ・峇: `public / unlisted / private`
- 謠仙・迥ｶ諷・ `pending / queued / compiling / running / judging / accepted / wrong_answer / time_limit_exceeded / memory_limit_exceeded / runtime_error / compilation_error / internal_error / cancelled`
- 蛻晄悄險隱・ `C++ / Python / Java / JavaScript`
- 鬆・ｽ崎｡ｨ: 蝠城｡後＃縺ｨ縺ｮ譛鬮倡せ + 繝壹リ繝ｫ繝・ぅ縺ｧ髮・ｨ・- 鬆・ｽ崎｡ｨ蜈ｬ髢・ `hidden / partial / full` 繧貞渚譏
- 謠仙・隧ｳ邏ｰ縺ｮ蜈ｬ髢狗ｲ貞ｺｦ: `group_only / case_index_only / case_name_visible`
- 莉紋ｺｺ謠仙・繧ｳ繝ｼ繝峨・髱槫・髢・ 譛ｬ莠ｺ縺ｾ縺溘・邂｡逅・・・縺ｿ蜈ｨ譁・夢隕ｧ蜿ｯ
- 菴懈・讓ｩ髯・
  - 蝠城｡御ｽ懈・縺ｯ `problem_author` 縺ｾ縺溘・ `admin`
  - 繧ｳ繝ｳ繝・せ繝井ｽ懈・縺ｯ `contest_organizer` 縺ｾ縺溘・ `admin`
- 謠仙・繝ｬ繝ｼ繝亥宛髯・
  - 蜷御ｸ繝ｦ繝ｼ繧ｶ繝ｼ繝ｻ蜷御ｸ蝠城｡後・騾壼ｸｸ謠仙・繧ｯ繝ｼ繝ｫ繝繧ｦ繝ｳ: 10遘・  - 蜷御ｸ繝ｦ繝ｼ繧ｶ繝ｼ縺ｮ騾壼ｸｸ謠仙・荳企剞: 1蛻・≠縺溘ｊ20莉ｶ
- 蜀阪ず繝｣繝・ず蛻ｶ髯・
  - 蜷御ｸ繝ｦ繝ｼ繧ｶ繝ｼ: 1蛻・≠縺溘ｊ3莉ｶ
  - 蜷御ｸ繝ｦ繝ｼ繧ｶ繝ｼ繝ｻ蜷御ｸ蝠城｡・ 60遘偵け繝ｼ繝ｫ繝繧ｦ繝ｳ
- 繧ｳ繝ｳ繝・せ繝域署蜃ｺ蛻ｶ邏・
  - 蜿ょ刈貂医∩繝ｦ繝ｼ繧ｶ繝ｼ縺ｮ縺ｿ謠仙・蜿ｯ
  - 髢句ぎ荳ｭ (`running`) 縺ｮ縺ｿ謠仙・蜿ｯ
  - 蝠城｡後′繧ｳ繝ｳ繝・せ繝医そ繝・ヨ縺ｫ蜷ｫ縺ｾ繧後ｋ蝣ｴ蜷医・縺ｿ謠仙・蜿ｯ
- 陦ｨ遉ｺ蜷榊､画峩:
  - 30譌･繧ｯ繝ｼ繝ｫ繝繧ｦ繝ｳ
  - 陦ｨ遉ｺ蜷堺ｸ諢丞宛邏・  - 逶｣譟ｻ繝ｭ繧ｰ險倬鹸
- 蝠城｡兄IP讀懆ｨｼAPI:
  - `POST /api/problems/:problemId/package`
  - 蠢・医ヵ繧｡繧､繝ｫ繝ｻ`.in/.out` 繝壹い繝ｻpath traversal繝ｻ螳ｹ驥丈ｸ企剞繧呈､懆ｨｼ
  - 讀懆ｨｼ謌仙粥譎ゅ↓ `timeLimitMs / memoryLimitMb / scoringType` 繧貞撫鬘瑚ｨｭ螳壹∈蜿肴丐

## 螳溯｣・ｸ翫・蛻ｶ邏・
- 豌ｸ邯壼喧縺ｯ譛ｪ螳溯｣・〒縲∝渕譛ｬ縺ｯ繧､繝ｳ繝｡繝｢繝ｪ繧ｹ繝医い縺ｧ縺吶・- 隱崎ｨｼ縺ｯ GitHub OAuth 繝ｭ繧ｰ繧､繝ｳ縺ｧ縺呻ｼ・next-auth`・峨・- 蛻晏屓繝ｭ繧ｰ繧､繝ｳ譎ゅ・縲；itHub繧｢繧ｫ繧ｦ繝ｳ繝域ュ蝣ｱ縺九ｉ繧｢繝励Μ蜀・Θ繝ｼ繧ｶ繝ｼ繧定・蜍穂ｽ懈・縺励∪縺吶・- 繧ｸ繝｣繝・ず縺ｯ髱槫酔譛溘〒縺呻ｼ・pending -> queued -> compiling -> running -> judging -> final`・峨・- 蝠城｡兄IP縺檎匳骭ｲ縺輔ｌ縺ｦ縺・ｋ蝠城｡後・縲～config.json` 縺ｨ `tests/*` 繧剃ｽｿ縺｣縺ｦ螳溯｡後ず繝｣繝・ず縺励∪縺吶・  - 蟇ｾ蠢懆ｨ隱・ `C++ / Python / Java / JavaScript`
  - 豈碑ｼ・婿蠑・ `exact / ignore_trailing_spaces`
  - 謗｡轤ｹ譁ｹ蠑・ `binary / sum_of_groups`
- 蛻､螳壼━蜈磯・・莉墓ｧ倬壹ｊ `CE > IE > RE > MLE > TLE > WA > AC` 縺ｧ縺吶・- 蝠城｡兄IP縺梧悴逋ｻ骭ｲ縺ｮ蝠城｡後・ `internal_error` 縺ｫ縺ｪ繧翫∪縺呻ｼ・eed縺ｮ `p1000 / p1001` 縺ｯ蝓九ａ霎ｼ縺ｿ繝代ャ繧ｱ繝ｼ繧ｸ縺ゅｊ・峨・- 謗｡轤ｹ譎ゅ・ `judgeEnvironmentVersion` 繧呈署蜃ｺ縺ｫ菫晏ｭ倥＠縺ｾ縺呻ｼ域里螳・ `v1`・峨・- Prisma / PostgreSQL 繧堤畑諢上＠縺ｦ縲√せ繝翫ャ繝励す繝ｧ繝・ヨ縺ｮ seed 縺ｧ蛻晄悄繝・・繧ｿ謚募・縺ｧ縺阪∪縺吶・
## 襍ｷ蜍・
```bash
npm install
npm run dev
```

繝悶Λ繧ｦ繧ｶ縺ｧ `http://localhost:3000` 繧帝幕縺・※縺上□縺輔＞縲・
## GitHub OAuth 險ｭ螳・
`.env.local` 縺ｫ莉･荳九ｒ險ｭ螳壹＠縺ｦ縺上□縺輔＞縲・
```bash
AUTH_SECRET="replace-with-long-random-string"
AUTH_GITHUB_ID="github-oauth-client-id"
AUTH_GITHUB_SECRET="github-oauth-client-secret"
JUDGE_ENVIRONMENT_VERSION="v1"
```

GitHub OAuth App 蛛ｴ縺ｫ縺ｯ縲∝茜逕ｨ迺ｰ蠅・↓蜷医ｏ縺帙※ Callback URL 繧定ｨｭ螳壹＠縺ｦ縺上□縺輔＞縲・
- 繝ｭ繝ｼ繧ｫ繝ｫ髢狗匱: `http://localhost:3000/api/auth/callback/github`
- Heroku萓・ `https://<your-app-name>.herokuapp.com/api/auth/callback/github`

`AUTH_SECRET` 縺ｯ `openssl rand -base64 32` 縺ｪ縺ｩ縺ｧ逕滓・縺励◆蜊∝・縺ｫ髟ｷ縺・Λ繝ｳ繝繝譁・ｭ怜・繧呈耳螂ｨ縺励∪縺吶・
## Heroku Container 繝・・繝ｭ繧､

縺薙・繝ｪ繝昴ず繝医Μ縺ｫ縺ｯ `Dockerfile` 縺ｨ `heroku.yml` 縺悟性縺ｾ繧後※縺翫ｊ縲・judge 縺ｫ蠢・ｦ√↑螳溯｡檎腸蠅・ｼ・g++ / python3 / javac / java / node`・峨ｒ蜷梧｢ｱ縺ｧ縺阪∪縺吶・
謇矩・

```bash
heroku stack:set container -a <your-app-name>
git push heroku main
```

蛻晏屓縺ｾ縺溘・繧ｹ繧ｭ繝ｼ繝槫､画峩譎・

```bash
heroku run npm run db:push -a <your-app-name>
```

繝・・繝ｫ繝√ぉ繝ｼ繝ｳ遒ｺ隱・

```bash
heroku run "node -v && python3 --version && g++ --version && javac -version && java -version" -a <your-app-name>
```

豕ｨ諢・
- 迴ｾ蝨ｨ縺ｯ繧､繝ｳ繝｡繝｢繝ｪ繧ｹ繝医い縺ｮ縺溘ａ縲？eroku 縺ｧ縺ｯ `web=1` 繧呈耳螂ｨ縺励∪縺呻ｼ郁､・焚dyno縺ｧ迥ｶ諷句・譛峨＆繧後∪縺帙ｓ・峨・- 蝠城｡兄IP譛ｪ險ｭ螳壹・蝠城｡後・ `internal_error` 縺ｫ縺ｪ繧翫∪縺吶・- `JUDGE_ENVIRONMENT_VERSION` 繧・Config Vars 縺ｫ險ｭ螳壹☆繧九→謠仙・縺ｸ險倬鹸縺輔ｌ縺ｾ縺呻ｼ域悴險ｭ螳壽凾縺ｯ `v1`・峨・
## DB 繧ｻ繝・ヨ繧｢繝・・・・risma / PostgreSQL・・
1繧ｳ繝槭Φ繝峨〒襍ｷ蜍輔・繧ｹ繧ｭ繝ｼ繝槫渚譏繝ｻseed 縺ｾ縺ｧ螳溯｡後〒縺阪∪縺吶・
```bash
npm run db:prepare
```

豕ｨ諢・
- 譌｢蟄倥ョ繝ｼ繧ｿ縺後≠繧句､夜ΚDB縺ｫ `DATABASE_URL` 繧貞髄縺代◆蝣ｴ蜷医～npm run db:push` 縺ｯ繝・・繧ｿ謳榊､ｱ隴ｦ蜻翫〒蛛懈ｭ｢縺励∪縺吶・- 髢狗匱逕ｨ縺ｫ縺ｯ繝ｭ繝ｼ繧ｫ繝ｫDB・・ocker・峨ｒ菴ｿ縺・°縲∝､夜ΚDB繧剃ｽｿ縺・ｴ蜷医・蟇ｾ雎｡繧ｹ繧ｭ繝ｼ繝槭ｒ莠句燕縺ｫ遒ｺ隱阪＠縺ｦ縺上□縺輔＞縲・- `.env.example` 縺ｯ繝・Φ繝励Ξ繝ｼ繝医〒縺吶ょｮ溷､縺ｯ `.env.local` 縺ｧ邂｡逅・＠縺ｦ縺上□縺輔＞・・.env.local` 縺ｯ Git 霑ｽ霍｡蟇ｾ雎｡螟厄ｼ峨・
蛟句挨縺ｫ螳溯｡後☆繧句ｴ蜷・

```bash
npm run db:up
npm run db:generate
npm run db:push
npm run db:seed
```

蛛懈ｭ｢:

```bash
npm run db:down
```

繝・・繧ｿ繧ょ炎髯､縺励※蛛懈ｭ｢:

```bash
npm run db:down:volumes
```

Prisma Studio:

```bash
npm run db:studio
```

`DATABASE_URL` 繧呈悴險ｭ螳壹・蝣ｴ蜷医√Ο繝ｼ繧ｫ繝ｫ髢狗匱逕ｨ縺ｮ譌｢螳壼､
`postgresql://postgres:postgres@localhost:15432/ojp?schema=public`
繧貞茜逕ｨ縺励∪縺吶・
## 讀懆ｨｼ繧ｳ繝槭Φ繝・
```bash
npm run lint
npm run build
```

## 荳ｻ縺ｪ繝壹・繧ｸ

- `/`
- `/problems`
- `/problems/new`
- `/problems/[problemId]`
- `/problems/[problemId]/edit`
- `/problems/[problemId]/submit`
- `/submissions`
- `/submissions/[submissionId]`
- `/contests`
- `/contests/new`
- `/contests/[contestId]`
- `/contests/[contestId]/edit`
- `/me`
- `/reports/new`
- `/admin`

## API 繧ｨ繝ｳ繝峨・繧､繝ｳ繝・
- `GET/POST /api/auth/*` (next-auth)
- `GET /api/me`
- `PATCH /api/me/profile`
- `GET /api/problems`
- `POST /api/problems`
- `GET /api/problems/:problemId`
- `PATCH /api/problems/:problemId`
- `POST /api/problems/:problemId/publish`
- `POST /api/problems/:problemId/unpublish`
- `POST /api/problem-packages/inspect`
- `POST /api/problems/:problemId/package`
- `POST /api/problems/:problemId/package/manual`
- `GET /api/problems/:problemId/explanation`
- `PUT /api/problems/:problemId/explanation`
- `GET /api/announcements`
- `POST /api/submissions`
- `GET /api/submissions`
- `GET /api/submissions?mine=1&problemId=&contestId=&status=&language=&limit=`
- `GET /api/submissions/:submissionId`
- `POST /api/submissions/:submissionId/rejudge`
- `GET /api/contests`
- `POST /api/contests`
- `GET /api/contests/:contestId`
- `PATCH /api/contests/:contestId`
- `POST /api/contests/:contestId/publish`
- `POST /api/contests/:contestId/unpublish`
- `POST /api/contests/:contestId/join`
- `GET /api/contests/:contestId/scoreboard`
- `POST /api/contests/:contestId/problems`
- `DELETE /api/contests/:contestId/problems/:contestProblemId`
- `POST /api/reports`
- `GET /api/admin/reports`
- `POST /api/admin/reports/:reportId/resolve`
- `POST /api/admin/reports/:reportId/status`
- `POST /api/admin/users/:userId/freeze`
- `POST /api/admin/users/:userId/unfreeze`
- `POST /api/admin/users/:userId/role`
- `GET /api/admin/announcements`
- `POST /api/admin/announcements`
- `POST /api/admin/announcements/:announcementId/hide`
- `GET /api/admin/judge/queue`
- `POST /api/admin/judge/queue`
- `POST /api/admin/problems/:problemId/hide`
- `POST /api/admin/problems/:problemId/explanation/hide`
- `POST /api/admin/contests/:contestId/hide`

荳隕ｧ邉ｻAPI (`/api/problems`, `/api/contests`, `/api/submissions`, `/api/admin/reports`) 縺ｯ
`page`, `limit`, `cursor` 繧ｯ繧ｨ繝ｪ繧偵し繝昴・繝医＠縺ｾ縺吶・
## Google OAuth Setup

To enable Google login, add these env vars (`.env.local` or Heroku Config Vars):

```bash
AUTH_GOOGLE_ID="google-oauth-client-id"
AUTH_GOOGLE_SECRET="google-oauth-client-secret"
```

Google OAuth callback URL:
- Local: `http://localhost:3000/api/auth/callback/google`
- Heroku: `https://<your-app-name>.herokuapp.com/api/auth/callback/google`

You can keep GitHub and Google enabled at the same time.

## Auth Secret Note (PKCE)

If OAuth sign-in fails with `InvalidCheck: pkceCodeVerifier value could not be parsed`,
check secret consistency first.

- Set a fixed `AUTH_SECRET` in Config Vars.
- If you already use legacy naming, `NEXTAUTH_SECRET` is also accepted by this app.
- Do not rotate secret between the sign-in request and callback.
- After changing secret, clear browser cookies once and retry login.

## DB-only Persistence Mode

This app can run without object storage for MVP/small scale operation.

- App state is persisted to Postgres (`AppState` table) as JSON snapshot.
- Submission source and package-derived data remain in DB-managed state.
- Set `STORE_DB_SYNC=1` (default) to enable snapshot sync.

Operational notes:
- Keep `web=1` to avoid multi-process state conflicts.
- This mode is suitable for small deployments; large test assets should still move to object storage later.

## Legacy DB Enum Migration

If `npm run db:push` fails with an enum error like
`invalid input value for enum "SubmissionStatus_new": "AC"`,
run this one-time migration first:

```bash
npm run db:migrate:legacy-status
npm run db:push -- --accept-data-loss
```

This converts old verdict/status values (`AC`, `WA`, etc.) to the current
values (`accepted`, `wrong_answer`, etc.) before Prisma drops legacy enum variants.

## Problem ZIP Format

You can register problem test cases by uploading one ZIP package.

Problem create/edit page also supports:
- ZIP import with automatic form prefill from `statement.md` and `config.json`
- Manual judge package editing on the page (samples, groups, cases, scores, compare mode)

Expected structure:

```text
problem-package.zip
|- statement.md
|- config.json
|- samples/
|  |- sample1.in
|  |- sample1.out
|  |- sample2.in
|  `- sample2.out
`- tests/
   |- group1/
   |  |- 01.in
   |  |- 01.out
   |  |- 02.in
   |  `- 02.out
   `- group2/
      |- 01.in
      `- 01.out
```

`config.json` fields:
- `timeLimitMs` (number)
- `memoryLimitMb` (number)
- `scoringType` (optional: `binary` or `sum_of_groups`)
- `groups` (each item is either group name string or `{ name, score? }`)

Scoring rules:
- If every group has integer `score`, the sum must be exactly `100` (partial scoring mode).
- If `score` is omitted for all groups, binary mode is used (`all groups passed => 100`, otherwise `0`).
- Mixing scored and non-scored groups in the same package is invalid.

Validation rules:
- `.in/.out` pairs are required for `samples/` and `tests/<group>/`.
- Group test case names are auto-detected from `tests/<group>/` (no `tests[]` list required).
- Path traversal and oversized ZIP/file payloads are rejected.

Template generator:

```bash
npm run template:problem-zip
npm run template:problem-zip -- --mode partial --output ./my-problem.zip
npm run template:problem-zip -- --mode binary --groups 3 --tests-per-group 4
```


## Problem Difficulty

- Each problem has an optional integer difficulty value (difficulty).
- You can set/update it from the create/edit problem form.
- This value is intended to be compatible with AtCoder-style rating numbers (for example 400, 800, 1200).

