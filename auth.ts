import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

interface GitHubProfileLike {
  id?: string | number;
  login?: string;
  name?: string | null;
  bio?: string | null;
}

const githubClientId = process.env.AUTH_GITHUB_ID ?? process.env.GITHUB_ID ?? "";
const githubClientSecret =
  process.env.AUTH_GITHUB_SECRET ?? process.env.GITHUB_SECRET ?? "";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    GitHub({
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    }),
  ],
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    jwt({ token, account, profile }) {
      if (account?.provider === "github" && profile) {
        const github = profile as GitHubProfileLike;
        token.githubId = github.id !== undefined ? String(github.id) : undefined;
        token.githubLogin = typeof github.login === "string" ? github.login : undefined;
        token.githubName = typeof github.name === "string" ? github.name : undefined;
        token.githubBio = typeof github.bio === "string" ? github.bio : undefined;
      }
      return token;
    },
    session({ session, token }) {
      const user = session.user as
        | (typeof session.user & {
            githubId?: string;
            githubLogin?: string;
            githubBio?: string | null;
          })
        | undefined;

      if (!user) {
        return session;
      }

      const enrichedUser = user as typeof user & {
        githubId?: string;
        githubLogin?: string;
        githubBio?: string | null;
      };
      enrichedUser.githubId = typeof token.githubId === "string" ? token.githubId : undefined;
      enrichedUser.githubLogin =
        typeof token.githubLogin === "string" ? token.githubLogin : undefined;
      enrichedUser.githubBio = typeof token.githubBio === "string" ? token.githubBio : null;
      if (typeof token.githubName === "string") {
        enrichedUser.name = token.githubName;
      }
      return session;
    },
  },
});
