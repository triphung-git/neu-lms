import {ReportCharts} from './ReportCharts';
import { useState } from "react";
import { root } from "./api";
import { useLanguage } from "./i18n";
import { Input, Load, useData } from "./ui";
import "./learning.css";
export function ReportsPage() {
  const { t, language } = useLanguage();
  const [query, setQuery] = useState("");
  const state = useData<{
    start: string;
    end: string;
    metrics: Record<string, number>;
    download_trend: { day: string; count: number }[];
  }>("/reports" + query);
  const labels: Record<string, string> = {
    new_users: t("Tài khoản mới", "New users"),
    new_courses: t("Môn mới", "New courses"),
    enrollments: t("Ghi danh mới", "New enrollments"),
    submissions: t("Bài nộp cá nhân", "Individual submissions"),
    group_submissions: t("Bài nộp nhóm", "Group submissions"),
    attendance_checkins: t("Lượt điểm danh", "Check-ins"),
    downloads: t("Lượt tải", "Downloads"),
    completed_lessons: t("Bài học hoàn thành", "Completed lessons"),
    appeals: t("Phúc khảo", "Appeals"),
    library_documents: t("Tài liệu thư viện mới", "New library documents"),
    current_storage_bytes: t(
      "Dung lượng hiện tại (byte)",
      "Current storage (bytes)",
    ),
  };
  return (
    <section className="learning-page">
      <h1>{t("Báo cáo hệ thống", "System reports")}</h1>
      <p>
        {t(
          "Thống kê hoạt động theo khoảng thời gian. Mặc định 30 ngày, tối đa 366 ngày.",
          "Activity statistics by date range. Default: 30 days; maximum: 366 days.",
        )}
      </p>
      <form
        className="learning-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setQuery(
            "?" +
              new URLSearchParams({
                start: new Date(String(f.get("start"))).toISOString(),
                end: new Date(String(f.get("end"))).toISOString(),
              }),
          );
        }}
      >
        <Input name="start" type="datetime-local" label={t("Từ", "From")} />
        <Input name="end" type="datetime-local" label={t("Đến", "To")} />
        <button>{t("Xem báo cáo", "View report")}</button>
      </form>
      {state.data && <div className="report-export-actions">
        <a href={root + "/reports?" + new URLSearchParams({start: state.data.start, end: state.data.end, export: "csv"})}>
          {t("Xuất CSV", "Export CSV")}
        </a>
        <a href={root + "/reports?" + new URLSearchParams({start: state.data.start, end: state.data.end, export: "xlsx", lang: language})}>
          {t("Xuất Excel có biểu đồ", "Export Excel with charts")}
        </a>
      </div>}
      {!state.data ? (
        <Load {...state} />
      ) : (
        <>
          <ReportCharts metrics={state.data.metrics} labels={labels} trend={state.data.download_trend}/>

        </>
      )}
    </section>
  );
}
