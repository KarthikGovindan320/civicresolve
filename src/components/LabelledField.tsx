import type { ReactNode } from "react";
import { fieldLabelClass } from "./ui";

/**
 * A form control with a visible label above it. The label is tied to the
 * control through `htmlFor`, so clicking it focuses the field and screen
 * readers announce it.
 */
export default function LabelledField({
  id,
  label,
  children,
}: {
  /** The `id` of the control passed as children. */
  id: string;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      {children}
    </div>
  );
}
