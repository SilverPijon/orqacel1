import React from "react";

// Save and Cancel stay in view at the bottom of a form that scrolls, so the primary action is
// always reachable. The negative margins match the dialog's own padding, letting the bar span the
// full width while the content scrolls underneath it.
export default function StickyFormFooter({ children, className = "" }) {
  return (
    <div
      className={`sticky bottom-0 z-10 -mx-6 -mb-6 mt-4 flex flex-wrap justify-end gap-2 border-t border-border bg-card px-6 py-3 ${className}`}
    >
      {children}
    </div>
  );
}