# OJP (AtCoder-like Platform MVP)

`atcoder_like_platform_spec_draft.md` をもとに、Next.js App Router で実装した
AtCoder 風プラットフォームの MVP プロトタイプです。

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
  - 作成ロール変更
  - 問題 / コンテスト非公開化
  - 問題 / コンテスト削除
  - 再ジャッジ要求確認
  - ジャッジキュー修復
- GitHub / Google OAuth ログイン

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
- 問題 ZIP 検証 API:
  - `GET/POST /api/problems/:problemId/package`
  - 必須ファイル・`.in/.out` ペア・path traversal・容量上限を検証
  - 検証成功時に `timeLimitMs / memoryLimitMb / scoringType` を問題設定へ反映

## 実装上の制約

- アプリ状態は PostgreSQL の `AppState` テーブルへ JSON スナップショットとして保存します。
- 問題パッケージと提出コードは DB 管理状態に保持されます。
- judge は非同期です:
  `pending -> queued -> compiling -> running -> judging -> final`
- 問題 ZIP が登録されている問題は `config.json` と `tests/*` を使って実行ジャッジします。
  - 提出言語: `C++ / Python / Java / JavaScript`
  - 比較方式: `exact / ignore_trailing_spaces`
  - 採点方式: `binary / sum_of_groups`
  - special judge:
    `cpp / python / java / javascript` で checker を実装可能
- 判定優先順:
  `CE > IE > RE > MLE > TLE > WA > AC`
- 問題 ZIP / 手動 package 未設定の問題は `internal_error` になります。
- `judgeEnvironmentVersion` を提出に保存します。

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

`AUTH_SECRET` は `openssl rand -base64 32` などで生成した十分に長いランダム文字列を推奨します。

### PKCE エラーについて

OAuth サインインで
`InvalidCheck: pkceCodeVerifier value could not be parsed`
が出る場合は、まず secret の整合性を確認してください。

- 固定の `AUTH_SECRET` を Config Vars に設定する
- 旧名の `NEXTAUTH_SECRET` も使用可能
- サインイン開始から callback までの間に secret を変えない
- secret を変えた後はブラウザ cookie を一度削除する

## Heroku Container デプロイ

このリポジトリには `Dockerfile` と `heroku.yml` が含まれており、
judge に必要な実行環境
`g++ / python3 / javac / java / node`
を同梱できます。

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

- `web=1` は引き続き推奨です
- `worker` は複数 dyno を起動できます
  - ただし `AppState` JSON snapshot 構成のため、queue drain は Postgres の worker lease を取った leader 1 台が担当します
  - 追加 worker は leader 障害時の failover として待機します
- package 未設定問題は `internal_error` になります
- `JUDGE_ENVIRONMENT_VERSION` を Config Vars に設定すると提出へ記録されます

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

## DB-only Persistence Mode

このアプリは object storage なしでも小規模運用できます。

- アプリ状態は Postgres (`AppState`) に JSON スナップショットで保存
- 提出コードと package 派生データも DB 管理状態に保持
- `STORE_DB_SYNC=1` (既定) で同期を有効化

注意:

- `web=1` は引き続き推奨
- `worker` は複数起動可能だが、leader lease により 1 台が active drain を担当
- 大きなテスト資産は将来的に object storage へ分離した方が安全

## Legacy DB Enum Migration

`npm run db:push` が
`invalid input value for enum "SubmissionStatus_new": "AC"`
のような enum エラーで止まる場合は、先に次を一度だけ実行してください。

```bash
npm run db:migrate:legacy-status
npm run db:push -- --accept-data-loss
```

## Problem ZIP Format

問題作成 / 編集ページでは、次の 2 つの方法で judge package を扱えます。

- ZIP import:
  `statement.md` と `config.json` からフォームを自動入力
- 既存問題の編集ページでは:
  stored ZIP を必要な時だけ読み込むため、大きい package でも初期表示は軽量
  - package manifest だけ先に読み込む
  - testcase 本文は選択時に遅延取得
  - 保存 / test run / ZIP export の直前に、未読込 testcase があれば読み込む
- 保存 / test run:
  - ZIP はまず object storage へ送信
  - 重い package apply / preview は worker で実行
  - client は package job を polling して完了を待つ
- Manual editor:
  samples / groups / cases / score / checker をページ上で直接編集
  - special judge の checker フィールドには言語別テンプレートを自動入力

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

## Problem Detail Samples

- 問題詳細ページは `Problem.sampleCases` を優先して表示
- 既存問題で `sampleCases` が未保存の場合のみ `/api/problems/:problemId/samples` から遅延取得
- これにより problem detail の初期表示で package 全体を server-side 展開しません

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

## Problem Difficulty

- 各問題に整数 difficulty を設定可能
- AtCoder 風のレーティング値を想定
  - 例: `400 / 800 / 1200`

## Site Header Links

ヘッダーの外部リンク URL は次で設定します。

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
- package の展開結果はメモリ cache に保持され、DB スナップショットには object ref のみ保存されます
- 既存の埋め込み package は migration 実行で zip 再構築して R2 へ移行できます

## Judge Worker Dyno

Heroku container では judge を `worker` dyno に分離できます。

- `web`: `JUDGE_PROCESS_MODE=web`
- `worker`: `JUDGE_PROCESS_MODE=worker`

`heroku.yml` には両 process を定義済みです。デプロイ後に次を実行してください。

```bash
heroku ps:scale web=1 worker=1 -a <your-app-name>
```

補足:

- local / 単一プロセス運用では `JUDGE_PROCESS_MODE` 未設定時に `inline` で従来どおり動きます
- worker は DB snapshot をポーリングして queue を拾います
- queue 追加と rejudge は即時 persist するようにしてあるので、worker 側へ比較的早く伝播します
