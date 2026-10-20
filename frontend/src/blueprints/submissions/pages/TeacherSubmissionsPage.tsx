import React, { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { useNotification } from '../../../app/providers/NotificationContext';
import {
  getLatestPublishedGrade,
  getLatestDraftGrade,
  canTeacherAccessCourse
} from '../../grading/domain/gradingPolicies';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { TextField, SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN, formatScoreVN } from '../../../shared/kernel/formatting';
import { removeVietnameseAccents } from '../../../shared/lib/search';
import type { Assignment, Submission, Course, Membership, User } from '../../../shared/kernel/types';
import {
  Users,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Send,
  ArrowRight,
  FileText,
  Award
} from 'lucide-react';
import './TeacherSubmissionsPage.css';

export const TeacherSubmissionsPage: React.FC = () => {
  const { baiTapId } = useParams<{ baiTapId: string }>();
  const { assignments, submissions, gradeRevisions, courses, memberships, users, publishGrade } = useDatabase();
  const { currentUser } = useSession();
  const { notifySuccess } = useNotification();
  const navigate = useNavigate();

  const assignment = assignments.find((a: Assignment) => a.id === baiTapId);
  const course = assignment ? courses.find((c: Course) => c.id === assignment.courseId) : null;
  const isAuthorized = canTeacherAccessCourse(course, currentUser);
  const isArchived = course?.status === 'archived';

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted' | 'not_submitted' | 'graded' | 'late'>('all');

  // Bulk publish modal
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [isBulkPublishing, setIsBulkPublishing] = useState(false);

  // All enrolled students (active + withdrawn)
  const courseMembers = useMemo(() => {
    if (!course) return [];
    return memberships.filter((m: Membership) => m.courseId === course.id);
  }, [memberships, course]);

  const activeStudents = useMemo(() => {
    return courseMembers.filter((m: Membership) => m.status === 'active');
  }, [courseMembers]);

  // Submissions for this assignment
  const assSubmissions = useMemo(() => {
    if (!assignment) return [];
    return submissions.filter((s: Submission) => s.assignmentId === assignment.id);
  }, [submissions, assignment]);

  const subMap = useMemo(() => {
    return new Map<string, Submission>(
      assSubmissions.map((s: Submission) => [s.studentId, s])
    );
  }, [assSubmissions]);

  // 5 Non-overlapping metrics:
  const totalStudentsCount = activeStudents.length;
  const notSubmittedCount = activeStudents.filter((st: Membership) => !subMap.has(st.userId || '')).length;
  const onTimeSubmittedCount = activeStudents.filter((st: Membership) => {
    const s = subMap.get(st.userId || '');
    return s && !s.isLate;
  }).length;
  const lateSubmittedCount = activeStudents.filter((st: Membership) => {
    const s = subMap.get(st.userId || '');
    return s && s.isLate;
  }).length;
  const gradedCount = assSubmissions.filter((s: Submission) => s.gradingStatus === 'graded').length;

  // Draft grades count eligible for bulk publish
  const draftEligibleSubs = useMemo(() => {
    return assSubmissions.filter((s: Submission) => {
      const draft = getLatestDraftGrade(gradeRevisions, s.id);
      return !!draft;
    });
  }, [assSubmissions, gradeRevisions]);

  // Student row items for the table
  const allRows = useMemo(() => {
    return courseMembers.map((m: Membership) => {
      const user = users.find((u: User) => u.id === m.userId || u.emailNormalized === m.emailNormalized);
      const sub = subMap.get(m.userId || '') || null;
      const pubGrade = sub ? getLatestPublishedGrade(gradeRevisions, sub.id) : null;
      const draftGrade = sub ? getLatestDraftGrade(gradeRevisions, sub.id) : null;
      const grade = pubGrade || draftGrade;
      const latestRev = sub && sub.revisions.length > 0 ? sub.revisions[sub.revisions.length - 1] : null;

      return {
        member: m,
        userName: user?.fullName || m.emailNormalized,
        userEmail: m.emailNormalized,
        submission: sub,
        latestRev,
        grade,
      };
    });
  }, [courseMembers, subMap, users, gradeRevisions]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return allRows.filter((row) => {
      const { userName, userEmail, submission, grade } = row;

      if (statusFilter === 'not_submitted' && submission) return false;
      if (statusFilter === 'submitted' && !submission) return false;
      if (statusFilter === 'graded' && grade?.status !== 'published') return false;
      if (statusFilter === 'late' && !submission?.isLate) return false;

      if (searchQuery.trim()) {
        const qNorm = removeVietnameseAccents(searchQuery.toLowerCase());
        const nameNorm = removeVietnameseAccents(userName.toLowerCase());
        const emailNorm = userEmail.toLowerCase();
        return nameNorm.includes(qNorm) || emailNorm.includes(qNorm);
      }

      return true;
    });
  }, [allRows, statusFilter, searchQuery]);

  if (!assignment || !course || !isAuthorized) {
    return (
      <div className="teacher-subs-container">
        <EmptyState
          title="Không tìm thấy bài tập"
          description="Bài tập không tồn tại hoặc bạn không có quyền truy cập."
          action={
            <Button variant="secondary" onClick={() => navigate('/gv')}>
              Về danh sách bài tập
            </Button>
          }
        />
      </div>
    );
  }

  // Handle bulk publish
  const handleConfirmBulkPublish = () => {
    if (draftEligibleSubs.length === 0) return;
    setIsBulkPublishing(true);

    draftEligibleSubs.forEach((sub: Submission) => {
      const draftGrade = getLatestDraftGrade(gradeRevisions, sub.id);
      if (draftGrade) {
        const rubricScores: Record<string, number> = {};
        if (draftGrade.criterionScores && draftGrade.criterionScores.length > 0) {
          draftGrade.criterionScores.forEach((cs) => {
            rubricScores[cs.criterionId] = cs.score;
          });
        }
        publishGrade(sub.id, draftGrade.total, rubricScores, draftGrade.feedback || 'Hoàn thành bài tập.');
      }
    });

    setIsBulkPublishing(false);
    setShowBulkModal(false);
    notifySuccess(`Đã công bố điểm chính thức cho ${draftEligibleSubs.length} sinh viên.`);
  };

  return (
    <div className="teacher-submissions-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Bàn làm việc', path: '/gv' },
              { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
              { label: 'Bài tập', path: `/gv/mon-hoc/${course.id}/bai-tap` },
              { label: `Bài nộp: ${assignment.title}` }
            ]}
          />
          <h1 className="page-main-heading">Danh sách bài nộp: {assignment.title}</h1>
          <p className="page-subtitle">
            Hạn nộp: <strong>{formatDateVN(assignment.dueAt)}</strong> • Thang điểm: <strong>{assignment.maxScore} đ</strong>
          </p>
        </div>

        {!isArchived && (
          <Button
            type="button"
            variant="primary"
            onClick={() => setShowBulkModal(true)}
            disabled={draftEligibleSubs.length === 0}
          >
            <Send size={16} />
            <span>Công bố {draftEligibleSubs.length} bản nháp điểm</span>
          </Button>
        )}
      </div>

      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>Môn học đã lưu trữ: Toàn bộ bài nộp và điểm số ở trạng thái chỉ đọc.</span>
        </div>
      )}

      {/* 5 Non-overlapping Metrics Cards */}
      <div className="five-metrics-grid">
        <div className="metric-box">
          <div className="metric-icon blue"><Users size={20} /></div>
          <div className="metric-info">
            <span className="metric-val">{totalStudentsCount}</span>
            <span className="metric-lbl">Sĩ số chính thức</span>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-icon gray"><Clock size={20} /></div>
          <div className="metric-info">
            <span className="metric-val">{notSubmittedCount}</span>
            <span className="metric-lbl">Chưa nộp bài</span>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-icon green"><CheckCircle2 size={20} /></div>
          <div className="metric-info">
            <span className="metric-val">{onTimeSubmittedCount}</span>
            <span className="metric-lbl">Nộp đúng hạn</span>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-icon red"><AlertTriangle size={20} /></div>
          <div className="metric-info">
            <span className="metric-val">{lateSubmittedCount}</span>
            <span className="metric-lbl">Nộp muộn</span>
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-icon purple"><Award size={20} /></div>
          <div className="metric-info">
            <span className="metric-val">{gradedCount}</span>
            <span className="metric-lbl">Đã công bố điểm</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="filter-search-card">
        <div className="search-col">
          <TextField
            label="Tìm kiếm sinh viên"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo họ tên hoặc email..."
          />
        </div>

        <div className="filter-col">
          <SelectField
            label="Lọc trạng thái nộp"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            options={[
              { value: 'all', label: `Tất cả (${allRows.length})` },
              { value: 'submitted', label: `Đã nộp bài (${assSubmissions.length})` },
              { value: 'not_submitted', label: `Chưa nộp (${notSubmittedCount})` },
              { value: 'graded', label: `Đã chấm điểm (${gradedCount})` },
              { value: 'late', label: `Nộp muộn (${lateSubmittedCount})` }
            ]}
          />
        </div>
      </div>

      {/* Submissions Table */}
      {filteredRows.length === 0 ? (
        <EmptyState
          title="Không tìm thấy sinh viên"
          description="Không có dữ liệu bài nộp nào phù hợp với bộ lọc tìm kiếm."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
              }}
            >
              Xóa bộ lọc
            </Button>
          }
        />
      ) : (
        <div className="subs-table-wrapper">
          <table className="npc-table">
            <thead>
              <tr>
                <th>Sinh viên</th>
                <th>Trạng thái nộp</th>
                <th>Thời gian nộp</th>
                <th>Tệp bài làm</th>
                <th>Điểm số</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ member, userName, userEmail, submission, latestRev, grade }) => {
                const isWithdrawn = member.status === 'withdrawn';
                const isGraded = grade?.status === 'published';
                const isDraft = grade?.status === 'draft';

                return (
                  <tr key={member.id} className={isWithdrawn ? 'withdrawn-row' : ''}>
                    <td>
                      <strong>{userName}</strong>
                      <div className="email-subtext">
                        {userEmail}
                        {isWithdrawn && <span className="withdrawn-chip">Đã rút khỏi lớp</span>}
                      </div>
                    </td>

                    <td>
                      {submission ? (
                        <div className="status-cell-wrap">
                          <Badge
                            variant={isGraded ? 'published' : 'draft'}
                            label={isGraded ? 'Đã chấm' : 'Đã nộp bài'}
                          />
                          {submission.isLate && (
                            <span className="late-warning-pill">Nộp muộn</span>
                          )}
                        </div>
                      ) : (
                        <Badge variant="draft" label="Chưa nộp" />
                      )}
                    </td>

                    <td>
                      {submission ? formatDateVN(submission.submittedAt) : <span className="text-muted">—</span>}
                    </td>

                    <td>
                      {latestRev ? (
                        <div className="file-info-cell">
                          <FileText size={16} className="file-icon" />
                          <span>{latestRev.filename}</span>
                          <small>(v{latestRev.revisionNumber})</small>
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>

                    <td>
                      {isGraded && grade ? (
                        <strong className="published-score-pill">
                          {formatScoreVN(grade.total)} / {assignment.maxScore}
                        </strong>
                      ) : isDraft && grade ? (
                        <span className="draft-score-pill">
                          Nháp: {formatScoreVN(grade.total)}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>

                    <td>
                      {submission ? (
                        <Link
                          to={`/gv/bai-nop/${submission.id}/cham`}
                          className="npc-btn npc-btn-secondary npc-btn-sm"
                        >
                          <span>{isGraded ? 'Xem lại' : 'Chấm bài'}</span>
                          <ArrowRight size={14} />
                        </Link>
                      ) : (
                        <span className="text-muted">Không thể chấm</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Bulk Publish */}
      {showBulkModal && (
        <Modal
          title="Xác nhận công bố điểm hàng loạt"
          isOpen={showBulkModal}
          onClose={() => setShowBulkModal(false)}
        >
          <div className="modal-content-stack">
            <p>
              Bạn có <strong>{draftEligibleSubs.length}</strong> bài nộp đã được chấm nháp đầy đủ điểm và nhận xét.
            </p>
            <div className="alert-notice-box">
              <CheckCircle2 size={18} />
              <span>
                Sau khi công bố, điểm số sẽ hiển thị công khai ngay lập tức trên bảng điểm của sinh viên và báo cáo quản trị. Hệ thống mô phỏng gửi email ở chế độ an toàn (không gửi email rác ra ngoài).
              </span>
            </div>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowBulkModal(false)}>
                Hủy bỏ
              </Button>
              <Button
                type="button"
                variant="primary"
                isLoading={isBulkPublishing}
                onClick={handleConfirmBulkPublish}
              >
                Công bố toàn bộ {draftEligibleSubs.length} điểm
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
