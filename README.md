# OJP (AtCoder-like Platform MVP)

`atcoder_like_platform_spec_draft.md` をもとに、Next.js App Router で実装した AtCoder 風オンラインジャッジの MVP プロトタイプです。

## 実装済み機能

- 問題一覧 / 問題詳細 / 解説ページ
- 問題作成 / 問題編集
- ZIP 取り込みによる問題文・制約・ジャッジ設定の自動入力
- 問題作成ページ上での手動テストケース編集
  - サンプルケース編集
  - グループ編集
  - ケース追加・編集・並び替え
  - special judge 設定
  - 保存前テスト実行
  - 既存 package の manifest 遅延読込
  - testcase 本文のオンデマンド読込
- 提出フォーム / 提出一覧 / 提出詳細
- 問題ページ下部からの直接提出
- コンテスト一覧 / コンテスト詳細 / 順位表
- コンテスト作成 / コンテスト編集 / 参加
- プロフィール編集
- プロフィール統計表示
- 通報作成
- 管理者画面
  - 通報管理
  - ユーザー凍結 / 解除
  - ロール変更
  - 問題 / コンテスト非公開化
  - 問題 / コンテスト削除
  - 再ジャッジ要求確認
  - ジャッジキュー診断
- GitHub / Google OAuth ログイン
- Cloudflare R2 への問題 package 保存
- worker dyno による非同期 judge

## 現在のアーキテクチャ

### 永続化

このプロジェクトは 2 系統の永続化を使っています。

1. `AppState` JSON snapshot
- ユーザー
- 問題メタデータ
- コンテスト
- 通報
- 監査ログ
- 再ジャッジ要求
- そのほかアプリ全体の基本状態

2. 専用テーブル / object storage
- `JudgeJob`: 提出ジャッジ用ジョブキュー
- `PackageJob`: package apply / preview 用ジョブキュー
- `SubmissionRuntimeState`: 提出の runtime 状態
- `SubmissionRuntimeTestResult`: testcase ごとの runtime 結果
- `WorkerLease`: AppState 書き込み用 lease
- Cloudflare R2: 問題 package ZIP 本体

### worker モデル

- `web`: 通常のページ表示、提出受付、問題 package upload、job enqueue を担当
- `worker`: `JudgeJob` / `PackageJob` を処理
- job claim は PostgreSQL の `FOR UPDATE SKIP LOCKED` を使います
- 複数 worker を起動しても同じ job を二重取得しない構成です
- ただし `Problem` などの本体メタデータはまだ `AppState` 側にあるため、AppState 書き換えが必要な job は内部で lease を取って直列化します

### 問題 package の読み込み方

- 問題詳細ページ:
  `Problem.sampleCases` を優先表示し、必要な場合だけ samples を遅延読込します
- 問題編集ページ:
  初期表示では package 全体を展開せず、manifest を読み込んで group / case 一覧だけを表示します
- testcase 本文は、編集時に選択したケースだけオンデマンドで取得します
- 保存 / test run / ZIP export の直前に、未読込 testcase が残っていれば必要分を読み込みます

## 仕様との対応

- 公開範囲: `public / unlisted / private`
- 提出状態:
  `pending / queued / compiling / running / judging / accepted / wrong_answer / time_limit_exceeded / memory_limit_exceeded / runtime_error / compilation_error / internal_error / cancelled`
- 初期対応言語: `C++ / Python / Java / JavaScript`
- 順位表: 問題ごとの最高点 + ペナルティで集計
- 順位表公開: `hidden / partial / full`
- 提出詳細の公開粒度:
  `group_only / case_index_only / case_name_visible`
- 他人提出コードの非公開:
  本人または管理者のみ全文閲覧可
- 作成権限:
  - 問題作成: `problem_author` または `admin`
  - コンテスト作成: `contest_organizer` または `admin`
- 提出レート制限:
  - 同一ユーザー・同一問題の通常提出クールダウン: 10 秒
  - 同一ユーザーの通常提出上限: 1 分あたり 20 件
- 再ジャッジ制限:
  - 同一ユーザー: 1 分あたり 3 件
  - 同一ユーザー・同一問題: 60 秒クールダウン
- コンテスト提出制約:
  - 参加済みユーザーのみ提出可
  - 開催中 (`running`) のみ提出可
  - 問題がコンテストセットに含まれる場合のみ提出可
- 表示名変更:
  - 30 日クールダウン
  - 表示名一意制約
  - 監査ログ記録

## judge の現在仕様

- judge は非同期です:
  `pending -> queued -> compiling -> running -> judging -> final`
- 問題 ZIP が登録されている問題は `config.json` と `tests/*` を使って実行ジャッジします
- 比較方式:
  `exact / ignore_trailing_spaces`
- 採点方式:
  `binary / sum_of_groups`
