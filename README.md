# OJP (AtCoder-like Platform MVP)

`atcoder_like_platform_spec_draft.md` をもとに、Next.js App Router で実装した
AtCoder風プラットフォームのMVPプロトタイプです。

## 実装済み機能

- 問題一覧 / 問題詳細
- 問題作成 / 問題編集
- 提出フォーム / 提出一覧 / 提出詳細
- コンテスト一覧 / コンテスト詳細 / 順位表
- コンテスト作成 / コンテスト編集 / 参加
- プロフィール編集（表示名・自己紹介）
- 通報作成
- 管理者画面（通報管理、ユーザー凍結、問題/コンテスト非公開化）
- 管理者画面（通報管理、ユーザー凍結/解除、作成ロール変更、問題/コンテスト非公開化）
- 再ジャッジ要求

## 仕様との対応

- 公開範囲: `public / unlisted / private`
- 提出状態: `pending / queued / compiling / running / judging / accepted / wrong_answer / time_limit_exceeded / memory_limit_exceeded / runtime_error / compilation_error / internal_error / cancelled`
- 初期言語: `C++ / Python / Java / JavaScript`
- 順位表: 問題ごとの最高点 + ペナルティで集計
- 順位表公開: `hidden / partial / full` を反映
- 提出詳細の公開粒度: `group_only / case_index_only / case_name_visible`
- 他人提出コードの非公開: 本人または管理者のみ全文閲覧可
- 作成権限:
  - 問題作成は `problem_author` または `admin`
  - コンテスト作成は `contest_organizer` または `admin`
- 提出レート制限:
  - 同一ユーザー・同一問題の通常提出クールダウン: 10秒
  - 同一ユーザーの通常提出上限: 1分あたり20件
- 再ジャッジ制限:
  - 同一ユーザー: 1分あたり3件
  - 同一ユーザー・同一問題: 60秒クールダウン
- コンテスト提出制約:
  - 参加済みユーザーのみ提出可
  - 開催中 (`running`) のみ提出可
  - 問題がコンテストセットに含まれる場合のみ提出可
- 表示名変更:
  - 30日クールダウン
  - 表示名一意制約
  - 監査ログ記録
- 問題ZIP検証API:
  - `POST /api/problems/:problemId/package`
  - 必須ファイル・`.in/.out` ペア・path traversal・容量上限を検証
  - 検証成功時に `timeLimitMs / memoryLimitMb / supportedLanguages` を問題設定へ反映

## 実装上の制約

- 永続化は未実装で、基本はインメモリストアです。
- 認証は GitHub OAuth ログインです（`next-auth`）。
- 初回ログイン時は、GitHubアカウント情報からアプリ内ユーザーを自動作成します。
- ジャッジは非同期です（`pending -> queued -> compiling -> running -> judging -> final`）。
- 問題ZIPが登録されている問題は、`config.json` と `tests/*` を使って実行ジャッジします。
  - 対応言語: `C++ / Python / Java / JavaScript`
  - 比較方式: `exact / ignore_trailing_spaces`
  - 採点方式: `binary / sum_of_groups`
- 判定優先順は仕様通り `CE > IE > RE > MLE > TLE > WA > AC` です。
- 問題ZIPが未登録の問題は `internal_error` になります（seedの `p1000 / p1001` は埋め込みパッケージあり）。
- 採点時の `judgeEnvironmentVersion` を提出に保存します（既定: `v1`）。
- Prisma / PostgreSQL を用意して、スナップショットの seed で初期データ投入できます。

## 起動

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開いてください。

## GitHub OAuth 設定

`.env.local` に以下を設定してください。

```bash
AUTH_SECRET="replace-with-long-random-string"
AUTH_GITHUB_ID="github-oauth-client-id"
AUTH_GITHUB_SECRET="github-oauth-client-secret"
JUDGE_ENVIRONMENT_VERSION="v1"
```

GitHub OAuth App 側には、利用環境に合わせて Callback URL を設定してください。

- ローカル開発: `http://localhost:3000/api/auth/callback/github`
- Heroku例: `https://<your-app-name>.herokuapp.com/api/auth/callback/github`

`AUTH_SECRET` は `openssl rand -base64 32` などで生成した十分に長いランダム文字列を推奨します。

## Heroku Container デプロイ

このリポジトリには `Dockerfile` と `heroku.yml` が含まれており、
judge に必要な実行環境（`g++ / python3 / javac / java / node`）を同梱できます。

手順:

```bash
heroku stack:set container -a <your-app-name>
git push heroku main
```

初回またはスキーマ変更時:

```bash
heroku run npm run db:push -a <your-app-name>
```

ツールチェーン確認:

```bash
heroku run "node -v && python3 --version && g++ --version && javac -version && java -version" -a <your-app-name>
```

注意:
- 現在はインメモリストアのため、Heroku では `web=1` を推奨します（複数dynoで状態共有されません）。
- 問題ZIP未設定の問題は `internal_error` になります。
- `JUDGE_ENVIRONMENT_VERSION` を Config Vars に設定すると提出へ記録されます（未設定時は `v1`）。

## DB セットアップ（Prisma / PostgreSQL）

1コマンドで起動・スキーマ反映・seed まで実行できます。

```bash
npm run db:prepare
```

注意:
- 既存データがある外部DBに `DATABASE_URL` を向けた場合、`npm run db:push` はデータ損失警告で停止します。
- 開発用にはローカルDB（Docker）を使うか、外部DBを使う場合は対象スキーマを事前に確認してください。
- `.env.example` はテンプレートです。実値は `.env.local` で管理してください（`.env.local` は Git 追跡対象外）。

個別に実行する場合:

```bash
npm run db:up
npm run db:generate
npm run db:push
npm run db:seed
```

停止:

```bash
npm run db:down
```

データも削除して停止:

```bash
npm run db:down:volumes
```

Prisma Studio:

```bash
npm run db:studio
```

`DATABASE_URL` を未設定の場合、ローカル開発用の既定値
`postgresql://postgres:postgres@localhost:15432/ojp?schema=public`
を利用します。

## 検証コマンド

```bash
npm run lint
npm run build
```

## 主なページ

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

## API エンドポイント

- `GET/POST /api/auth/*` (next-auth)
- `GET /api/me`
- `PATCH /api/me/profile`
- `GET /api/problems`
- `POST /api/problems`
- `GET /api/problems/:problemId`
- `PATCH /api/problems/:problemId`
- `POST /api/problems/:problemId/publish`
- `POST /api/problems/:problemId/unpublish`
- `POST /api/problems/:problemId/package`
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

一覧系API (`/api/problems`, `/api/contests`, `/api/submissions`, `/api/admin/reports`) は
`page`, `limit`, `cursor` クエリをサポートします。

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
