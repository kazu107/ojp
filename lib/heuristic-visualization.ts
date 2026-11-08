export function parseVisualization(
  kind: "knapsack" | "route",
  input: string,
  output: string,
) {
  if (input.length > 65536 || output.length > 65536)
    throw new Error("Visualization input is limited to 64 KiB");
  const numbers = (text: string) => {
    const tokens = text.trim().split(/\s+/);
    if (tokens.some((x) => !/^\d+$/.test(x)))
      throw new Error("Use nonnegative integers");
    const values = tokens.map(Number);
    if (values.some((n) => !Number.isSafeInteger(n) || n > 1_000_000_000))
      throw new Error("Visualization value exceeds limit");
    return values;
  };
  const values = numbers(input),
    answer = numbers(output),
    n = values[0];
  if (n < 1 || n > 200) throw new Error("Visualize between 1 and 200 items");
  if (kind === "route") {
    if (
      values.length !== 1 + 2 * n ||
      answer.length !== n ||
      new Set(answer).size !== n ||
      answer.some((i) => i >= n)
    )
      throw new Error("Output must be a permutation of all point indices");
    const points = Array.from({ length: n }, (_, i) => ({
      x: values[1 + 2 * i],
      y: values[2 + 2 * i],
    }));
    const cost = answer.reduce((sum, id, i) => {
      const a = points[id],
        b = points[answer[(i + 1) % n]];
      return sum + Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }, 0);
    return {
      points,
      answer,
      score: cost,
      weight: 0,
      capacity: 0,
      items: [] as Array<{ weight: number; value: number; selected: boolean }>,
    };
  }
  if (
    values.length !== 2 + 2 * n ||
    answer.length !== n ||
    answer.some((i) => i > 1)
  )
    throw new Error("Output must contain one 0/1 selection per item");
  const items = Array.from({ length: n }, (_, i) => ({
    weight: values[2 + 2 * i],
    value: values[3 + 2 * i],
    selected: answer[i] === 1,
  }));
  const weight = items.reduce((s, x) => s + (x.selected ? x.weight : 0), 0),
    score = items.reduce((s, x) => s + (x.selected ? x.value : 0), 0);
  if (weight > values[1]) throw new Error("Capacity exceeded");
  return {
    points: [] as Array<{ x: number; y: number }>,
    answer,
    score,
    weight,
    capacity: values[1],
    items,
  };
}
