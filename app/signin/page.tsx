import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export const dynamic = "force-dynamic";

interface SignInPageProps {
  searchParams: Promise<{
    callbackUrl?: string;
  }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
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
          <h1 className="page-title">Sign in</h1>
          <p className="page-subtitle">
            GitHubアカウントでログインして OJP を利用してください。
          </p>
        </div>
      </section>

      <section className="panel stack">
        <p className="text-soft">
          MVP版では GitHub OAuth ログインを使用します。初回ログイン時はユーザーを自動作成します。
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: callbackUrl });
          }}
        >
          <button type="submit" className="button">
            Sign in with GitHub
          </button>
        </form>
      </section>
    </div>
  );
}
