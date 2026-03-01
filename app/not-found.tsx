import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page">
      <section className="panel stack">
        <h1 className="page-title">Not Found</h1>
        <p className="page-subtitle">
          指定されたリソースにアクセスできません。公開範囲設定により表示できない場合もあります。
        </p>
        <div className="button-row">
          <Link href="/" className="button">
            Dashboardへ戻る
          </Link>
        </div>
      </section>
    </div>
  );
}
