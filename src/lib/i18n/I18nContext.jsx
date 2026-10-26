import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en from "@/lib/i18n/locales/en";
import et from "@/lib/i18n/locales/et";
import lv from "@/lib/i18n/locales/lv";
import lt from "@/lib/i18n/locales/lt";
import ru from "@/lib/i18n/locales/ru";
import de from "@/lib/i18n/locales/de";
import fi from "@/lib/i18n/locales/fi";
import sv from "@/lib/i18n/locales/sv";
import es from "@/lib/i18n/locales/es";
import fr from "@/lib/i18n/locales/fr";
import pl from "@/lib/i18n/locales/pl";
import { DEFAULT_LANGUAGE, LANGUAGES, LANGUAGE_STORAGE_KEY } from "@/lib/i18n/languages";

const dictionaries = { en, et, lv, lt, ru, de, fi, sv, es, fr, pl };

const I18nContext = createContext(null);

function resolveInitialLanguage() {
  let stored = null;
  try {
    stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    stored = null;
  }
  const browser = (window.navigator?.language || "").slice(0, 2).toLowerCase();
  return [stored, browser].find((code) => code && dictionaries[code]) || DEFAULT_LANGUAGE;
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(DEFAULT_LANGUAGE);

  useEffect(() => {
    setLangState(resolveInitialLanguage());
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((code) => {
    const next = dictionaries[code] ? code : DEFAULT_LANGUAGE;
    setLangState(next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const t = useCallback(
    (key, vars) => {
      const dict = dictionaries[lang] || dictionaries[DEFAULT_LANGUAGE];
      let text = dict[key] ?? dictionaries[DEFAULT_LANGUAGE][key] ?? key;
      if (vars) {
        Object.entries(vars).forEach(([name, value]) => {
          text = text.split(`{${name}}`).join(String(value));
        });
      }
      return text;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t, languages: LANGUAGES }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}