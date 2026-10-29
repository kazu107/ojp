# 対話型ジャッジ

通常判定・スペシャルジャッジを変更せず、対話型の問題を追加できます。
提出とinteractorを同時に起動し、それぞれの標準出力を相手の標準入力へ逐次転送します。
Webサーバーではなく、既存のジャッジworkerで実行します。通信に外部ネットワークは使いません。

## 作問

問題作成・編集の「テストケース」タブで、Checker Typeを「対話型」にします。
interactorの言語はC++、Python、Java、JavaScriptから選べます。
各言語の初期コードは「1〜1000の秘密の整数を10回以内の質問で当てる」サンプルです。
テンプレート以外のコードは、言語・判定方法の切替時にも勝手に上書きしません。

各ケースの入力欄には、秘密の答え・初期状態・固定した乱数seedなどを登録します。
この内容は提出の標準入力には直接渡しません。正解出力欄と`.out`ファイルは不要です。
既存のグループ採点、合計100点の部分点、ケースごとのWJ・逐次結果更新に対応します。

「テストrun」タブでは、保存前の設定でも対話実行できます。
各ケースのメッセージ欄にある通信ログを展開すると、方向と経過時刻を確認できます。

## ZIP

```text
statement.md
config.json
interactor/Main.py
tests/group1/case01.in
tests/group1/case02.in
samples/sample01.interaction
```

```json
{
  "judgeType": "interactive",
  "interactorLanguage": "python",
  "timeLimitMs": 2000,
  "memoryLimitMb": 256,
  "interactive": {
    "idleTimeLimitMs": 5000,
    "wallTimeLimitMs": 30000,
    "interactorTimeLimitMs": 10000
  },
  "groups": ["group1"]
}
```

各時間設定は100〜300000msの整数です。通信待ち上限は全体経過時間上限以下にしてください。
未指定の場合は上記の値を使います。`checkerType: "interactive"`も受理します。
エディター内部では従来のchecker用フィールドを共用し、ZIPでは`interactor/Main.*`に出力します。
通常問題は既存の`checkerType: "exact"`、スペシャルジャッジは`special_judge`のままです。

サンプルは以下のような会話を`.interaction`に書きます。`<`はジャッジ、`>`は提出の出力です。
これは問題ページに掲載する説明用の例で、実行時の秘密の入力とは別です。

```text
< 1000
> ? 37
< EQUAL
> ! 37
```

ZIPのインポート・エクスポート、R2保存、大容量ZIPの遅延読込に対応しています。
旧来のサンプル`.in/.out`も引き続き読めます。サンプルなしの対話型ZIPも登録できます。

テンプレートの生成:

```powershell
npm run template:interactive-zip -- --output interactive-guess.zip --language python
```

`--language`は`python`、`cpp`、`java`、`javascript`です。上書きする場合だけ`--force`を付けます。

## Interactor API

- 第1引数: そのケースの秘密データファイルのパス。
- 標準入力: 提出からの出力。EOFまで一括で読むのではなく、質問ごとに読みます。
- 標準出力: 提出に渡す応答のみ。応答後に必ずflushしてください。
- 標準エラー: 作問者・管理者用の診断。秘密を含む可能性があるため一般公開しません。
- 終了コード0: AC、1: WA、それ以外・資源超過: IE。

問題ごとの質問回数・値域・形式はinteractorで検証してください。
秘密のデータを最初にすべて提出へ送ってしまわないよう注意してください。
乱数を使う場合はケースの固定seedから生成すると再ジャッジを再現できます。
このAPIはOJP独自です。testlib/Polygon形式をそのままインポートする機能ではありません。

提出言語は既存の12実行系を利用できます。通常問題の「標準入力をEOFまで一括読込する」
テンプレートは対話型には使えません。Pythonは`print(..., flush=True)`、C++は`endl`や`flush`、
Java/Kotlinは`System.out.flush()`、Goは`bufio.Writer.Flush()`などを使ってください。
Brainfuckは対話実行時に入力待ち前と改行出力時にバッファをflushします。

## 制限と判定

- Linuxでは提出のCPU時間とRSSを計測し、interactorの時間・メモリは提出の値に加算しません。
- 入力待ちだけでCPU時間を消費しないようにしつつ、通信待ちと全体経過時間を別々に制限します。
- 通信待ち・全体経過時間超過はTLE、提出のRSS超過はMLE、出力等の資源超過はREです。
- interactorのCPU・メモリ・出力等の資源超過や異常終了はIEです。
- interactorのメモリは`JUDGE_CHECKER_MEMORY_MB`（既定256MiB）で制限します。
- 各方向の通信出力量は1MiBと`JUDGE_MAX_OUTPUT_BYTES`の小さい方が上限です。
- 通信ログは各ケース16KiB、提出全体256KiBまでです。制限後も上限付きストリームで対話を続行します。
- 片方が終了すると相手にEOFを伝え、750msの終了猶予後に残ったプロセスツリーを停止します。
- WAを確定した後の強制停止をRE/TLEに上書きしません。提出自身の先行クラッシュはREです。
- ログは作問者・管理者だけに返します。提出者本人でも他人の問題の秘密ログは見られません。

