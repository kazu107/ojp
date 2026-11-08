# ヒューリスティック採点

通常・部分点・スペシャルジャッジ・対話型の互換性を維持し、通常入出力型の数値採点を追加します。
ACは「有効な解」であり、最適解や満点を意味しません。

## 作問とZIP

テストケースタブで「ヒューリスティック採点」を選びます。採点器はC++ / Python / Java / JavaScript。
提出は既存の12実行系を使えます。グループの固定部分点・合計100点の制約は適用しません。

```text
statement.md
config.json
checker/Main.py
samples/sample1.in
samples/sample1.out
tests/provisional/case01.in
tests/system/case01.in
```

```json
{
  "timeLimitMs": 3000,
  "memoryLimitMb": 256,
  "checkerType": "heuristic",
  "checkerLanguage": "python",
  "scoringType": "heuristic",
  "heuristic": {
    "direction": "maximize",
    "evaluation": "absolute",
    "aggregate": "sum",
    "failurePolicy": "case_zero",
    "finalGroups": ["system"],
    "seeds": {"provisional/case01": "100", "system/case01": "10000"},
    "visualizer": "knapsack"
  },
  "groups": ["provisional", "system"]
}
```

テストの`.out`は不要です。存在する場合は参照出力として採点器へ渡します。
finalGroupsに指定しないグループが暫定テスト、指定したグループが最終テストです。
少なくとも1つの暫定グループが必要で、最終テストを開催する場合は最終グループも必要です。
seedは再現用メタデータで、入力本文が実際のテストデータです。Webサーバーで生成器は実行しません。
ZIPのクライアント/サーバー両インポート、遅延編集、ダウンロードに対応します。

## 採点器プロトコル

コマンド引数は入力・参照出力・提出出力の順です。Pythonでは`sys.argv[1:4]`。
入力と出力はファイルとして渡すので、大きな本文を引数やDBへ複製しません。

```json
{"version":1,"valid":true,"score":"123.45","message":"optional private diagnostic"}
```

- 終了コード0でJSONを1つだけ出力。上限16KiB。
- 不正な解は`{"version":1,"valid":false}`。有効な0点は`valid:true, score:"0"`。
- scoreは非負・整数部24桁以内・小数部12桁以内の文字列。指数表記・NaN・Infinity・負数を拒否。
- 採点器の非0終了、不正JSON、制限超過はIE。提出の不正出力はWA。
- 採点器は10秒・既存checker用メモリ制限を使用し、提出のCPU時間・RSSに加算しません。
- 診断は作問者・管理者だけに公開。提出者本人でも作問権限がなければ表示しません。
- ケースごとの診断は最大4,000文字、実行全体では約256KiBまでに制限します。

## 得点

- direction: `maximize`は大きい方、`minimize`は小さい方。
- aggregate: `sum`はケース合計、`mean`はケース数で割った平均。
- failurePolicy: `case_zero`は失敗ケースの寄与を0、`submission_zero`は提出全体を採点対象外とします。
- 絶対評価の最小化では、失敗を0コストと誤認しないよう、失敗を含む提出は有効な総コストなしとします。
- IEを含む実行は有効な得点なし。未完了を0点と確定表示しません。
- 保存はDECIMAL(48,12)、APIは小数文字列。平均は小数12桁へ四捨五入します。

相対評価はケースごとに最大化なら`自身/最大値`、最小化なら`最小値/自身`へ10^9を掛けて整数に丸めます。
最大値0なら有効解は全員10^9点。最小値0なら0コストの解だけ10^9点、正のコストの解は0点です。
失敗ケースは分母の基準計算から除外します。submission_zeroの失敗提出は基準全体からも除外します。
基準値は同じ固定版・同じテスト段階の採用候補だけから求めます。他者の改善により相対点は再計算されます。

## コンテスト

作成時にヒューリスティック採点を選びます。Unrated専用で、通常問題とは混在できません。
複数問を設定する場合は評価方向・絶対/相対・集計方式を統一します。既存の配点欄は正の重みとして扱い、
各問題の得点に掛けて合計します。通常コンテストの0〜100点への制限やWAペナルティは適用しません。
同点は同順位で、表示順だけユーザーIDで安定化します。

