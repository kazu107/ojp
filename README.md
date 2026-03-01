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
- 再ジャッジ要求

## 仕様との対応

- 公開範囲: `public / unlisted / private`
- 判定種別: `AC / WA / TLE / MLE / RE / CE / IE / WJ`
- 初期言語: `C++ / Python / Java / JavaScript`
- 順位表: 問題ごとの最高点 + ペナルティで集計
- 順位表公開: `hidden / partial / full` を反映
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

## 実装上の制約

- 永続化は未実装で、基本はインメモリストアです。
- 認証は GitHub OAuth の代わりに固定の現在ユーザーを使用しています。
- ジャッジは疑似判定です。
- Prisma / PostgreSQL を用意して、スナップショットの seed で初期データ投入できます。

疑似判定では提出コードに次の文字列を含めると判定を再現できます。

- `wrong_answer` -> `WA`
- `time_limit` -> `TLE`
- `memory_limit` -> `MLE`
- `runtime_error` -> `RE`
- `compile_error` -> `CE`
- `internal_error` -> `IE`

## 起動

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開いてください。

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

- `GET /api/me`
- `PATCH /api/me/profile`
- `GET /api/problems`
- `POST /api/problems`
- `GET /api/problems/:problemId`
- `PATCH /api/problems/:problemId`
- `POST /api/submissions`
- `GET /api/submissions/:submissionId`
- `POST /api/submissions/:submissionId/rejudge`
- `GET /api/contests`
- `POST /api/contests`
- `GET /api/contests/:contestId`
- `PATCH /api/contests/:contestId`
- `POST /api/contests/:contestId/join`
- `GET /api/contests/:contestId/scoreboard`
- `POST /api/reports`
- `GET /api/admin/reports`
- `POST /api/admin/reports/:reportId/status`
- `POST /api/admin/users/:userId/freeze`
- `POST /api/admin/problems/:problemId/hide`
- `POST /api/admin/contests/:contestId/hide`
