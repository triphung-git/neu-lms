import React, { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import {
  getLatestPublishedGrade,
  getLatestDraftGrade,
  canTeacherAccessCourse
} from '../domain/gradingPolicies';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatScoreVN } from '../../../shared/kernel/formatting';
import { removeVietnameseAccents } from '../../../shared/lib/search';
import {
  AlertTriangle,
  Info
} from 'lucide-react';
import './TeacherGradebookPage.css';

export const TeacherGradebookPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const { courses, assignments, submissions, gradeRevisions, memberships, users } = useDatabase();
  const { currentUser } = useSession();
  const navigate = useNavigate();

  const course = courses.find(c => c.id === monId);
  const isAuthorized = canTeacherAccessCourse(course, currentUser);
  const isArchived = course?.status === 'archived';
  const [searchQuery, setSearchQuery] = useState('');

  // Published assignments for this course
  const publishedAssignments = useMemo(() => {
    return assignments.filter(a => a.courseId === monId && a.status === 'published');
  }, [assignments, monId]);

  // Enriched members with userName and userEmail
  const courseMembers = useMemo(() => {
    return memberships
      .filter(m => m.courseId === monId)
      .map(m => {
        const u = users.find(usr => usr.id === m.userId);
        return {
          ...m,
          userName: u?.fullName || m.emailNormalized,
          userEmail: m.emailNormalized
        };
      });
  }, [memberships, users, monId]);

  // Filtered members by search
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return courseMembers;
    const qNorm = removeVietnameseAccents(searchQuery.toLowerCase().trim());
    return courseMembers.filter(m => {
      const nameNorm = removeVietnameseAccents(m.userName.toLowerCase());
      const emailNorm = m.userEmail.toLowerCase();
      return nameNorm.includes(qNorm) || emailNorm.includes(qNorm);
    });
  }, [courseMembers, searchQuery]);

  if (!course || !isAuthorized) {
    return (
      <div className="teacher-gradebook-container">
        <EmptyState
          title="Không tìm thấy môn học"
          description="Môn học không tồn tại hoặc bạn không có quyền truy cập."
          action={
            <Button variant="primary" onClick={() => navigate('/gv/mon-hoc')}>
              Về danh sách môn học
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="teacher-gradebook-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/gv' },
            { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
            { label: 'Bảng điểm tổng hợp' }
          ]}
        />
        <h1 className="page-main-heading">Bảng điểm học phần: {course.name}</h1>
        <p className="page-subtitle">
          Ma trận theo dõi điểm số toàn bộ sinh viên qua các bài tập đã công bố.
        </p>
      </div>

      <div className="gradebook-notice-box">
        <Info size={18} />
        <span>
          <strong>Lưu ý nghiệp vụ:</strong> Bảng điểm chỉ thể hiện các cột bài tập đã công bố chính thức. Không tự ý hiển thị cột điểm tổng kết hoặc thứ hạng khi chưa có công thức trọng số phê duyệt.
        </span>
      </div>

      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>Môn học đã lưu trữ: Bảng điểm ở chế độ chỉ đọc.</span>
        </div>
      )}

      {/* Search Bar */}
      <div className="gradebook-search-card">
        <TextField
          label="Tìm kiếm sinh viên trong bảng điểm"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Nhập tên hoặc email sinh viên..."
        />
      </div>

      {publishedAssignments.length === 0 ? (
        <EmptyState
          title="Chưa có bài tập nào được công bố"
          description="Bảng điểm sẽ hiển thị ma trận điểm khi giảng viên công bố bài tập đầu tiên cho học phần."
          action={
            <Button variant="primary" onClick={() => navigate(`/gv/mon-hoc/${course.id}/bai-tap`)}>
              Vào quản lý bài tập
            </Button>
          }
        />
      ) : (
        <div className="gradebook-matrix-card">
          <div className="matrix-scroll-wrapper">
            <table className="gradebook-matrix-table">
              <thead>
                <tr>
                  <th className="sticky-col header-col">Sinh viên</th>
                  <th className="sub-header-col">Email</th>
                  {publishedAssignments.map(ass => (
                    <th key={ass.id} className="ass-col-header">
                      <div className="ass-header-title">{ass.title}</div>
                      <span className="ass-header-pts">({ass.maxScore} đ)</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map(m => {
                  const isWithdrawn = m.status === 'withdrawn';
                  return (
                    <tr key={m.id} className={isWithdrawn ? 'withdrawn-row' : ''}>
                      <td className="sticky-col data-col">
                        <strong>{m.userName}</strong>
                        {isWithdrawn && <span className="withdrawn-tag">Đã rút</span>}
                      </td>

                      <td className="email-data-col">{m.userEmail}</td>

                      {publishedAssignments.map(ass => {
                        const sub = submissions.find(
                          s => s.assignmentId === ass.id && s.studentId === m.userId
                        );

                        if (!sub) {
                          return (
                            <td key={ass.id} className="matrix-cell empty-cell">
                              <span className="text-muted" title="Chưa nộp bài">—</span>
                            </td>
                          );
                        }

                        const pubGrade = getLatestPublishedGrade(gradeRevisions, sub.id);
                        const draftGrade = getLatestDraftGrade(gradeRevisions, sub.id);

                        if (pubGrade) {
                          return (
                            <td key={ass.id} className="matrix-cell published-cell">
                              <Link
                                to={`/gv/bai-nop/${sub.id}/cham`}
                                className="cell-score-link"
                                title="Xem lại phiếu chấm"
                              >
                                <strong className="published-score-text">
                                  {formatScoreVN(pubGrade.total)}
                                </strong>
                              </Link>
                            </td>
                          );
                        }

                        if (draftGrade) {
                          return (
                            <td key={ass.id} className="matrix-cell draft-cell">
                              <Link
                                to={`/gv/bai-nop/${sub.id}/cham`}
                                className="cell-score-link"
                                title="Bản nháp điểm — Nhấn để công bố"
                              >
                                <span className="draft-score-tag">
                                  Nháp: {formatScoreVN(draftGrade.total)}
                                </span>
                              </Link>
                            </td>
                          );
                        }

                        return (
                          <td key={ass.id} className="matrix-cell pending-cell">
                            <Link
                              to={`/gv/bai-nop/${sub.id}/cham`}
                              className="cell-grade-action-btn"
                              title="Đã nộp — Nhấn để chấm"
                            >
                              Chấm bài
                            </Link>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
