import React from "react";
import { Check, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n/I18nContext";

export default function LanguageSwitcher({ variant = "ghost", className = "" }) {
  const { lang, setLang, languages } = useI18n();
  const current = languages.find((item) => item.code === lang) || languages[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="sm" className={`gap-2 ${className}`}>
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline">{current.native}</span>
          <span className="uppercase sm:hidden">{current.code}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-48 overflow-y-auto">
        {languages.map((item) => (
          <DropdownMenuItem
            key={item.code}
            onClick={() => setLang(item.code)}
            className="flex items-center justify-between gap-3"
          >
            <span>{item.native}</span>
            {item.code === lang ? <Check className="h-4 w-4 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}