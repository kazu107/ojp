
import { getI18n } from "@/lib/i18n/server";
import { auth, signOut } from "@/auth";

export async function AuthControls() {
  const { t } = await getI18n();
  const session = await auth();
  const sessionUser = session?.user as
    | {
        name?: string | null;
        oauthLogin?: string;
        githubLogin?: string;
      }
    | undefined;
  const login =
    typeof sessionUser?.oauthLogin === "string" && sessionUser.oauthLogin
      ? sessionUser.oauthLogin
      : typeof sessionUser?.githubLogin === "string" && sessionUser.githubLogin
        ? sessionUser.githubLogin
        : sessionUser?.name ?? "signed-in";

  if (!session?.user) {
    return (
      <a className="site-nav-cta" href="/signin">
        {t("Sign in")}</a>
    );
  }

  return (
    <div className="site-auth">
      <span className="site-auth-label">@{login}</span>
      <form
        className="site-nav-form"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/signin" });
        }}
      >
        <button type="submit" className="site-nav-button">
          {t("Sign out")}</button>
      </form>
    </div>
  );
}
