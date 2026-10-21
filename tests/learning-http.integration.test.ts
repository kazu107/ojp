import assert from "node:assert/strict";
import test from "node:test";
import { encode } from "next-auth/jwt";
import { newLearningItem, sampleLearningDraft } from "../lib/learning";

test(
  "local HTTP: author CRUD, public reading, secret quiz answers and verified completion",
  { skip: !process.env.LEARNING_HTTP_TEST_ORIGIN },
  async () => {
    const origin = new URL(process.env.LEARNING_HTTP_TEST_ORIGIN!);
    assert.equal(
      origin.origin,
      "http://127.0.0.1:3100",
      "Use the dedicated validation server only.",
    );
    for (const pathname of ["/me", "/admin", "/learn/new"]) {
      const response: Response = await fetch(`${origin.origin}${pathname}`, { redirect: "manual" });
      assert.equal(response.status, 307);
      const location: URL = new URL(response.headers.get("location")!, origin.origin);
      assert.equal(location.origin, origin.origin);
      assert.equal(location.pathname, "/signin");
      assert.equal(location.searchParams.get("callbackUrl"), pathname);
    }
    for (const pathname of ["/me", "/admin"]) {
      const response: Response = await fetch(`${origin.origin}${pathname}?_rsc=redirectcheck`, {
        redirect: "manual", headers: { RSC: "1", "Next-Router-Prefetch": "1" },
      });
      assert.equal(response.status, 307);
      const location: URL = new URL(response.headers.get("location")!, origin.origin);
      assert.equal(location.pathname, "/signin");
      assert.equal(location.origin, origin.origin);
    }
    const token = async (login: string) =>
      encode({
        secret: "learning-local-validation-only-not-production",
        salt: "authjs.session-token",
        token: {
          sub: login,
          oauthProvider: "github",
          oauthAccountId: login,
          oauthLogin: login,
          oauthName: login,
        },
        maxAge: 3600,
      });
    const authorCookie = `authjs.session-token=${await token("learning-test")}`;
    const studentCookie = `authjs.session-token=${await token("learning-student")}`;
    async function request(
      path: string,
      cookie?: string,
      method = "GET",
      body?: unknown,
    ) {
      return fetch(`${origin.origin}${path}`, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    }
    const draft = sampleLearningDraft();
    draft.slug = `http-test-${Date.now()}`;
    draft.visibility = "unlisted";
    const practice = newLearningItem("problem", "practice");
    practice.problemId = "p1000";
    draft.chapters[0].items.push(practice);
    assert.equal(
      (await request("/api/learning/courses", undefined, "POST", { draft }))
        .status,
      401,
    );
    assert.equal(
      (await request("/api/learning/courses", studentCookie, "POST", { draft }))
        .status,
      403,
    );
    const created = await request(
      "/api/learning/courses",
      authorCookie,
      "POST",
      { draft },
    );
    assert.equal(created.status, 201);
    const saved = await created.json();
    const base = `/api/learning/courses/${saved.id}`;
    assert.equal((await request(`${base}?edit=1`, studentCookie)).status, 404);
    assert.equal((await request(`${base}?edit=1`)).status, 401);
    assert.equal((await request(base)).status, 404);
    const published = await request(`${base}/publish`, authorCookie, "POST", {
      editVersion: saved.editVersion,
    });
    assert.equal(published.status, 200);
    const { versionId, editVersion } = await published.json();
    const listing = await (await request("/api/learning/courses")).json();
    assert.ok(
      !listing.courses.some((course: { id: string }) => course.id === saved.id),
    );
    const metadata = await (await request(base)).json();
    assert.ok(!JSON.stringify(metadata).includes("markdown"));
    const quizResponse = await request(
      `${base}/items/check?version=${versionId}`,
    );
    assert.equal(
      quizResponse.headers.get("Cache-Control"),
      "private, no-store",
    );
    const quiz = await quizResponse.json();
    assert.ok(!JSON.stringify(quiz).includes("answerId"));
    const attempt = await request(`${base}/progress`, studentCookie, "POST", {
      versionId,
      itemId: "check",
      action: "quiz",
      answers: { q1: "a" },
    });
    assert.equal(attempt.status, 200);
    const graded = await attempt.json();
    assert.equal(graded.quiz.passed, true);
    assert.equal(
      (
        await request(`${base}/progress`, studentCookie, "POST", {
          versionId,
          itemId: "practice",
          action: "read",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(`${base}/progress`, studentCookie, "POST", {
          versionId,
          itemId: "practice",
          action: "problem",
          submissionId: "fake",
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(base, authorCookie, "PUT", { draft, editVersion: 1 }))
        .status,
      409,
    );
    assert.equal(
      (
        await request(`${base}/publish`, authorCookie, "POST", {
          editVersion,
          unpublish: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (await request(`${base}/items/input?version=${versionId}`)).status,
      404,
    );
  },
);
