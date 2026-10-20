import React, { useState } from 'react';
import { useClock } from '../providers/ClockContext';
import { useSession } from '../providers/SessionContext';
import { useDatabase } from '../providers/DatabaseContext';
import { formatDateTimeVN } from '../../shared/kernel/formatting';
import { Clock, RefreshCw, UserCheck, AlertTriangle } from 'lucide-react';
import { Modal } from '../../shared/ui/Modal';
import { Button } from '../../shared/ui/Button';
import './DemoControlBar.css';

export const DemoControlBar: React.FC = () => {
  const { currentTimeIso, advanceHours, advanceDays, resetClock } = useClock();
  const { currentUser, role, switchRoleQuick, logout } = useSession();
  const { resetDb, isMemoryOnly } = useDatabase();
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  const handleConfirmReset = () => {
    resetDb();
    resetClock();
    logout();
    setIsResetModalOpen(false);
    window.location.href = '/dang-nhap';
  };

  return (
    <div className="demo-bar" role="region" aria-label="Thanh điều khiển phiên bản minh họa">
      <div className="demo-bar-inner">
        <div className="demo-bar-clock">
          <Clock size={15} aria-hidden="true" />
          <span className="demo-clock-text">
            Thời gian minh họa: <strong>{formatDateTimeVN(currentTimeIso)}</strong>
          </span>
          <div className="demo-clock-actions">
            <button className="demo-pill-btn" onClick={() => advanceHours(2)} title="Tiến 2 giờ">
              +2h
            </button>
            <button className="demo-pill-btn" onClick={() => advanceDays(1)} title="Tiến 1 ngày">
              +1d
            </button>
            <button className="demo-pill-btn" onClick={() => advanceDays(3)} title="Tiến 3 ngày">
              +3d
            </button>
          </div>
        </div>

        {isMemoryOnly && (
          <div className="demo-bar-warning" role="alert">
            <AlertTriangle size={14} />
            <span>Chỉ lưu bộ nhớ phiên (Memory-only)</span>
          </div>
        )}

        <div className="demo-bar-right">
          <div className="demo-role-switcher">
            <UserCheck size={14} aria-hidden="true" />
            <span className="demo-role-label">Vai trò:</span>
            <button
              className={`demo-role-btn ${role === 'student' ? 'active' : ''}`}
              onClick={() => switchRoleQuick('student')}
            >
              Sinh viên
            </button>
            <button
              className={`demo-role-btn ${role === 'teacher' ? 'active' : ''}`}
              onClick={() => switchRoleQuick('teacher')}
            >
              Giảng viên
            </button>
            <button
              className={`demo-role-btn ${role === 'admin' ? 'active' : ''}`}
              onClick={() => switchRoleQuick('admin')}
            >
              Quản trị
            </button>
          </div>

          <button
            className="demo-reset-btn"
            onClick={() => setIsResetModalOpen(true)}
            title="Đặt lại dữ liệu gốc của phiên minh họa"
          >
            <RefreshCw size={13} />
            <span>Reset Demo</span>
          </button>
        </div>
      </div>

      <Modal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        title="Xác nhận đặt lại dữ liệu minh họa"
        description="Toàn bộ thay đổi về bài nộp, điểm số, học liệu, tài khoản đã thêm sẽ được khôi phục về trạng thái hạt giống (seed) ban đầu."
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsResetModalOpen(false)}>
              Hủy bỏ
            </Button>
            <Button variant="danger" onClick={handleConfirmReset}>
              Xác nhận Đặt lại
            </Button>
          </>
        }
      >
        <p style={{ color: 'var(--ink-soft)', lineHeight: '1.6' }}>
          Hành động này sẽ xóa dữ liệu trong bộ nhớ namespace <code>npc-lms-demo:v1</code> và hủy phiên đăng nhập hiện tại.
        </p>
      </Modal>
    </div>
  );
};
