
import { getI18n } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { auth, enabledAuthProviders, signIn } from "@/auth";

export const dynamic = "force-dynamic";

interface SignInPageProps {
  searchParams: Promise<{
    callbackUrl?: string;
  }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { t } = await getI18n();
  const params = await searchParams;
  const callbackUrl =
    typeof params.callbackUrl === "string" && params.callbackUrl.startsWith("/")
      ? params.callbackUrl
      : "/";
  const session = await auth();
  if (session?.user) {
    redirect(callbackUrl);
  }

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("Sign in")}</h1>
          <p className="page-subtitle">{t("Sign in with your GitHub or Google account to use OJP.")}</p>
        </div>
      </section>

      <section className="panel stack">
        <p className="text-soft">{t("First login creates your user account automatically.")}</p>
        {enabledAuthProviders.github ? (
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: callbackUrl });
            }}
          >
            <button type="submit" className="button">
              {t("Sign in with GitHub")}</button>
          </form>
        ) : null}
        {enabledAuthProviders.google ? (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: callbackUrl });
            }}
          >
            <button type="submit" className="button button-secondary">
              {t("Sign in with Google")}</button>
          </form>
        ) : null}
        {!enabledAuthProviders.github && !enabledAuthProviders.google ? (
          <p className="text-soft">{t("No OAuth provider is configured.")}</p>
        ) : null}
      </section>
    </div>
  );
}
