import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { TextField, TextAreaField, SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import {
  Send,
  Mail,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Info
} from 'lucide-react';
import './TeacherAnnouncementsPage.css';

export const TeacherAnnouncementsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const {
    announcements,
    courses,
    memberships,
    emailJobs,
    createAnnouncement,
    retryFailedEmailJobs,
    systemSettings
  } = useDatabase();
  const { currentUser } = useSession();
  const { showNotification } = useNotifications();

  const preselectedCourseId = searchParams.get('mon');

  // Teacher's courses
  const myCourses = useMemo(() => {
    return courses.filter(c => c.teacherId === currentUser?.id);
  }, [courses, currentUser]);

  // Form states
  const [selectedCourseId, setSelectedCourseId] = useState(
    preselectedCourseId || (myCourses.length > 0 ? myCourses[0].id : '')
  );
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [sendEmail, setSendEmail] = useState(true);

  // Confirm publish modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Error retry modal
  const [retryTargetAnnId, setRetryTargetAnnId] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  // Active students in selected course
  const targetMembers = useMemo(() => {
    return memberships.filter(
      m => m.courseId === selectedCourseId && m.status === 'active'
    );
  }, [memberships, selectedCourseId]);

  const selectedCourse = courses.find(c => c.id === selectedCourseId);
  const isSelectedCourseArchived = selectedCourse?.status === 'archived';

  // Announcements posted by this teacher
  const myAnnouncements = useMemo(() => {
    const courseIdSet = new Set(myCourses.map(c => c.id));
    return announcements
      .filter(a => courseIdSet.has(a.courseId))
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }, [announcements, myCourses]);

  // Handle post announcement
  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSelectedCourseArchived) {
      showNotification('error', 'Không thể đăng thông báo vào môn học đã lưu trữ.');
      return;
    }
    if (!title.trim()) {
      showNotification('error', 'Vui lòng nhập tiêu đề thông báo.');
      return;
    }
    if (!content.trim()) {
      showNotification('error', 'Vui lòng nhập nội dung thông báo.');
      return;
    }
    if (!selectedCourseId) {
      showNotification('error', 'Vui lòng chọn môn học cần thông báo.');
      return;
    }

    setShowConfirmModal(true);
  };

  const handleConfirmPublish = () => {
    if (!currentUser) return;
    setIsSubmitting(true);

    const newAnnId = `ann-${Date.now()}`;
    const res = createAnnouncement({
      id: newAnnId,
      courseId: selectedCourseId,
      title: title.trim(),
      body: content.trim(),
      authorId: currentUser.id,
      publishedAt: new Date().toISOString(),
      readByUserIds: [currentUser.id]
    });

    setIsSubmitting(false);
    setShowConfirmModal(false);

    if (res.ok) {
      setTitle('');
      setContent('');
      showNotification('success', `Đã đăng thông báo tới ${targetMembers.length} sinh viên thành công.`);
    } else {
      showNotification('error', res.error?.message || 'Lỗi đăng thông báo');
    }
  };

  // Failed email jobs for retry modal
  const failedJobsForTarget = useMemo(() => {
    if (!retryTargetAnnId) return [];
    return emailJobs.filter(j => j.entityId === retryTargetAnnId && (j.status === 'partial_error' || (j.status as any) === 'failed'));
  }, [emailJobs, retryTargetAnnId]);

  const handleRetryFailedOnly = () => {
    if (!retryTargetAnnId) return;
    setIsRetrying(true);

    const res = retryFailedEmailJobs();
    setIsRetrying(false);

    if (res.ok) {
      showNotification('success', `Đã gửi lại thành công các email thông báo bị lỗi.`);
      setRetryTargetAnnId(null);
    } else {
      showNotification('error', res.error?.message || 'Lỗi gửi lại email');
    }
  };

  return (
    <div className="teacher-announcements-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/gv' },
            { label: 'Quản lý thông báo' }
          ]}
        />
        <h1 className="page-heading">Thông báo môn học & Bản tin lớp</h1>
        <p className="page-subheading">
          Gửi thông báo nhanh đến sinh viên trong lớp học phần kèm mô phỏng gửi email an toàn.
        </p>
      </div>

      <div className="teacher-ann-layout">
        {/* COMPOSER CARD (LEFT/TOP) */}
        <section className="composer-card">
          <h2 className="card-title">Soạn thông báo mới</h2>

          {isSelectedCourseArchived && (
            <div className="archived-notice" role="alert">
              <AlertTriangle size={18} />
              <span>Môn học này đã lưu trữ. Không thể gửi thông báo mới.</span>
            </div>
          )}

          <form onSubmit={handleOpenConfirm} className="composer-form">
            <SelectField
              label="Chọn lớp học phần tiếp nhận"
              required
              value={selectedCourseId}
              onChange={e => setSelectedCourseId(e.target.value)}
              options={myCourses.map(c => ({
                value: c.id,
                label: `${c.code} — ${c.name} (${c.status === 'open' ? 'Đang mở' : 'Đã lưu trữ'})`
              }))}
              disabled={myCourses.length === 0}
            />

            <TextField
              label="Tiêu đề thông báo"
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ví dụ: Nhắc nhở nộp bài tập lớn và dời lịch phụ đạo"
              disabled={isSelectedCourseArchived}
            />

            <TextAreaField
              label="Nội dung chi tiết"
              required
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Nhập nội dung thông báo đầy đủ gửi đến sinh viên..."
              rows={5}
              disabled={isSelectedCourseArchived}
            />

            <div className="email-sim-option-box">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={sendEmail}
                  onChange={e => setSendEmail(e.target.checked)}
                  disabled={!systemSettings.emailEnabled || isSelectedCourseArchived}
                />
                <span className="checkbox-text">Mô phỏng gửi email thông báo đến toàn bộ sinh viên</span>
              </label>

              {!systemSettings.emailEnabled && (
                <div className="email-disabled-note">
                  <Info size={14} />
                  <span>Hệ thống gửi email đang tạm tắt trong cấu hình toàn trường (an toàn demo).</span>
                </div>
              )}
            </div>

            <div className="form-submit-row">
              <Button
                type="submit"
                variant="primary"
                disabled={isSelectedCourseArchived || myCourses.length === 0}
              >
                <Send size={16} />
                <span>Đăng thông báo ({targetMembers.length} sinh viên)</span>
              </Button>
            </div>
          </form>
        </section>

        {/* ANNOUNCEMENT HISTORY (RIGHT/BOTTOM) */}
        <section className="history-card">
          <h2 className="card-title">Lịch sử thông báo đã gửi ({myAnnouncements.length})</h2>

          {myAnnouncements.length === 0 ? (
            <EmptyState
              title="Chưa có thông báo nào"
              description="Các thông báo bạn đăng tải cho các lớp học phần sẽ xuất hiện tại đây."
            />
          ) : (
            <div className="ann-history-stack">
              {myAnnouncements.map(ann => {
                const c = courses.find(crs => crs.id === ann.courseId);
                const annJobs = emailJobs.filter(j => j.entityId === ann.id);
                const failedJobs = annJobs.filter(j => j.status === 'partial_error' || (j.status as any) === 'failed');

                return (
                  <article key={ann.id} className="history-item-card">
                    <div className="hist-top-line">
                      <div className="hist-title-group">
                        <span className="hist-course-code">{c?.code}</span>
                        <h3 className="hist-title">{ann.title}</h3>
                      </div>
                      <span className="hist-date">{formatDateVN(ann.publishedAt)}</span>
                    </div>

                    <p className="hist-content-snippet">{ann.body}</p>

                    <footer className="hist-footer-row">
                      <div className="delivery-status-wrap">
                        <Mail size={15} />
                        {annJobs.length === 0 ? (
                          <span className="text-muted">Chỉ đăng trong bảng tin</span>
                        ) : failedJobs.length > 0 ? (
                          <span className="failed-jobs-warning">
                            <AlertTriangle size={14} /> Có {failedJobs.length} đợt gửi lỗi email
                          </span>
                        ) : (
                          <span className="success-jobs-text">
                            <CheckCircle2 size={14} /> {annJobs.length} email mô phỏng thành công
                          </span>
                        )}
                      </div>

                      {failedJobs.length > 0 && (
                        <button
                          type="button"
                          className="npc-btn npc-btn-secondary npc-btn-sm"
                          onClick={() => setRetryTargetAnnId(ann.id)}
                        >
                          <RotateCcw size={14} />
                          <span>Chi tiết lỗi & Gửi lại</span>
                        </button>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <Modal
          title="Xác nhận đăng thông báo"
          isOpen={showConfirmModal}
          onClose={() => setShowConfirmModal(false)}
        >
          <div className="modal-content-stack">
            <p>
              Bạn chuẩn bị gửi thông báo <strong>"{title}"</strong> đến <strong>{targetMembers.length} sinh viên</strong> thuộc học phần <strong>{selectedCourse?.name}</strong>.
            </p>
            <div className="alert-notice-box">
              <Info size={18} />
              <span>
                Trạng thái email: {sendEmail && systemSettings.emailEnabled ? 'Mô phỏng gửi email an toàn vào hộp thư sinh viên.' : 'Chỉ đăng trên bảng tin học phần.'}
              </span>
            </div>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowConfirmModal(false)}>
                Hủy bỏ
              </Button>
              <Button
                type="button"
                variant="primary"
                isLoading={isSubmitting}
                onClick={handleConfirmPublish}
              >
                Xác nhận đăng ngay
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Retry Failed Only Modal */}
      {retryTargetAnnId && (
        <Modal
          title="Chi tiết lỗi gửi email & Thử lại"
          isOpen={!!retryTargetAnnId}
          onClose={() => setRetryTargetAnnId(null)}
        >
          <div className="modal-content-stack">
            <p className="retry-intro">
              Danh sách các email nhận thông báo bị lỗi kết nối mô phỏng:
            </p>

            <div className="failed-jobs-list-wrap">
              <table className="npc-table">
                <thead>
                  <tr>
                    <th>Email người nhận</th>
                    <th>Lý do lỗi</th>
                  </tr>
                </thead>
                <tbody>
                  {failedJobsForTarget.flatMap(j =>
                    (j.failedRecipients.length > 0 ? j.failedRecipients : ['sinhvien@demo.neu.edu.vn']).map(email => (
                      <tr key={email}>
                        <td><strong>{email}</strong></td>
                        <td>
                          <span className="error-reason-pill">Kết nối mô phỏng timeout</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setRetryTargetAnnId(null)}>
                Đóng
              </Button>
              <Button
                type="button"
                variant="primary"
                isLoading={isRetrying}
                onClick={handleRetryFailedOnly}
              >
                <RotateCcw size={16} />
                <span>Gửi lại cho các email bị lỗi</span>
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
