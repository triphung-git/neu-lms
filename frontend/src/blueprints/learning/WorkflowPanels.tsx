import { useState } from "react";
import { useSession } from "../../app/providers/SessionContext";
import { get, post, root, upload } from "./api";
import { useLanguage } from "./i18n";
import { ActionForm, Body, Input, Load, Table, useData } from "./ui";
import type { Hub } from "./LearningHub";
type Props = { path: string; hub: Hub };
export function AssignmentSelect({ hub }: { hub: Hub }) {
  const { t } = useLanguage();
  return (
    <label>
      {t("Bài tập", "Assignment")}
      <select name="assignment_id" required>
        {hub.assignments.map((a) => (
          <option key={a.id} value={a.id}>
            {a.title}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Appeals({ path, hub }: Props) {
  const { t, date } = useLanguage();
  const state = useData<{
    items: {
      id: number;
      grade_id: number;
      current_version: number;
      reason: string;
      status: string;
      response: string;
      grade__score: string;
      resolved_grade__score: string | null;
      grade__submission__student__display_name: string;
      grade__submission__assignment__title: string;
    }[];
    grades: {
      id: number;
      score: string;
      submission__assignment__title: string;
      submission__assignment_id: string;
      submission__student__display_name: string;
    }[];
    policies: { assignment_id: string; deadline: string }[];
  }>(path + "/appeals");
  if (!state.data) return <Load {...state} />;
  return (
    <>
      {hub.manager && (
        <details className="learning-card">
          <summary>{t("Mở hạn phúc khảo", "Set appeal deadline")}</summary>
          <ActionForm
            path={path + "/appeals"}
            initial={{ action: "policy" }}
            done={state.reload}
          >
            <AssignmentSelect hub={hub} />
            <Input
              name="deadline"
              type="datetime-local"
              label={t("Hạn phúc khảo", "Appeal deadline")}
            />
          </ActionForm>
        </details>
      )}
      <Table
        headers={[
          t("Bài tập", "Assignment"),
          t("Hạn phúc khảo", "Appeal deadline"),
        ]}
        rows={state.data.policies.map((p) => [
          hub.assignments.find((a) => a.id === p.assignment_id)?.title ||
            p.assignment_id,
          date(p.deadline),
        ])}
      />
      {!hub.manager && (
        <ActionForm
          path={path + "/appeals"}
          initial={{ action: "create" }}
          done={state.reload}
          label={t("Gửi phúc khảo", "Submit appeal")}
        >
          <label>
            {t("Điểm đã công bố", "Published grade")}
            <select name="grade_id" required>
              {state.data.grades.map((g) => (
                <option key={g.id} value={g.id}>
                  #{g.id} {g.submission__assignment__title}: {g.score}
                </option>
              ))}
            </select>
          </label>
          <Body name="reason" label={t("Lý do phúc khảo", "Appeal reason")} />
        </ActionForm>
      )}
      {state.data.items.map((a) => (
        <article className="learning-card" key={a.id}>
          <h3>
            {a.grade__submission__assignment__title} ·{" "}
            {a.grade__submission__student__display_name}
          </h3>
          <p>
            {a.status} · {a.grade__score} → {a.resolved_grade__score || "—"}
          </p>
          <p className="learning-text">{a.reason}</p>
          <p className="learning-text">{a.response}</p>
          {hub.manager && a.status !== "resolved" && (
            <>
              <ActionForm
                path={path + "/appeals"}
                initial={{ action: "review", id: a.id }}
                done={state.reload}
                label={t("Tiếp nhận", "Start review")}
              />
              <ActionForm
                path={path + "/appeals"}
                initial={{
                  action: "resolve",
                  id: a.id,
                  expected_version: a.current_version,
                }}
                done={state.reload}
                label={t("Giải quyết", "Resolve")}
              >
                <Input
                  name="score"
                  type="number"
                  required={false}
                  label={t(
                    "Điểm mới; để trống để giữ điểm",
                    "New score; blank to keep grade",
                  )}
                />
                <Body
                  name="response"
                  label={t("Phản hồi và lý do", "Response and reason")}
                />
              </ActionForm>
            </>
          )}
        </article>
      ))}
    </>
  );
}
export function Downloads({ path, hub }: Props) {
  const { t, date } = useLanguage();
  const [query, setQuery] = useState("");
  const state = useData<{
    items: {
      user__display_name: string;
      user__email: string;
      assignment__title: string;
      file__file_name: string;
      kind: string;
      occurred_at: string;
    }[];
    totals: { user__email: string; file__file_name: string; count: number }[];
    total_events: number;
    limit: number;
  }>(path + "/downloads" + query);
  return (
    <>
      <p>
        {t(
          "Ghi nhận yêu cầu tải hợp lệ, không chứng minh đã tải xong hoặc đã đọc. Tối đa 5.000 dòng mỗi lần xuất.",
          "Records valid download requests, not completed downloads or reading. Maximum 5,000 exported rows.",
        )}
      </p>
      <form
        className="learning-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const q = new URLSearchParams();
          for (const [k, v] of f)
            if (v)
              q.set(
                k,
                k === "start" || k === "end"
                  ? new Date(String(v)).toISOString()
                  : String(v),
              );
          setQuery("?" + q);
        }}
      >
        <AssignmentSelect hub={hub} />
        <label>
          {t("Sinh viên", "Student")}
          <select name="user_id">
            <option value="">{t("Tất cả", "All")}</option>
            {hub.students.map((s) => (
              <option key={s.student_id} value={s.student_id}>
                {s.student__display_name}
              </option>
            ))}
          </select>
        </label>
        <Input
          name="file_id"
          label={t("Mã tệp (tùy chọn)", "File ID (optional)")}
          required={false}
        />
        <Input
          name="start"
          type="datetime-local"
          label={t("Từ", "From")}
          required={false}
        />
        <Input
          name="end"
          type="datetime-local"
          label={t("Đến", "To")}
          required={false}
        />
        <button>{t("Lọc", "Filter")}</button>
      </form>
      <a
        href={
          root +
          path +
          "/downloads" +
          (query ? query + "&" : "?") +
          "export=csv"
        }
      >
        {t("Xuất CSV", "Export CSV")}
      </a>
      {!state.data ? (
        <Load {...state} />
      ) : (
        <>
          <p>
            {t("Tổng sự kiện", "Total events")}: {state.data.total_events}
          </p>
          <Table
            headers={["Email", t("Tệp", "File"), t("Số lượt tải", "Downloads")]}
            rows={state.data.totals.map((x) => [
              x.user__email,
              x.file__file_name,
              x.count,
            ])}
          />
          <Table
            headers={[
              t("Sinh viên", "Student"),
              t("Bài tập", "Assignment"),
              t("Tệp", "File"),
              t("Loại", "Type"),
              t("Ngày giờ", "Timestamp"),
            ]}
            rows={state.data.items.map((x) => [
              x.user__display_name,
              x.assignment__title,
              x.file__file_name,
              x.kind,
              date(x.occurred_at),
            ])}
          />
        </>
      )}
    </>
  );
}
type Policy = {
  id: number;
  assignment_id: string;
  assignment__title: string;
  assignment__total_score: string;
  max_members: number;
  formation_deadline: string;
};
type Group = {
  id: number;
  policy_id: number;
  name: string;
  leader_id: string;
  mine: boolean;
  members: { student_id: string; student__display_name: string }[];
  submissions: {
    id: number;
    number: number;
    file_name: string;
    submitted_at: string;
    is_late: boolean;
    grade: {
      id: number;
      version: number;
      score: string;
      feedback: string;
      published: boolean;
      adjustments: Record<string, { score: string; reason: string }>;
    } | null;
  }[];
};
export function Groups({ path, hub }: Props) {
  const { t, date } = useLanguage();
  const { currentUser } = useSession();
  const state = useData<{ policies: Policy[]; items: Group[] }>(
    path + "/groups",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!state.data) return <Load {...state} />;
  const submit = async (
    e: React.FormEvent<HTMLFormElement>,
    g: Group,
    p: Policy,
  ) => {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const file = new FormData(form).get("file");
    if (!(file instanceof File) || !file.size) return;
    setBusy(true);
    setError("");
    try {
      const id = await upload(hub.course.id, file, p.assignment_id);
      await post(path + "/groups", {
        action: "submit",
        policy_id: p.id,
        group_id: g.id,
        file_id: id,
      });
      state.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <p>
        {t(
          "Nhóm khóa thành viên khi hết hạn lập nhóm hoặc khi bài tập có bài nộp nhóm đầu tiên.",
          "Membership locks at the formation deadline or the first group submission for this assignment.",
        )}
      </p>
      {hub.manager && (
        <details className="learning-card">
          <summary>
            {t("Thiết lập bài tập nhóm", "Configure group assignment")}
          </summary>
          <p>
            {t(
              "Chọn bài tập chưa có bài nộp cá nhân hoặc nhóm.",
              "Choose an assignment without individual submissions or groups.",
            )}
          </p>
          <ActionForm
            path={path + "/groups"}
            initial={{ action: "policy" }}
            done={state.reload}
          >
            <AssignmentSelect hub={hub} />
            <Input
              name="max_members"
              type="number"
              value="5"
              label={t("Tối đa thành viên (1–30)", "Maximum members (1–30)")}
            />
            <Input
              name="formation_deadline"
              type="datetime-local"
              label={t("Hạn lập nhóm", "Formation deadline")}
            />
          </ActionForm>
        </details>
      )}
      {state.data.policies.map((p) => (
        <section key={p.id} className="learning-card">
          <h3>{p.assignment__title}</h3>
          <p>
            {t("Hạn lập nhóm", "Formation deadline")}:{" "}
            {date(p.formation_deadline)} · {p.max_members}{" "}
            {t("thành viên", "members")}
          </p>
          {!hub.manager && (
            <ActionForm
              path={path + "/groups"}
              initial={{ action: "create", policy_id: p.id }}
              done={state.reload}
              label={t("Tạo nhóm", "Create group")}
            >
              <Input name="name" label={t("Tên nhóm", "Group name")} />
            </ActionForm>
          )}
          {hub.manager && (
            <RosterForm path={path} hub={hub} policy={p} done={state.reload} />
          )}
          {state
            .data!.items.filter((g) => g.policy_id === p.id)
            .map((g) => (
              <article className="learning-group" key={g.id}>
                <h4>{g.name}</h4>
                {hub.manager && (
                  <details>
                    <summary>{t("Sửa thành viên", "Edit roster")}</summary>
                    <RosterForm
                      path={path}
                      hub={hub}
                      policy={p}
                      group={g}
                      done={state.reload}
                    />
                  </details>
                )}
                <ul>
                  {g.members.map((m) => (
                    <li key={m.student_id}>
                      {m.student__display_name}{" "}
                      {m.student_id === g.leader_id ? "★" : ""}
                    </li>
                  ))}
                </ul>
                {!hub.manager && !g.mine && (
                  <ActionForm
                    path={path + "/groups"}
                    initial={{
                      action: "join",
                      policy_id: p.id,
                      group_id: g.id,
                    }}
                    done={state.reload}
                    label={t("Tham gia", "Join")}
                  />
                )}
                {g.mine && (
                  <ActionForm
                    path={path + "/groups"}
                    initial={{ action: "leave", policy_id: p.id }}
                    done={state.reload}
                    label={t("Rời nhóm", "Leave group")}
                  />
                )}
                {g.leader_id === currentUser?.id && (
                  <>
                    <ActionForm
                      path={path + "/groups"}
                      initial={{
                        action: "leader",
                        policy_id: p.id,
                        group_id: g.id,
                      }}
                      done={state.reload}
                      label={t("Chuyển trưởng nhóm", "Transfer leadership")}
                    >
                      <select name="student_id">
                        {g.members.map((m) => (
                          <option key={m.student_id} value={m.student_id}>
                            {m.student__display_name}
                          </option>
                        ))}
                      </select>
                    </ActionForm>
                    <form
                      className="learning-form"
                      onSubmit={(e) => void submit(e, g, p)}
                    >
                      <label>
                        {t("Tệp bài nộp nhóm", "Group submission file")}
                        <input
                          type="file"
                          name="file"
                          required
                          disabled={busy}
                        />
                      </label>
                      <button disabled={busy}>
                        {busy
                          ? t("Đang tải và quét…", "Uploading and scanning…")
                          : t("Nộp bài nhóm", "Submit group work")}
                      </button>
                    </form>
                  </>
                )}
                {g.submissions.map((s) => (
                  <div className="learning-reply" key={s.id}>
                    <p>
                      v{s.number} · {date(s.submitted_at)}{" "}
                      {s.is_late ? t("(Muộn)", "(Late)") : ""}
                    </p>
                    <a href={root + "/group-files/" + s.id}>{s.file_name}</a>
                    <p>
                      {t("Điểm", "Score")}: {s.grade?.score || "—"} ·{" "}
                      {s.grade?.feedback}
                    </p>
                    {s.grade &&
                      Object.entries(s.grade.adjustments)
                        .filter(([, v]) => v)
                        .map(([uid, v]) => (
                          <p key={uid}>
                            {
                              g.members.find((m) => m.student_id === uid)
                                ?.student__display_name
                            }
                            : {v.score} — {v.reason}
                          </p>
                        ))}
                    {!hub.manager && s.grade?.published && (
                      <ActionForm
                        path={path + "/group-appeals"}
                        initial={{ action: "create", grade_id: s.grade.id }}
                        done={state.reload}
                        label={t("Phúc khảo điểm cá nhân", "Appeal my grade")}
                      >
                        <Body name="reason" label={t("Lý do", "Reason")} />
                      </ActionForm>
                    )}
                    {hub.manager && (
                      <GroupGradeForm
                        path={path}
                        policy={p}
                        group={g}
                        submission={s}
                        done={state.reload}
                      />
                    )}
                  </div>
                ))}
              </article>
            ))}
        </section>
      ))}
      <GroupAppeals path={path} manager={hub.manager} />
    </>
  );
}
function GroupGradeForm({
  path,
  policy,
  group,
  submission,
  done,
}: {
  path: string;
  policy: Policy;
  group: Group;
  submission: Group["submissions"][number];
  done: () => void;
}) {
  const { t } = useLanguage();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="learning-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const f = new FormData(e.currentTarget);
        const adjustments: Record<string, { score: string; reason: string }> =
          {};
        for (const m of group.members) {
          const score = String(f.get(m.student_id + "-score") || "");
          if (score !== "")
            adjustments[m.student_id] = {
              score,
              reason: String(f.get(m.student_id + "-reason") || ""),
            };
        }
        setBusy(true);
        setError("");
        try {
          await post(path + "/groups", {
            action: "grade",
            policy_id: policy.id,
            submission_id: submission.id,
            expected_version: submission.grade?.version || 0,
            score: f.get("score"),
            feedback: f.get("feedback"),
            published: f.get("published") === "on",
            adjustments,
          });
          done();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <Input
          name="score"
          type="number"
          value={submission.grade?.score}
          label={t("Điểm chung", "Group score")}
        />
        <label>
          {t("Nhận xét", "Feedback")}
          <textarea name="feedback" defaultValue={submission.grade?.feedback} />
        </label>
        <details>
          <summary>
            {t(
              "Điều chỉnh điểm cá nhân (điểm cuối cùng)",
              "Individual overrides (final scores)",
            )}
          </summary>
          {group.members.map((m) => (
            <div key={m.student_id}>
              <Input
                name={m.student_id + "-score"}
                type="number"
                required={false}
                value={submission.grade?.adjustments[m.student_id]?.score}
                label={m.student__display_name}
              />
              <Input
                name={m.student_id + "-reason"}
                required={false}
                value={submission.grade?.adjustments[m.student_id]?.reason}
                label={t(
                  "Lý do bắt buộc khi sửa điểm",
                  "Reason required for override",
                )}
              />
            </div>
          ))}
        </details>
        <label>
          <input type="checkbox" name="published" />
          {t("Công bố", "Publish")}
        </label>
        <button>{t("Lưu điểm", "Save grade")}</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function RosterForm({
  path,
  hub,
  policy,
  group,
  done,
}: {
  path: string;
  hub: Hub;
  policy: Policy;
  group?: Group;
  done: () => void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="learning-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await post(path + "/groups", {
            action: "roster",
            policy_id: policy.id,
            group_id: group?.id,
            name: f.get("name"),
            leader_id: f.get("leader_id"),
            student_ids: f.getAll("student_ids"),
          });
          done();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <Input
          name="name"
          value={group?.name}
          label={t("Tên nhóm", "Group name")}
        />
        <label>
          {t("Trưởng nhóm", "Leader")}
          <select name="leader_id" defaultValue={group?.leader_id}>
            {hub.students.map((m) => (
              <option key={m.student_id} value={m.student_id}>
                {m.student__display_name}
              </option>
            ))}
          </select>
        </label>
        <p>
          {t(
            "Chọn thành viên, bao gồm trưởng nhóm",
            "Select members, including the leader",
          )}
        </p>
        {hub.students.map((m) => (
          <label key={m.student_id}>
            <input
              type="checkbox"
              name="student_ids"
              value={m.student_id}
              defaultChecked={group?.members.some(
                (x) => x.student_id === m.student_id,
              )}
            />
            {m.student__display_name}
          </label>
        ))}
        <button>{t("Lưu nhóm", "Save group")}</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function GroupAppeals({ path, manager }: { path: string; manager: boolean }) {
  const { t } = useLanguage();
  const state = useData<{
    items: {
      id: number;
      student: string;
      assignment: string;
      group: string;
      reason: string;
      response: string;
      status: string;
      score: string;
      resolved_score: string | null;
      current_version: number;
    }[];
  }>(path + "/group-appeals");
  if (!state.data) return <Load {...state} />;
  return (
    <section>
      <h3>{t("Theo dõi phúc khảo điểm nhóm", "Group grade appeals")}</h3>
      <button onClick={state.reload}>{t("Làm mới", "Refresh")}</button>
      {state.data.items.map((a) => (
        <article className="learning-card" key={a.id}>
          <h4>
            {a.assignment} · {a.group} · {a.student}
          </h4>
          <p>
            {a.status}: {a.score} → {a.resolved_score || "—"}
          </p>
          <p>{a.reason}</p>
          <p>{a.response}</p>
          {manager && a.status !== "resolved" && (
            <ActionForm
              path={path + "/group-appeals"}
              initial={{
                action: "resolve",
                id: a.id,
                expected_version: a.current_version,
              }}
              done={state.reload}
              label={t("Giải quyết", "Resolve")}
            >
              <Input
                name="score"
                type="number"
                required={false}
                label={t(
                  "Điểm cá nhân mới (bỏ trống để giữ nguyên)",
                  "New personal score (blank to keep)",
                )}
              />
              <Body name="response" label={t("Phản hồi", "Response")} />
            </ActionForm>
          )}
        </article>
      ))}
    </section>
  );
}