- 判定優先順:
  `CE > IE > RE > MLE > TLE > WA > AC`
- special judge:
  `cpp / python / java / javascript` で checker を実装可能
- package 未設定問題は `internal_error` になります
- `judgeEnvironmentVersion` を提出に保存します

### 実行時間表示

- 表示用の実行時間は 1ms 単位の wall-clock です
- `/usr/bin/time` が使える環境では CPU time も内部で取得しています
- 強制停止用の timeout は wall-clock ベースです

## 起動

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開いてください。

## GitHub / Google OAuth 設定

`.env.local` に以下を設定してください。

```bash
AUTH_SECRET="replace-with-long-random-string"
AUTH_GITHUB_ID="github-oauth-client-id"
AUTH_GITHUB_SECRET="github-oauth-client-secret"
AUTH_GOOGLE_ID="google-oauth-client-id"
AUTH_GOOGLE_SECRET="google-oauth-client-secret"
JUDGE_ENVIRONMENT_VERSION="v1"
```

OAuth callback URL:

- GitHub local:
  `http://localhost:3000/api/auth/callback/github`
- GitHub Heroku:
  `https://<your-app-name>.herokuapp.com/api/auth/callback/github`
- Google local:
  `http://localhost:3000/api/auth/callback/google`
- Google Heroku:
  `https://<your-app-name>.herokuapp.com/api/auth/callback/google`

### PKCE エラーについて

OAuth サインインで
`InvalidCheck: pkceCodeVerifier value could not be parsed`
が出る場合は、まず secret の整合性を確認してください。

- 固定の `AUTH_SECRET` を Config Vars に設定する
- 旧名の `NEXTAUTH_SECRET` も使用可能
- サインイン開始から callback までの間に secret を変えない
- secret を変えた後はブラウザ cookie を一度削除する

## Heroku Container デプロイ

このリポジトリには `Dockerfile` と `heroku.yml` が含まれており、judge に必要な実行環境
`g++ / python3 / javac / java / node`
を同梱できます。

```bash
heroku stack:set container -a <your-app-name>
git push heroku main
```

初回または schema 変更時:

```bash
heroku run -- npm run db:push -a <your-app-name>
```

ツールチェーン確認:

```bash
heroku run "node -v && python3 --version && g++ --version && javac -version && java -version" -a <your-app-name>
```

worker を有効化:

```bash
heroku ps:scale web=1 worker=1 -a <your-app-name>
```

複数 worker:

```bash
heroku ps:scale web=1 worker=3 -a <your-app-name>
```

補足:

- `web=1` は引き続き推奨です
- `worker` は複数 dyno を起動できます
- `JudgeJob` / `PackageJob` は DB claim (`SKIP LOCKED`) により複数 worker 対応です
- ただし AppState 書き換えが必要な処理は lease により直列化されます
- package 未設定問題は `internal_error` になります

## DB セットアップ (Prisma / PostgreSQL)

```bash
npm run db:prepare
```

個別実行:

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

`DATABASE_URL` 未設定時は次を既定値として使います。

```bash
postgresql://postgres:postgres@localhost:15432/ojp?schema=public
```

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
- `/problems/[problemId]/explanation`
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

- `GET/POST /api/auth/*`
- `GET /api/me`
- `PATCH /api/me/profile`
- `GET /api/problems`
- `POST /api/problems`
- `GET /api/problems/:problemId`
- `PATCH /api/problems/:problemId`
- `POST /api/problems/:problemId/publish`
- `POST /api/problems/:problemId/unpublish`
- `POST /api/problem-packages/inspect`
- `POST /api/problem-packages/test`
- `PUT /api/problem-packages/upload`
- `GET /api/package-jobs/:jobId`
- `GET /api/problems/:problemId/package`
- `PUT /api/problems/:problemId/package`
- `GET /api/problems/:problemId/package/manifest`
- `POST /api/problems/:problemId/package`
- `GET /api/problems/:problemId/package/testcase?groupName=&caseName=`
- `POST /api/problems/:problemId/package/manual`
- `GET /api/problems/:problemId/samples`
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
- `POST /api/admin/problems/:problemId/delete`
- `POST /api/admin/problems/:problemId/hide`
- `POST /api/admin/problems/:problemId/explanation/hide`
- `POST /api/admin/contests/:contestId/delete`
- `POST /api/admin/contests/:contestId/hide`

一覧系 API (`/api/problems`, `/api/contests`, `/api/submissions`, `/api/admin/reports`) は
`page`, `limit`, `cursor` をサポートします。

## Problem ZIP Format

問題作成 / 編集ページでは、次の 2 つの方法で judge package を扱えます。

- ZIP import:
  `statement.md` と `config.json` からフォームを自動入力
- Manual editor:
  samples / groups / cases / score / checker をページ上で直接編集
