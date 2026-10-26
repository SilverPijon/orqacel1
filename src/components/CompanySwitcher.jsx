import React, { useState } from "react";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useServerFn } from "@tanstack/react-start";
import { switchCompany } from "@/lib/tenant-fns";
import { useSession } from "@/lib/SessionContext";
import { useI18n } from "@/lib/i18n/I18nContext";

export default function CompanySwitcher() {
  const { companies, activeCompany, refresh } = useSession();
  const switchFn = useServerFn(switchCompany);
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const handleSwitch = async (companyId) => {
    if (companyId === activeCompany?.id) return;
    setBusy(true);
    try {
      await switchFn({ data: { company_id: companyId } });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!activeCompany) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          disabled={busy}
          className="h-auto w-full justify-between gap-2 px-3 py-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
              <Building2 className="h-4 w-4" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm font-semibold">{activeCompany.name}</span>
              <span className="block text-[11px] uppercase tracking-wide text-sidebar-foreground/60">
                {t(`settings.role_${activeCompany.role}`)}
              </span>
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("nav.settings")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((company) => (
          <DropdownMenuItem
            key={company.id}
            onClick={() => handleSwitch(company.id)}
            className="flex items-center justify-between gap-3"
          >
            <span className="truncate">{company.name}</span>
            {company.id === activeCompany.id ? <Check className="h-4 w-4 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/onboarding" className="cursor-pointer">
            {t("onboarding.add_company")}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}