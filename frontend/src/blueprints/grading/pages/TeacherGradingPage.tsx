import React, { useState, useMemo, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { canTeacherAccessCourse } from '../domain/gradingPolicies';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { TextAreaField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN, formatScoreVN } from '../../../shared/kernel/formatting';
import {
  Award,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  FileText,
  History,
  Send,
  Save,
  Download
} from 'lucide-react';
import './TeacherGradingPage.css';

export const TeacherGradingPage: React.FC = () => {
  const { baiNopId } = useParams<{ baiNopId: string }>();
  const {
    submissions,
    assignments,
    courses,
    gradeRevisions,
    users,
    saveGradeDraft,
    publishGrade
  } = useDatabase();
  const { showNotification } = useNotifications();
  const { currentUser } = useSession();
  const navigate = useNavigate();

  const submission = submissions.find(s => s.id === baiNopId);
  const assignment = submission ? assignments.find(a => a.id === submission.assignmentId) : null;
  const course = assignment ? courses.find(c => c.id === assignment.courseId) : null;
  const isAuthorized = canTeacherAccessCourse(course, currentUser);
  const isArchived = course?.status === 'archived';

  const student = submission ? users.find(u => u.id === submission.studentId) : null;
  const studentName = student?.fullName || 'Sinh viên';
  const latestRev = submission?.revisions[submission.revisions.length - 1];
  const fileName = latestRev?.filename || 'bai_nop.pdf';
  const revisionNumber = latestRev?.revisionNumber || 1;
  const submittedAt = latestRev?.submittedAt || submission?.submittedAt || '';
  const isLate = latestRev?.isLate ?? submission?.isLate ?? false;

  // Submissions list for Prev / Next navigation
  const siblingSubmissions = useMemo(() => {
    if (!assignment) return [];
    return submissions.filter(s => s.assignmentId === assignment.id);
  }, [submissions, assignment]);

  const currentIndex = siblingSubmissions.findIndex(s => s.id === submission?.id);
  const prevSub = currentIndex > 0 ? siblingSubmissions[currentIndex - 1] : null;
  const nextSub = currentIndex >= 0 && currentIndex < siblingSubmissions.length - 1 ? siblingSubmissions[currentIndex + 1] : null;

  // Existing grade revisions
  const revisions = useMemo(() => {
    return gradeRevisions
      .filter(gr => gr.submissionId === baiNopId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [gradeRevisions, baiNopId]);

  const latestGradeRev = revisions.length > 0 ? revisions[0] : null;

  // Initial scores from latest grade revision or rubric defaults
  const initialRubricScores = useMemo(() => {
    const defaults: Record<string, number> = {};
    if (latestGradeRev && latestGradeRev.criterionScores.length > 0) {
      latestGradeRev.criterionScores.forEach(cs => {
        defaults[cs.criterionId] = cs.score;
      });
      return defaults;
    }
    if (assignment?.rubricCriteria) {
      assignment.rubricCriteria.forEach(r => {
        defaults[r.id] = r.maxScore;
      });
    }
    return defaults;
  }, [assignment, latestGradeRev]);

  const [scores, setScores] = useState<Record<string, number>>(initialRubricScores);
  const [feedback, setFeedback] = useState(latestGradeRev?.feedback || '');
  const [isSaving, setIsSaving] = useState(false);

  // Synchronize scores and feedback whenever navigation changes the target submission
  useEffect(() => {
    setScores(initialRubricScores);
    setFeedback(latestGradeRev?.feedback || '');
  }, [baiNopId, initialRubricScores, latestGradeRev]);

  if (!submission || !assignment || !course || !isAuthorized) {
    return (
      <div className="teacher-grading-container">
        <EmptyState
          title="Không tìm thấy bài nộp"
          description="Bài nộp không tồn tại hoặc bạn không có quyền truy cập."
          action={
            <Button variant="primary" onClick={() => navigate('/gv')}>
              Về bàn làm việc
            </Button>
          }
        />
      </div>
    );
  }

  // Calculate sum of scores
  const totalScore = Object.values(scores).reduce((a, b) => a + (Number(b) || 0), 0);

  const handleScoreChange = (criterionId: string, val: number, maxPoints: number) => {
    const safeVal = Math.min(Math.max(0, val), maxPoints);
    setScores(prev => ({
      ...prev,
      [criterionId]: safeVal
    }));
  };

  const handleSaveDraft = () => {
    if (isArchived) return;
    setIsSaving(true);
    const res = saveGradeDraft(submission.id, totalScore, scores, feedback.trim());
    setIsSaving(false);

    if (res.ok) {
      showNotification('success', 'Đã lưu bản nháp điểm thành công (Sinh viên chưa nhìn thấy điểm này).');
    } else {
      showNotification('error', res.error?.message || 'Không thể lưu bản nháp.');
    }
  };

  const handlePublishGrade = () => {
    if (isArchived) return;
    setIsSaving(true);
    const res = publishGrade(submission.id, totalScore, scores, feedback.trim() || 'Bài làm đạt yêu cầu.');
    setIsSaving(false);

    if (res.ok) {
      showNotification('success', `Đã công bố điểm ${formatScoreVN(totalScore)} / ${assignment.maxScore} cho sinh viên ${studentName}.`);
    } else {
      showNotification('error', res.error?.message || 'Không thể công bố điểm.');
    }
  };

  return (
    <div className="teacher-grading-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Bàn làm việc', path: '/gv' },
              { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
              { label: assignment.title, path: `/gv/bai-tap/${assignment.id}/bai-nop` },
              { label: `Chấm bài: ${studentName}` }
            ]}
          />
          <div className="title-row">
            <h1 className="grading-main-heading">Chấm bài: {studentName}</h1>
            <Badge
              variant={submission.gradingStatus === 'graded' ? 'graded' : 'submitted'}
              label={submission.gradingStatus === 'graded' ? 'Đã công bố điểm' : 'Bản nháp / Đang chấm'}
            />
          </div>
        </div>

        {/* Prev / Next navigation */}
        <div className="sibling-nav-buttons">
          {prevSub ? (
            <Link
              to={`/gv/bai-nop/${prevSub.id}/cham`}
              className="npc-btn npc-btn-secondary npc-btn-sm"
              title="Chuyển sang bài trước"
            >
              <ArrowLeft size={14} />
              <span>Bài trước</span>
            </Link>
          ) : (
            <button className="npc-btn npc-btn-secondary npc-btn-sm" disabled>
              <ArrowLeft size={14} />
              <span>Bài trước</span>
            </button>
          )}

          <span className="sibling-counter-pill">
            {currentIndex + 1} / {siblingSubmissions.length}
          </span>

          {nextSub ? (
            <Link
              to={`/gv/bai-nop/${nextSub.id}/cham`}
              className="npc-btn npc-btn-secondary npc-btn-sm"
              title="Chuyển sang bài tiếp theo"
            >
              <span>Bài sau</span>
              <ArrowRight size={14} />
            </Link>
          ) : (
            <button className="npc-btn npc-btn-secondary npc-btn-sm" disabled>
              <span>Bài sau</span>
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>

      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>Môn học đã lưu trữ: Phiếu chấm điểm ở chế độ chỉ đọc. Không thể cập nhật điểm.</span>
        </div>
      )}

      {/* 2-panel workstation layout (Left: Submission preview, Right: Rubric scoring) */}
      <div className="grading-workstation-grid">
        {/* LEFT PANEL: Student Submission Viewer (55%) */}
        <section className="submission-viewer-panel">
          <div className="viewer-top-meta-card">
            <div className="meta-left">
              <FileText size={24} className="file-icon" />
              <div>
                <strong className="file-name-text">{fileName}</strong>
                <div className="file-sub-row">
                  <span>Phiên bản: <strong>v{revisionNumber}</strong></span>
                  <span className="dot">•</span>
                  <span>Nộp lúc: <strong>{formatDateVN(submittedAt)}</strong></span>
                  {isLate && (
                    <span className="late-badge">Nộp muộn</span>
                  )}
                </div>
              </div>
            </div>

            <Button
              type="button"
              variant="secondary"
              onClick={() => showNotification('success', `Đang tải xuống bài nộp: ${fileName}`)}
            >
              <Download size={15} />
              <span>Tải file</span>
            </Button>
          </div>

          {/* Interactive Document Viewer Canvas */}
          <div className="document-canvas-card">
            <div className="canvas-header">
              <span className="canvas-label">Bản xem trước bài nộp trực tuyến</span>
              <Badge variant="ready" label="Tệp sạch an ninh" />
            </div>

            <div className="student-work-canvas">
              <div className="simulated-paper">
                <div className="paper-header">
                  <h3>{assignment.title}</h3>
                  <p>Họ và tên sinh viên: <strong>{studentName}</strong></p>
                  <p>Thời điểm nộp bài: {formatDateVN(submittedAt)} (Phiên bản nộp #{revisionNumber})</p>
                  <hr />
                </div>

                <div className="paper-body">
                  <h4>PHẦN I: MÔ HÌNH VÀ KIẾN TRÚC THIẾT KẾ</h4>
                  <p>
                    Bài làm phân tách rõ ràng các tầng kiến trúc: Presentation Layer, Domain Layer và Persistence Layer. Ranh giới dữ liệu được chuẩn hóa thông qua các giao diện Port và DTO chặt chẽ.
                  </p>
                  <p>
                    Hệ thống áp dụng cơ chế xác thực kép và kiểm soát toàn vẹn giao dịch trước khi cam kết dữ liệu.
                  </p>

                  <h4>PHẦN II: KẾT QUẢ KIỂM THỬ VÀ BẰNG CHỨNG</h4>
                  <p>
                    Toàn bộ 12 ca kiểm thử chức năng đều đạt 100% pass rate. Các tình huống ngoại lệ như mất mạng hoặc tệp chứa mã độc đều được xử lý an toàn theo kịch bản chuẩn.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT PANEL: Rubric Scoring Form (45%) */}
        <aside className="rubric-scoring-panel">
          <div className="scoring-card">
            <div className="scoring-header">
              <div className="scoring-title-wrap">
                <Award size={22} className="award-icon" />
                <div>
                  <h2 className="scoring-heading">Phiếu chấm điểm Rubric</h2>
                  <span className="scoring-subtext">Thang điểm bài: {assignment.maxScore} đ</span>
                </div>
              </div>

              <div className="live-total-pill">
                <span className="total-label">Tổng:</span>
                <strong className="total-num">{formatScoreVN(totalScore)}</strong>
                <span className="total-max">/ {assignment.maxScore}</span>
              </div>
            </div>

            {/* Criteria List */}
            <div className="criteria-inputs-list">
              {assignment.rubricCriteria.map((item, idx: number) => {
                const currentPoint = scores[item.id] !== undefined ? scores[item.id] : item.maxScore;
                return (
                  <div key={item.id} className="criterion-score-item">
                    <div className="crit-top-row">
                      <strong className="crit-title">
                        {idx + 1}. {item.title}
                      </strong>
                      <span className="crit-max-tag">Tối đa: {formatScoreVN(item.maxScore)} đ</span>
                    </div>

                    <p className="crit-desc">{item.description}</p>

                    <div className="crit-input-row">
                      <label className="crit-input-label">Điểm số:</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max={item.maxScore}
                        className="crit-score-input"
                        value={currentPoint}
                        onChange={e => handleScoreChange(item.id, Number(e.target.value), item.maxScore)}
                        disabled={isArchived}
                      />
                      <span className="crit-denom">/ {formatScoreVN(item.maxScore)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Feedback textarea */}
            <div className="feedback-section">
              <TextAreaField
                label="Nhận xét của Giảng viên"
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder="Ghi chú đánh giá, nhận xét ưu điểm và các điểm cần cải thiện cho sinh viên..."
                rows={4}
                disabled={isArchived}
              />
            </div>

            {/* Actions Bar */}
            {!isArchived && (
              <div className="grading-action-buttons">
                <Button
                  type="button"
                  variant="secondary"
                  isLoading={isSaving}
                  onClick={handleSaveDraft}
                >
                  <Save size={16} />
                  <span>Lưu bản nháp điểm</span>
                </Button>

                <Button
                  type="button"
                  variant="primary"
                  isLoading={isSaving}
                  onClick={handlePublishGrade}
                >
                  <Send size={16} />
                  <span>Lưu và Công bố điểm</span>
                </Button>
              </div>
            )}
          </div>

          {/* Grade Revisions History */}
          {revisions.length > 0 && (
            <div className="revisions-history-card">
              <div className="rev-header">
                <History size={16} />
                <h3>Lịch sử chỉnh sửa điểm ({revisions.length})</h3>
              </div>
              <ul className="revisions-list">
                {revisions.map((rev, rIdx: number) => (
                  <li key={rev.id} className="rev-item">
                    <div className="rev-left">
                      <strong>Lần {revisions.length - rIdx}: {formatScoreVN(rev.total)} điểm ({rev.status === 'published' ? 'Công bố' : 'Bản nháp'})</strong>
                      <p className="rev-feedback">{rev.feedback || 'Không có nhận xét'}</p>
                    </div>
                    <span className="rev-time">{formatDateVN(rev.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
