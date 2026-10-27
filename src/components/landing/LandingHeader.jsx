import React from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useAuth } from "@/lib/AuthContext";
import { useI18n } from "@/lib/i18n/I18nContext";

// The public top bar. It reads the same session state as the hero, so a signed-in visitor is
// offered the way into their workspace instead of the sign-up buttons, and signing in from here
// lands on the dashboard rather than back on this page. While the session is still resolving
// nothing is shown: it never flashes "Sign in" at someone who is signed in, and the server's
// anonymous render matches the first client render.
export default function LandingHeader() {
  const { t } = useI18n();
  const { isAuthenticated, isLoadingAuth } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary font-heading text-lg font-bold text-primary-foreground">
            O
          </span>
          <span className="font-heading text-lg font-bold tracking-tight">{t("app.name")}</span>
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          {isLoadingAuth ? null : isAuthenticated ? (
            <Button asChild size="sm">
              <Link to="/dashboard">{t("landing.cta_dashboard")}</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link to="/login" search={{ returnTo: "/dashboard" }}>
                  {t("auth.sign_in")}
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/register">{t("auth.sign_up")}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}