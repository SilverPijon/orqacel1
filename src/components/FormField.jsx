import React from "react";
import { Label } from "@/components/ui/label";

// One field layout for every form: its label, its control, and its validation message directly
// beneath it. The message is announced when it appears, and the control it belongs to is marked
// invalid so the field itself shows where the problem is. A required field says so next to its
// label, in red, with the asterisk kept out of the accessible name and a localized "required"
// description read by assistive technology instead.
export default function FormField({ id, label, error, hint, required = false, className = "", children }) {
  return (
    <div className={className}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          // The marker is decoration: assistive technology reads the requirement from the
          // control's own aria-required attribute, so nothing is announced twice.
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </Label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 type-meta">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// The attributes a control needs to point at its own message and read as invalid.
export function fieldErrorProps(id, error) {
  return error
    ? { "aria-invalid": true, "aria-describedby": `${id}-error` }
    : {};
}