export class WorkspaceBodyError extends Error { readonly status = 413; }
export async function readWorkspaceBody(request: Request, maximum = 64 * 1024): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > maximum) throw new WorkspaceBodyError("Request body is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > maximum) { await reader.cancel(); throw new WorkspaceBodyError("Request body is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const result = JSON.parse(new TextDecoder().decode(bytes));
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("A JSON object is required.");
  return result;
}
