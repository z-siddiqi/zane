export interface CodexTextInput {
  type: "text";
  text: string;
  text_elements: [];
}

export function codexTextInput(text: string): CodexTextInput {
  return {
    type: "text",
    text,
    text_elements: [],
  };
}
