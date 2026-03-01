import { auth, signIn, signOut } from "@/auth";

export async function AuthControls() {
  const session = await auth();
  const sessionUser = session?.user as
    | {
        name?: string | null;
        githubLogin?: string;
      }
    | undefined;
  const login =
    typeof sessionUser?.githubLogin === "string" && sessionUser.githubLogin
      ? sessionUser.githubLogin
      : sessionUser?.name ?? "signed-in";

  if (!session?.user) {
    return (
      <form
        className="site-nav-form"
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/" });
        }}
      >
        <button type="submit" className="site-nav-cta">
          Sign in
        </button>
      </form>
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
