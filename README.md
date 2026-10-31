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
- 任意配点・部分点換算 / 順位表の自動更新 / バーチャル参加 / OJP独自Eloレーティング
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
- Markdown教材 / ブラウザ内コード実行 / 章内タブ / 確認クイズ / 練習問題 / 学習進捗
- サイト全体のUIを日本語・英語で切り替え（ヘッダーから選択、Cookieに保存）

## 表示言語

ヘッダーの「日本語 / English」でUIの表示言語を切り替えます。初期値は日本語で、選択は同じブラウザのCookieに1年間保存されます。ログインは不要です。ページ移動・再読み込みでも設定を保持し、編集中のフォーム・コードは切り替えで初期化しません。

対象は見出し、説明、フォーム、ボタン、結果表示、プロフィール、管理画面などです。問題文・解説・教材本文・クイズの問題文・コース名・ユーザー名・ソースコード・実行出力は登録された内容をそのまま表示します。未知のエラーや外部ツールの診断も原文を保持します。表示する日時は両言語とも日本時間です。

翻訳は `lib/i18n/messages.json` で管理します。DB変更や追加のConfig Varsは不要です。実装・検証手順は [日英UIの仕様](docs/i18n.md) を参照してください。

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
- `ContestVirtualParticipation`: コンテストごとの個人タイマー（1人1回）
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
- 提出言語・実行系: `C++ / Python / Java / JavaScript / Brainfuck / C / Rust / Go / C# (Mono) / Kotlin / Ruby / PyPy3`
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
  - 開催中 (`running`) の正式提出は未参加なら自動参加
  - 開催前は拒否、終了後は練習提出。バーチャルは個人の開催時間内のみ
  - 問題がコンテストセットに含まれる場合のみ提出可
  - `private` は主催者・管理者のみ、`unlisted` は直接リンクから参加可
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

- 表示用の実行時間は整数 ms です。実経過時間と CPU time から条件で選択します
- `/usr/bin/time` が使える環境では CPU time も内部で取得しています
- 強制停止用の timeout は wall-clock ベースです

### ジャッジ実行の保護

提出、checker、コンパイルは共通の実行処理を使います。DB・R2・OAuth の認証情報や `NODE_OPTIONS` / `PYTHONPATH` / `LD_PRELOAD` は子プロセスへ引き継ぎません。子プロセスの HOME と一時ディレクトリも実行用に設定します。

`JUDGE_SANDBOX` で次のモードを選べます。

| 値 | 動作 |
| --- | --- |
| `basic` (既定) | 環境変数の制限、出力量・作業ファイル量の制限、timeout 時のプロセスツリー停止。Linux では実行中の RSS / プロセス・スレッド数の監視と `prlimit` も使用 |
| `bubblewrap` | 上記に加えて、Linux namespace でファイル・ネットワーク・プロセスを隔離。実行 UID/GID は 65534。提出には自分の作業領域だけ、checker には必要なケースファイルだけを公開 |

`basic` はファイルシステムやネットワークを隔離する sandbox ではありません。環境変数を引き継がなくても、同じ権限のプログラムによるホストファイルや親プロセス情報へのアクセスまでは防げません。不特定ユーザーのコードを安全に実行するには、対応環境で `bubblewrap` を有効にするか、隔離された別の実行基盤が必要です。

Dockerfile に `bubblewrap` と `util-linux` を含めています。ただし、パッケージのインストールだけでは隔離を利用できるとは限りません。Heroku などの実行環境が Linux user namespace 等を許可している必要があります。次のコマンドはDBを更新せず、実際の隔離起動とツールチェーンを確認します。

```bash
npm run judge:doctor
npm run judge:doctor -- --sandbox=bubblewrap
heroku run "npm run judge:doctor -- --sandbox=bubblewrap" --app YOUR_APP_NAME
```

隔離ありの診断が成功した場合、Heroku Config Vars に `JUDGE_SANDBOX=bubblewrap` を設定します。隔離なしへの自動フォールバックはありません。設定した隔離を起動できなければworkerは起動時に停止し、エラー理由をログに出します。診断に失敗する環境では隔離対応のworker環境を用意してください。

#### Herokuの本番前提条件の確認

```bash
npm run judge:probe:heroku -- --app ojp
```

このコマンドは現在デプロイされているworker用イメージで一時的な診断プロセスを起動します。ローカルの診断コードを渡すため、事前デプロイは不要です。DB・R2・Config Vars・課金プランを変更せず、秘密情報は出力しません。一時dynoの稼働時間は通常のHeroku利用として扱われます。namespaceを利用できない場合や診断に失敗した場合は終了コード1を返します。

namespaceの前提条件だけの診断です。成功しても、`judge:doctor` と実際のジャッジテストが通るまでは隔離を有効化しないでください。Linux実行環境内で同じ診断を行う場合は `npm run judge:probe`、診断の回帰テストは `npm run test:ops` で実行できます。

