import { useState } from "react";
import { useLocation, useSearchParams, useParams } from "react-router-dom";
import { useCourseChoices } from "./useCourseChoices";
import { useEffect } from "react";
import { root } from "./api";
import { useLanguage } from "./i18n";
import { ActionForm, Body, Input, Load, Table, useData } from "./ui";
import { Groups, Appeals, Downloads } from "./WorkflowPanels";
import "./learning.css";
export type Hub = {
  course: { id: string; name: string; status: string };
  manager: boolean;
  students: {
    student_id: string;
    student__display_name: string;
    student__email: string;
  }[];
  lessons: { id: string; title: string }[];
  completed: string[];
  enrollment_open: boolean;
  has_password: boolean;
  assignments: { id: string; title: string; total_score: string }[];
};
export function LearningHub() {
  const { t } = useLanguage();
  const teacher = useLocation().pathname.startsWith("/gv");
  const [params, setParams] = useSearchParams();
  const id = params.get("course") || "";
  const {courses,error,loading}=useCourseChoices(teacher?'teacher':'student');
  useEffect(()=>{if(!id&&courses[0])setParams({course:courses[0].id},{replace:true});},[id,courses,setParams]);
  return (
    <section className="learning-page">
      <h1>{t("Không gian học tập", "Learning workspace")}</h1>
      <p>
        {t(
          "Tiến độ, thảo luận và hoạt động của lớp.",
          "Progress, discussions and class activities.",
        )}
      </p>
      {loading && <p>{t('Đang tải môn học…','Loading courses…')}</p>}{!loading && !error && !courses.length && <p>{t('Bạn chưa tham gia môn học nào.','You have no courses yet.')}</p>}{error && <p role="alert">{error}</p>}
      <label>
        {t("Môn học", "Course")}
        <select
          value={id}
          onChange={(e) => setParams({ course: e.target.value })}
        >
          <option value="">{t("Chọn môn học", "Select course")}</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {id && <CourseWorkspace key={id} id={id} />}
    </section>
  );
}
function CourseWorkspace({ id }: { id: string }) {
  const { t } = useLanguage();
  const state = useData<Hub>("/courses/" + id);
  const [tabParams, setTabParams] = useSearchParams();
  const requestedTab = tabParams.get("tab") || "progress";
  if (!state.data) return <Load {...state} />;
  const hub = state.data;
  const path = "/courses/" + id;
  const tabs = [
    ["progress", t("Tiến độ", "Progress")],
    ["discussion", t("Thảo luận", "Discussions")],
    ["groups", t("Bài tập nhóm", "Group assignments")],
    ["appeals", t("Phúc khảo", "Grade appeals")],
    ...(hub.manager
      ? [
          ["downloads", t("Log tải tệp", "Download log")],
          ["enrollment", t("Ghi danh", "Enrollment")],
        ]
      : []),
  ];
  const tab = tabs.some(([key]) => key === requestedTab) ? requestedTab : "progress";
  return (
    <>
      <h2>{hub.course.name}</h2>
      <nav className="learning-tabs">
        {tabs.map(([key, title]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTabParams({ course: id, tab: key })}
          >
            {title}
          </button>
        ))}
      </nav>
      {tab === "progress" && (
        <Progress path={path} hub={hub} refresh={state.reload} />
      )}
      {tab === "discussion" && <Discussions path={path} hub={hub} />}
      {tab === "groups" && <Groups path={path} hub={hub} />}
      {tab === "appeals" && <Appeals path={path} hub={hub} />}
      {tab === "downloads" && <Downloads path={path} hub={hub} />}
      {tab === "enrollment" && (
        <article className="learning-card">
          <h3>{t("Ghi danh bằng mật khẩu", "Password enrollment")}</h3>
          <p>
            {hub.has_password
              ? t(
                  "Đã đặt mật khẩu. Để trống nếu giữ nguyên.",
                  "Password set. Leave blank to keep it.",
                )
              : t("Chưa đặt mật khẩu.", "No password set.")}
          </p>
          <ActionForm
            path={path + "/actions"}
            initial={{ action: "enrollment" }}
            done={state.reload}
          >
            <label>
              <input
                type="checkbox"
                name="open"
                defaultChecked={hub.enrollment_open}
              />
              {t("Mở ghi danh", "Open enrollment")}
            </label>
            <Input
              name="password"
              type="password"
              required={!hub.has_password}
              label={t(
                "Mật khẩu mới (6–128 ký tự)",
                "New password (6–128 characters)",
              )}
            />
          </ActionForm>
        </article>
      )}
    </>
  );
}
type AttendanceData = {
  total_sessions: number;
  summary: {student_id:string; name:string; email:string; total:number; attended:number; present:number; late:number; absent:number; pending:number}[];

  sessions: {
    id: number;
    title: string;
    opens_at: string;
    late_at: string;
    closes_at: string;
    closed: boolean;
  }[];
  records: {
    id: number;
    session_id: number;
    student_id: string;
    student__display_name: string;
    status: string;
    checked_at: string | null;
    corrections: { from: string; to: string; reason: string; at: string }[];
  }[];
};
function Attendance({ path, hub }: { path: string; hub: Hub }) {
  const state = useData<AttendanceData>(path + "/attendance");
  const { t, date } = useLanguage();
  if (!state.data) return <Load {...state} />;
  return (
    <>
      <section className="learning-card attendance-summary">
        <h2>{t('Tổng kết điểm danh môn học','Course attendance summary')}</h2>
        <p>{t('Mỗi phiên được tính là một buổi. Có mặt và đi muộn được tính là đã tham dự. Lịch sử được giữ khi môn học lưu trữ.','Each session counts as one meeting. Present and late count as attended. History remains available after the course is archived.')}</p>
        <p>{t('Số phiên đã tạo','Sessions created')}: <strong>{state.data.total_sessions}</strong></p>
        <a href={root+path+'/attendance?export=summary'}>{t('Xuất tổng kết CSV','Export attendance summary')}</a>
        <Table headers={[t('Sinh viên','Student'),t('Đã tham dự / Tổng buổi có tên','Attended / Assigned sessions'),t('Đúng giờ','On time'),t('Đi muộn','Late'),t('Vắng','Absent'),t('Chưa kết thúc','Pending')]} rows={(state.data.summary||[]).map(r=>[<span>{r.name}<small className="attendance-email">{r.email}</small></span>,<strong>{r.attended} / {r.total}</strong>,r.present,r.late,r.absent,r.pending])}/>
      </section>
      <p>
        {t(
          "Mã điểm danh có thể được chia sẻ; kết quả không chứng minh có mặt trực tiếp.",
          "Codes can be shared; check-in does not prove physical presence.",
        )}
      </p>
      {hub.manager && hub.course.status !== "archived" && (
        <details className="learning-card">
          <summary>
            {t("Mở phiên điểm danh", "Create attendance session")}
          </summary>
          <ActionForm
            path={path + "/attendance"}
            initial={{ action: "create" }}
            done={state.reload}
          >
            <Input name="title" label={t("Tên buổi học", "Session title")} />
            <Input
              name="code"
              type="password"
              label={t("Mã tối thiểu 6 ký tự", "Code, minimum 6 characters")}
            />
            {["opens_at", "late_at", "closes_at"].map((name, i) => (
              <Input
                key={name}
                name={name}
                type="datetime-local"
                label={
                  [
                    t("Mở lúc", "Opens"),
                    t("Tính muộn từ", "Late after"),
                    t("Đóng lúc", "Closes"),
                  ][i]
                }
              />
            ))}
          </ActionForm>
        </details>
      )}
      <a href={root + path + "/attendance?export=csv"}>
        {t("Xuất CSV", "Export CSV")}
      </a>
      {state.data.sessions.map((s) => (
        <article className="learning-card" key={s.id}>
          <h3>{s.title}</h3>
          <p>
            {date(s.opens_at)} → {date(s.closes_at)} ·{" "}
            {s.closed
              ? t("Đã đóng", "Closed")
              : t("Theo thời gian phiên", "Scheduled window")}
          </p>
          {hub.manager ? (
            <ActionForm
              path={path + "/attendance"}
              initial={{ action: "close", session_id: s.id }}
              done={state.reload}
              label={t("Đóng phiên", "Close session")}
            />
          ) : (
            !s.closed && (
              <ActionForm
                path={path + "/attendance"}
                initial={{ action: "checkin", session_id: s.id }}
                done={state.reload}
                label={t("Điểm danh", "Check in")}
              >
                <Input
                  name="code"
                  label={t("Mã điểm danh", "Attendance code")}
                />
              </ActionForm>
            )
          )}
          <Table
            headers={[
              t("Sinh viên", "Student"),
              t("Trạng thái", "Status"),
              t("Thời điểm", "Time"),
              t("Điều chỉnh", "Correction"),
            ]}
            rows={state
              .data!.records.filter((r) => r.session_id === s.id)
              .map((r) => [
                r.student__display_name,
                r.status,
                date(r.checked_at),
                hub.manager ? (
                  <details>
                    <summary>{t("Sửa / lịch sử", "Edit / history")}</summary>
                    {r.corrections.map((c, i) => (
                      <p key={i}>
                        {c.from} → {c.to}: {c.reason} ({date(c.at)})
                      </p>
                    ))}
                    <ActionForm
                      path={path + "/attendance"}
                      initial={{
                        action: "correct",
                        session_id: s.id,
                        student_id: r.student_id,
                      }}
                      done={state.reload}
                    >
                      <select name="status" defaultValue={r.status}>
                        <option value="present">
                          {t("Có mặt", "Present")}
                        </option>
                        <option value="late">{t("Đi muộn", "Late")}</option>
                        <option value="absent">{t("Vắng", "Absent")}</option>
                      </select>
                      <Input name="reason" label={t("Lý do", "Reason")} />
                    </ActionForm>
                  </details>
                ) : (
                  "—"
                ),
              ])}
          />
        </article>
      ))}
    </>
  );
}
function Progress({
  path,
  hub,
  refresh,
}: {
  path: string;
  hub: Hub;
  refresh: () => void;
}) {
  const state = useData<{
    items: {
      student: string;
      email: string;
      completed: number;
      total: number;
      percent: number;
      submitted: number;
      assignments: number;
    }[];
  }>(path + "/progress");
  const { t } = useLanguage();
  return (
    <>
      <p>
        {t(
          "Tiến độ bài học do sinh viên tự đánh dấu; bài nộp được tính riêng.",
          "Lessons are self-reported; submissions are counted separately.",
        )}
      </p>
      {!hub.manager &&
        hub.lessons.map((l) => (
          <ActionForm
            key={l.id}
            path={path + "/actions"}
            initial={{
              action: "progress",
              lesson_id: l.id,
              completed: !hub.completed.includes(l.id),
            }}
            done={refresh}
            label={
              hub.completed.includes(l.id)
                ? t("Bỏ hoàn thành", "Mark incomplete")
                : t("Đã hoàn thành", "Mark complete")
            }
          >
            <strong>{l.title}</strong>
          </ActionForm>
        ))}
      <a href={root + path + "/progress?export=csv"}>
        {t("Xuất CSV", "Export CSV")}
      </a>
      {!state.data ? (
        <Load {...state} />
      ) : (
        <Table
          headers={[
            t("Sinh viên", "Student"),
            "Email",
            t("Bài học", "Lessons"),
            "%",
            t("Bài nộp", "Submissions"),
          ]}
          rows={state.data.items.map((x) => [
            x.student,
            x.email,
            `${x.completed}/${x.total}`,
            <progress
              max={100}
              value={x.percent}
              aria-label={`${x.percent}%`}
            />,
            `${x.submitted}/${x.assignments}`,
          ])}
        />
      )}
    </>
  );
}
type Topic = {
  id: number;
  title: string;
  body: string;
  author: string;
  pinned: boolean;
  locked: boolean;
  hidden: boolean;
  resolved: boolean;
  created_at: string;
  replies: {
    id: number;
    body: string;
    author__display_name: string;
    parent_id: number | null;
    accepted: boolean;
    hidden: boolean;
    created_at: string;
  }[];
};
function Discussions({ path, hub }: { path: string; hub: Hub }) {
  const state = useData<{
    items: Topic[];
    notices: { id: number; text: string; read_at: string | null }[];
  }>(path + "/discussion");
  const { t, date } = useLanguage();
  if (!state.data) return <Load {...state} />;
  return (
    <>
      <details className="learning-card">
        <summary>{t("Chủ đề mới", "New discussion")}</summary>
        <ActionForm
          path={path + "/discussion"}
          initial={{ action: "create" }}
          done={state.reload}
        >
          <Input name="title" label={t("Tiêu đề", "Title")} />
          <label>
            {t("Bài học (tùy chọn)", "Lesson (optional)")}
            <select name="lesson_id">
              <option value="">{t("Cả môn", "Whole course")}</option>
              {hub.lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          <Body label={t("Nội dung", "Content")} />
        </ActionForm>
      </details>
      {state.data.notices
        .filter((n) => !n.read_at)
        .map((n) => (
          <p key={n.id} role="status">
            🔔 {n.text}
          </p>
        ))}
      <ActionForm
        path={path + "/discussion"}
        initial={{ action: "read" }}
        done={state.reload}
        label={t("Đánh dấu thông báo đã đọc", "Mark notifications read")}
      />
      {state.data.items.map((topic) => (
        <article className="learning-card" key={topic.id}>
          <h3>
            {topic.pinned ? "📌 " : ""}
            {topic.title} {topic.resolved ? "✓" : ""}
          </h3>
          <small>
            {topic.author} · {date(topic.created_at)}
          </small>
          <p className="learning-text">{topic.body}</p>
          {hub.manager && hub.course.status !== "archived" && (
            <ActionForm
              path={path + "/discussion"}
              initial={{ action: "moderate", topic_id: topic.id }}
              done={state.reload}
            >
              {(["pinned", "locked", "hidden", "resolved"] as const).map(
                (key, i) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      name={key}
                      defaultChecked={topic[key]}
                    />
                    {
                      [
                        t("Ghim", "Pin"),
                        t("Khóa", "Lock"),
                        t("Ẩn", "Hide"),
                        t("Đã giải đáp", "Resolved"),
                      ][i]
                    }
                  </label>
                ),
              )}
            </ActionForm>
          )}
          {topic.replies.map((r) => (
            <div className="learning-reply" key={r.id}>
              <strong>
                {r.author__display_name} {r.accepted ? "✓" : ""}
              </strong>
              <small>
                {" "}
                #{r.id} {r.parent_id ? `↳ #${r.parent_id}` : ""} ·{" "}
                {date(r.created_at)}
              </small>
              <p className="learning-text">{r.body}</p>
              {hub.manager && hub.course.status !== "archived" && (
                <ActionForm
                  path={path + "/discussion"}
                  initial={{
                    action: "moderate",
                    topic_id: topic.id,
                    reply_id: r.id,
                  }}
                  done={state.reload}
                >
                  <label>
                    <input
                      name="accepted"
                      type="checkbox"
                      defaultChecked={r.accepted}
                    />
                    {t("Câu trả lời được chọn", "Accepted answer")}
                  </label>
                  <label>
                    <input
                      name="reply_hidden"
                      type="checkbox"
                      defaultChecked={r.hidden}
                    />
                    {t("Ẩn trả lời", "Hide reply")}
                  </label>
                </ActionForm>
              )}
            </div>
          ))}
          {!topic.locked && !topic.hidden && (
            <ActionForm
              path={path + "/discussion"}
              initial={{ action: "reply", topic_id: topic.id }}
              done={state.reload}
              label={t("Trả lời", "Reply")}
            >
              <label>
                {t("Trả lời cho", "Reply to")}
                <select name="parent_id">
                  <option value="">{t("Chủ đề", "Topic")}</option>
                  {topic.replies
                    .filter((r) => !r.hidden)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        #{r.id} {r.author__display_name}
                      </option>
                    ))}
                </select>
              </label>
              <Body label={t("Trả lời", "Reply")} />
            </ActionForm>
          )}
        </article>
      ))}
    </>
  );
}

export function CourseAttendance(){const {monId}=useParams();const state=useData<Hub>('/courses/'+monId);return <section className="learning-page">{state.data?<Attendance path={'/courses/'+monId} hub={state.data}/>:<Load {...state}/>}</section>;}
