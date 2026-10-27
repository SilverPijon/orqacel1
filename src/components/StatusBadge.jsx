import React from "react";

const TONES = {
  muted: "bg-muted text-muted-foreground",
  primary: "bg-info-muted text-info",
  info: "bg-info-muted text-info",
  success: "bg-success-muted text-success",
  warning: "bg-warning-muted text-warning",
  danger: "bg-destructive/10 text-destructive",
};

export default function StatusBadge({ label, tone = "muted", className = "" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone] || TONES.muted} ${className}`}
    >
      {label}
    </span>
  );
}