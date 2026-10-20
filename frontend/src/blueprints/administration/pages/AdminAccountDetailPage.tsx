import React, { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { useSession } from '../../../app/providers/SessionContext';
import { useNotifications } from '../../../app/providers/NotificationContext';
import { Breadcrumb } from '../../../shared/ui/Breadcrumb';
import { Badge } from '../../../shared/ui/Badge';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/Button';
import { TextField, SelectField } from '../../../shared/ui/TextField';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatDateVN } from '../../../shared/kernel/formatting';
import {
  ShieldAlert,
  Lock,
  Unlock,
  UserCheck,
  AlertTriangle
} from 'lucide-react';
import './AdminAccountDetailPage.css';

export const AdminAccountDetailPage: React.FC = () => {
  const { taiKhoanId } = useParams<{ taiKhoanId: string }>();
  const { users, courses, memberships, auditEvents, lockAccount, unlockAccount, changeUserRole } = useDatabase();
  const { currentUser } = useSession();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  const account = users.find(u => u.id === taiKhoanId);

  // Modals
  const [showLockModal, setShowLockModal] = useState(false);
  const [lockReason, setLockReason] = useState('');
  const [isLocking, setIsLocking] = useState(false);

  const [showRoleModal, setShowRoleModal] = useState(false);
  const [newRole, setNewRole] = useState<'student' | 'teacher' | 'admin'>('student');
  const [isChangingRole, setIsChangingRole] = useState(false);
  // Self guard: admin cannot lock or change role of their own account
  const isSelf = account ? account.id === currentUser?.id : false;

  // Open courses taught by this user if teacher
  const activeTaughtCourses = useMemo(() => {
    if (!account || account.role !== 'teacher') return [];
    return courses.filter(c => c.teacherId === account.id && c.status === 'open');
  }, [courses, account]);

  // Associated courses
  const associatedCourses = useMemo(() => {
    if (!account) return [];
    if (account.role === 'teacher') {
      return courses.filter(c => c.teacherId === account.id);
    }
    // Student
    const myMemCourseIds = new Set(
      memberships.filter(m => m.userId === account.id).map(m => m.courseId)
    );
    return courses.filter(c => myMemCourseIds.has(c.id));
  }, [courses, memberships, account]);

  // Recent 5 audit logs
  const userAuditLogs = useMemo(() => {
    if (!account) return [];
    return auditEvents
      .filter(e => e.actorId === account.id || e.entityId === account.id)
      .slice(0, 5);
  }, [auditEvents, account]);

  if (!account) {
    return (
      <div className="admin-acc-detail-container">
        <EmptyState
          title="Không tìm thấy tài khoản"
          description="Tài khoản không tồn tại trên hệ thống."
          action={<Button onClick={() => navigate('/ad/tai-khoan')}>Về danh sách tài khoản</Button>}
        />
      </div>
    );
  }

  // LOCK / UNLOCK HANDLER
  const handleToggleLock = () => {
    if (isSelf) {
      showNotification('error', 'Không thể tự khóa tài khoản của chính mình.');
      return;
    }

    setIsLocking(true);
    let res;
    if (account.status === 'active') {
      res = lockAccount(account.id);
    } else {
      res = unlockAccount(account.id);
    }
    setIsLocking(false);
    setShowLockModal(false);

    if (res.ok) {
      showNotification('success', account.status === 'active' ? `Đã khóa tài khoản ${account.fullName}.` : `Đã mở khóa tài khoản ${account.fullName}.`);
    } else {
      showNotification('error', res.error?.message || 'Lỗi khi cập nhật trạng thái');
    }
  };

  // CHANGE ROLE HANDLER
  const handleChangeRole = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSelf) {
      showNotification('error', 'Không thể tự đổi vai trò của chính mình.');
      return;
    }

    if (account.role === 'teacher' && newRole !== 'teacher' && activeTaughtCourses.length > 0) {
      showNotification('error', `Giảng viên đang phụ trách ${activeTaughtCourses.length} môn học đang mở. Vui lòng chuyển giao môn học trước khi đổi vai trò.`);
      return;
    }

    setIsChangingRole(true);
    const res = changeUserRole(account.id, newRole);
    setIsChangingRole(false);
    setShowRoleModal(false);

    if (res.ok) {
      showNotification('success', `Đã chuyển đổi vai trò tài khoản sang "${newRole}".`);
    } else {
      showNotification('error', res.error?.message || 'Lỗi khi đổi vai trò');
    }
  };

  return (
    <div className="admin-acc-detail-page">
      <div className="page-header">
        <Breadcrumb
          items={[
            { label: 'Bàn làm việc', path: '/ad' },
            { label: 'Tài khoản người dùng', path: '/ad/tai-khoan' },
            { label: account.fullName }
          ]}
        />
        <div className="title-row">
          <h1 className="acc-main-title">{account.fullName}</h1>
          <span className="role-badge">
            {account.role === 'admin' ? 'Quản trị viên' : account.role === 'teacher' ? 'Giảng viên' : 'Sinh viên'}
          </span>
          <Badge
            variant={account.status === 'active' ? 'published' : 'archived'}
            label={account.status === 'active' ? 'Đang hoạt động' : 'Tài khoản bị khóa'}
          />
        </div>
      </div>

      {/* Self Guard Alert */}
      {isSelf && (
        <div className="self-guard-notice" role="alert">
          <ShieldAlert size={20} />
          <span>
            <strong>Tài khoản cá nhân:</strong> Bạn đang xem tài khoản của chính mình. Tính năng khóa tài khoản và thay đổi vai trò bị vô hiệu hóa để bảo vệ quyền truy cập quản trị hệ thống.
          </span>
        </div>
      )}

      {/* Main Grid */}
      <div className="acc-detail-grid">
        {/* Left Column: Account Info & Actions */}
        <section className="acc-info-card">
          <h2 className="card-section-title">Thông tin tài khoản</h2>
          <div className="info-meta-list">
            <div className="info-row">
              <span className="info-lbl">Họ và tên:</span>
              <strong className="info-val">{account.fullName}</strong>
            </div>
            <div className="info-row">
              <span className="info-lbl">Địa chỉ Email:</span>
              <span className="info-val">{account.emailNormalized}</span>
            </div>
            <div className="info-row">
              <span className="info-lbl">Mã định danh:</span>
              <span className="info-val font-mono">{account.id}</span>
            </div>
            <div className="info-row">
              <span className="info-lbl">Ngày khởi tạo:</span>
              <span className="info-val">{formatDateVN(account.createdAt)}</span>
            </div>
            <div className="info-row">
              <span className="info-lbl">Đăng nhập gần nhất:</span>
              <span className="info-val">{formatDateVN(account.lastLoginAt)}</span>
            </div>
          </div>

          {!isSelf && (
            <div className="acc-actions-bar">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setNewRole(account.role);
                  setShowRoleModal(true);
                }}
              >
                <UserCheck size={16} />
                <span>Thay đổi vai trò</span>
              </Button>

              <Button
                type="button"
                variant={account.status === 'active' ? 'danger' : 'primary'}
                onClick={() => setShowLockModal(true)}
              >
                {account.status === 'active' ? <Lock size={16} /> : <Unlock size={16} />}
                <span>{account.status === 'active' ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}</span>
              </Button>
            </div>
          )}
        </section>

        {/* Right Column: Associated Courses */}
        <section className="acc-courses-card">
          <h2 className="card-section-title">
            {account.role === 'teacher' ? 'Môn học phụ trách' : 'Môn học đã ghi danh'} ({associatedCourses.length})
          </h2>

          {associatedCourses.length === 0 ? (
            <p className="empty-notice-text">Chưa có môn học nào liên kết với tài khoản này.</p>
          ) : (
            <ul className="courses-list-stack">
              {associatedCourses.map(c => (
                <li key={c.id} className="course-item-row">
                  <div>
                    <Link to={`/ad/mon-hoc/${c.id}`} className="course-name-link">
                      <strong>{c.name}</strong>
                    </Link>
                    <div className="course-meta-sub">
                      <span>{c.code}</span>
                      <span className="dot">•</span>
                      <span>Học kỳ: {c.term}</span>
                    </div>
                  </div>
                  <Badge
                    variant={c.status === 'open' ? 'published' : 'archived'}
                    label={c.status === 'open' ? 'Đang mở' : 'Lưu trữ'}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Recent 5 Audit Logs */}
      <section className="acc-audit-section">
        <h2 className="section-title">Nhật ký hoạt động gần đây (5 sự kiện)</h2>
        {userAuditLogs.length === 0 ? (
          <p className="empty-notice-text">Chưa ghi nhận sự kiện kiểm toán cho tài khoản này.</p>
        ) : (
          <div className="audit-table-wrap">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Hành động</th>
                  <th>Đối tượng</th>
                  <th>Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {userAuditLogs.map(log => (
                  <tr key={log.id}>
                    <td>{formatDateVN(log.at)}</td>
                    <td><strong>{log.action}</strong></td>
                    <td>{log.entityType} ({log.entityId})</td>
                    <td>
                      <span className={`status-pill ${log.result}`}>
                        {log.result === 'success' ? 'Thành công' : 'Thất bại'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal Lock / Unlock */}
      {showLockModal && (
        <Modal
          title={account.status === 'active' ? 'Xác nhận khóa tài khoản' : 'Xác nhận mở khóa tài khoản'}
          isOpen={showLockModal}
          onClose={() => setShowLockModal(false)}
        >
          <div className="modal-content-stack">
            <p>
              Bạn chuẩn bị {account.status === 'active' ? 'khóa' : 'mở khóa'} tài khoản người dùng <strong>{account.fullName}</strong> ({account.emailNormalized}).
            </p>

            {account.role === 'teacher' && activeTaughtCourses.length > 0 && account.status === 'active' && (
              <div className="alert-warning-card">
                <AlertTriangle size={18} />
                <span>
                  <strong>Cảnh báo:</strong> Giảng viên này đang phụ trách {activeTaughtCourses.length} môn học đang mở. Nếu khóa, các môn học sẽ tạm thời không có người chấm bài cho đến khi bạn điều chuyển sang giảng viên khác.
                </span>
              </div>
            )}

            {account.status === 'active' && (
              <TextField
                label="Lý do khóa tài khoản (Tùy chọn)"
                value={lockReason}
                onChange={e => setLockReason(e.target.value)}
                placeholder="Ví dụ: Tạm ngưng học vụ, bảo mật tài khoản..."
              />
            )}

            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowLockModal(false)}>
                Hủy bỏ
              </Button>
              <Button
                type="button"
                variant={account.status === 'active' ? 'danger' : 'primary'}
                isLoading={isLocking}
                onClick={handleToggleLock}
              >
                {account.status === 'active' ? 'Xác nhận khóa' : 'Xác nhận mở khóa'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Change Role */}
      {showRoleModal && (
        <Modal
          title="Thay đổi vai trò người dùng"
          isOpen={showRoleModal}
          onClose={() => setShowRoleModal(false)}
        >
          <form onSubmit={handleChangeRole} className="modal-content-stack">
            <p>
              Chọn vai trò phân quyền mới cho tài khoản <strong>{account.fullName}</strong>:
            </p>

            {account.role === 'teacher' && activeTaughtCourses.length > 0 && (
              <div className="alert-danger-card">
                <AlertTriangle size={18} />
                <span>
                  <strong>Ràng buộc nghiêm ngặt:</strong> Giảng viên đang phụ trách <strong>{activeTaughtCourses.length} môn học đang mở</strong>. Bạn phải điều chuyển các môn học này sang giảng viên khác trước khi hạ quyền xuống Sinh viên.
                </span>
              </div>
            )}

            <SelectField
              label="Vai trò mới"
              value={newRole}
              onChange={e => setNewRole(e.target.value as any)}
              options={[
                { value: 'student', label: 'Sinh viên' },
                { value: 'teacher', label: 'Giảng viên' },
                { value: 'admin', label: 'Quản trị viên' }
              ]}
            />

            <div className="modal-actions-bar">
              <Button type="button" variant="secondary" onClick={() => setShowRoleModal(false)}>
                Hủy bỏ
              </Button>
              <Button
                type="submit"
                variant="primary"
                isLoading={isChangingRole}
                disabled={account.role === 'teacher' && newRole !== 'teacher' && activeTaughtCourses.length > 0}
              >
                Lưu vai trò mới
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
