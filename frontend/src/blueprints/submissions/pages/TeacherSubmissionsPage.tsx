import {uiText} from "../../../shared/i18n/translate";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { assignmentsService, type GradebookRow, type TeacherSubmissionRow } from '../../../api/assignmentsService';
import { coursesService, type Course } from '../../../api/coursesService';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { TextField, SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN, formatScoreVN } from '../../../shared/kernel/formatting';
import { removeVietnameseAccents } from '../../../shared/lib/search';
import { Users, Clock, CheckCircle2, AlertTriangle, ArrowRight, FileText, Award, RefreshCw } from 'lucide-react';
import './TeacherSubmissionsPage.css';

type Assignment = Awaited<ReturnType<typeof assignmentsService.getAssignmentDirect>>;
type SubmissionListRow = GradebookRow & { submission: TeacherSubmissionRow | null };
type LoadState = 'loading' | 'ready' | 'error';

async function loadAllPages<T>(
  fetchPage: (page: number) => Promise<{
    items: T[];
    pagination: { has_next: boolean; total_items: number };
    total_score?: string | null;
  }>,
): Promise<{ items: T[]; total_items: number; total_score: string | null }> {
  const first = await fetchPage(1);
  const rows = [...first.items];
  let page = 2;
  let hasNext = first.pagination.has_next;
  while (hasNext && page <= 100) {
    const next = await fetchPage(page);
    rows.push(...next.items);
    hasNext = next.pagination.has_next;
    page += 1;
  }
  if (hasNext) throw new Error(uiText("Danh sách có quá nhiều trang để tải an toàn. Vui lòng lọc theo tên sinh viên."));
  return { items: rows, total_items: first.pagination.total_items, total_score: first.total_score ?? null };
}

