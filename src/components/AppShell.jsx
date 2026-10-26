import React, { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import NavLinks from "@/components/NavLinks";
import CompanySwitcher from "@/components/CompanySwitcher";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import UserMenu from "@/components/UserMenu";
import RequireCompany from "@/components/RequireCompany";
import { useI18n } from "@/lib/i18n/I18nContext";

export default function AppShell({ children }) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <RequireCompany>
      <div className="min-h-dvh bg-secondary/30 lg:flex">
        <aside className="hidden w-64 shrink-0 flex-col gap-4 bg-sidebar p-4 lg:flex">
          <div className="flex items-center gap-2 px-2 py-1">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary font-heading text-lg font-bold text-primary-foreground">
              O
            </span>
            <span className="font-heading text-lg font-bold text-sidebar-foreground">{t("app.name")}</span>
          </div>
          <CompanySwitcher />
          <NavLinks />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-background/90 px-4 backdrop-blur lg:px-6">
            <div className="flex items-center gap-2 lg:hidden">
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t("nav.menu")}>
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-72 bg-sidebar p-4">
                  <SheetTitle className="sr-only">{t("nav.menu")}</SheetTitle>
                  <div className="flex items-center gap-2 px-2 py-1">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary font-heading text-lg font-bold text-primary-foreground">
                      O
                    </span>
                    <span className="font-heading text-lg font-bold text-sidebar-foreground">{t("app.name")}</span>
                  </div>
                  <div className="mt-4">
                    <CompanySwitcher />
                  </div>
                  <div className="mt-4">
                    <NavLinks onNavigate={() => setMenuOpen(false)} />
                  </div>
                </SheetContent>
              </Sheet>
              <span className="font-heading text-base font-bold">{t("app.name")}</span>
            </div>
            <div className="hidden lg:block" />
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <UserMenu />
            </div>
          </header>

          <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </RequireCompany>
  );
}