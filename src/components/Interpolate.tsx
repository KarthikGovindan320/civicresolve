import { Fragment, type ReactNode } from "react";

/**
 * Renders a translated message with its `{name}` placeholders filled by
 * elements rather than plain text, so a filled-in value can carry its own
 * markup, such as the `lang` of an English department name inside a Tamil
 * sentence. Pass the message without params, so its placeholders are intact;
 * a placeholder without a value is left as written, as `t` does.
 */
export default function Interpolate({ message, values }: { message: string; values: Record<string, ReactNode> }) {
  // Splitting on a capturing group puts the placeholder names at the odd indexes.
  const fill = (part: string, index: number) => {
    if (index % 2 === 0) return part;
    return Object.hasOwn(values, part) ? values[part] : `{${part}}`;
  };
  return message.split(/\{(\w+)\}/).map((part, index) => <Fragment key={index}>{fill(part, index)}</Fragment>);
}
