import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { getAssignmentService } from '../../../app/composition/assignmentWiring';
import type { StudentAssignmentView } from '../contracts/assignmentsDto';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { Modal } from '../../../shared/ui/Modal';
import { PdfPreview } from '../../files/components/PdfPreview';
import { SubmissionForm } from './SubmissionForm';
import { formatDateVN, formatScoreVN } from '../../../shared/kernel/formatting';
import { SubmissionGradePanel } from '../../submissions/pages/SubmissionGradePanel';
import { SubmissionHistory } from '../../submissions/pages/SubmissionHistory';
import {
  Clock,
  Calendar,
  AlertTriangle,
  Award,
  Download,
  FileText,
  Eye,
  RefreshCw,
  Info,
  ShieldCheck,
} from 'lucide-react';
import './StudentAssignmentDetailPage.css';

export const StudentAssignmentDetailPage: React.FC = () => {
  const { monId, baiTapId } = useParams<{ monId?: string; baiTapId: string }>();
  const navigate = useNavigate();
  const { showNotification } = useNotifications();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [viewData, setViewData] = useState<StudentAssignmentView | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  const fetchAssignmentData = useCallback(async (signal?: AbortSignal) => {
    if (!baiTapId) return;
    setLoading(true);
    setError(null);

    try {
      const service = getAssignmentService();
      const res = monId
        ? await service.getStudentAssignment(monId, baiTapId, { signal })
        : await service.getStudentAssignmentDirect(baiTapId, { signal });

      if (signal?.aborted) return;

      if (!res.ok) {
        setError({
          code: res.error.code || 'UNKNOWN_ERROR',
          message: res.error.message || uiText("Không thể tải thông tin bài tập."),
        });
      } else {
        setViewData(res.data);
      }
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const apiErr = err as { message?: string };
      setError({
        code: 'NETWORK_ERROR',
        message: apiErr.message || uiText("Không thể kết nối đến máy chủ. Vui lòng thử lại."),
      });
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [monId, baiTapId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchAssignmentData(controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchAssignmentData]);

  // Handle download attachment via authenticated direct/course endpoint
  const handleDownloadAttachment = (attachmentId: string, filename: string) => {
    if (!viewData) return;
    const courseId = viewData.assignment.courseId;
    const assignmentId = viewData.assignment.id;
    const url = `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}/attachments/${encodeURIComponent(attachmentId)}/download`;
    window.open(url, '_blank', 'noopener,noreferrer');
    showNotification('success', uiText("Đang tải xuống tệp: {0}",[filename]));
  };

  // Handle preview attachment via authenticated endpoint
  const handlePreviewAttachment = (attachmentId: string, name: string) => {
    if (!viewData) return;
    const courseId = viewData.assignment.courseId;
    const assignmentId = viewData.assignment.id;
    const url = `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}/attachments/${encodeURIComponent(attachmentId)}/preview`;
    setPreview({ url, name });
  };

  // Loading skeleton state
  if (loading) {
    return (
      <div className="student-assignment-detail-page">
        <div className="student-ass-container">
          <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
            <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
              {uiText("Đang xác thực quyền và tải dữ liệu bài tập từ máy chủ...")}</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state (401, 403, 404, etc.)
  if (error || !viewData) {
    const isForbidden = error?.code === '403' || error?.message?.includes('quyền') || error?.message?.includes('công bố');
    return (
      <div className="student-assignment-detail-page">
        <div className="student-ass-container">
          <EmptyState
            title={isForbidden ? uiText("Không có quyền truy cập") : uiText("Không tìm thấy bài tập")}
            description={
              error?.message ||
              uiText("Bài tập không tồn tại, bạn chưa ghi danh môn học hoặc bài tập chưa được giảng viên công bố.")
            }
            action={
              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center' }}>
                <Button
                  variant="secondary"
                  onClick={() => fetchAssignmentData()}
                  icon={<RefreshCw size={16} />}
                >
                  {uiText("Thử lại")}</Button>
                <Button variant="primary" onClick={() => navigate('/sv/mon-hoc')}>
                  {uiText("Về danh sách môn học")}</Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  const { assignment, eligibility } = viewData;
  const latest = viewData.submission?.latestRevision;
  const isClosed = eligibility.isClosed || !eligibility.canSubmit;
  const isLate = eligibility.isLate;

  const breadcrumbs = [
    { label: uiText("Trang chủ"), path: '/sv' },
    { label: uiText("Môn học"), path: '/sv/mon-hoc' },
    {
      label: assignment.courseTitle || uiText("Môn học"),
      path: `/sv/mon-hoc/${assignment.courseId}?tab=bai-tap`,
    },
    { label: assignment.title },
  ];

  return (
    <div className="student-assignment-detail-page" data-testid="student-assignment-detail">
      {/* Header & Breadcrumb */}
      <div className="page-header">
        <Breadcrumb items={breadcrumbs} />

        <div className="title-row">
          <h1 className="ass-main-title" data-testid="assignment-title">{assignment.title}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {isClosed ? (
              <Badge variant="archived" label={eligibility.message || uiText("Đã đóng nộp")} />
            ) : isLate ? (
              <Badge variant="warning" label={uiText("Quá hạn (Cho nộp muộn)")} />
            ) : (
              <Badge variant="published" label={uiText("Đang nhận bài")} />
            )}
          </div>
        </div>
      </div>

      {/* Notice alert when closed or late */}
      {isClosed && (
        <div className="archived-warning-alert" role="alert" data-testid="closed-alert">
          <AlertTriangle size={20} />
          <div>
            <strong>{uiText("Cổng nộp bài đã đóng")}</strong>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)' }}>
              {eligibility.message || uiText("Bài tập đã hết hạn nộp hoặc được giảng viên đóng tiếp nhận.")}
            </p>
          </div>
        </div>
      )}

      {!isClosed && isLate && (
        <div className="late-warning-chip" role="alert" style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: '#fffbeb', border: '1px solid #fef3c7', color: '#92400e', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <AlertTriangle size={16} />
          <span>{uiText("Thời hạn nộp ban đầu đã qua. Bài làm gửi trong thời gian này sẽ được ghi nhận là ")}<strong>{uiText("Nộp muộn")}</strong> {uiText(" theo chính sách của môn học.")}</span>
        </div>
      )}

      {/* Main Grid: 60% Left Content / 40% Right Submission Panel */}
      <div className="assignment-detail-grid">
        {/* Left Column: Instructions, Attachments, Rubric, Grades Notice */}
        <section className="assignment-instructions-panel">
          {/* Card: Đề bài & Hướng dẫn */}
          <div className="card-box">
            <h2 className="box-title">{uiText("Đề bài & Hướng dẫn thực hiện")}</h2>
            <div className="assignment-desc-content" data-testid="assignment-instructions">
              {assignment.instructions ? (
                assignment.instructions.split('\n').map((par, pIdx) => (
                  <p key={pIdx} style={{ margin: '0 0 var(--space-2) 0' }}>{par}</p>
                ))
              ) : (
                <p style={{ color: 'var(--muted)', fontStyle: 'italic' }}>{uiText("Không có hướng dẫn văn bản bổ sung.")}</p>
              )}
            </div>

            {/* Attachments List */}
            {assignment.attachments && assignment.attachments.length > 0 ? (
              <div style={{ marginTop: 'var(--space-4)', borderTop: '1px solid var(--border-soft)', paddingTop: 'var(--space-4)' }}>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', marginBottom: 'var(--space-3)' }}>
                  {uiText("Tài liệu đề bài đính kèm (")}{assignment.attachments.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {assignment.attachments.map((att) => (
                    <div
                      key={att.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 'var(--space-3)',
                        background: 'var(--surface-hover)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', overflow: 'hidden' }}>
                        <FileText size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{att.filename}</strong>
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginLeft: 'var(--space-2)' }}>
                            ({(att.sizeBytes / 1024).toFixed(1)} KB)
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Download size={14} />}
                          onClick={() => handleDownloadAttachment(att.id, att.filename)}
                        >
                          {uiText("Tải về")}</Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Eye size={14} />}
                          onClick={() => handlePreviewAttachment(att.id, att.filename)}
                          disabled={!att.previewUrl}
                        >
                          {uiText("Xem trước")}</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* Card: Tiêu chí chấm điểm (Rubric) */}
          <div className="card-box" data-testid="rubric-card">
            <div className="rubric-header">
              <Award size={20} className="rubric-icon" />
              <div>
                <h2 className="box-title">{uiText("Tiêu chí chấm điểm (Rubric)")}</h2>
                <span className="rubric-subtext">
                  {uiText("Tổng điểm tối đa của bài tập: ")}<strong>{formatScoreVN(assignment.totalScore)} {uiText(" điểm")}</strong>
                </span>
              </div>
            </div>

            {assignment.rubricCriteria && assignment.rubricCriteria.length > 0 ? (
              <div className="rubric-table-wrap">
                <table className="npc-table">
                  <thead>
                    <tr>
                      <th style={{ width: '35%' }}>{uiText("Tiêu chí đánh giá")}</th>
                      <th>{uiText("Mô tả chi tiết")}</th>
                      <th className="text-right" style={{ width: '120px' }}>{uiText("Điểm tối đa")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignment.rubricCriteria.map((item, idx) => (
                      <tr key={item.id || idx}>
                        <td><strong>{item.title}</strong></td>
                        <td>{item.description || uiText("Theo yêu cầu của đề bài")}</td>
                        <td className="text-right">
                          <strong className="score-pts">{formatScoreVN(item.maxScore)} {uiText(" đ")}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
                {uiText("Giảng viên không thiết lập bảng tiêu chí chấm điểm chi tiết cho bài tập này.")}</p>
            )}
          </div>

          {/* Card: Phân hệ B12 Thông báo kết quả chấm */}
          <div className="card-box">
            <h2 className="box-title">{uiText("Điểm và nhận xét")}</h2>
            
            {latest ? (
              <>
                <p>{uiText("Kết quả lần nộp ")}{latest.revisionNumber}</p>
                <SubmissionGradePanel submissionId={latest.id} />
              </>
            ) : (
              <p>{uiText("Bạn chưa nộp bài.")}</p>
            )}
          </div>
        </section>

        {/* Right Column: Submission Status & Action */}
        <aside className="submission-action-panel">
          <div className="card-box">
            <h2 className="box-title">{uiText("Thời hạn & Trạng thái nộp")}</h2>

            <div className="due-date-meta-box">
              <div className="meta-row">
                <Calendar size={16} />
                <span>{uiText("Hạn chót: ")}<strong>{formatDateVN(assignment.dueAt)}</strong></span>
              </div>
              <div className="meta-row">
                <Clock size={16} />
                <span>
                  {uiText("Chính sách nộp muộn: ")}{assignment.allowLate ? (
                    <strong style={{ color: '#d97706' }}>{uiText("Cho phép nộp muộn")}</strong>
                  ) : (
                    <strong>{uiText("Khóa khi hết hạn")}</strong>
                  )}
                </span>
              </div>
              <div className="meta-row" style={{ marginTop: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                <ShieldCheck size={14} />
                <span>{uiText("Giờ máy chủ: ")}{formatDateVN(eligibility.serverTime)}</span>
              </div>
            </div>

            {/* Submission Requirements Policy */}
            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--ink-soft)' }}>
              <strong>{uiText("Quy định tệp nộp bài:")}</strong>
              <ul style={{ margin: 'var(--space-1) 0 0 var(--space-4)', padding: 0 }}>
                <li>{uiText("Dung lượng tối đa: ")}{Math.round(assignment.filePolicy.maxFileSizeBytes / (1024 * 1024))} {uiText(" MB/tệp")}</li>
                <li>{uiText("Số tệp tối đa: ")}{assignment.filePolicy.maxFilesPerSubmission} {uiText(" tệp")}</li>
                <li>{uiText("Định dạng: ")}{assignment.filePolicy.allowedMimeTypes.map(m => m.split('/')[1] || m).join(', ')}</li>
              </ul>
            </div>

            {latest && (
              <p role="status">
                {uiText("Đã nộp ")}<strong>{latest.filename}</strong>
                {' · '}{uiText("Lần ")}{latest.revisionNumber}
                {' · '}{new Date(latest.submittedAt).toLocaleString(currentLocale())}
                {' · '}{latest.isLate ? uiText("Nộp muộn") : uiText("Đúng hạn")}
              </p>
            )}

            <SubmissionHistory 
            key={latest?.id ?? 'empty'}
            courseId={assignment.courseId}
            assignmentId={assignment.id}
            />

            {/* Submission Action */}
            <div className="submit-action-zone" style={{ marginTop: 'var(--space-2)' }}>
              {eligibility.isGroupAssignment ? (
                <Link to={`/sv/hoc-tap?course=${assignment.courseId}&tab=groups`}>
                  {uiText("Bài tập nhóm: quản lý nhóm, nộp bài và xem điểm / Group workspace")}</Link>
              ) : isClosed ? (
                <div className="submission-locked-notice" role="status" data-testid="submission-locked">
                  <AlertTriangle size={18} />
                  <span>{eligibility.message || uiText("Bài tập đã đóng nhận bài nộp.")}</span>
                </div>
              ) : (
              <SubmissionForm
                  key={assignment.id}
                  assignment={assignment}
                  onSubmitted={() => void fetchAssignmentData()}
                />
              )}
            </div>
          </div>
        </aside>
      </div>
      {preview && (
        <Modal isOpen onClose={() => setPreview(null)} title={uiText("Xem trước: {0}",[preview.name])} size="lg">
          {preview.name.toLowerCase().endsWith('.pdf') ? (
            <PdfPreview url={preview.url} />
          ) : /\.(png|jpe?g|gif|webp)$/i.test(preview.name) ? (
            <img src={preview.url} alt={preview.name} style={{ maxWidth: '100%' }} />
          ) : <p>{uiText("Định dạng này chưa hỗ trợ xem trực tuyến. Vui lòng tải tệp để xem.")}</p>}
        </Modal>
      )}
    </div>
  );
};
