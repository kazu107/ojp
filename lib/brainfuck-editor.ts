import { StreamLanguage } from "@codemirror/language";

export const brainfuckLanguage = StreamLanguage.define({
  name: "brainfuck",
  token(stream) {
    const command = stream.next();
    if (command === "[" || command === "]") return "bracket";
    if (command === "+" || command === "-") return "arithmeticOperator";
    if (command === ">" || command === "<") return "operator";
    if (command === "." || command === ",") return "keyword";
    stream.eatWhile(/[^+\-<>.,\[\]]/);
    return "comment";
  },
  languageData: { closeBrackets: { brackets: ["["] } },
});
