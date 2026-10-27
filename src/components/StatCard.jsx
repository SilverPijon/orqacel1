import React from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/**
 * A dashboard statistic card.
 * Pass `to` to make the whole card a navigation shortcut (one link, no nested
 * interactive elements). Without `to` it renders as a plain, non-interactive card.
 */
export default function StatCard({ label, value, hint, icon: Icon, to }) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon ? (
          <span
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary",
              to && "transition-colors group-hover:bg-primary group-hover:text-primary-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <p className="mt-3 font-heading text-2xl font-bold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );

  if (!to) {
    return <div className="rounded-2xl border border-border bg-card p-5">{content}</div>;
  }

  return (
    <Link
      to={to}
      className="group block rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {content}
    </Link>
  );
}