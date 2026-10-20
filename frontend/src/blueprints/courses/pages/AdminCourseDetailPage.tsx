import React, { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN, formatScoreVN } from '../../../shared/kernel/formatting';
import {
  BookOpen,
  Users,
  FolderTree,
  FileText,
  ClipboardList,
  Award,
  Archive,
  UserCheck,
  AlertTriangle,
  Info
} from 'lucide-react';
import './AdminCourseDetailPage.css';

export const AdminCourseDetailPage: React.FC = () => {
  const { monId } = useParams<{ monId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    courses,
    users,
    chapters,
    lessons,
    materials,
    materialVersions,
    assignments,
    submissions,
    gradeRevisions,
    memberships,
    transferCourseTeacher,
    archiveCourse
  } = useDatabase();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  const activeTab = searchParams.get('tab') || 'tong-quan';

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);

  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const course = courses.find(c => c.id === monId);

  // Available teachers for transfer
  const activeTeachers = useMemo(() => {
    return users.filter(u => u.role === 'teacher' && u.status === 'active');
  }, [users]);

  if (!course) {
    return (
      <div className="admin-detail-container">
        <EmptyState
          title="Không tìm thấy môn học"
          description="Môn học không tồn tại trên hệ thống."
          action={<Button onClick={() => navigate('/ad/mon-hoc')}>Về danh mục môn học</Button>}
        />
      </div>
    );
  }

  const isArchived = course.status === 'archived';

  const courseChapters = chapters
    .filter(ch => ch.courseId === monId)
    .sort((a, b) => a.order - b.order);
  const chIds = new Set(courseChapters.map(ch => ch.id));
  const courseLessons = lessons
    .filter(l => chIds.has(l.chapterId))
    .sort((a, b) => a.order - b.order);

  const courseMaterials = materials.filter(m => m.courseId === monId);
  const courseAssignments = assignments.filter(a => a.courseId === monId);
  const courseMembers = memberships.filter(m => m.courseId === monId);
  const activeMembers = courseMembers.filter(m => m.status === 'active');

  const handleSelectTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next);
  };

  const handleTransferTeacher = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeacherId) {
      showNotification('error', 'Vui lòng chọn giảng viên tiếp nhận.');
      return;
    }
    const newTeacher = activeTeachers.find(t => t.id === selectedTeacherId);
    if (!newTeacher) return;

    setIsTransferring(true);
    const res = transferCourseTeacher(course.id, newTeacher.id, newTeacher.fullName);
    setIsTransferring(false);
    setShowTransferModal(false);

    if (res.ok) {
      showNotification('success', `Đã chuyển giao môn học sang giảng viên ${newTeacher.fullName}.`);
    } else {
      showNotification('error', res.error?.message || 'Lỗi chuyển giao giảng viên');
    }
  };

  const handleArchive = () => {
    setIsArchiving(true);
    const res = archiveCourse(course.id);
    setIsArchiving(false);
    setShowArchiveModal(false);

    if (res.ok) {
      showNotification('success', `Đã lưu trữ môn học "${course.name}".`);
    } else {
      showNotification('error', res.error?.message || 'Lỗi khi lưu trữ');
    }
  };

  const teacherName = users.find(u => u.id === course.teacherId)?.fullName || 'Chưa phân công';

  return (
    <div className="admin-course-detail-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/ad' },
            { label: 'Môn học toàn trường', path: '/ad/mon-hoc' },
            { label: `${course.code} — ${course.name}` }
          ]}
        />
        <div className="title-row">
          <span className="code-badge">{course.code}</span>
          <h1 className="course-title">{course.name}</h1>
          <Badge
            variant={isArchived ? 'archived' : 'published'}
            label={isArchived ? 'Đã lưu trữ' : 'Đang mở'}
          />
        </div>
        <p className="course-meta">
          <span>Học kỳ: <strong>{course.term}</strong></span>
          <span className="dot">•</span>
          <span>Giảng viên hiện tại: <strong>{teacherName}</strong></span>
        </p>
      </div>

      {/* Operational Hub Notice */}
      <div className="admin-ops-card">
        <div className="ops-card-header">
          <div className="ops-title-wrap">
            <UserCheck size={20} className="ops-icon" />
            <div>
              <h2 className="ops-title">Khối vận hành ngoại lệ của Quản trị viên</h2>
              <p className="ops-desc">
                Nội dung môn học ở chế độ chỉ đọc. Quản trị viên chỉ thực hiện các thao tác hành chính đặc biệt dưới đây.
              </p>
            </div>
          </div>

          <div className="ops-actions-group">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSelectedTeacherId(course.teacherId);
                setShowTransferModal(true);
              }}
              disabled={isArchived}
            >
              <UserCheck size={16} />
              <span>Điều chuyển giảng viên</span>
            </Button>

            <Button
              type="button"
              variant="danger"
              onClick={() => setShowArchiveModal(true)}
              disabled={isArchived}
            >
              <Archive size={16} />
              <span>{isArchived ? 'Đã lưu trữ' : 'Cưỡng chế lưu trữ'}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <nav className="admin-tabs-nav" aria-label="Phân hệ môn học">
        <button
          className={`tab-btn ${activeTab === 'tong-quan' ? 'active' : ''}`}
          onClick={() => handleSelectTab('tong-quan')}
        >
          <BookOpen size={16} />
          <span>Tổng quan</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'cau-truc' ? 'active' : ''}`}
          onClick={() => handleSelectTab('cau-truc')}
        >
          <FolderTree size={16} />
          <span>Cấu trúc bài học ({courseChapters.length})</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'hoc-lieu' ? 'active' : ''}`}
          onClick={() => handleSelectTab('hoc-lieu')}
        >
          <FileText size={16} />
          <span>Metadata học liệu ({courseMaterials.length})</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'bai-tap' ? 'active' : ''}`}
          onClick={() => handleSelectTab('bai-tap')}
        >
          <ClipboardList size={16} />
          <span>Bài tập ({courseAssignments.length})</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'diem' ? 'active' : ''}`}
          onClick={() => handleSelectTab('diem')}
        >
          <Award size={16} />
          <span>Bảng điểm đã công bố</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'thanh-vien' ? 'active' : ''}`}
          onClick={() => handleSelectTab('thanh-vien')}
        >
          <Users size={16} />
          <span>Thành viên ({activeMembers.length})</span>
        </button>
      </nav>

      {/* TAB: TỔNG QUAN */}
      {activeTab === 'tong-quan' && (
        <div className="tab-pane">
          <div className="meta-stats-grid">
            <div className="stat-card">
              <span className="stat-val">{activeMembers.length}</span>
              <span className="stat-lbl">Sinh viên chính thức</span>
            </div>
            <div className="stat-card">
              <span className="stat-val">{courseChapters.length}</span>
              <span className="stat-lbl">Chương đề cương</span>
            </div>
            <div className="stat-card">
              <span className="stat-val">{courseLessons.length}</span>
              <span className="stat-lbl">Bài học</span>
            </div>
            <div className="stat-card">
              <span className="stat-val">{courseMaterials.length}</span>
              <span className="stat-lbl">Học liệu đã tải</span>
            </div>
            <div className="stat-card">
              <span className="stat-val">{courseAssignments.length}</span>
              <span className="stat-lbl">Bài tập học phần</span>
            </div>
          </div>

          <div className="info-section-card">
            <h3 className="section-title">Mô tả học phần</h3>
            <p className="desc-text">{course.description || 'Chưa có mô tả môn học.'}</p>
          </div>
        </div>
      )}

      {/* TAB: CẤU TRÚC (READ-ONLY) */}
      {activeTab === 'cau-truc' && (
        <div className="tab-pane">
          <div className="readonly-banner">
            <Info size={18} />
            <span>Đề cương môn học ở chế độ chỉ đọc dành cho Quản trị viên.</span>
          </div>

          {courseChapters.length === 0 ? (
            <EmptyState title="Chưa có cấu trúc đề cương" description="Giảng viên chưa tạo chương bài học cho môn này." />
          ) : (
            <div className="structure-readonly-tree">
              {courseChapters.map((ch, idx) => {
                const chLessons = courseLessons.filter(l => l.chapterId === ch.id);
                return (
                  <div key={ch.id} className="ch-readonly-card">
                    <h3 className="ch-title">Chương {idx + 1}: {ch.title}</h3>
                    {chLessons.length === 0 ? (
                      <p className="empty-sub">Chưa có bài học</p>
                    ) : (
                      <ul className="lessons-readonly-list">
                        {chLessons.map(l => (
                          <li key={l.id} className="lesson-readonly-item">
                            <BookOpen size={16} />
                            <span>{l.title}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB: HỌC LIỆU (METADATA ONLY, NO DOWNLOAD) */}
      {activeTab === 'hoc-lieu' && (
        <div className="tab-pane">
          <div className="readonly-banner">
            <Info size={18} />
            <span>Quản trị viên chỉ xem metadata học liệu và trạng thái xử lý AI / mã độc, không có quyền tải file tài liệu của lớp.</span>
          </div>

          <div className="admin-table-container">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>Tên học liệu</th>
                  <th>Định dạng</th>
                  <th>Phiên bản</th>
                  <th>Quét mã độc</th>
                  <th>Chỉ mục AI</th>
                  <th>Quyền hiển thị</th>
                </tr>
              </thead>
              <tbody>
                {courseMaterials.map(mat => {
                  const curVer = materialVersions.find(v => v.id === mat.currentVersionId);
                  const scanClean = curVer?.scanStatus === 'clean';
                  const scanInfected = curVer?.scanStatus === 'infected';
                  const indexed = curVer?.indexStatus === 'success';
                  const fileExt = curVer?.filename ? curVer.filename.split('.').pop()?.toUpperCase() : 'PDF';
                  return (
                    <tr key={mat.id}>
                      <td><strong>{mat.title}</strong></td>
                      <td>{fileExt}</td>
                      <td>v{curVer?.versionNumber || 1}</td>
                      <td>
                        <Badge
                          variant={scanClean ? 'ready' : scanInfected ? 'error' : 'processing'}
                          label={scanClean ? 'Sạch' : scanInfected ? 'Phát hiện mã độc' : 'Đang quét'}
                        />
                      </td>
                      <td>
                        <Badge
                          variant={indexed ? 'published' : 'draft'}
                          label={indexed ? 'Đã lập chỉ mục' : 'Chờ xử lý'}
                        />
                      </td>
                      <td>
                        <Badge
                          variant={mat.visibility === 'class' ? 'published' : mat.visibility === 'draft' ? 'draft' : 'archived'}
                          label={mat.visibility === 'class' ? 'Cả lớp' : mat.visibility === 'draft' ? 'Bản nháp' : 'Ẩn'}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: BÀI TẬP (READ-ONLY, NO SUBMISSION DOWNLOAD) */}
      {activeTab === 'bai-tap' && (
        <div className="tab-pane">
          <div className="readonly-banner">
            <Info size={18} />
            <span>Quản trị viên chỉ theo dõi tiến độ nộp bài, không xem trực tiếp nội dung bài nộp của sinh viên.</span>
          </div>

          <div className="admin-table-container">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>Tiêu đề bài tập</th>
                  <th>Hạn nộp</th>
                  <th>Nộp muộn</th>
                  <th>Số bài đã nộp</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {courseAssignments.map(ass => {
                  const subCount = submissions.filter(s => s.assignmentId === ass.id).length;
                  return (
                    <tr key={ass.id}>
                      <td><strong>{ass.title}</strong></td>
                      <td>{formatDateVN(ass.dueAt)}</td>
                      <td>{ass.allowLate ? 'Cho phép' : 'Khóa khi hết hạn'}</td>
                      <td>{subCount} sinh viên đã nộp</td>
                      <td>
                        <Badge
                          variant={ass.status === 'published' ? 'published' : ass.status === 'archived' ? 'archived' : 'draft'}
                          label={ass.status === 'published' ? 'Đang mở' : ass.status === 'archived' ? 'Đã đóng' : 'Bản nháp'}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: BẢNG ĐIỂM (PUBLISHED SCORES ONLY) */}
      {activeTab === 'diem' && (
        <div className="tab-pane">
          <div className="readonly-banner">
            <Info size={18} />
            <span>Chỉ hiển thị các đầu điểm đã được Giảng viên phê duyệt và công bố chính thức.</span>
          </div>

          <div className="admin-table-container">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>Sinh viên</th>
                  <th>Email</th>
                  {courseAssignments.filter(a => a.status === 'published').map(a => (
                    <th key={a.id}>{a.title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeMembers.map(m => {
                  const memberUser = users.find(u => u.id === m.userId || u.emailNormalized === m.emailNormalized);
                  return (
                    <tr key={m.id}>
                      <td><strong>{memberUser?.fullName || m.emailNormalized}</strong></td>
                      <td>{m.emailNormalized}</td>
                      {courseAssignments.filter(a => a.status === 'published').map(a => {
                        const sub = submissions.find(s => s.assignmentId === a.id && s.studentId === m.userId);
                        const pubGrade = sub ? gradeRevisions.find(g => g.submissionId === sub.id && g.status === 'published') : undefined;
                        return (
                          <td key={a.id}>
                            {pubGrade ? (
                              <strong className="score-num">{formatScoreVN(pubGrade.total)}</strong>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: THÀNH VIÊN */}
      {activeTab === 'thanh-vien' && (
        <div className="tab-pane">
          <div className="admin-table-container">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>Họ và tên</th>
                  <th>Email</th>
                  <th>Trạng thái ghi danh</th>
                  <th>Ngày ghi danh</th>
                </tr>
              </thead>
              <tbody>
                {courseMembers.map(m => {
                  const memberUser = users.find(u => u.id === m.userId || u.emailNormalized === m.emailNormalized);
                  return (
                    <tr key={m.id}>
                      <td><strong>{memberUser?.fullName || m.emailNormalized}</strong></td>
                      <td>{m.emailNormalized}</td>
                      <td>
                        <Badge
                          variant={m.status === 'active' ? 'active' : m.status === 'withdrawn' ? 'withdrawn' : 'pending'}
                          label={m.status === 'active' ? 'Đang học' : m.status === 'withdrawn' ? 'Đã rút' : 'Chờ xác nhận'}
                        />
                      </td>
                      <td>{formatDateVN(m.addedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Transfer Teacher */}
      {showTransferModal && (
        <Modal
          title="Điều chuyển Giảng viên phụ trách"
          isOpen={showTransferModal}
          onClose={() => setShowTransferModal(false)}
        >
          <form onSubmit={handleTransferTeacher} className="modal-form-stack">
            <p className="modal-intro">
              Chọn giảng viên mới để chuyển giao quyền quản lý học phần <strong>{course.code} — {course.name}</strong>.
            </p>
            <SelectField
              label="Giảng viên tiếp nhận"
              required
              value={selectedTeacherId}
              onChange={e => setSelectedTeacherId(e.target.value)}
              options={activeTeachers.map(t => ({
                value: t.id,
                label: `${t.fullName} (${t.emailNormalized})`
              }))}
            />
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowTransferModal(false)}>
                Hủy bỏ
              </Button>
              <Button type="submit" variant="primary" isLoading={isTransferring}>
                Xác nhận chuyển giao
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Archive Course */}
      {showArchiveModal && (
        <Modal
          title="Xác nhận cưỡng chế Lưu trữ môn học"
          isOpen={showArchiveModal}
          onClose={() => setShowArchiveModal(false)}
        >
          <div className="modal-form-stack">
            <p>
              Bạn đang thực hiện thao tác quản trị đặc biệt: Cưỡng chế lưu trữ học phần <strong>{course.code} — {course.name}</strong>.
            </p>
            <div className="archive-alert-box">
              <AlertTriangle size={20} />
              <span>
                Sau khi lưu trữ, môn học sẽ chuyển sang chế độ <strong>chỉ đọc vĩnh viễn</strong>. Giảng viên và sinh viên sẽ không thể nộp bài hoặc chấm điểm.
              </span>
            </div>
            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowArchiveModal(false)}>
                Hủy bỏ
              </Button>
              <Button type="button" variant="danger" isLoading={isArchiving} onClick={handleArchive}>
                Xác nhận cưỡng chế lưu trữ
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
