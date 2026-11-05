import {uiText} from "../../shared/i18n/translate";
import { useEffect, useSyncExternalStore } from "react";
const event = "lms-language";
const subscribe = (notify: () => void) => {
  window.addEventListener(event, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(event, notify);
    window.removeEventListener("storage", notify);
  };
};
const get = () => {
  try {
    return localStorage.getItem("lms-language") === "en" ? "en" : "vi";
  } catch {
    return "vi";
  }
};
export function useLanguage() {
  const language = useSyncExternalStore(subscribe, get, () => "vi");
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return {
    language,
    t: (vi: string, en: string) => (language === "en" ? en : vi),
    date: (value: string | null) =>
      value
        ? new Date(value).toLocaleString(language === "en" ? "en-GB" : "vi-VN")
        : "—",
  };
}
export function LanguageSwitch() {
  const { language } = useLanguage();
  return (
    <label className="language-switch">
      🌐{" "}
      <select
        aria-label={uiText("Ngôn ngữ / Language")}
        value={language}
        onChange={(e) => {
          try {
            localStorage.setItem("lms-language", e.target.value);
          } catch {
            return;
          }
          window.dispatchEvent(new Event(event));
        }}
      >
        <option value="vi">{uiText("Tiếng Việt")}</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
