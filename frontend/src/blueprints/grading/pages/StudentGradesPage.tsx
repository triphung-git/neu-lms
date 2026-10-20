import React, { useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { getLatestPublishedGrade } from '../domain/gradingPolicies';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN, formatScoreVN } from '../../../shared/kernel/formatting';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import './StudentGradesPage.css';

export const StudentGradesPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { assignments, submissions, gradeRevisions, courses, memberships } = useDatabase();
  const { currentUser } = useSession();

  const selectedCourseId = searchParams.get('mon') || 'all';
  const [expandedRubrics, setExpandedRubrics] = useState<Record<string, boolean>>({});

  // Student's enrolled courses
  const myCourseIds = useMemo(() => {
    return new Set(
      memberships
        .filter(m => m.userId === currentUser?.id && m.status === 'active')
        .map(m => m.courseId)
    );
  }, [memberships, currentUser]);

  const enrolledCourses = useMemo(() => {
    return courses.filter(c => myCourseIds.has(c.id));
  }, [courses, myCourseIds]);

  // Target courses to display
  const targetCourseIds = useMemo(() => {
    if (selectedCourseId !== 'all') {
      return myCourseIds.has(selectedCourseId) ? [selectedCourseId] : [];
    }
    return Array.from(myCourseIds);
  }, [selectedCourseId, myCourseIds]);

  // Published assignments for target courses
  const targetAssignments = useMemo(() => {
    const set = new Set(targetCourseIds);
    return assignments.filter(a => set.has(a.courseId) && a.status === 'published');
  }, [assignments, targetCourseIds]);

  const handleSelectCourse = (courseId: string) => {
    const next = new URLSearchParams(searchParams);
    if (courseId === 'all') next.delete('mon');
    else next.set('mon', courseId);
    setSearchParams(next);
  };

  const toggleExpand = (subId: string) => {
    setExpandedRubrics(prev => ({
      ...prev,
      [subId]: !prev[subId]
    }));
  };

  return (
    <div className="student-grades-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Trang chủ', path: '/sv' },
            { label: 'Bảng điểm của tôi' }
          ]}
        />
        <h1 className="page-heading">Bảng điểm học tập của tôi</h1>
        <p className="page-subheading">
          Theo dõi kết quả đánh giá chi tiết và nhận xét từ giảng viên cho các bài tập đã nộp.
        </p>
      </div>

      <div className="grades-rule-notice">
        <Info size={18} />
        <span>
          <strong>Lưu ý:</strong> Bảng điểm chỉ hiển thị các bài tập đã được Giảng viên chấm và công bố chính thức. Điểm bài tập được hiển thị riêng biệt theo từng học phần.
        </span>
      </div>

      {/* Filter by course */}
      <div className="grades-filter-card">
        <div className="filter-select-col">
          <SelectField
            label="Chọn môn học để xem điểm"
            value={selectedCourseId}
            onChange={e => handleSelectCourse(e.target.value)}
            options={[
              { value: 'all', label: 'Tất cả các môn đang học' },
              ...enrolledCourses.map(c => ({ value: c.id, label: `${c.code} — ${c.name}` }))
            ]}
          />
        </div>
      </div>

      {targetAssignments.length === 0 ? (
        <EmptyState
          title="Chưa có dữ liệu bài tập"
          description="Chưa có bài tập nào được công bố trong học phần đã chọn."
        />
      ) : (
        <div className="grades-table-card">
          <table className="npc-table">
            <thead>
              <tr>
                <th>Môn học</th>
                <th>Bài tập</th>
                <th>Hạn nộp</th>
                <th>Điểm công bố</th>
                <th>Trạng thái</th>
                <th>Chi tiết đánh giá</th>
              </tr>
            </thead>
            <tbody>
              {targetAssignments.map(ass => {
                const c = courses.find(crs => crs.id === ass.courseId);
                const sub = submissions.find(
                  s => s.assignmentId === ass.id && s.studentId === currentUser?.id
                );
                const grade = sub ? getLatestPublishedGrade(gradeRevisions, sub.id) : null;
                const isGraded = !!grade;
                const isExpanded = sub ? !!expandedRubrics[sub.id] : false;

                return (
                  <React.Fragment key={ass.id}>
                    <tr>
                      <td>
                        <span className="course-code-tag">{c?.code}</span>
                      </td>
                      <td>
                        <Link to={`/sv/bai-tap/${ass.id}`} className="ass-title-link">
                          <strong>{ass.title}</strong>
                        </Link>
                      </td>
                      <td>{formatDateVN(ass.dueAt)}</td>
                      <td>
                        {isGraded ? (
                          <strong className="published-score-num">
                            {formatScoreVN(grade.total)} / {ass.maxScore}
                          </strong>
                        ) : sub ? (
                          <span className="text-muted">Đang chấm điểm</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {isGraded ? (
                          <Badge variant="published" label="Đã công bố" />
                        ) : sub ? (
                          <Badge variant="submitted" label="Đã nộp bài" />
                        ) : (
                          <Badge variant="pending" label="Chưa nộp" />
                        )}
                      </td>
                      <td>
                        {isGraded ? (
                          <button
                            type="button"
                            className="expand-rubric-btn"
                            onClick={() => sub && toggleExpand(sub.id)}
                            aria-expanded={isExpanded}
                          >
                            <span>{isExpanded ? 'Thu gọn' : 'Xem tiêu chí & Nhận xét'}</span>
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        ) : (
                          <Link to={`/sv/bai-tap/${ass.id}`} className="view-ass-link">
                            Xem đề bài →
                          </Link>
                        )}
                      </td>
                    </tr>

                    {/* Expandable Rubric Details Row */}
                    {isGraded && isExpanded && (
                      <tr className="expanded-rubric-row">
                        <td colSpan={6}>
                          <div className="rubric-breakdown-box">
                            <h4 className="breakdown-title">Bảng điểm chi tiết theo tiêu chí Rubric:</h4>
                            <div className="rubric-criteria-grid">
                              {ass.rubricCriteria.map(cr => {
                                const crScore = grade.criterionScores.find(cs => cs.criterionId === cr.id)?.score ?? 0;
                                return (
                                  <div key={cr.id} className="rubric-criteria-card">
                                    <div className="crit-header">
                                      <strong>{cr.title}</strong>
                                      <span className="crit-points">
                                        {formatScoreVN(crScore)} / {formatScoreVN(cr.maxScore)} đ
                                      </span>
                                    </div>
                                    <p className="crit-desc">{cr.description}</p>
                                  </div>
                                );
                              })}
                            </div>

                            {grade.feedback && (
                              <div className="teacher-feedback-block">
                                <strong>Nhận xét từ Giảng viên:</strong>
                                <p>{grade.feedback}</p>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
