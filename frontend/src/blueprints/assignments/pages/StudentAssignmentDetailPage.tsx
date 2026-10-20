import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { getLatestPublishedGrade } from '../../grading/domain/gradingPolicies';
import { useClock } from '../../../app/providers/ClockContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN, formatScoreVN } from '../../../shared/kernel/formatting';
import {
  Upload,
  Clock,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Award,
  Download,
  FileCheck
} from 'lucide-react';
import './StudentAssignmentDetailPage.css';

export const StudentAssignmentDetailPage: React.FC = () => {
  const { baiTapId } = useParams<{ baiTapId: string }>();
  const { assignments, submissions, gradeRevisions, courses, memberships, submitAssignment, systemSettings } = useDatabase();
  const { currentUser } = useSession();
  const { now } = useClock();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  const assignment = assignments.find(a => a.id === baiTapId);
  const course = assignment ? courses.find(c => c.id === assignment.courseId) : null;
  const isArchived = course?.status === 'archived';

  // Current student submission
  const mySubmission = useMemo(() => {
    return submissions.find(
      s => s.assignmentId === baiTapId && s.studentId === currentUser?.id
    ) || null;
  }, [submissions, baiTapId, currentUser]);

  const latestRev = useMemo(() => {
    if (!mySubmission) return null;
    return mySubmission.revisions.find(r => r.id === mySubmission.latestRevisionId) || mySubmission.revisions[mySubmission.revisions.length - 1] || null;
  }, [mySubmission]);

  const publishedGrade = useMemo(() => {
    if (!mySubmission) return null;
    return getLatestPublishedGrade(gradeRevisions, mySubmission.id);
  }, [gradeRevisions, mySubmission]);

  // Upload state
  const [selectedFileName, setSelectedFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  if (!assignment || !course) {
    return (
      <div className="student-ass-container">
        <EmptyState
          title="Không tìm thấy bài tập"
          description="Bài tập không tồn tại hoặc chưa được công bố."
          action={
            <Button variant="secondary" onClick={() => navigate('/sv/mon-hoc')}>
              Về môn học của tôi
            </Button>
          }
        />
      </div>
    );
  }

  const isEnrolled = memberships.some(
    m => m.courseId === course.id && m.userId === currentUser?.id && m.status === 'active'
  );

  if (!isEnrolled) {
    return (
      <div className="student-ass-container">
        <EmptyState
          title="Chưa ghi danh môn học"
          description="Bạn không thể nộp bài tập do chưa ghi danh vào môn học này."
          action={
            <Button variant="secondary" onClick={() => navigate('/sv/mon-hoc')}>
              Về danh sách môn học
            </Button>
          }
        />
      </div>
    );
  }

  // Time calculation
  const nowDate = new Date(now).getTime();
  const dueDate = new Date(assignment.dueAt).getTime();
  const isPastDue = nowDate > dueDate;
  const isClosed = assignment.status === 'archived' || (isPastDue && !assignment.allowLate);

  // Download instructions template
  const handleDownloadTemplate = () => {
    showNotification('success', `Đang tải xuống tài liệu hướng dẫn làm bài: De_bai_${assignment.title}.pdf`);
  };

  // Submit file handler
  const handleSimulateSubmit = () => {
    if (!currentUser) return;
    if (isClosed || isArchived) {
      showNotification('error', 'Bài tập đã đóng nhận bài nộp.');
      return;
    }

    const fileName = selectedFileName || `Bai_lam_${currentUser.fullName.replace(/\s+/g, '_')}_v${(latestRev?.revisionNumber || 0) + 1}.pdf`;
    setIsUploading(true);
    setUploadProgress(40);

    setTimeout(() => {
      setUploadProgress(85);
      setTimeout(() => {
        const nextRev = (latestRev?.revisionNumber || 0) + 1;
        const res = submitAssignment(assignment.id, currentUser.id, {
          filename: fileName,
          size: 1850000
        });

        setIsUploading(false);
        setUploadProgress(0);
        setSelectedFileName('');

        if (res.ok) {
          showNotification('success', mySubmission ? `Đã nộp thay thế bài làm thành công (Phiên bản ${nextRev}).` : 'Đã nộp bài tập thành công.');
        } else {
          showNotification('error', res.error?.message || 'Lỗi nộp bài');
        }
      }, 600);
    }, 600);
  };

  return (
    <div className="student-assignment-detail-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Trang chủ', path: '/sv' },
            { label: `${course.code} — ${course.name}`, path: `/sv/mon-hoc/${course.id}` },
            { label: 'Bài tập', path: `/sv/mon-hoc/${course.id}?tab=bai-tap` },
            { label: assignment.title }
          ]}
        />
        <div className="title-row">
          <h1 className="ass-main-title">{assignment.title}</h1>
          {mySubmission ? (
            <Badge
              variant={mySubmission.gradingStatus === 'graded' ? 'graded' : 'submitted'}
              label={mySubmission.gradingStatus === 'graded' ? 'Đã chấm điểm' : 'Đã nộp bài'}
            />
          ) : (
            <Badge
              variant={isClosed ? 'archived' : 'draft'}
              label={isClosed ? 'Đã đóng nộp' : 'Chưa nộp'}
            />
          )}
        </div>
      </div>

      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>
            Môn học đã lưu trữ: Bài tập ở chế độ chỉ đọc. Không thể nộp hoặc sửa đổi bài làm.
          </span>
        </div>
      )}

      {/* Grid: 60% Left Instructions & Rubric / 40% Right Submission Zone */}
      <div className="assignment-detail-grid">
        {/* Left Column */}
        <section className="assignment-instructions-panel">
          <div className="card-box">
            <h2 className="box-title">Đề bài & Hướng dẫn thực hiện</h2>
            <div className="assignment-desc-content">
              {assignment.instructions.split('\n').map((par, pIdx) => (
                <p key={pIdx}>{par}</p>
              ))}
            </div>

            <div className="template-download-row">
              <Button type="button" variant="secondary" onClick={handleDownloadTemplate}>
                <Download size={16} />
                <span>Tải tệp hướng dẫn đính kèm</span>
              </Button>
            </div>
          </div>

          {/* Rubric Criteria Table */}
          <div className="card-box">
            <div className="rubric-header">
              <Award size={20} className="rubric-icon" />
              <div>
                <h2 className="box-title">Tiêu chí chấm điểm (Rubric)</h2>
                <span className="rubric-subtext">Tổng điểm tối đa của bài: <strong>{assignment.maxScore} điểm</strong></span>
              </div>
            </div>

            <div className="rubric-table-wrap">
              <table className="npc-table">
                <thead>
                  <tr>
                    <th>Tiêu chí đánh giá</th>
                    <th>Mô tả chi tiết</th>
                    <th className="text-right">Điểm tối đa</th>
                  </tr>
                </thead>
                <tbody>
                  {(assignment.rubricCriteria || []).map(item => (
                    <tr key={item.id}>
                      <td><strong>{item.title}</strong></td>
                      <td>{item.description || 'Theo yêu cầu đề bài'}</td>
                      <td className="text-right">
                        <strong className="score-pts">{formatScoreVN(item.maxScore)} đ</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Published Grades Section (If graded) */}
          {mySubmission && mySubmission.gradingStatus === 'graded' && publishedGrade && (
            <div className="card-box graded-result-card">
              <div className="grade-result-top">
                <CheckCircle2 size={24} className="grade-check-icon" />
                <div>
                  <h2 className="grade-card-title">Kết quả chấm điểm chính thức</h2>
                  <span className="grade-time">Điểm số đã được Giảng viên công bố</span>
                </div>
                <div className="score-big-pill">
                  <span className="score-val">{formatScoreVN(publishedGrade.total)}</span>
                  <span className="score-max">/ {assignment.maxScore}</span>
                </div>
              </div>

              {publishedGrade.feedback && (
                <div className="feedback-content-box">
                  <strong>Nhận xét chung của Giảng viên:</strong>
                  <p>{publishedGrade.feedback}</p>
                </div>
              )}

              {/* Rubric Breakdown */}
              {publishedGrade.criterionScores && (
                <div className="rubric-breakdown-list">
                  <strong>Điểm chi tiết theo tiêu chí:</strong>
                  <ul>
                    {(assignment.rubricCriteria || []).map(cr => {
                      const scoreItem = publishedGrade.criterionScores?.find(cs => cs.criterionId === cr.id);
                      const scoreVal = scoreItem ? scoreItem.score : 0;
                      return (
                        <li key={cr.id} className="rubric-breakdown-row">
                          <span>{cr.title}</span>
                          <span>
                            <strong>{formatScoreVN(scoreVal)}</strong> / {formatScoreVN(cr.maxScore)} đ
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right Column: Submission Status & Action */}
        <aside className="submission-action-panel">
          <div className="card-box">
            <h2 className="box-title">Thời hạn & Trạng thái nộp</h2>

            <div className="due-date-meta-box">
              <div className="meta-row">
                <Calendar size={16} />
                <span>Hạn chót: <strong>{formatDateVN(assignment.dueAt)}</strong></span>
              </div>
              <div className="meta-row">
                <Clock size={16} />
                <span>
                  Chế độ nộp muộn: {assignment.allowLate ? (
                    <strong className="text-warning">Cho phép nộp muộn</strong>
                  ) : (
                    <strong>Khóa ngay khi hết hạn</strong>
                  )}
                </span>
              </div>
              {isPastDue && (
                <div className="late-warning-chip">
                  <AlertTriangle size={14} />
                  <span>Đã quá thời hạn nộp bài</span>
                </div>
              )}
            </div>

            {/* Current Submission Info if exists */}
            {mySubmission && latestRev && (
              <div className="current-sub-info-card">
                <div className="sub-info-top">
                  <FileCheck size={20} className="file-check-icon" />
                  <div>
                    <strong className="sub-file-title">{latestRev.filename}</strong>
                    <span className="sub-file-meta">
                      Phiên bản {latestRev.revisionNumber} • {formatDateVN(latestRev.submittedAt)}
                    </span>
                  </div>
                </div>

                <div className="sub-status-pills">
                  <Badge
                    variant="published"
                    label="Tệp đã quét an toàn"
                  />
                  {latestRev.isLate && (
                    <span className="late-badge">Nộp muộn</span>
                  )}
                </div>
              </div>
            )}

            {/* Upload Zone */}
            {!isClosed && !isArchived ? (
              <div className="submit-action-zone">
                <div className="upload-drop-placeholder">
                  <Upload size={24} className="up-icon" />
                  <label className="npc-btn npc-btn-secondary npc-btn-sm file-picker-label">
                    <span>{mySubmission ? 'Chọn tệp thay thế...' : 'Chọn tệp bài làm...'}</span>
                    <input
                      type="file"
                      className="sr-only"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) setSelectedFileName(f.name);
                      }}
                    />
                  </label>
                  {selectedFileName && (
                    <span className="chosen-filename">{selectedFileName}</span>
                  )}
                </div>

                {isUploading && (
                  <div className="uploading-progress-box">
                    <span className="progress-label">Đang tải lên và quét an ninh... {uploadProgress}%</span>
                    <div className="progress-bar-track">
                      <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }}></div>
                    </div>
                  </div>
                )}

                <Button
                  type="button"
                  variant="primary"
                  className="w-full"
                  isLoading={isUploading}
                  onClick={handleSimulateSubmit}
                >
                  <Upload size={16} />
                  <span>{mySubmission ? 'Nộp thay thế bài làm' : 'Xác nhận nộp bài'}</span>
                </Button>
                <p className="submit-note-text">
                  Dung lượng tối đa: {systemSettings.maxSubmissionFileMB} MB. Chỉ chấp nhận các định dạng cho phép: {systemSettings.studentSubmissionFormats.join(', ')}.
                </p>
              </div>
            ) : (
              <div className="submission-locked-notice">
                <AlertTriangle size={18} />
                <span>
                  {isArchived ? 'Môn học đã lưu trữ. Không thể nộp bài.' : 'Bài tập đã đóng nhận bài nộp.'}
                </span>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
