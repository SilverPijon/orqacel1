import React from "react";

// Save and Cancel stay in view at the bottom of a form that scrolls, so the primary action is
// always reachable. Inside a dialog the negative margins match the dialog's own padding, letting the
// bar span the full width while the content scrolls underneath it. A page-level form passes `inset`
// instead: the bar keeps its own width there, so the page can never overflow sideways.
export default function StickyFormFooter({ children, className = "", inset = false }) {
  const shell = inset
    ? "mt-6 flex flex-wrap justify-end gap-2 border-t border-border bg-background px-2 py-3"
    : "-mx-6 -mb-6 mt-4 flex flex-wrap justify-end gap-2 border-t border-border bg-card px-6 py-3";

  return <div className={`sticky bottom-0 z-10 ${shell} ${className}`}>{children}</div>;
}