export const TeacherSubmissionsPage: React.FC = () => {
  const { baiTapId } = useParams<{ baiTapId: string }>();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [rows, setRows] = useState<SubmissionListRow[]>([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [totalScore, setTotalScore] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted' | 'not_submitted' | 'graded' | 'late'>('all');

  const load = useCallback(async (signal: AbortSignal) => {
    if (!baiTapId) {
      setError(uiText("Thiếu mã bài tập."));
      setState('error');
      return;
    }
    setState('loading');
    setError('');
    try {
      const assignmentData = await assignmentsService.getAssignmentDirect(baiTapId, { signal });
      if (signal.aborted) return;
      const courseData = await coursesService.get(assignmentData.course_id);
      if (signal.aborted) return;
      const [gradebook, submissions] = await Promise.all([
        loadAllPages((page) => assignmentsService.getTeacherGradebook(
          assignmentData.course_id,
          assignmentData.id,
          { page, page_size: 100 },
          { signal },
        )),
        loadAllPages((page) => assignmentsService.listTeacherSubmissions(
          assignmentData.id,
          { page, page_size: 100 },
          { signal },
        )),
      ]);
      if (signal.aborted) return;
      const submissionByStudent = new Map(submissions.items.map((item) => [item.student_id, item]));
      setAssignment(assignmentData);
      setCourse(courseData);
      setRows(gradebook.items.map((item) => ({
        ...item,
        submission: submissionByStudent.get(item.student_id) ?? null,
      })));
      setTotalStudents(gradebook.total_items);
      setTotalScore(gradebook.total_score);
      setState('ready');
    } catch (caughtError) {
      if (signal.aborted) return;
      setError(caughtError instanceof Error ? caughtError.message : uiText("Không tải được danh sách bài nộp."));
      setState('error');
    }
  }, [baiTapId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reload]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    const submitted = row.revision_number !== null && row.submission !== null;
    const published = row.published_grade !== null;
    const late = row.submission?.is_late ?? false;
    if (statusFilter === 'submitted' && !submitted) return false;
    if (statusFilter === 'not_submitted' && submitted) return false;
    if (statusFilter === 'graded' && !published) return false;
    if (statusFilter === 'late' && !late) return false;
    if (searchQuery.trim()) {
      const query = removeVietnameseAccents(searchQuery.trim().toLowerCase());
      return removeVietnameseAccents(row.name.toLowerCase()).includes(query) || row.email.toLowerCase().includes(query);
    }
    return true;
  }), [rows, searchQuery, statusFilter]);

  const submittedRows = rows.filter((row) => row.revision_number !== null && row.submission);
  const lateCount = submittedRows.filter((row) => row.submission?.is_late).length;
  const publishedCount = rows.filter((row) => row.published_grade !== null).length;
  const onTimeCount = submittedRows.length - lateCount;
  const notSubmittedCount = Math.max(0, totalStudents - submittedRows.length);
  const archived = course?.status === 'archived';

  if (state === 'loading') {
    return <div className="teacher-subs-container"><p role="status">{uiText("Đang tải danh sách bài nộp từ máy chủ…")}</p></div>;
  }

  if (state === 'error' || !assignment || !course) {
    return (
      <div className="teacher-subs-container">
        <EmptyState
          title={uiText("Không tải được danh sách bài nộp")}
          description={error || uiText("Bài tập không tồn tại hoặc bạn không có quyền truy cập.")}
          action={<Button variant="secondary" onClick={() => setReload((value) => value + 1)}><RefreshCw size={16} /> {uiText(" Thử lại")}</Button>}
        />
      </div>
    );
  }

  return (
    <div className="teacher-submissions-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb items={[
            { label: uiText("Bàn làm việc"), path: '/gv' },
            { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
            { label: uiText("Bài tập"), path: `/gv/mon-hoc/${course.id}/bai-tap` },
            { label: uiText("Bài nộp: {0}",[assignment.title]) },
          ]} />
          <h1 className="page-main-heading">{uiText("Danh sách bài nộp: ")}{assignment.title}</h1>
          <p className="page-subtitle">{uiText("Hạn nộp: ")}<strong>{formatDateVN(assignment.due_at)}</strong> {uiText(" · Thang điểm: ")}<strong>{assignment.total_score} {uiText(" đ")}</strong></p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setReload((value) => value + 1)}>
          <RefreshCw size={16} /> {uiText(" Cập nhật dữ liệu")}</Button>
      </div>

      {archived && <div className="archived-warning-alert" role="alert"><AlertTriangle size={20} /><span>{uiText("Môn học đã lưu trữ: danh sách bài nộp ở trạng thái chỉ đọc.")}</span></div>}

      <div className="five-metrics-grid">
        <div className="metric-box"><div className="metric-icon blue"><Users size={20} /></div><div className="metric-info"><span className="metric-val">{totalStudents}</span><span className="metric-lbl">{uiText("Sĩ số chính thức")}</span></div></div>
        <div className="metric-box"><div className="metric-icon gray"><Clock size={20} /></div><div className="metric-info"><span className="metric-val">{notSubmittedCount}</span><span className="metric-lbl">{uiText("Chưa nộp bài")}</span></div></div>
        <div className="metric-box"><div className="metric-icon green"><CheckCircle2 size={20} /></div><div className="metric-info"><span className="metric-val">{onTimeCount}</span><span className="metric-lbl">{uiText("Nộp đúng hạn")}</span></div></div>
        <div className="metric-box"><div className="metric-icon red"><AlertTriangle size={20} /></div><div className="metric-info"><span className="metric-val">{lateCount}</span><span className="metric-lbl">{uiText("Nộp muộn")}</span></div></div>
        <div className="metric-box"><div className="metric-icon purple"><Award size={20} /></div><div className="metric-info"><span className="metric-val">{publishedCount}</span><span className="metric-lbl">{uiText("Đã công bố điểm")}</span></div></div>
      </div>

      <div className="filter-search-card">
        <div className="search-col"><TextField label={uiText("Tìm kiếm sinh viên")} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={uiText("Tìm theo họ tên hoặc email…")} /></div>
        <div className="filter-col"><SelectField label={uiText("Lọc trạng thái nộp")} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} options={[
          { value: 'all', label: uiText("Tất cả ({0})",[rows.length]) },
          { value: 'submitted', label: uiText("Đã nộp bài ({0})",[submittedRows.length]) },
          { value: 'not_submitted', label: uiText("Chưa nộp ({0})",[notSubmittedCount]) },
          { value: 'graded', label: uiText("Đã công bố điểm ({0})",[publishedCount]) },
          { value: 'late', label: uiText("Nộp muộn ({0})",[lateCount]) },
        ]} /></div>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState title={uiText("Không tìm thấy sinh viên")} description={uiText("Không có dữ liệu phù hợp với bộ lọc hiện tại.")} action={<Button variant="secondary" onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}>{uiText("Xóa bộ lọc")}</Button>} />
      ) : (
        <div className="subs-table-wrapper">
          <table className="npc-table">
            <thead><tr><th>{uiText("Sinh viên")}</th><th>{uiText("Trạng thái nộp")}</th><th>{uiText("Thời gian nộp")}</th><th>{uiText("Tệp bài làm")}</th><th>{uiText("Điểm số")}</th><th>{uiText("Thao tác")}</th></tr></thead>
            <tbody>
              {filteredRows.map((row) => {
                const submitted = row.submission !== null;
                const published = row.published_grade !== null;
                const draft = row.latest_grade?.status === 'draft';
                return (
                  <tr key={row.student_id}>
                    <td><strong>{row.name}</strong><div className="email-subtext">{row.email}</div></td>
                    <td>{submitted ? <div className="status-cell-wrap"><Badge variant={published ? 'published' : 'draft'} label={published ? uiText("Đã chấm") : uiText("Đã nộp bài")} />{row.submission?.is_late && <span className="late-warning-pill">{uiText("Nộp muộn")}</span>}</div> : <Badge variant="draft" label={uiText("Chưa nộp")} />}</td>
                    <td>{row.submission ? formatDateVN(row.submission.submitted_at) : <span className="text-muted">—</span>}</td>
                    <td>{row.submission ? <div className="file-info-cell"><FileText size={16} className="file-icon" /><span>{row.submission.file_name}</span><small>(v{row.submission.number})</small></div> : <span className="text-muted">—</span>}</td>
                    <td>{published && row.published_grade ? <strong className="published-score-pill">{formatScoreVN(Number(row.published_grade.score))} / {totalScore ?? assignment.total_score}</strong> : draft && row.latest_grade ? <span className="draft-score-pill">{uiText("Nháp: ")}{formatScoreVN(Number(row.latest_grade.score))}</span> : <span className="text-muted">—</span>}</td>
                    <td>{row.submission ? <Link to={`/gv/bai-nop/${row.submission.id}/cham`} className="npc-btn npc-btn-secondary npc-btn-sm"><span>{published ? uiText("Xem lại") : uiText("Chấm bài")}</span><ArrowRight size={14} /></Link> : <span className="text-muted">{uiText("Không thể chấm")}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
