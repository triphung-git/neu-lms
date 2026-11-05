import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiClient } from "../../api/client";
import { post, remove, root, upload } from "./api";
import { useLanguage } from "./i18n";
import { Input, Load, useData } from "./ui";
import "./learning.css";
type Doc = {
  id: number;
  title: string;
  description: string;
  category: string;
  tags: string;
  visibility: string;
  hidden: boolean;
  owner: string;
  file_name: string;
  course_id: string;
  can_edit: boolean;
};
export function LibraryPage() {
  const { t } = useLanguage();
  const teacher = useLocation().pathname.startsWith("/gv");
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [edit, setEdit] = useState<Doc | null>(null),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const state = useData<{ count: number; items: Doc[] }>(
    "/library?q=" + encodeURIComponent(query) + "&page=" + page,
  );
  useEffect(() => {
    if (!teacher) return;
    const c = new AbortController();
    apiClient
      .untypedRequest<{ items: { id: string; name: string }[] }>(
        "/api/v1/courses",
        {
          method: "GET",
          params: { role: "teacher", page_size: 100 },
          signal: c.signal,
        },
      )
      .then((r) => setCourses(r.items))
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [teacher]);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        ...Object.fromEntries(f),
        hidden: f.get("hidden") === "on",
      };
      if (edit) body.id = edit.id;
      else {
        const file = f.get("file");
        if (!(file instanceof File) || !file.size)
          throw new Error(t("Chọn tệp", "Choose a file"));
        body.file_id = await upload(String(f.get("course_id")), file);
        delete body.file;
      }
      await post("/library", body);
      setEdit(null);
      setCreating(false);
      state.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="learning-page">
      <h1>{t("Thư viện số", "Digital library")}</h1>
      <p>
        {t(
          "Tìm kiếm và chia sẻ tài liệu đã kiểm tra an toàn.",
          "Search and share safety-checked documents.",
        )}
      </p>
      <div className="learning-toolbar">
        <input
          aria-label={t("Tìm kiếm", "Search")}
          value={query}
          placeholder={t("Tên, danh mục hoặc thẻ…", "Title, category or tags…")}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        {teacher && (
          <button
            onClick={() => {
              setEdit(null);
              setCreating(true);
            }}
          >
            {t("Tải tài liệu lên", "Upload document")}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="learning-error">
          {error}
        </p>
      )}
      {(creating || edit) && (
        <article className="learning-card">
          <form
            className="learning-form"
            key={edit?.id || "new"}
            onSubmit={(e) => void save(e)}
          >
            <fieldset disabled={busy}>
              <Input
                name="title"
                label={t("Tiêu đề", "Title")}
                value={edit?.title}
              />
              <label>
                {t("Mô tả", "Description")}
                <textarea
                  name="description"
                  defaultValue={edit?.description}
                  maxLength={10000}
                />
              </label>
              <Input
                name="category"
                required={false}
                label={t("Danh mục", "Category")}
                value={edit?.category}
              />
              <Input
                name="tags"
                required={false}
                label={t("Thẻ tìm kiếm", "Tags")}
                value={edit?.tags}
              />
              <label>
                {t("Chia sẻ", "Visibility")}
                <select
                  name="visibility"
                  defaultValue={edit?.visibility || "private"}
                >
                  <option value="private">{t("Riêng tư", "Private")}</option>
                  <option value="course">
                    {t("Thành viên môn", "Course members")}
                  </option>
                  <option value="school">
                    {t("Người dùng đã xác thực", "Verified users")}
                  </option>
                </select>
              </label>
              <label>
                <input
                  name="hidden"
                  type="checkbox"
                  defaultChecked={edit?.hidden}
                />
                {t("Ẩn khỏi thư viện", "Hide from library")}
              </label>
              {!edit && (
                <>
                  <label>
                    {t(
                      "Kho tệp môn học (tính vào hạn mức môn)",
                      "Course storage (uses course quota)",
                    )}
                    <select name="course_id" required>
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input type="file" name="file" required />
                </>
              )}
              <button>
                {busy
                  ? t(
                      "Đang tải, quét và lưu…",
                      "Uploading, scanning and saving…",
                    )
                  : t("Lưu tài liệu", "Save document")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEdit(null);
                  setCreating(false);
                }}
              >
                {t("Hủy", "Cancel")}
              </button>
            </fieldset>
          </form>
        </article>
      )}
      {!state.data ? (
        <Load {...state} />
      ) : (
        <>
          <div className="library-grid">
            {state.data.items.map((d) => (
              <article key={d.id} className="learning-card">
                <small>
                  {d.category} · {d.visibility}{" "}
                  {d.hidden ? t("· Đã ẩn", "· Hidden") : ""}
                </small>
                <h2>{d.title}</h2>
                <p className="learning-text">{d.description}</p>
                <p>{d.tags}</p>
                <small>
                  {d.owner} · {d.file_name}
                </small>
                <div className="learning-toolbar">
                  <a href={root + "/library/" + d.id}>
                    {t("Tải xuống", "Download")}
                  </a>
                  {d.file_name.toLowerCase().endsWith(".pdf") && (
                    <a
                      href={root + "/library/" + d.id + "?preview=true"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("Xem trước", "Preview")}
                    </a>
                  )}
                  {d.can_edit && (
                    <>
                      <button
                        onClick={() => {
                          setCreating(false);
                          setEdit(d);
                        }}
                      >
                        {t("Sửa", "Edit")}
                      </button>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          if (
                            !window.confirm(
                              t(
                                "Xóa mục này khỏi thư viện? Tệp gốc được giữ lại.",
                                "Delete this library entry? The original file is retained.",
                              ),
                            )
                          )
                            return;
                          setBusy(true);
                          try {
                            await remove("/library/" + d.id);
                            state.reload();
                          } catch (e) {
                            setError(String(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {t("Xóa", "Delete")}
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!state.data.items.length && (
            <p>{t("Chưa có tài liệu phù hợp.", "No matching documents.")}</p>
          )}
          <div className="learning-toolbar">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              {t("Trước", "Previous")}
            </button>
            <span>
              {page} / {Math.max(1, Math.ceil(state.data.count / 30))}
            </span>
            <button
              disabled={page * 30 >= state.data.count}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("Sau", "Next")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
