import {uiText} from "../../../shared/i18n/translate";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { announcementsService, type AnnouncementFeed } from '../../../api/announcementsService';
import { coursesService, type Course } from '../../../api/coursesService';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { TextField, TextAreaField, SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { Send, Mail, AlertTriangle, RefreshCw } from 'lucide-react';
import './TeacherAnnouncementsPage.css';

export const TeacherAnnouncementsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { showNotification } = useNotifications();
  const preselectedCourseId = searchParams.get('mon');

  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState(preselectedCourseId ?? '');
  const [feed, setFeed] = useState<AnnouncementFeed | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const requestKeyRef = useRef<string | null>(null);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;
  const isSelectedCourseArchived = selectedCourse?.status === 'archived';

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const [courseResult, announcementResult] = await Promise.all([
        coursesService.list({ role: 'teacher', page: 1, page_size: 100 }),
        announcementsService.listForTeacher({ page, page_size: 20 }, signal),
      ]);
      if (signal.aborted) return;
      setCourses(courseResult.items);
      setFeed(announcementResult);
      if (preselectedCourseId && courseResult.items.some((course) => course.id === preselectedCourseId)) {
        setSelectedCourseId(preselectedCourseId);
      } else {
        setSelectedCourseId((current) => (
          current && courseResult.items.some((course) => course.id === current)
            ? current
            : courseResult.items[0]?.id ?? ''
        ));
      }
    } catch (caughtError) {
      if (signal.aborted) return;
      setError(caughtError instanceof Error ? caughtError.message : uiText("Không tải được dữ liệu thông báo."));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [page, preselectedCourseId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reload]);

  const handleOpenConfirm = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedCourseId) {
      showNotification('error', uiText("Vui lòng chọn lớp học phần cần thông báo."));
      return;
    }
    if (isSelectedCourseArchived) {
      showNotification('error', uiText("Không thể đăng thông báo vào môn học đã lưu trữ."));
      return;
    }
    if (!title.trim() || !content.trim()) {
      showNotification('error', uiText("Vui lòng nhập đầy đủ tiêu đề và nội dung thông báo."));
      return;
    }
    requestKeyRef.current = crypto.randomUUID();
    setShowConfirmModal(true);
  };

  const handleConfirmPublish = async () => {
    if (!selectedCourseId || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await announcementsService.publish({
        request_key: requestKeyRef.current ?? crypto.randomUUID(),
        course_id: selectedCourseId,
        title: title.trim(),
        body: content.trim(),
      });
      setTitle('');
      setContent('');
      setShowConfirmModal(false);
      requestKeyRef.current = null;
      setPage(1);
      setReload((value) => value + 1);
      showNotification('success', uiText("Đã đăng thông báo tới {0} sinh viên trên bảng tin môn học.",[selectedCourse?.active_member_count ?? 0]));
    } catch (caughtError) {
      showNotification('error', caughtError instanceof Error ? caughtError.message : uiText("Không đăng được thông báo."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const notices = feed?.items ?? [];
  const historyCourses = new Map(courses.map((course) => [course.id, course]));

  return (
    <div className="teacher-announcements-page">
      <div className="page-header">
        <Breadcrumb items={[{ label: uiText("Bàn làm việc"), path: '/gv' }, { label: uiText("Quản lý thông báo") }]} />
        <h1 className="page-heading">{uiText("Thông báo môn học & Bản tin lớp")}</h1>
        <p className="page-subheading">{uiText("Đăng thông báo trực tiếp lên bảng tin của lớp học phần. Email chưa được gửi từ chức năng này.")}</p>
      </div>

      <div className="teacher-ann-layout">
        <section className="composer-card">
          <h2 className="card-title">{uiText("Soạn thông báo mới")}</h2>
          {isSelectedCourseArchived && <div className="archived-notice" role="alert"><AlertTriangle size={18} /><span>{uiText("Môn học này đã lưu trữ. Không thể đăng thông báo mới.")}</span></div>}

          <form onSubmit={handleOpenConfirm} className="composer-form">
            <SelectField
              label={uiText("Chọn lớp học phần tiếp nhận")}
              required
              value={selectedCourseId}
              onChange={(event) => setSelectedCourseId(event.target.value)}
              options={courses.map((course) => ({ value: course.id, label: `${course.code} — ${course.name} (${course.status === 'open' ? uiText("Đang mở") : uiText("Đã lưu trữ")})` }))}
              disabled={courses.length === 0}
            />
            <TextField label={uiText("Tiêu đề thông báo")} required value={title} onChange={(event) => setTitle(event.target.value)} placeholder={uiText("Ví dụ: Nhắc nhở nộp bài tập lớn và dời lịch phụ đạo")} disabled={isSelectedCourseArchived} />
            <TextAreaField label={uiText("Nội dung chi tiết")} required value={content} onChange={(event) => setContent(event.target.value)} placeholder={uiText("Nhập nội dung thông báo đầy đủ gửi đến sinh viên…")} rows={5} disabled={isSelectedCourseArchived} />
            <div className="email-sim-option-box">
              <div className="email-disabled-note">
                <Mail size={14} />
                <span>{uiText("Thông báo sẽ xuất hiện trong hộp thư nội bộ của sinh viên. Chức năng gửi email chưa được kích hoạt cho thông báo môn học.")}</span>
              </div>
            </div>
            <div className="form-submit-row">
              <Button type="submit" variant="primary" disabled={isSelectedCourseArchived || courses.length === 0 || loading}>
                <Send size={16} />
                <span>{uiText("Đăng thông báo (")}{selectedCourse?.active_member_count ?? 0} {uiText(" sinh viên)")}</span>
              </Button>
            </div>
          </form>
        </section>

        <section className="history-card">
          <div className="history-header-row">
            <h2 className="card-title">{uiText("Lịch sử thông báo đã gửi (")}{feed?.pagination.total_items ?? 0})</h2>
            <Button type="button" variant="secondary" onClick={() => setReload((value) => value + 1)} disabled={loading}><RefreshCw size={15} /> {uiText(" Làm mới")}</Button>
          </div>
          {error && <p role="alert">{error}</p>}
          {loading && <p role="status">{uiText("Đang tải lịch sử thông báo…")}</p>}
          {!loading && !error && notices.length === 0 ? (
            <EmptyState title={uiText("Chưa có thông báo nào")} description={uiText("Các thông báo bạn đăng cho lớp học phần sẽ xuất hiện tại đây.")} />
          ) : (
            <div className="ann-history-stack">
              {notices.map((notice) => {
                const course = historyCourses.get(notice.course_id);
                return (
                  <article key={notice.id} className="history-item-card">
                    <div className="hist-top-line">
                      <div className="hist-title-group">
                        <span className="hist-course-code">{course?.code ?? notice.course_name}</span>
                        <h3 className="hist-title">{notice.title}</h3>
                      </div>
                      <span className="hist-date">{formatDateVN(notice.published_at)}</span>
                    </div>
                    <p className="hist-content-snippet">{notice.body}</p>
                    <footer className="hist-footer-row">
                      <div className="delivery-status-wrap"><Mail size={15} /><span className="text-muted">{uiText("Đã đăng trong bảng tin · ")}{notice.recipients} {uiText(" người nhận")}</span></div>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
          {feed && feed.pagination.total_pages > 1 && (
            <nav className="ann-pagination" aria-label={uiText("Phân trang lịch sử thông báo")}>
              <button type="button" disabled={!feed.pagination.has_previous || loading} onClick={() => setPage((value) => value - 1)}>{uiText("Trước")}</button>
              <span>Trang {feed.pagination.page}/{feed.pagination.total_pages}</span>
              <button type="button" disabled={!feed.pagination.has_next || loading} onClick={() => setPage((value) => value + 1)}>Sau</button>
            </nav>
          )}
        </section>
      </div>

      {showConfirmModal && (
        <Modal title={uiText("Xác nhận đăng thông báo")} isOpen={showConfirmModal} onClose={() => { setShowConfirmModal(false); requestKeyRef.current = null; }}>
          <div className="modal-content-stack">
            <p>{uiText("Bạn chuẩn bị đăng thông báo ")}<strong>“{title}”</strong> {uiText(" tới ")}<strong>{selectedCourse?.active_member_count ?? 0} {uiText(" sinh viên")}</strong> {uiText(" thuộc học phần ")}<strong>{selectedCourse?.name}</strong>.</p>
            <div className="alert-notice-box"><Mail size={18} /><span>{uiText("Thông báo được lưu trên máy chủ và hiển thị trong hộp thư nội bộ. Không có email bên ngoài nào được gửi.")}</span></div>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => { setShowConfirmModal(false); requestKeyRef.current = null; }}>{uiText("Hủy bỏ")}</Button>
              <Button type="button" variant="primary" isLoading={isSubmitting} onClick={() => void handleConfirmPublish()}>{uiText("Xác nhận đăng ngay")}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
