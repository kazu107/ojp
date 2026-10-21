import assert from "node:assert/strict";
import test from "node:test";
import { encode } from "next-auth/jwt";

const configuredOrigin = process.env.I18N_HTTP_TEST_ORIGIN;

test("local SSR: Japanese/English public and authenticated UI with unchanged content", {
  skip: !configuredOrigin,
}, async () => {
  const origin = new URL(configuredOrigin!);
  assert.equal(origin.origin, "http://127.0.0.1:3100", "Use the disposable validation server only.");
  const token = await encode({
    secret: "learning-local-validation-only-not-production",
    salt: "authjs.session-token",
    token: {
      sub: "learning-test", oauthProvider: "github", oauthAccountId: "learning-test",
      oauthLogin: "learning-test", oauthName: "learning-test",
    },
    maxAge: 3600,
  });
  const publicPaths = ["/", "/problems", "/problems/p1000", "/contests", "/contests/c1000", "/submissions", "/signin", "/learn"];
  const privatePaths = ["/me", "/admin", "/problems/new", "/problems/p1000/edit", "/problems/p1000/submit", "/contests/new", "/contests/c1000/edit", "/reports/new", "/learn/new"];
  const pages = new Map<string, string>();
  for (const locale of ["ja", "en"]) {
    for (const [paths, signedIn] of [[publicPaths, false], [privatePaths, true]] as const) {
      for (const pathname of paths) {
        const response: Response = await fetch(`${origin.origin}${pathname}`, {
          redirect: "manual",
          headers: { Cookie: `ojp_locale=${locale}${signedIn ? `; authjs.session-token=${token}` : ""}` },
        });
        assert.equal(response.status, 200, `${locale} ${pathname}`);
        const html = await response.text();
        assert.ok(html.includes(`<html lang="${locale}"`), `${locale} ${pathname}`);
        assert.ok(!html.includes("Application error:"), `${locale} ${pathname}`);
        assert.ok(html.includes(locale === "ja" ? "表示言語" : "Display language"), `${locale} ${pathname}`);
        assert.ok(html.includes(locale === "ja" ? "OJP - オンラインジャッジ" : "OJP - Online Judge"));
        pages.set(`${locale}:${pathname}`, html);
      }
    }
  }
  assert.match(pages.get("ja:/learn")!, /<h1[^>]*>学習<\/h1>/);
  assert.match(pages.get("en:/learn")!, /<h1[^>]*>Learn<\/h1>/);
  assert.ok(!pages.get("ja:/learn")!.includes("OJP LEARNING"));
  assert.match(pages.get("ja:/problems/new")!, /問題を作成/);
  assert.match(pages.get("en:/problems/new")!, /Create Problem/);
  assert.match(pages.get("ja:/me")!, /表示名/);
  assert.match(pages.get("en:/me")!, /Display Name/);

  for (const locale of ["en", "ja"]) {
    const response: Response = await fetch(`${origin.origin}/problems/does-not-exist`, {
      headers: { Cookie: `ojp_locale=${locale}` },
    });
    assert.equal(response.status, 404);
    assert.ok((await response.text()).includes(locale === "ja" ? "ページが見つかりません" : "Not Found"));
    const privateResponse: Response = await fetch(`${origin.origin}/admin`, {
      redirect: "manual", headers: { Cookie: `ojp_locale=${locale}` },
    });
    assert.equal(privateResponse.status, 307, "Locale must not affect authorization.");
  }
  const invalidCookie: Response = await fetch(`${origin.origin}/learn`, { headers: { Cookie: "ojp_locale=fr" } });
  assert.ok((await invalidCookie.text()).includes('<html lang="ja"'));
});
