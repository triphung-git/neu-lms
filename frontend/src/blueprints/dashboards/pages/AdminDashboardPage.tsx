import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDatabase } from '../../../app/providers/DatabaseContext';
import { formatDateTimeVN } from '../../../shared/kernel/formatting';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import {
  Users,
  BookOpen,
  MailCheck,
  AlertTriangle,
  Activity,
  Sparkles,
  Shield
} from 'lucide-react';
import './DashboardPages.css';

export const AdminDashboardPage: React.FC = () => {
  const { db } = useDatabase();
  const navigate = useNavigate();

  const activeUsers = db.users.filter((u) => u.status === 'active');
  const lockedUsers = db.users.filter((u) => u.status === 'locked');
  const pendingEmails = db.validEmails.filter((v) => !v.registeredUserId);
  const openCourses = db.courses.filter((c) => c.status === 'open');
  const archivedCourses = db.courses.filter((c) => c.status === 'archived');

  const problemMaterials = db.materials.filter((m) => {
    const ver = db.materialVersions.find((v) => v.id === m.currentVersionId);
    return ver?.scanStatus === 'infected' || ver?.scanStatus === 'error';
  });

  const recentLogs = db.auditLogs.slice(0, 6);

  return (
    <div className="dash-page-container">
      <div className="dash-page-header">
        <div>
          <h1 className="dash-page-title">Vận hành Tổng quan Hệ thống</h1>
          <p className="dash-page-subtitle">
            Giám sát tài khoản, tình trạng phân bổ môn học và nhật ký an toàn toàn trường.
          </p>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="stat-cards-row">
        <div className="stat-metric-card" onClick={() => navigate('/ad/tai-khoan')}>
          <div className="metric-header">
            <span className="metric-title">Tài khoản hoạt động</span>
            <Users size={20} className="text-accent" />
          </div>
          <span className="metric-number">{activeUsers.length}</span>
          <span className="metric-sub">{lockedUsers.length} tài khoản đang bị khóa</span>
        </div>

        <div className="stat-metric-card" onClick={() => navigate('/ad/email-hop-le')}>
          <div className="metric-header">
            <span className="metric-title">Email chờ kích hoạt</span>
            <MailCheck size={20} className="text-warning" />
          </div>
          <span className="metric-number">{pendingEmails.length}</span>
          <span className="metric-sub">Trong tổng {db.validEmails.length} email hợp lệ</span>
        </div>

        <div className="stat-metric-card" onClick={() => navigate('/ad/mon-hoc')}>
          <div className="metric-header">
            <span className="metric-title">Môn học đang mở</span>
            <BookOpen size={20} className="text-accent" />
          </div>
          <span className="metric-number">{openCourses.length}</span>
          <span className="metric-sub">{archivedCourses.length} môn đã lưu trữ</span>
        </div>

        <div className="stat-metric-card">
          <div className="metric-header">
            <span className="metric-title">Học liệu nguy hại</span>
            <AlertTriangle size={20} className="text-danger" />
          </div>
          <span className="metric-number">{problemMaterials.length}</span>
          <span className="metric-sub">Phát hiện qua quét mô phỏng</span>
        </div>
      </div>

      <div className="dash-grid-sections">
        {/* Left Column: Recent Audit Logs */}
        <div className="dash-col-main">
          <section className="dash-card" aria-labelledby="audit-heading">
            <div className="dash-card-header">
              <Activity className="card-title-icon" />
              <h2 id="audit-heading">Nhật ký hoạt động gần đây</h2>
              <Link to="/ad/nhat-ky" className="card-view-all">
                Xem toàn bộ nhật ký →
              </Link>
            </div>

            <div className="audit-table-wrapper">
              <table className="mini-data-table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Người thực hiện</th>
                    <th>Hành động</th>
                    <th>Thực thể</th>
                    <th>Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {recentLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="font-mono text-muted">{formatDateTimeVN(log.at)}</td>
                      <td>
                        <strong>{log.actorName}</strong>
                        <span className="log-role-pill">{log.actorRole}</span>
                      </td>
                      <td>
                        <code>{log.action}</code>
                      </td>
                      <td>{log.entityType}</td>
                      <td>
                        <Badge
                          variant={log.result === 'success' ? 'published' : 'error'}
                          label={log.result === 'success' ? 'Thành công' : 'Từ chối'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Right Column: AI & System Configurations Status */}
        <div className="dash-col-side">
          <section className="dash-card" aria-labelledby="config-status-heading">
            <div className="dash-card-header">
              <Sparkles className="card-title-icon text-accent" />
              <h2 id="config-status-heading">Cấu hình & Định ngạch</h2>
              <Link to="/ad/cau-hinh" className="card-view-all">
                Chỉnh sửa →
              </Link>
            </div>

            <div className="config-summary-list">
              <div className="config-summary-item">
                <span className="config-label">Trạng thái AI toàn trường</span>
                <Badge
                  variant={db.settings.aiEnabled ? 'ready' : 'closed'}
                  label={db.settings.aiEnabled ? 'Đang bật' : 'Đã tắt'}
                />
              </div>
              <div className="config-summary-item">
                <span className="config-label">Quota Sinh viên</span>
                <span className="config-val">{db.settings.studentDailyAIQuota} câu / ngày</span>
              </div>
              <div className="config-summary-item">
                <span className="config-label">Quota Giảng viên</span>
                <span className="config-val">{db.settings.teacherMonthlyAIQuota} lượt / tháng</span>
              </div>
              <div className="config-summary-item">
                <span className="config-label">Dung lượng file nộp</span>
                <span className="config-val">Tối đa {db.settings.maxSubmissionFileMB} MB</span>
              </div>
              <div className="config-summary-item">
                <span className="config-label">Mô phỏng Email</span>
                <Badge
                  variant={db.settings.emailEnabled ? 'published' : 'closed'}
                  label={db.settings.emailEnabled ? 'Đang bật' : 'Đã tắt'}
                />
              </div>
            </div>
          </section>

          {/* Quick Shortcuts */}
          <section className="dash-card" aria-labelledby="shortcuts-heading">
            <div className="dash-card-header">
              <Shield className="card-title-icon" />
              <h2 id="shortcuts-heading">Lối tắt tác vụ</h2>
            </div>
            <div className="shortcuts-list">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/ad/email-hop-le')}
                icon={<MailCheck size={16} />}
              >
                Nhập danh sách Email (CSV)
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/ad/tai-khoan')}
                icon={<Users size={16} />}
              >
                Rà soát tài khoản người dùng
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/ad/mon-hoc')}
                icon={<BookOpen size={16} />}
              >
                Chuyển giao giảng viên môn học
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
