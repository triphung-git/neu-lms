import { useEffect, useState, type ReactNode } from "react";
import { get, post } from "./api";
import { useLanguage } from "./i18n";
export function useData<T>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError("");
    get<T>(path, c.signal)
      .then((value) => {
        if (!c.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e.message || e));
      });
    return () => c.abort();
  }, [path, version]);
  return { data, error, reload: () => setVersion((x) => x + 1) };
}
export function Load({ error, reload }: { error: string; reload: () => void }) {
  const { t } = useLanguage();
  return (
    <div role={error ? "alert" : "status"}>
      {error || t("Đang tải…", "Loading…")}{" "}
      {error && <button onClick={reload}>{t("Thử lại", "Retry")}</button>}
    </div>
  );
}
export function ActionForm({
  path,
  initial,
  children,
  done,
  label,
}: {
  path: string;
  initial: Record<string, unknown>;
  children?: ReactNode;
  done: () => void;
  label?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { t } = useLanguage();
  return (
    <form
      className="learning-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = e.currentTarget;
        const values: Record<string, unknown> = {
          ...initial,
          ...Object.fromEntries(new FormData(form)),
        };
        for (const [key, value] of Object.entries(values)) {
          if (value === "" && key !== "body") delete values[key];
        }
        for (const input of Array.from(
          form.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
        ))
          values[input.name] = input.checked;
        for (const input of Array.from(form.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]'))) {
          if (input.value) values[input.name] = new Date(input.value).toISOString();
        }
        setBusy(true);
        setError("");
        try {
          await post(path, values);
          form.reset();
          done();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        {children}
        <button type="submit">
          {busy ? t("Đang lưu…", "Saving…") : label || t("Lưu", "Save")}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="learning-error">
          {error}
        </p>
      )}
    </form>
  );
}
export function Input({
  name,
  label,
  type = "text",
  required = true,
  value,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  value?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        step={type === "number" ? "any" : undefined}
        required={required}
        defaultValue={value}
        maxLength={type === "text" ? 200 : undefined}
      />
    </label>
  );
}
export function Body({
  name = "body",
  label,
}: {
  name?: string;
  label: string;
}) {
  return (
    <label>
      {label}
      <textarea name={name} required maxLength={10000} rows={3} />
    </label>
  );
}
export function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  const { t } = useLanguage();
  return (
    <div className="learning-table">
      <table>
        <thead>
          <tr>
            {headers.map((x) => (
              <th key={x}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p>{t("Chưa có dữ liệu.", "No data yet.")}</p>}
    </div>
  );
}
