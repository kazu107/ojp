// Display one deterministic hunk without an unbounded quadratic diff on arbitrary source.
export function agentCodeChange(before: string, after: string) {
  const a = before ? before.split("\n") : [], b = after ? after.split("\n") : [];
  let head = 0, tail = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { startLine: head + 1, removed: a.slice(head, a.length - tail), added: b.slice(head, b.length - tail) };
}
