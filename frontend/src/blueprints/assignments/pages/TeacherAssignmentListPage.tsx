import React, { useState, useMemo } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import {
  Plus,
  Lock,
  ArrowRight,
  AlertTriangle
} from 'lucide-react';
import './TeacherAssignmentListPage.css';

export const TeacherAssignmentListPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { courses, assignments, submissions, updateAssignment } = useDatabase();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  const activeTab = searchParams.get('tab') || 'all';

  const course = courses.find(c => c.id === monId);
  const isArchived = course?.status === 'archived';

  // Modal to close submission
  const [targetToClose, setTargetToClose] = useState<typeof assignments[0] | null>(null);

  const courseAssignments = useMemo(() => {
    return assignments.filter(a => a.courseId === monId);
  }, [assignments, monId]);

  const filteredAssignments = useMemo(() => {
    return courseAssignments.filter(a => {
      if (activeTab === 'draft' && a.status !== 'draft') return false;
      if (activeTab === 'published' && a.status !== 'published') return false;
      if (activeTab === 'archived' && a.status !== 'archived') return false;
      return true;
    });
  }, [courseAssignments, activeTab]);

  if (!course) {
    return (
      <div className="teacher-ass-container">
        <EmptyState
          title="Không tìm thấy môn học"
          description="Môn học không tồn tại trên hệ thống."
          action={
            <Button variant="secondary" onClick={() => navigate('/gv/mon-hoc')}>
              Về danh sách môn học
            </Button>
          }
        />
      </div>
    );
  }

  const handleSelectTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'all') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next);
  };

  const handleConfirmCloseSubmission = () => {
    if (!targetToClose) return;
    const res = updateAssignment(targetToClose.id, { status: 'archived' });
    if (res.ok) {
      showNotification('success', `Đã đóng nhận bài nộp cho bài tập "${targetToClose.title}".`);
      setTargetToClose(null);
    } else {
      showNotification('error', res.error?.message || 'Lỗi cập nhật bài tập');
    }
  };

  return (
    <div className="teacher-assignment-list-page">
      <div className="page-header-row">
        <div>
          <Breadcrumb
            items={[
              { label: 'Bàn làm việc', path: '/gv' },
              { label: `${course.code} — ${course.name}`, path: `/gv/mon-hoc/${course.id}` },
              { label: 'Quản lý bài tập' }
            ]}
          />
          <h1 className="page-main-heading">Bài tập & Đề thi học phần</h1>
          <p className="page-subtitle">
            Thiết lập đề bài, tiêu chí rubric chấm điểm và quản lý tiến độ nộp bài của sinh viên.
          </p>
        </div>

        {!isArchived && (
          <Link
            to={`/gv/mon-hoc/${course.id}/bai-tap/soan`}
            className="npc-btn npc-btn-primary"
          >
            <Plus size={18} />
            <span>Soạn bài tập mới</span>
          </Link>
        )}
      </div>

      {isArchived && (
        <div className="archived-warning-alert" role="alert">
          <AlertTriangle size={20} />
          <span>
            Môn học đã lưu trữ: Toàn bộ bài tập ở trạng thái chỉ đọc. Không thể soạn bài mới hoặc chỉnh sửa tiêu chí chấm.
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="ass-tabs-bar" role="tablist">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => handleSelectTab('all')}
        >
          <span>Tất cả</span>
          <span className="count-chip">{courseAssignments.length}</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'published' ? 'active' : ''}`}
          onClick={() => handleSelectTab('published')}
        >
          <span>Đang mở</span>
          <span className="count-chip">{courseAssignments.filter(a => a.status === 'published').length}</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'draft' ? 'active' : ''}`}
          onClick={() => handleSelectTab('draft')}
        >
          <span>Bản nháp</span>
          <span className="count-chip">{courseAssignments.filter(a => a.status === 'draft').length}</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'archived' ? 'active' : ''}`}
          onClick={() => handleSelectTab('archived')}
        >
          <span>Đã đóng nộp</span>
          <span className="count-chip">{courseAssignments.filter(a => a.status === 'archived').length}</span>
        </button>
      </div>

      {/* Table */}
      {filteredAssignments.length === 0 ? (
        <EmptyState
          title="Chưa có bài tập"
          description="Chưa có bài tập nào trong mục này."
          action={!isArchived ? (
            <Button variant="primary" onClick={() => navigate(`/gv/mon-hoc/${course.id}/bai-tap/soan`)}>
              Soạn bài tập đầu tiên
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="ass-table-wrapper">
          <table className="npc-table">
            <thead>
              <tr>
                <th>Tiêu đề bài tập</th>
                <th>Hạn nộp</th>
                <th>Nộp muộn</th>
                <th>Đã nộp</th>
                <th>Chờ chấm</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssignments.map(ass => {
                const subCount = submissions.filter(s => s.assignmentId === ass.id).length;
                const pendingCount = submissions.filter(
                  s => s.assignmentId === ass.id && (s.gradingStatus === 'ungraded' || s.gradingStatus === 'in_progress')
                ).length;

                return (
                  <tr key={ass.id}>
                    <td>
                      <Link
                        to={
                          ass.status === 'draft'
                            ? `/gv/mon-hoc/${course.id}/bai-tap/soan?baiTap=${ass.id}`
                            : `/gv/bai-tap/${ass.id}/bai-nop`
                        }
                        className="ass-title-link"
                      >
                        <strong>{ass.title}</strong>
                      </Link>
                      <div className="ass-subtext">Thang điểm: {ass.maxScore} đ ({ass.rubricCriteria?.length || 0} tiêu chí)</div>
                    </td>
                    <td>{formatDateVN(ass.dueAt)}</td>
                    <td>
                      {ass.allowLate ? (
                        <span className="badge-allow-late">Cho phép</span>
                      ) : (
                        <span className="text-muted">Khóa</span>
                      )}
                    </td>
                    <td>
                      <span className="metric-count">{subCount} bài</span>
                    </td>
                    <td>
                      {pendingCount > 0 ? (
                        <strong className="pending-alert-text">{pendingCount} bài chờ chấm</strong>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                    <td>
                      <Badge
                        variant={ass.status === 'published' ? 'published' : ass.status === 'archived' ? 'archived' : 'draft'}
                        label={ass.status === 'published' ? 'Đang mở' : ass.status === 'archived' ? 'Đã đóng nộp' : 'Bản nháp'}
                      />
                    </td>
                    <td>
                      <div className="ass-row-actions">
                        {ass.status === 'draft' && (
                          <Link
                            to={`/gv/mon-hoc/${course.id}/bai-tap/soan?baiTap=${ass.id}`}
                            className="npc-btn npc-btn-secondary npc-btn-sm"
                          >
                            Tiếp tục soạn
                          </Link>
                        )}

                        {ass.status === 'published' && (
                          <>
                            <Link
                              to={`/gv/bai-tap/${ass.id}/bai-nop`}
                              className="npc-btn npc-btn-primary npc-btn-sm"
                            >
                              <span>Bài nộp ({subCount})</span>
                              <ArrowRight size={14} />
                            </Link>

                            {!isArchived && (
                              <button
                                type="button"
                                className="npc-btn npc-btn-ghost npc-btn-sm text-warning"
                                onClick={() => setTargetToClose(ass)}
                                title="Đóng cổng nhận bài nộp"
                              >
                                <Lock size={14} />
                                <span>Đóng nộp</span>
                              </button>
                            )}
                          </>
                        )}

                        {ass.status === 'archived' && (
                          <Link
                            to={`/gv/bai-tap/${ass.id}/bai-nop`}
                            className="npc-btn npc-btn-secondary npc-btn-sm"
                          >
                            Xem bài nộp
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Confirm Close Submissions */}
      {targetToClose && (
        <Modal
          title="Xác nhận đóng cổng nhận bài nộp"
          isOpen={!!targetToClose}
          onClose={() => setTargetToClose(null)}
        >
          <div className="modal-content-stack">
            <p>
              Bạn có chắc chắn muốn đóng cổng nộp bài cho bài tập <strong>"{targetToClose.title}"</strong>?
            </p>
            <div className="alert-notice-box">
              <AlertTriangle size={18} />
              <span>
                Quy định hệ thống: Sau khi đóng cổng nhận bài nộp, sinh viên sẽ không thể nộp thêm hoặc sửa bài. Hệ thống không tự ý hỗ trợ mở lại sau khi đóng.
              </span>
            </div>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setTargetToClose(null)}>
                Hủy bỏ
              </Button>
              <Button type="button" variant="danger" onClick={handleConfirmCloseSubmission}>
                Xác nhận đóng nộp bài
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
