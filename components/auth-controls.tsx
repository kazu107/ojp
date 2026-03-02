import { auth, signOut } from "@/auth";

export async function AuthControls() {
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
        Sign in
      </a>
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
          Sign out
        </button>
      </form>
    </div>
  );
}
