import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { getAssignmentService } from '../../../app/composition/assignmentWiring';
import type { StudentAssignmentView } from '../contracts/assignmentsDto';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { Modal } from '../../../shared/ui/Modal';
import { PdfPreview } from '../../files/components/PdfPreview';
import { formatDateVN, formatScoreVN } from '../../../shared/kernel/formatting';
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
  CheckCircle,
} from 'lucide-react';
import './StudentAssignmentDetailPage.css';

export const StudentAssignmentDetailPage: React.FC = () => {
  const { monId, baiTapId } = useParams<{ monId?: string; baiTapId: string }>();
  const navigate = useNavigate();
  const { showNotification } = useNotifications();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [viewData, setViewData] = useState<StudentAssignmentView | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
          message: res.error.message || 'Không thể tải thông tin bài tập.',
        });
      } else {
        setViewData(res.data);
      }
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const apiErr = err as { message?: string };
      setError({
        code: 'NETWORK_ERROR',
        message: apiErr.message || 'Không thể kết nối đến máy chủ. Vui lòng thử lại.',
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
    showNotification('success', `Đang tải xuống tệp: ${filename}`);
  };

  // Handle preview attachment via authenticated endpoint
  const handlePreviewAttachment = (attachmentId: string, name: string) => {
    if (!viewData) return;
    const courseId = viewData.assignment.courseId;
    const assignmentId = viewData.assignment.id;
    const url = `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}/attachments/${encodeURIComponent(attachmentId)}/preview`;
    setPreview({ url, name });
  };

  // Submit attempt handler - strictly blocks fake mutations and notifies honestly of B11 intake
  const handleSubmitClick = async () => {
    if (!viewData) return;
    if (!viewData.eligibility.canSubmit) {
      showNotification('error', viewData.eligibility.message || 'Bài tập đã đóng nhận bài.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await getAssignmentService().submitAssignment({
        assignmentId: viewData.assignment.id,
        studentId: '', // Actor resolved strictly by session on server
        file: { filename: 'submission_payload', size: 0 },
      });

      if (!res.ok) {
        // Honest notification: B11 pipeline pending
        showNotification(
          'info',
          res.error.message || 'Quy trình nộp bài chính thức sẽ được kích hoạt tại Milestone B11.'
        );
      }
    } catch {
      showNotification('error', 'Lỗi kết nối máy chủ khi xử lý yêu cầu.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading skeleton state
  if (loading) {
    return (
      <div className="student-assignment-detail-page">
        <div className="student-ass-container">
          <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
            <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
              Đang xác thực quyền và tải dữ liệu bài tập từ máy chủ...
            </p>
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
            title={isForbidden ? 'Không có quyền truy cập' : 'Không tìm thấy bài tập'}
            description={
              error?.message ||
              'Bài tập không tồn tại, bạn chưa ghi danh môn học hoặc bài tập chưa được giảng viên công bố.'
            }
            action={
              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center' }}>
                <Button
                  variant="secondary"
                  onClick={() => fetchAssignmentData()}
                  icon={<RefreshCw size={16} />}
                >
                  Thử lại
                </Button>
                <Button variant="primary" onClick={() => navigate('/sv/mon-hoc')}>
                  Về danh sách môn học
                </Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  const { assignment, eligibility } = viewData;
  const isClosed = eligibility.isClosed || !eligibility.canSubmit;
  const isLate = eligibility.isLate;

  const breadcrumbs = [
    { label: 'Trang chủ', path: '/sv' },
    { label: 'Môn học', path: '/sv/mon-hoc' },
    {
      label: assignment.courseTitle || 'Môn học',
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
              <Badge variant="archived" label={eligibility.message || 'Đã đóng nộp'} />
            ) : isLate ? (
              <Badge variant="warning" label="Quá hạn (Cho nộp muộn)" />
            ) : (
              <Badge variant="published" label="Đang nhận bài" />
            )}
          </div>
        </div>
      </div>

      {/* Notice alert when closed or late */}
      {isClosed && (
        <div className="archived-warning-alert" role="alert" data-testid="closed-alert">
          <AlertTriangle size={20} />
          <div>
            <strong>Cổng nộp bài đã đóng</strong>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)' }}>
              {eligibility.message || 'Bài tập đã hết hạn nộp hoặc được giảng viên đóng tiếp nhận.'}
            </p>
          </div>
        </div>
      )}

      {!isClosed && isLate && (
        <div className="late-warning-chip" role="alert" style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: '#fffbeb', border: '1px solid #fef3c7', color: '#92400e', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <AlertTriangle size={16} />
          <span>Thời hạn nộp ban đầu đã qua. Bài làm gửi trong thời gian này sẽ được ghi nhận là <strong>Nộp muộn</strong> theo chính sách của môn học.</span>
        </div>
      )}

      {/* Main Grid: 60% Left Content / 40% Right Submission Panel */}
      <div className="assignment-detail-grid">
        {/* Left Column: Instructions, Attachments, Rubric, Grades Notice */}
        <section className="assignment-instructions-panel">
          {/* Card: Đề bài & Hướng dẫn */}
          <div className="card-box">
            <h2 className="box-title">Đề bài & Hướng dẫn thực hiện</h2>
            <div className="assignment-desc-content" data-testid="assignment-instructions">
              {assignment.instructions ? (
                assignment.instructions.split('\n').map((par, pIdx) => (
                  <p key={pIdx} style={{ margin: '0 0 var(--space-2) 0' }}>{par}</p>
                ))
              ) : (
                <p style={{ color: 'var(--muted)', fontStyle: 'italic' }}>Không có hướng dẫn văn bản bổ sung.</p>
              )}
            </div>

            {/* Attachments List */}
            {assignment.attachments && assignment.attachments.length > 0 ? (
              <div style={{ marginTop: 'var(--space-4)', borderTop: '1px solid var(--border-soft)', paddingTop: 'var(--space-4)' }}>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', marginBottom: 'var(--space-3)' }}>
                  Tài liệu đề bài đính kèm ({assignment.attachments.length})
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
                          Tải về
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Eye size={14} />}
                          onClick={() => handlePreviewAttachment(att.id, att.filename)}
                          disabled={!att.previewUrl}
                        >
                          Xem trước
                        </Button>
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
                <h2 className="box-title">Tiêu chí chấm điểm (Rubric)</h2>
                <span className="rubric-subtext">
                  Tổng điểm tối đa của bài tập: <strong>{formatScoreVN(assignment.totalScore)} điểm</strong>
                </span>
              </div>
            </div>

            {assignment.rubricCriteria && assignment.rubricCriteria.length > 0 ? (
              <div className="rubric-table-wrap">
                <table className="npc-table">
                  <thead>
                    <tr>
                      <th style={{ width: '35%' }}>Tiêu chí đánh giá</th>
                      <th>Mô tả chi tiết</th>
                      <th className="text-right" style={{ width: '120px' }}>Điểm tối đa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignment.rubricCriteria.map((item, idx) => (
                      <tr key={item.id || idx}>
                        <td><strong>{item.title}</strong></td>
                        <td>{item.description || 'Theo yêu cầu của đề bài'}</td>
                        <td className="text-right">
                          <strong className="score-pts">{formatScoreVN(item.maxScore)} đ</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
                Giảng viên không thiết lập bảng tiêu chí chấm điểm chi tiết cho bài tập này.
              </p>
            )}
          </div>

          {/* Card: Phân hệ B12 Thông báo kết quả chấm */}
          <div className="card-box" style={{ background: '#f8fafc', borderStyle: 'dashed' }}>
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
              <Info size={20} style={{ color: 'var(--ink-soft)', flexShrink: 0 }} />
              <div>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
                  Kết quả đánh giá & Điểm số (Phân hệ B12)
                </h3>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', margin: 'var(--space-1) 0 0 0' }}>
                  Điểm số chính thức, nhận xét chi tiết từng tiêu chí và phản hồi của giảng viên sẽ được hiển thị tại đây sau khi giảng viên hoàn tất chấm bài (kích hoạt tại Milestone B12).
                </p>
              </div>
            </div>
          </div>
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
                  Chính sách nộp muộn: {assignment.allowLate ? (
                    <strong style={{ color: '#d97706' }}>Cho phép nộp muộn</strong>
                  ) : (
                    <strong>Khóa khi hết hạn</strong>
                  )}
                </span>
              </div>
              <div className="meta-row" style={{ marginTop: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                <ShieldCheck size={14} />
                <span>Giờ máy chủ: {formatDateVN(eligibility.serverTime)}</span>
              </div>
            </div>

            {/* Submission Requirements Policy */}
            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--ink-soft)' }}>
              <strong>Quy định tệp nộp bài:</strong>
              <ul style={{ margin: 'var(--space-1) 0 0 var(--space-4)', padding: 0 }}>
                <li>Dung lượng tối đa: {Math.round(assignment.filePolicy.maxFileSizeBytes / (1024 * 1024))} MB/tệp</li>
                <li>Số tệp tối đa: {assignment.filePolicy.maxFilesPerSubmission} tệp</li>
                <li>Định dạng: {assignment.filePolicy.allowedMimeTypes.map(m => m.split('/')[1] || m).join(', ')}</li>
              </ul>
            </div>

            {/* Submission Action */}
            <div className="submit-action-zone" style={{ marginTop: 'var(--space-2)' }}>
              {isClosed ? (
                <div className="submission-locked-notice" role="status" data-testid="submission-locked">
                  <AlertTriangle size={18} />
                  <span>{eligibility.message || 'Bài tập đã đóng nhận bài nộp.'}</span>
                </div>
              ) : (
                <div>
                  <Button
                    type="button"
                    variant="primary"
                    className="w-full"
                    disabled={isSubmitting || !eligibility.canSubmit}
                    onClick={handleSubmitClick}
                    data-testid="submit-assignment-btn"
                  >
                    <CheckCircle size={16} />
                    <span>Nộp bài tập</span>
                  </Button>
                  <p className="submit-note-text" style={{ marginTop: 'var(--space-2)', textAlign: 'center' }}>
                    Phân hệ nộp bài và quét tệp an ninh đa tầng sẽ được mở tại Milestone B11.
                  </p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
      {preview && (
        <Modal isOpen onClose={() => setPreview(null)} title={`Xem trước: ${preview.name}`} size="lg">
          {preview.name.toLowerCase().endsWith('.pdf') ? (
            <PdfPreview url={preview.url} />
          ) : /\.(png|jpe?g|gif|webp)$/i.test(preview.name) ? (
            <img src={preview.url} alt={preview.name} style={{ maxWidth: '100%' }} />
          ) : <p>Định dạng này chưa hỗ trợ xem trực tuyến. Vui lòng tải tệp để xem.</p>}
        </Modal>
      )}
    </div>
  );
};
