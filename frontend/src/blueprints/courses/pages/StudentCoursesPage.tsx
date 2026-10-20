import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { Tabs } from '../../../shared/ui/Tabs';
import { Badge } from '../../../shared/ui/Badge';
import { BookOpen, User, Calendar, FileText } from 'lucide-react';
import './StudentCoursesPage.css';

export const StudentCoursesPage: React.FC = () => {
  const { db } = useDatabase();
  const { currentUser } = useSession();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'open' | 'archived'>('open');

  // Enrolled courses
  const myMemberships = db.memberships.filter(
    (m) => m.userId === currentUser?.id && m.status === 'active'
  );
  const enrolledCourseIds = myMemberships.map((m) => m.courseId);

  const courses = db.courses.filter(
    (c) => enrolledCourseIds.includes(c.id) && c.status === activeTab
  );

  const tabs = [
    {
      id: 'open',
      label: 'Đang học',
      badge: db.courses.filter((c) => enrolledCourseIds.includes(c.id) && c.status === 'open').length,
    },
    {
      id: 'archived',
      label: 'Đã lưu trữ',
      badge: db.courses.filter((c) => enrolledCourseIds.includes(c.id) && c.status === 'archived').length,
    },
  ];

  return (
    <div className="courses-page-container">
      <div className="courses-page-header">
        <div>
          <h1 className="courses-title">Môn học của tôi</h1>
          <p className="courses-subtitle">
            Danh sách các lớp học phần bạn đang tham gia học tập và tra cứu tài liệu.
          </p>
        </div>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={(t) => setActiveTab(t as any)} />

      {courses.length === 0 ? (
        <div className="courses-empty-card" role="alert">
          <BookOpen size={36} className="text-muted" />
          <h3>Không có môn học nào trong mục này</h3>
          <p>
            Nếu bạn chưa thấy môn học của mình, vui lòng liên hệ Giảng viên phụ trách hoặc Phòng Đào tạo để được thêm vào danh sách lớp học phần.
          </p>
        </div>
      ) : (
        <div className="course-cards-grid">
          {courses.map((crs) => {
            const teacher = db.users.find((u) => u.id === crs.teacherId);
            const asgs = db.assignments.filter((a) => a.courseId === crs.id && a.status === 'published');
            const mySubs = db.submissions.filter(
              (s) => s.studentId === currentUser?.id && asgs.some((a) => a.id === s.assignmentId)
            );
            const pendingAsgCount = asgs.length - mySubs.length;

            return (
              <div
                key={crs.id}
                className="student-course-card"
                onClick={() => navigate(`/sv/mon-hoc/${crs.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') navigate(`/sv/mon-hoc/${crs.id}`);
                }}
              >
                <div className="course-card-top">
                  <span className="card-code-badge">{crs.code}</span>
                  <Badge
                    variant={crs.status === 'open' ? 'published' : 'archived'}
                    label={crs.status === 'open' ? 'Đang mở' : 'Đã lưu trữ'}
                  />
                </div>

                <h3 className="course-card-name">{crs.name}</h3>
                <p className="course-card-desc">{crs.description}</p>

                <div className="course-card-meta">
                  <div className="meta-item">
                    <User size={14} />
                    <span>{teacher?.fullName || 'Giảng viên phụ trách'}</span>
                  </div>
                  <div className="meta-item">
                    <Calendar size={14} />
                    <span>{crs.term}</span>
                  </div>
                </div>

                <div className="course-card-footer">
                  <span className="pending-asg-indicator">
                    <FileText size={14} />
                    <span>{pendingAsgCount > 0 ? `${pendingAsgCount} bài tập chưa nộp` : 'Đã nộp đủ bài tập'}</span>
                  </span>
                  <span className="view-arrow">Chi tiết →</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
