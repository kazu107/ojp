
import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import { LearningError } from "@/lib/learning";

export async function LearningUnavailable({ error }: { error: unknown }) {
  const { t } = await getI18n();
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;
  const message =
    code === "P2021"
      ? "学習用テーブルが未作成です。デプロイ前に npm run db:learning を実行してください。"
      : error instanceof LearningError
        ? error.message
        : "学習データに接続できませんでした。しばらくしてから再度お試しください。";
  return (
    <section className="panel stack">
      <h1 className="panel-title">{t("学習ページを表示できません")}</h1>
      <p role="alert">{t(message)}</p>
      <Link className="link" href="/learn">
        {t("コース一覧へ")}</Link>
    </section>
  );
}
