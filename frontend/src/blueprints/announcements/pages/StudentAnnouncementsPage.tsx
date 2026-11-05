import {uiText} from "../../../shared/i18n/translate";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { announcementsService, type AnnouncementFeed } from '../../../api/announcementsService';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Button } from '../../../shared/ui/Button';
import { SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { CheckCheck, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import './StudentAnnouncementsPage.css';
import { GradeNotices } from './GradeNotices';

export const StudentAnnouncementsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedCourseId = searchParams.get('mon') || 'all';
  const targetAnnouncementId = searchParams.get('thongBao');
  const [activeTab, setActiveTab] = useState<'unread' | 'all'>('all');
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});
  const [data, setData] = useState<AnnouncementFeed | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const params = {
        ...(selectedCourseId !== 'all' ? { course_id: selectedCourseId } : {}),
        unread: activeTab === 'unread',
        page,
        page_size: 20,
      };
      const [feed, unread] = await Promise.all([
        announcementsService.listForStudent(params, signal),
        announcementsService.getStudentUnreadCount(
          selectedCourseId !== 'all' ? { course_id: selectedCourseId } : {},
          signal,
        ),
      ]);
      if (signal.aborted) return;
      setData(feed);
      setUnreadCount(unread.unread_count);
    } catch (caughtError) {
      if (signal.aborted) return;
      setError(caughtError instanceof Error ? caughtError.message : uiText("Không tải được thông báo môn học."));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [activeTab, page, selectedCourseId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reload]);

  useEffect(() => {
    if (!targetAnnouncementId || !data) return;
    const id = Number(targetAnnouncementId);
    const target = data.items.find((item) => item.id === id);
    if (!target) return;
    setExpandedIds((previous) => ({ ...previous, [id]: true }));
    if (!target.is_read) {
      void announcementsService.markStudentRead(id).then(() => setReload((value) => value + 1)).catch((caughtError) => {
        setError(caughtError instanceof Error ? caughtError.message : uiText("Không đánh dấu được thông báo đã đọc."));
      });
    }
  }, [targetAnnouncementId, data]);

  const handleToggleExpand = async (id: number, isRead: boolean) => {
    const opening = !expandedIds[id];
    setExpandedIds((previous) => ({ ...previous, [id]: opening }));
    if (!opening || isRead || saving) return;
    setSaving(true);
    try {
      await announcementsService.markStudentRead(id);
      setReload((value) => value + 1);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : uiText("Không đánh dấu được thông báo đã đọc."));
    } finally {
      setSaving(false);
    }
  };

  const handleMarkAllRead = async () => {
    if (saving || unreadCount === 0) return;
    setSaving(true);
    setError('');
    try {
      await announcementsService.markAllStudentRead(
        selectedCourseId !== 'all' ? { course_id: selectedCourseId } : {},
      );
      setReload((value) => value + 1);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : uiText("Không đánh dấu được tất cả thông báo."));
    } finally {
      setSaving(false);
    }
  };

  const handleSelectCourse = (courseId: string) => {
    const next = new URLSearchParams(searchParams);
    if (courseId === 'all') next.delete('mon');
    else next.set('mon', courseId);
    setPage(1);
    setSearchParams(next);
  };

  const courses = data?.courses ?? [];
  const items = data?.items ?? [];
  const courseNameById = useMemo(() => new Map(courses.map((course) => [course.id, course.name])), [courses]);

  return (
    <div className="student-announcements-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb items={[{ label: uiText("Trang chủ"), path: '/sv' }, { label: uiText("Thông báo môn học") }]} />
          <h1 className="page-main-heading">{uiText("Thông báo từ giảng viên")}</h1>
          <p className="page-subtitle">{uiText("Cập nhật các thông tin quan trọng về bài tập, lịch học và nội dung học phần.")}</p>
        </div>
        <div className="ann-header-actions">
          {unreadCount > 0 && (
            <Button type="button" variant="secondary" onClick={() => void handleMarkAllRead()} disabled={saving}>
              <CheckCheck size={16} />
              <span>{uiText("Đánh dấu tất cả đã đọc")}</span>
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => setReload((value) => value + 1)} disabled={loading}>
            <RefreshCw size={16} /> {uiText(" Làm mới")}</Button>
        </div>
      </div>

      <GradeNotices />

      <div className="ann-controls-card">
        <div className="course-picker-col">
          <SelectField
            label={uiText("Lọc theo môn học")}
            value={selectedCourseId}
            onChange={(event) => handleSelectCourse(event.target.value)}
            options={[{ value: 'all', label: uiText("Tất cả các môn đang học") }, ...courses.map((course) => ({ value: course.id, label: course.name }))]}
          />
        </div>
        <div className="ann-tab-toggle" role="tablist">
          <button type="button" className={`ann-tab-btn ${activeTab === 'all' ? 'active' : ''}`} onClick={() => { setActiveTab('all'); setPage(1); }}>
            <span>{uiText("Tất cả thông báo")}</span>
            {activeTab === 'all' && <span className="count-chip">{data?.pagination.total_items ?? 0}</span>}
          </button>
          <button type="button" className={`ann-tab-btn ${activeTab === 'unread' ? 'active' : ''}`} onClick={() => { setActiveTab('unread'); setPage(1); }}>
            <span>{uiText("Chưa đọc")}</span>
            <span className="count-chip unread">{unreadCount}</span>
          </button>
        </div>
      </div>

      {error && <p role="alert" className="ann-error-message">{error}</p>}
      {loading && <p role="status">{uiText("Đang tải thông báo…")}</p>}
      {!loading && !error && items.length === 0 && (
        <EmptyState
          title={activeTab === 'unread' ? uiText("Không có thông báo chưa đọc") : uiText("Chưa có thông báo nào")}
          description={activeTab === 'unread' ? uiText("Bạn đã đọc toàn bộ thông báo trong phạm vi đã chọn.") : uiText("Giảng viên chưa gửi thông báo nào trong môn học đã chọn.")}
        />
      )}

      {!loading && items.length > 0 && (
        <div className="announcements-stack-list">
          {items.map((announcement) => {
            const expanded = !!expandedIds[announcement.id];
            return (
              <article key={announcement.id} className={`announcement-card ${announcement.is_read ? 'read' : 'unread'}`}>
                <header
                  className="ann-header-clickable"
                  onClick={() => void handleToggleExpand(announcement.id, announcement.is_read)}
                  tabIndex={0}
                  role="button"
                  aria-expanded={expanded}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void handleToggleExpand(announcement.id, announcement.is_read);
                    }
                  }}
                >
                  <div className="ann-header-left">
                    {!announcement.is_read && <span className="unread-dot" title={uiText("Chưa đọc")} />}
                    <span className="course-code-badge">{courseNameById.get(announcement.course_id) ?? announcement.course_name}</span>
                    <h2 className="ann-title-text">{announcement.title}</h2>
                  </div>
                  <div className="ann-header-right">
                    <span className="ann-date-text">{formatDateVN(announcement.published_at)}</span>
                    <button type="button" className="expand-icon-btn" aria-label={expanded ? uiText("Thu gọn chi tiết") : uiText("Mở rộng chi tiết")}>
                      {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </header>
                {expanded && (
                  <div className="ann-body-content">
                    <div className="ann-content-text">{announcement.body.split('\n').map((line, index) => <p key={index}>{line}</p>)}</div>
                    <footer className="ann-footer-row">
                      <span className="author-name">{uiText("Người gửi: ")}<strong>{announcement.author_name}</strong></span>
                      <span className="course-full-name">{announcement.course_name}</span>
                    </footer>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {data && data.pagination.total_pages > 1 && (
        <nav aria-label={uiText("Phân trang thông báo môn học")} className="ann-pagination">
          <button type="button" disabled={!data.pagination.has_previous || loading} onClick={() => setPage((value) => value - 1)}>{uiText("Trước")}</button>
          <span>Trang {data.pagination.page}/{data.pagination.total_pages}</span>
          <button type="button" disabled={!data.pagination.has_next || loading} onClick={() => setPage((value) => value + 1)}>Sau</button>
        </nav>
      )}
    </div>
  );
};