コンテスト保存時に問題版・採点器・ZIP参照を固定します。開始前の再保存で固定版を更新できます。
開始後に問題本体が編集されても、正式提出は固定版を使います。個別再ジャッジも固定版を維持します。

- best: 暫定評価の最良の提出全体を採用。異なる提出の良いケースを合成しません。
- last: CE・取消を除く最新の提出。WA/TLEの提出も最新なら採用します。
- 相対評価は、bestでは全候補、lastでは各利用者の最新候補からケース基準値を求めて順位付けします。
- 終了後、主催者・管理者が「最終テストを開始・再開」を押します。未判定・IEがあれば開始を止めます。
- 暫定ルールで選んだ提出IDを固定し、最終グループで再評価します。締切後の練習提出は含めません。
- すべての最終ジョブが完了してから最終順位を公開。実行中は暫定順位を残します。
- 繰り返し開始しても同じ評価IDを使い、欠けたジョブだけ修復します。IEの再開では正常に保存済みのケースを維持します。
- 最終結果は公開後に対象提出の詳細から参照可能です。暫定結果と履歴は保持します。

API: `POST /api/contests/:id/heuristic/finalize`、`GET /api/submissions/:id/heuristic?phase=provisional|system`。
既存APIの整数scoreは従来形式用で、数値採点の正本は専用API・HeuristicRunです。
数値採点の提出には`heuristic: true`を付けます。通常採点との方式変更を伴う個別再ジャッジは拒否し、新規提出を案内します。
順位表の読込ではソースコード・診断ログを取得せず、相対得点のケース値は10実行ずつ処理します。

## ジョブと表示

HeuristicRunが固定版・ソース・設定・段階・状態を、HeuristicCaseScoreがケースごとの得点を保存します。
実行UUIDとケースキーの主キーで重複を防ぎ、SKIP LOCKED、120秒lease、20秒heartbeat、token付き書込みで
古いworkerの結果反映を拒否します。失効時は同じ実行を回収し、保存済みケースを再利用します。
同一worker内では通常問題・パッケージ・数値採点を重ねて実行しません。別workerは別ジョブを処理できます。

提出一覧・詳細・作問テストに数値スコアを表示し、提出詳細はWJからケース単位でポーリング更新します。
一般利用者のケース名・ケース別スコアは既存の公開範囲に従います。版ごとの個人最良記録も表示します。
内蔵ビジュアライザは公開サンプルと利用者が入力したデータだけをブラウザで描画し、出力2つを比較できます。
各本文64KiB、描画200要素まで。非公開テストは配信しません。任意JSの登録・実行はできません。

## 例題一式

```powershell
npm run template:heuristic-zip
```

`recovered/heuristic-examples`に荷物詰め・巡回経路のZIP、各4種類のPython提出、seed別の独立最適値JSONを生成します。
各ZIPはサンプル2件、暫定10件、最終30件。入力生成は固定seedで決定的です。
荷物詰めの提出は空選択/貪欲法/DP/不正解。巡回は入力順/最近傍/全探索/不正解です。
検証値は荷物詰めを部分集合列挙、巡回をHeld-Karp DPで計算し、参考提出とは独立しています。

## 導入・検証

```powershell
npm run db:generate
npm run db:heuristic
npm run test:heuristic
npm run test:heuristic:integration
npm run build
```

本番はバックアップ・隔離DBでの復元/SQL反復検証後に追加SQLを適用し、web/workerのコードを揃えて再開します。
SQLは専用3テーブル・インデックスの追加だけで、既存整数得点・AppStateを変更しません。
HTTPテストはlocalhostの`ojp_heuristic_test`専用DB、`HEURISTIC_TEST_ORIGIN=http://127.0.0.1:3103`のみ許可します。
ローカル限定のテスト用署名セッションを使い、本番の認証情報をコピーしません。GitHub Actionsにも専用ジョブがあります。

対話型＋数値採点、ヒューリスティック専用バーチャル参加、任意JSビジュアライザ、AHCレーティングは未対応です。
完全隔離は以前からの別課題であり、数値採点の追加で解決済みとはしません。