2026-10-09の `ojp` の本番workerでは、`unprivileged_userns_clone=0`、`NoNewPrivs=1`、`Seccomp=2` で、`unshare --user --map-root-user id` が `Permission denied` になりました。現在の非特権namespace方式のbubblewrapはこの環境では利用できません。`JUDGE_SANDBOX=bubblewrap` は有効化していません。パッケージの追加やアプリのConfig Varsだけで、このホスト側の制約を解消したとは扱わないでください。

Herokuのcontainerアプリでは `heroku run --exit-code` は非対応です。使用すると、今回の環境では `command parsing error` で診断の起動自体が失敗しました。本リポジトリの診断コマンドはこのオプションを使わず、結果のJSONを検証します。参考: [Herokuのcontainer制約](https://devcenter.heroku.com/articles/container-registry-and-runtime#known-issues-and-limitations)、[bubblewrapのuser namespace要件](https://github.com/containers/bubblewrap/blob/main/README.md#user-namespaces)。

隔離の本番有効化には、必要なnamespaceが許可されたLinuxの実行基盤が必要です。Herokuのwebを残し、ジャッジworkerだけを別のLinuxサーバーに移す構成が候補です。DB・R2への接続はworker側に保持し、提出プログラムには認証情報やホストのファイルを公開しません。接続用の認証情報はGitやDockerイメージに含めず、実行時に渡してください。移設先で前提条件・4言語・checker・資源制限・結果保存を確認するまでは、本番移設を完了扱いにしません。

| 設定 | 既定値 | 対象 |
| --- | --- | --- |
| `JUDGE_MAX_OUTPUT_BYTES` | 67108864 (64 MiB) | 提出の標準出力ファイル |
| `JUDGE_MAX_WORKSPACE_BYTES` | 134217728 (128 MiB) | 実行の作業領域と一時領域のファイル合計 |
| `JUDGE_MAX_PROCESSES` | 128 | プロセス・スレッド数 |
| `JUDGE_COMPILER_MEMORY_MB` | 256 | コンパイルのRSS上限 |
| `JUDGE_CHECKER_MEMORY_MB` | 256 | checkerのRSS上限 |

提出のRSS上限は問題の `memoryLimitMb` を使います。Linuxでは約40msごとに実行ツリーを監視し、超過時に停止します。RSS監視はcgroupによる割り当て時の強制上限ではなく、瞬間的な大容量割り当てを完全に防ぐ保証はありません。WindowsではRSS監視は使用しません。

Linuxの `prlimit` でCPU時間、ファイルサイズ、open file数、core dumpを制限します。プロセス数のOS上限はbubblewrapの独立したuser namespace内で設定し、basicでは実行ツリーを監視します。同じUIDで動く別ジョブまで共通の低いプロセス上限に巻き込まないためです。標準エラーは64 KiB、コンパイル・checkerの標準出力は256 KiBまでとし、超過したプロセスを停止します。出力量・プロセス数・作業ファイル量を超えた提出はRE、メモリ超過はMLE、checkerの資源超過はIEにします。

Linuxの基本・隔離ありの両モードと4言語を検証するGitHub Actionsを追加しています。ローカルでは `npm run test:judge` を実行できます。Linux固有のテストはWindowsではskipされます。

Docker Desktopでの検証例:

```bash
docker build -t ojp:judge-validation .
docker run --rm --network none --memory 512m --pids-limit 256 --user 1000:1000 --env STORE_DB_SYNC=0 --env JUDGE_SANDBOX=basic ojp:judge-validation npm run test:judge
docker run --rm --network none --memory 512m --pids-limit 256 --security-opt seccomp=unconfined --user 1000:1000 --env STORE_DB_SYNC=0 --env JUDGE_SANDBOX=bubblewrap ojp:judge-validation npm run test:judge
```

2026-10-09に通常モード17件、隔離モード19件のテストが成功しました。隔離モードではネットワークと他の作業領域へのアクセス拒否も確認しています。Dockerの既定seccomp設定ではnamespaceの作成が拒否されたため、上記の隔離テストでは検証用コンテナに限ってseccompを緩和しています。ホストのディレクトリや認証情報は渡しません。この設定をそのまま本番運用の安全性の保証として扱わず、実際のworker環境で診断してください。

Docker build中のNext.js buildでは `STORE_DB_SYNC=0` を指定し、DBへの接続・同期を行いません。これはbuildコマンドだけの設定で、起動時のDB同期は無効にしません。

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

- 通常・スペシャルジャッジは `samples/` と `tests/<group>/` の `.in/.out` ペアが必須。対話型はテストの `.in` のみで登録でき、サンプルは `.interaction` を使用できます
- `tests[]` は省略可能で、未指定時はディレクトリから自動検出
- path traversal と oversized ZIP/file payload は拒否
- `statement.md`, `samples/*.in/.out`, `tests/*/*.in/.out`, checker source は読込時に改行を `LF` に正規化

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

## Learning Mode

ヘッダーの `Learn` から、Markdown教材・ブラウザ内のPython/JavaScript/Brainfuck実行欄・確認クイズ・既存問題の練習を章内タブで切り替えられます。作成者用のライブプレビュー、下書き／公開版、進捗保存、教材ZIP取り込み・書き出しに対応します。

初回導入時に学習用テーブルだけを追加してください（既存の問題・提出テーブルは変更しません）。

```bash
npm run db:generate
npm run db:learning
npm run build
```

教材作成は `/learn/new` で行います。`problem_author` または `admin` が必要です。既存のR2設定を使い、未設定なら学習専用DBテーブルに保存します。ブラウザ実行用ファイルはdev/build前に自動準備するため、新しい実行サーバーや外部CDNの設定は不要です。

使い方、Markdown記法、ZIP形式、実行上限、未実装の範囲は [学習モードの説明](docs/learning-mode.md) を参照してください。

```bash
npm run template:learning-zip
npm run test:learning
```

## 競プロ向け実行系の追加

C、Rust、Go、C#（Mono）、Kotlin、Ruby、PyPy3を提出・テストrunに追加しました。エディター、テンプレート、フィルター、プロフィール統計も対応しています。教材の練習問題からも提出できます。教材内のブラウザ試し実行は従来の3言語です。

既存DBには、バックアップ・復元確認後に `npm run db:competitive-languages` を一度実行し、SDKを含むDockerイメージでweb・workerの両方を更新します。追加のConfig Varsや、既存ZIPの再登録は不要です。バージョン、入口の規則、制限と検証手順は [提出言語と実行系](docs/judge-languages.md) を参照してください。

## Brainfuck

通常提出、問題作成・編集時のテストrun、教材内のブラウザ実行で使用できます。色付きエディターとHello Worldテンプレート、提出の言語フィルター・プロフィール統計にも対応します。追加の外部ランタイムは不要です。

セルは8bit符号なし整数（0〜255で循環）、ゼロ初期化した30,000セル、ポインターの範囲外はRE、EOF入力は0です。入出力はバイト単位で、数値入力を自動で整数に変換しません。提出では問題の時間・メモリ制限と既存の出力制限、教材では10秒・64 KiBの制限を適用します。構文不正は提出ではCEです。checkerはファイル引数を使うため、従来の4言語のみ対応します。

既存DBには再デプロイ前に次の追加SQLを一度適用してください（言語enumへの値追加のみ。既存の提出・テストケースは変更しません）。本番ではバックアップ・復元確認を行い、全体の `db:push` やseedは実行しないでください。webとworkerの両方を更新します。

```bash
npm run db:generate
npm run db:brainfuck
npm run build
npm run test:brainfuck
```

詳しい仕様・教材記法・例は [Brainfuckの説明](docs/brainfuck.md) を参照してください。

## コンテスト・レーティング

作成フォームで問題ごとのラベル・整数配点・並び順を設定します。問題の得点（0〜100点）をコンテスト配点に換算し、順位表を表示中は5秒ごとに更新します。開催日時は日本時間で入力します。開始後は開催期間・問題セット・配点・ペナルティ・Rated設定を変更できません。

終了後は1人1回のバーチャル参加が可能です。タイマーはDBに保存され、正式順位表・レーティングには影響しません。公開コンテストで主催者がRatedを有効にした場合のみ、対象者2人以上でOJP独自Eloを計算します。初期値1500、K=32で、AtCoderのレーティングとは別です。`/ratings` にルールと順位表、`/me` に履歴を表示します。

初回導入では、バックアップを取得して復元確認後、専用の追加SQLを適用してください。既存のAppStateや問題・提出を変更しません。本番に全体の `db:push` は不要です。

```bash
npm run db:generate
npm run db:contest
npm run build
npm run test:contest
```

採点・権限・ペナルティ・Eloの詳しい規則と、専用DBで実際のweb/workerを動かすテスト手順は [コンテスト仕様](docs/contests.md) を参照してください。追加のConfig Varsは不要です。

## Legacy DB Enum Migration

`npm run db:push` が
`invalid input value for enum "SubmissionStatus_new": "AC"`
のような enum エラーで止まる場合は、先に次を一度だけ実行してください。

```bash
npm run db:migrate:legacy-status
npm run db:push -- --accept-data-loss
```

## 対話型問題

対話型ジャッジ（interactor）、作問画面、ZIP入出力、非公開通信ログに対応しています。
新しいリリースの起動前に `npm run db:interactive` でログ用の列を追加してください。
仕様・ZIPテンプレート・資源制限は [対話型ジャッジ](docs/interactive-judge.md) を参照してください。

## 問題ワークスペース

自動保存・復元、問題検索とタグ、問題の版履歴・判定版の固定、個人ブックマーク・メモ・復習に対応しています。
新しいWeb/workerの起動前に `npm run db:workspace-features` を実行してください。
仕様・制限・導入手順は [問題ワークスペース](docs/problem-workspace.md) を参照してください。
