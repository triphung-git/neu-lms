import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Button } from '../../../shared/ui/Button';
import { SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import { CheckCheck, ChevronDown, ChevronUp } from 'lucide-react';
import './StudentAnnouncementsPage.css';

export const StudentAnnouncementsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { announcements, courses, memberships, users, markAnnouncementAsRead, markAllAnnouncementsAsRead } = useDatabase();
  const { currentUser } = useSession();

  const selectedCourseId = searchParams.get('mon') || 'all';
  const targetAnnouncementId = searchParams.get('thongBao');
  const [activeTab, setActiveTab] = useState<'unread' | 'all'>('all');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  // Enrolled courses
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

  // Target announcements
  const availableAnnouncements = useMemo(() => {
    return announcements
      .filter(a => myCourseIds.has(a.courseId))
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }, [announcements, myCourseIds]);

  // Filtered by course
  const courseFiltered = useMemo(() => {
    if (selectedCourseId === 'all') return availableAnnouncements;
    return availableAnnouncements.filter(a => a.courseId === selectedCourseId);
  }, [availableAnnouncements, selectedCourseId]);

  // Read status calculation
  const isRead = (ann: typeof announcements[0]) => {
    return ann.readByUserIds.includes(currentUser?.id || '');
  };

  const unreadList = useMemo(() => {
    return courseFiltered.filter(a => !isRead(a));
  }, [courseFiltered, currentUser]);

  const displayedList = activeTab === 'unread' ? unreadList : courseFiltered;

  // Auto expand and mark read if param `thongBao` is present
  useEffect(() => {
    if (targetAnnouncementId && currentUser) {
      setExpandedIds(prev => ({ ...prev, [targetAnnouncementId]: true }));
      markAnnouncementAsRead(targetAnnouncementId);
    }
  }, [targetAnnouncementId, currentUser]);

  const handleToggleExpand = (annId: string) => {
    const isCurrentlyOpen = !!expandedIds[annId];
    setExpandedIds(prev => ({ ...prev, [annId]: !isCurrentlyOpen }));

    if (!isCurrentlyOpen && currentUser) {
      markAnnouncementAsRead(annId);
    }
  };

  const handleMarkAllRead = () => {
    if (!currentUser) return;
    markAllAnnouncementsAsRead();
  };

  const handleSelectCourse = (courseId: string) => {
    const next = new URLSearchParams(searchParams);
    if (courseId === 'all') next.delete('mon');
    else next.set('mon', courseId);
    setSearchParams(next);
  };

  return (
    <div className="student-announcements-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Trang chủ', path: '/sv' },
              { label: 'Thông báo môn học' }
            ]}
          />
          <h1 className="page-main-heading">Thông báo từ giảng viên</h1>
          <p className="page-subtitle">
            Cập nhật các thông tin quan trọng về bài tập, lịch học và nội dung học phần.
          </p>
        </div>

        {unreadList.length > 0 && (
          <Button type="button" variant="secondary" onClick={handleMarkAllRead}>
            <CheckCheck size={16} />
            <span>Đánh dấu tất cả đã đọc</span>
          </Button>
        )}
      </div>

      {/* Course Filter and Tab bar */}
      <div className="ann-controls-card">
        <div className="course-picker-col">
          <SelectField
            label="Lọc theo môn học"
            value={selectedCourseId}
            onChange={e => handleSelectCourse(e.target.value)}
            options={[
              { value: 'all', label: 'Tất cả các môn đang học' },
              ...enrolledCourses.map(c => ({ value: c.id, label: `${c.code} — ${c.name}` }))
            ]}
          />
        </div>

        <div className="ann-tab-toggle" role="tablist">
          <button
            type="button"
            className={`ann-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            <span>Tất cả thông báo</span>
            <span className="count-chip">{courseFiltered.length}</span>
          </button>
          <button
            type="button"
            className={`ann-tab-btn ${activeTab === 'unread' ? 'active' : ''}`}
            onClick={() => setActiveTab('unread')}
          >
            <span>Chưa đọc</span>
            <span className="count-chip unread">{unreadList.length}</span>
          </button>
        </div>
      </div>

      {/* Announcements List */}
      {displayedList.length === 0 ? (
        <EmptyState
          title={activeTab === 'unread' ? "Không có thông báo chưa đọc" : "Chưa có thông báo nào"}
          description={
            activeTab === 'unread'
              ? "Bạn đã đọc toàn bộ thông báo của các môn học."
              : "Giảng viên chưa gửi thông báo nào trong môn học đã chọn."
          }
        />
      ) : (
        <div className="announcements-stack-list">
          {displayedList.map(ann => {
            const c = courses.find(crs => crs.id === ann.courseId);
            const read = isRead(ann);
            const isExpanded = !!expandedIds[ann.id];
            const author = users.find(u => u.id === ann.authorId);

            return (
              <article
                key={ann.id}
                className={`announcement-card ${read ? 'read' : 'unread'}`}
              >
                <header
                  className="ann-header-clickable"
                  onClick={() => handleToggleExpand(ann.id)}
                  tabIndex={0}
                  role="button"
                  aria-expanded={isExpanded}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleToggleExpand(ann.id);
                    }
                  }}
                >
                  <div className="ann-header-left">
                    {!read && <span className="unread-dot" title="Chưa đọc" />}
                    <span className="course-code-badge">{c?.code}</span>
                    <h2 className="ann-title-text">{ann.title}</h2>
                  </div>

                  <div className="ann-header-right">
                    <span className="ann-date-text">{formatDateVN(ann.publishedAt)}</span>
                    <button type="button" className="expand-icon-btn" aria-label="Mở rộng chi tiết">
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </header>

                {isExpanded && (
                  <div className="ann-body-content">
                    <div className="ann-content-text">
                      {ann.body.split('\n').map((line, idx) => (
                        <p key={idx}>{line}</p>
                      ))}
                    </div>

                    <footer className="ann-footer-row">
                      <span className="author-name">Người gửi: <strong>{author?.fullName || 'Giảng viên'}</strong></span>
                      <span className="course-full-name">{c?.name}</span>
                    </footer>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
