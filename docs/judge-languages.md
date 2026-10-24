# 提出用の言語と実行系

## 追加した実行系

既存のC++、CPython、Java、JavaScript、Brainfuckに加え、C、Rust、Go、C#（Mono）、Kotlin、Ruby、PyPy3を選択できます。通常提出・コンテスト・問題作成時のテストrun・教材の練習問題・言語別統計に共通の言語定義を使用します。選択ごとのテンプレートとエディターの構文色付けも用意しています。

| APIの値 | 実行系 | ソースと入口 | 主な設定 |
| --- | --- | --- | --- |
| `c` | GCC | `Main.c` / `main` | C17、O2、libm |
| `rust` | rustc | `Main.rs` / `fn main()` | edition 2021、最適化、コンパイル並列度を制限 |
| `go` | Go | `Main.go` / `package main` の `func main()` | パッケージの並列ビルドを1、CGO無効、標準ライブラリのみ |
| `csharp` | Mono | `Main.cs` / `static void Main()` | C# 7.2、System.Numerics参照、Mono実行 |
| `kotlin` | Kotlin/JVM | `Main.kt` のトップレベル `fun main()` | `MainKt` をJVMで実行。Kotlinコンパイラを直接起動 |
| `ruby` | Ruby | `Main.rb` | gems自動読込を無効化 |
| `pypy` | PyPy3 | `Main.py` | 事前構文チェック後にPyPy3で実行 |

DockerイメージはDebian bookwormのパッケージを使用します。Go、Rust、Kotlin、Mono等のバージョンはAtCoderの最新版と同一とは限りません。初期構成ではRust 1.63系、Go 1.19系、Mono 6.8系、Kotlin 1.3.31系、Ruby 3.1系、PyPy 7.3.11系です。実際のイメージでは `npm run judge:doctor` が起動可否とバージョンを表示します。

NuGet、Cargo、Go Modules、gemsの追加依存を提出時にダウンロードする仕組みはありません。特にC#は.NET 8以降ではなくMonoです。トップレベル文、ファイルスコープ名前空間、新しいC#の構文は利用できません。Kotlinの入力には `readLine()` や標準入力ストリームを使用し、Kotlin 1.3にない `readln()` 等は使わないでください。

## ジャッジ設定

- コンパイル時間と実行時間は別に扱います。コンパイルはC/C#が20秒、Rustが30秒、Go/Kotlinが60秒、Ruby/PyPyの構文チェックが10秒です。
- コンパイラのメモリ制限は従来の `JUDGE_COMPILER_MEMORY_MB` を維持します。既定は256 MiBです。Kotlinはpreloaderを避け、128 MiBのヒープとSerial GCでコンパイラを直接起動します。標準ライブラリを毎回jarへコピーせず、実行時に読み取り専用のシステムjarを使用します。
- 実行時間・メモリ・出力・プロセス数・作業領域の制限は既存の共通ランナーを使用します。JVMのheap上限も問題のメモリ設定に合わせます。メモリ表示はVM/JIT等を含むプロセスのRSSです。
- 環境変数は引き続き固定の許可リストです。DB/R2/OAuthの秘密情報や、親プロセスのRUBYOPT・MONO_ENV_OPTIONS・GOENV・GOPROXY等を引き継ぎません。Goは外部モジュール取得とCGOを無効化し、同時実行数を1にします。
- 新しい言語のcheckerテンプレート・ZIP形式は追加していません。special judgeの作成言語は従来のC++・Python・Java・JavaScriptです。新しい言語で提出したコードを既存checkerで判定できます。
- 教材内のブラウザ試し実行はPython・JavaScript・Brainfuckのままです。今回の追加言語はサーバー上の正式提出・テストrun向けです。
- `JUDGE_SANDBOX=basic` は完全隔離ではありません。この機能で本番の隔離設定や課金プランは変更しません。bubblewrap構成ではMonoのシステム設定も読み取り専用で公開します。

## 導入

既存DBではバックアップを取得し、別の同メジャーPostgreSQLで復元確認後、追加のenum値だけを適用します。既存の問題・テストケース・提出は変更しません。全体の `db:push` やseedは実行しないでください。

```bash
npm ci
npm run db:generate
npm run db:competitive-languages
npm run build
```

DockerfileにもSDKを追加しています。web・workerの両方を同じ新しいイメージでデプロイしてください。追加のConfig Varsは不要です。

## 検証

```bash
npm run test:languages
npm run test:judge
npm run test:learning
npm run test:i18n
npm run lint
npx tsc --noEmit
npm run build
```

Linuxテストでは新しい各実行系で数値加算・UTF-8の入出力・テンプレートのコンパイル・構文エラー・誤答・実行エラー・無限ループを確認します。WindowsではSDK依存の試験をスキップし、言語選択やテンプレート・既存ランナーを確認します。本番の検証には既存の「シンプルplus」（4ケース）とEcho問題（6ケース）を使用します。新しい問題やテストケースを追加・改変する必要はありません。
