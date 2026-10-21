import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";

test("learning R2 uses its own prefix, round trips Unicode and bounds streamed reads", async () => {
  let saved = "";
  let oversized = false;
  const server = http.createServer(async (request, response) => {
    assert.ok(request.url?.includes("/learning/version/cell.md"));
    if (request.method === "PUT") {
      const buffers = [];
      for await (const buffer of request) buffers.push(buffer);
      const body = Buffer.concat(buffers).toString("utf8");
      // AWS SDK can wrap the payload with its streaming checksum framing.
      saved =
        request.headers["content-encoding"] === "aws-chunked"
          ? body.split("\r\n")[1]
          : body;
      response.writeHead(200, { ETag: '"test-etag"' });
      response.end();
    } else if (request.method === "GET") {
      response.writeHead(200, { "Content-Type": "text/markdown" });
      response.end(oversized ? "x".repeat(1024 * 1024 + 1) : saved);
    } else {
      response.writeHead(204);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  process.env.R2_ENDPOINT = `http://127.0.0.1:${address.port}`;
  process.env.R2_BUCKET = "test-bucket";
  process.env.R2_ACCESS_KEY_ID = "test-only";
  process.env.R2_SECRET_ACCESS_KEY = "test-only";
  delete process.env.LEARNING_STORAGE;
  const { putLearningMarkdown, getLearningMarkdown, removeLearningMarkdown } =
    await import("../lib/learning-storage");
  try {
    const key = await putLearningMarkdown(
      "version",
      "cell",
      "# 日本語の教材\n",
    );
    assert.equal(key, "learning/version/cell.md");
    assert.equal(await getLearningMarkdown(key!), "# 日本語の教材\n");
    oversized = true;
    await assert.rejects(getLearningMarkdown(key!), /exceeds/);
    await assert.rejects(
      getLearningMarkdown("problem-packages/private.zip"),
      /Invalid/,
    );
    await removeLearningMarkdown([key!]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
