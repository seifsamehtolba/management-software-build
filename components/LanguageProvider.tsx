"use client";

import { useEffect, useState } from "react";
import { I18nContext, translations, type Lang } from "@/lib/i18n";

const LANG_KEY = "app-lang";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");

  useEffect(() => {
    const stored = localStorage.getItem(LANG_KEY) as Lang | null;
    const initial: Lang = stored === "en" ? "en" : "ar";
    setLangState(initial);
    document.documentElement.lang = initial;
    document.documentElement.dir = initial === "ar" ? "rtl" : "ltr";
  }, []);

  const setLang = (next: Lang) => {
    setLangState(next);
    localStorage.setItem(LANG_KEY, next);
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
  };

  return (
    <I18nContext.Provider value={{ lang, t: translations[lang] as import("@/lib/i18n").Translations, setLang }}>
      {children}
    </I18nContext.Provider>
  );
}
