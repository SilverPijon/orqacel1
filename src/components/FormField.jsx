import React from "react";
import { Label } from "@/components/ui/label";

// One field layout for every form: its label, its control, and its validation message directly
// beneath it. The message is announced when it appears, and the control it belongs to is marked
// invalid so the field itself shows where the problem is.
export default function FormField({ id, label, error, hint, className = "", children }) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
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