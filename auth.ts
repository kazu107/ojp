import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

interface GitHubProfileLike {
  id?: string | number;
  login?: string;
  name?: string | null;
  bio?: string | null;
}

interface GoogleProfileLike {
  sub?: string;
  email?: string | null;
  name?: string | null;
}

function loginFromEmail(email: string | null | undefined): string | undefined {
  if (typeof email !== "string") {
    return undefined;
  }
  const trimmed = email.trim();
  if (!trimmed) {
    return undefined;
  }
  const at = trimmed.indexOf("@");
  return at >= 1 ? trimmed.slice(0, at) : trimmed;
}

const githubClientId = process.env.AUTH_GITHUB_ID ?? process.env.GITHUB_ID ?? "";
const githubClientSecret =
  process.env.AUTH_GITHUB_SECRET ?? process.env.GITHUB_SECRET ?? "";
const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
const googleClientId =
  process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_ID ?? "";
const googleClientSecret =
  process.env.AUTH_GOOGLE_SECRET ??
  process.env.GOOGLE_CLIENT_SECRET ??
  process.env.GOOGLE_SECRET ??
  "";

export const enabledAuthProviders = {
  github: Boolean(githubClientId && githubClientSecret),
  google: Boolean(googleClientId && googleClientSecret),
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret || undefined,
  trustHost: true,
  providers: [
    ...(enabledAuthProviders.github
      ? [
          GitHub({
            clientId: githubClientId,
            clientSecret: githubClientSecret,
          }),
        ]
      : []),
    ...(enabledAuthProviders.google
      ? [
          Google({
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          }),
        ]
      : []),
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
        token.oauthProvider = "github";
        token.oauthAccountId = token.githubId;
        token.oauthLogin = token.githubLogin;
        token.oauthName = token.githubName;
        token.oauthBio = token.githubBio;
      } else if (account?.provider === "google" && profile) {
        const google = profile as GoogleProfileLike;
        token.githubId = undefined;
        token.githubLogin = undefined;
        token.githubName = undefined;
        token.githubBio = undefined;
        token.oauthProvider = "google";
        token.oauthAccountId =
          typeof google.sub === "string" && google.sub ? google.sub : undefined;
        token.oauthLogin = loginFromEmail(google.email);
        token.oauthName = typeof google.name === "string" ? google.name : undefined;
        token.oauthBio = undefined;
      }
      return token;
    },
    session({ session, token }) {
      const user = session.user as
        | (typeof session.user & {
            oauthProvider?: string;
            oauthAccountId?: string;
            oauthLogin?: string;
            oauthBio?: string | null;
            githubId?: string;
            githubLogin?: string;
            githubBio?: string | null;
          })
        | undefined;

      if (!user) {
        return session;
      }

      const enrichedUser = user as typeof user & {
        oauthProvider?: string;
        oauthAccountId?: string;
        oauthLogin?: string;
        oauthBio?: string | null;
        githubId?: string;
        githubLogin?: string;
        githubBio?: string | null;
      };
      enrichedUser.oauthProvider =
        typeof token.oauthProvider === "string" ? token.oauthProvider : undefined;
      enrichedUser.oauthAccountId =
        typeof token.oauthAccountId === "string" ? token.oauthAccountId : undefined;
      enrichedUser.oauthLogin = typeof token.oauthLogin === "string" ? token.oauthLogin : undefined;
      enrichedUser.oauthBio = typeof token.oauthBio === "string" ? token.oauthBio : null;
      enrichedUser.githubId = typeof token.githubId === "string" ? token.githubId : undefined;
      enrichedUser.githubLogin =
        typeof token.githubLogin === "string" ? token.githubLogin : undefined;
      enrichedUser.githubBio = typeof token.githubBio === "string" ? token.githubBio : null;
      if (typeof token.oauthName === "string") {
        enrichedUser.name = token.oauthName;
      } else if (typeof token.githubName === "string") {
        enrichedUser.name = token.githubName;
      }
      return session;
    },
  },
});
