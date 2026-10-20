import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { Plus, Users, Clock, ArrowRight } from 'lucide-react';
import './TeacherCoursesPage.css';

export const TeacherCoursesPage: React.FC = () => {
  const { courses, memberships, assignments, submissions } = useDatabase();
  const { currentUser } = useSession();
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const navigate = useNavigate();

  const myCourses = useMemo(() => {
    return courses.filter(c => c.teacherId === currentUser?.id);
  }, [courses, currentUser]);

  const activeCourses = useMemo(() => {
    return myCourses.filter(c => c.status === 'open');
  }, [myCourses]);

  const archivedCourses = useMemo(() => {
    return myCourses.filter(c => c.status === 'archived');
  }, [myCourses]);

  const displayedCourses = activeTab === 'active' ? activeCourses : archivedCourses;

  return (
    <div className="teacher-courses-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Bàn làm việc', path: '/gv' },
              { label: 'Môn học của tôi' }
            ]}
          />
          <h1 className="page-main-heading">Môn học phụ trách</h1>
          <p className="page-subtitle">Quản lý nội dung học phần, bài tập và theo dõi sinh viên.</p>
        </div>
        <Link to="/gv/mon-hoc/tao" className="npc-btn npc-btn-primary">
          <Plus size={18} />
          <span>Tạo môn học mới</span>
        </Link>
      </div>

      <div className="courses-tab-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'active'}
          className={`tab-item-btn ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          <span>Đang giảng dạy</span>
          <span className="tab-count-chip">{activeCourses.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'archived'}
          className={`tab-item-btn ${activeTab === 'archived' ? 'active' : ''}`}
          onClick={() => setActiveTab('archived')}
        >
          <span>Đã lưu trữ</span>
          <span className="tab-count-chip">{archivedCourses.length}</span>
        </button>
      </div>

      {displayedCourses.length === 0 ? (
        activeTab === 'active' ? (
          <EmptyState
            title="Chưa có môn học nào đang mở"
            description="Bạn chưa khởi tạo hoặc đang không phụ trách môn học nào trong học kỳ này."
            action={
              <Button variant="primary" onClick={() => navigate('/gv/mon-hoc/tao')}>
                Tạo môn học đầu tiên
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="Chưa có môn học nào được lưu trữ"
            description="Các môn học sau khi kết thúc kỳ đào tạo và lưu trữ sẽ xuất hiện tại đây ở trạng thái chỉ đọc."
          />
        )
      ) : (
        <div className="courses-cards-grid">
          {displayedCourses.map(course => {
            const studentCount = memberships.filter(
              m => m.courseId === course.id && m.status === 'active'
            ).length;

            const courseAssIds = new Set(
              assignments.filter(a => a.courseId === course.id).map(a => a.id)
            );
            const pendingGradingCount = submissions.filter(
              s => courseAssIds.has(s.assignmentId) && (s.gradingStatus === 'ungraded' || s.gradingStatus === 'in_progress')
            ).length;

            return (
              <div key={course.id} className="teacher-course-card">
                <div className="course-card-top">
                  <span className="course-code-pill">{course.code}</span>
                  <Badge
                    variant={course.status === 'open' ? 'published' : 'archived'}
                    label={course.status === 'open' ? 'Đang mở' : 'Đã lưu trữ'}
                  />
                </div>

                <h2 className="course-card-name">
                  <Link to={`/gv/mon-hoc/${course.id}`} className="course-title-link">
                    {course.name}
                  </Link>
                </h2>
                <p className="course-card-term">Học kỳ: {course.term}</p>
                <p className="course-card-desc">{course.description || 'Chưa có mô tả môn học.'}</p>

                <div className="course-card-metrics">
                  <div className="metric-item">
                    <Users size={16} />
                    <span>{studentCount} sinh viên</span>
                  </div>
                  <div className="metric-item">
                    <Clock size={16} />
                    <span>{pendingGradingCount} bài chờ chấm</span>
                  </div>
                </div>

                <div className="course-card-actions">
                  <Link to={`/gv/mon-hoc/${course.id}`} className="npc-btn npc-btn-secondary npc-btn-sm w-full">
                    <span>Vào quản lý môn</span>
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
