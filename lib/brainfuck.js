/**
 * Shared, self-contained byte interpreter for the isolated browser worker and judge process.
 * @param {string} source
 * @param {() => number} readByte Returns zero at EOF.
 * @param {(value: number) => void} writeByte
 * @param {boolean} [validateOnly]
 */
export function runBrainfuck(
  source,
  readByte,
  writeByte,
  validateOnly = false,
) {
  const jumps = new Int32Array(source.length);
  /** @type {number[]} */
  const openings = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "[") openings.push(i);
    else if (source[i] === "]") {
      const opening = openings.pop();
      if (opening === undefined)
        throw new SyntaxError(`Unmatched ']' at character ${i + 1}.`);
      jumps[opening] = i;
      jumps[i] = opening;
    }
  }
  if (openings.length)
    throw new SyntaxError(
      `Unmatched '[' at character ${openings[openings.length - 1] + 1}.`,
    );
  if (validateOnly) return;
  const cells = new Uint8Array(30000);
  let pointer = 0;
  for (let i = 0; i < source.length; i++) {
    switch (source[i]) {
      case ">":
        if (++pointer === cells.length)
          throw new RangeError(
            "Brainfuck data pointer is outside the 30000-cell tape.",
          );
        break;
      case "<":
        if (--pointer < 0)
          throw new RangeError(
            "Brainfuck data pointer is outside the 30000-cell tape.",
          );
        break;
      case "+":
        cells[pointer]++;
        break;
      case "-":
        cells[pointer]--;
        break;
      case ",":
        cells[pointer] = readByte();
        break;
      case ".":
        writeByte(cells[pointer]);
        break;
      case "[":
        if (!cells[pointer]) i = jumps[i];
        break;
      case "]":
        if (cells[pointer]) i = jumps[i];
        break;
    }
  }
}

export const BRAINFUCK_HELLO_WORLD =
  "++++++++++[>+++++++>++++++++++>+++>+<<<<-]>++.>+.+++++++..+++.>++.<<+++++++++++++++.>.+++.------.--------.>+.>.";