ケースは逐次実行します。ただしworker、提出、interactorのメモリは同時に必要です。
問題のメモリ制限はdyno全体のメモリ使用量ではありません。workerの並列度を上げるときは余裕を見てください。
Windowsは開発用の機能テスト向けで、Linuxと同じCPU/RSS測定・隔離保証はありません。

## DBとデプロイ

通信ログの永続化用に`SubmissionRuntimeTestResult.interactionLog`（nullable TEXT）を追加しました。
既存行の削除・置換は不要です。新しいWeb/workerを起動する前に、対象DBで以下を実行してください。

```powershell
npm run db:interactive
npm run db:generate
npm run build
```

`prisma/interactive-schema.sql`は列追加のみで、繰り返し実行可能です。
新旧workerが混在しないよう、Webとworkerを同じリリースに更新してください。

## テストと隔離

```powershell
npm run test:interactive
npm run test:judge
```

対話の正常終了、WA、形式不正、質問超過、通信待ち、全体時間、クラッシュ、出力超過、
LinuxのCPU/RSS、Brainfuckのflush、途中まで終わったケースからの再開、各言語、ZIP往復、
遅延読込、日英UI、ログの権限制御をテストします。

`JUDGE_SANDBOX=bubblewrap`では提出とinteractorを別々の隔離環境に置き、秘密データはinteractorにだけmountします。
`basic`は完全なファイル・ネットワーク隔離ではありません。対話型対応だけでこの制約は解消しません。
Heroku本番での強い隔離は、別途Linux実行基盤を用意する課題として引き続き残ります。

## 今回の検証範囲

- Linux/WSL、basicモード: 通常・スペシャル・対話型を合わせて118件成功、隔離環境専用3件はスキップ。対話型の新規35件はすべて成功。
- 12提出実行系と4言語のinteractorテンプレートを実行。
- 使い捨てPostgreSQL: 追加SQLの再実行、既存行の保持、ログ保存と再接続の統合テスト1件成功。検証用DBサーバーは停止済み。
- 学習20件、コンテスト16件、日英表示6件、lint、型チェック、本番向けビルドが成功。
- 初回実装時は作問画面・対話例・ログ表示を日英のSSRテストで確認しました。続く本番反映の結果は次節を参照してください。

## 本番反映後の確認

対話型実装（7add4fd）をHerokuのWeb・workerへ反映しました。初回確認リリースはv90です。
事前にPostgreSQL 16のカスタム形式バックアップを取得・復元し、ハッシュ一致と追加SQLの再実行を確認しました。
本番のログ列追加も適用済みです。既存の問題19件・提出26件・ユーザー3件は内容を保持しています。

本番イメージの一時dynoで対話型テスト35件すべてが成功しました。12提出実行系と4言語のinteractorを確認しています。
さらに、既存管理者に紐付けた管理CLIから限定公開の検証用問題p1046を追加し、通常のworker.1で次を確認しました。

| 検証 | 提出 | 結果 | ケース数 |
| --- | --- | --- | --- |
| 対話型・正答（Python） | [s1082](https://ojp.kazu107.xyz/submissions/s1082) | AC・100点 | 5 |
| 対話型・誤答（JavaScript） | [s1083](https://ojp.kazu107.xyz/submissions/s1083) | WA・0点 | 5 |
| 対話型・通信待ち（JavaScript） | [s1084](https://ojp.kazu107.xyz/submissions/s1084) | TLE・0点 | 5 |
| 既存の通常問題（Python） | [s1085](https://ojp.kazu107.xyz/submissions/s1085) | AC・100点 | 4 |

4提出・19ケース・4ジョブが完了し、重複と完了後の再実行はありません。
ログのDB保存と、未ログインのAPI・結果ページに秘密の通信内容が含まれないことも確認しました。
検証用問題の登録と提出は管理CLIによるもので、ブラウザのフォーム操作やOAuthログインを自動操作した試験ではありません。

未ログインで問題作成ページを開いた場合は、エラー画面ではなく、作成ページへの復帰先を付けたログイン画面に誘導します。
本番のsandboxはbasicのままです。強い隔離の課題は、この反映では解消していません。