- 既存問題の編集ページ:
  - stored ZIP は必要時だけ manifest を読み込み
  - testcase 本文は選択時に遅延読込
  - 保存 / test run / ZIP export の直前に未読込 testcase があれば追加で読込
- 保存 / test run:
  - R2 が有効なら ZIP を object storage にアップロードして worker job を実行
  - client は package job を polling して完了を待つ
  - R2 無効時は一部処理が direct fallback になります

### 期待される構成

```text
problem-package.zip
|- statement.md
|- config.json
|- samples/
|  |- sample1.in
|  |- sample1.out
|  |- sample2.in
|  `- sample2.out
|- checker/
|  `- Main.py
`- tests/
   |- group1/
   |  |- 01.in
   |  |- 01.out
   |  `- 02.in
   `- group2/
      |- 01.in
      `- 01.out
```

### `config.json` fields

- `timeLimitMs`
- `memoryLimitMb`
- `scoringType`:
  `binary` or `sum_of_groups`
- `checkerType`:
  `exact` or `special_judge`
- `checkerLanguage`:
  `checkerType` が `special_judge` のとき必須
- `compareMode`:
  `exact` or `ignore_trailing_spaces`
- `groups`:
  `"group1"` または `{ "name": "group1", "score": 50 }`

### 採点ルール

- 全 group に `score` がある場合:
  合計 100 点で部分点採点
- 全 group で `score` 省略時:
  binary 採点
- `score` あり / なし の混在は不可

### special judge

- `checkerType: "special_judge"` を指定
- `checkerLanguage` を `cpp / python / java / javascript` から選ぶ
- checker ソースは次のいずれかに置く
  - `checker/Main.cpp`
  - `checker/Main.py`
  - `checker/Main.java`
  - `checker/Main.js`
- checker には次の 3 引数が渡されます
  - 入力ファイルパス
  - reference output ファイルパス
  - contestant output ファイルパス
- exit code:
  - `0` = AC
  - `1` = WA
  - その他 = judge error (`internal_error`)

### 検証ルール

- `samples/` と `tests/<group>/` の `.in/.out` ペアが必須
- `tests[]` は省略可能で、未指定時はディレクトリから自動検出
- path traversal と oversized ZIP/file payload は拒否

### テンプレート生成

```bash
npm run template:problem-zip
npm run template:problem-zip -- --mode partial --output ./my-problem.zip
npm run template:problem-zip -- --mode binary --groups 3 --tests-per-group 4
```

## Problem Detail Samples

- 問題詳細ページは `Problem.sampleCases` を優先して表示
- 既存問題で `sampleCases` が未保存の場合のみ `/api/problems/:problemId/samples` から遅延取得
- このため problem detail の初期表示で package 全体を server-side 展開しません

## Problem Difficulty

- 各問題に整数 difficulty を設定可能
- AtCoder 風のレーティング値を想定
  - 例: `400 / 800 / 1200`

## Site Header / Footer Links

外部リンク URL は次で設定します。

- `lib/site-links.ts`

```ts
export const SITE_SOCIAL_LINKS = {
  github: "https://github.com/replace-this",
  twitter: "https://x.com/replace-this",
} as const;
```

## Cloudflare R2

問題 package ZIP を DB スナップショットへ埋め込まず、Cloudflare R2 に保存できます。

必要な環境変数:

```bash
R2_BUCKET="your-bucket-name"
R2_ACCOUNT_ID="your-cloudflare-account-id"
R2_ACCESS_KEY_ID="your-r2-access-key-id"
R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
# 代わりに明示 endpoint を使う場合
# R2_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
```

移行手順:

1. R2 bucket を作成する
2. R2 用の Access Key / Secret を作成する
3. 上の環境変数を設定してデプロイする
4. 管理画面の `Object Storage Migration` から `Migrate Problem ZIPs to R2` を実行する

補足:

- 新しく登録・更新した問題 package は自動で R2 に保存されます
- package の展開結果はメモリ cache に一部保持されますが、大きい package はサーバーメモリに常駐させない設計です
- save / preview は object storage + worker job 経由で進めます

## DB-only Persistence Mode

object storage なしでも小規模運用できます。

- アプリ状態は Postgres (`AppState`) に JSON snapshot として保存
- 問題 package や preview は一部 direct fallback で動作
- `STORE_DB_SYNC=1` (既定) で DB 同期を有効化

補足:

- `web=1` は引き続き推奨です
- `worker` は複数起動可能ですが、AppState を書き換える処理は部分的に lease で直列化されます
- 大きなテスト資産は R2 の利用を前提にした方が安全です

## Legacy DB Enum Migration

`npm run db:push` が
`invalid input value for enum "SubmissionStatus_new": "AC"`
のような enum エラーで止まる場合は、先に次を一度だけ実行してください。

```bash
npm run db:migrate:legacy-status
npm run db:push -- --accept-data-loss
```
