import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';
import { useSession } from '../providers/SessionContext';
import { useDatabase } from '../providers/DatabaseContext';
import {
  CheckSquare,
  BookOpen,
  Search,
  Award,
  Bell,
  User,
  LogOut,
  Menu,
  X
} from 'lucide-react';
import './DashboardLayout.css';

export const StudentLayout: React.FC = () => {
  const { currentUser, logout } = useSession();
  const { db } = useDatabase();
  const navigate = useNavigate();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Calculate unread announcements for current student
  const studentCourseIds = db.memberships
    .filter((m) => m.userId === currentUser?.id && m.status === 'active')
    .map((m) => m.courseId);

  const unreadCount = db.announcements.filter(
    (a) => studentCourseIds.includes(a.courseId) && !a.readByUserIds.includes(currentUser?.id || '')
  ).length;

  const handleLogout = async () => {
  try {
    await logout();
    navigate('/dang-nhap', { replace: true });
  } catch (error) {
    window.alert(
      error instanceof Error
        ? error.message
        : 'Đăng xuất thất bại. Vui lòng thử lại.'
    );
  }
};

  const navLinks = [
    { to: '/sv', label: 'Việc cần làm', icon: <CheckSquare size={18} />, end: true },
    { to: '/sv/mon-hoc', label: 'Môn học của tôi', icon: <BookOpen size={18} /> },
    { to: '/sv/tim-kiem', label: 'Tìm học liệu', icon: <Search size={18} /> },
    { to: '/sv/diem', label: 'Điểm của tôi', icon: <Award size={18} /> },
    { to: '/sv/thong-bao', label: 'Thông báo', icon: <Bell size={18} />, badge: unreadCount },
  ];

  return (
    <div className="dash-shell">
      <header className="dash-topbar" role="banner">
        <div className="dash-topbar-inner">
          <div className="dash-topbar-left">
            <button
              className="dash-mobile-toggle"
              onClick={() => setIsMobileOpen(!isMobileOpen)}
              aria-label="Chuyển đổi menu"
              aria-expanded={isMobileOpen}
            >
              {isMobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <Link to="/sv" className="dash-brand" aria-label="Bàn làm việc Sinh viên NEU">
              <div className="dash-brand-icon" aria-hidden="true">
                <img
                  src="/neu-logo.webp"
                  alt="Biểu trưng Đại học Kinh tế Quốc dân"
                  className="dash-brand-img"
                />
              </div>
              <div className="dash-brand-text">
                <span className="dash-brand-name">NEU</span>
                <span className="dash-brand-sub">NEU - LEARNING MANAGEMENT SYSTEM</span>
              </div>
            </Link>
          </div>

          <div className="dash-topbar-right">
            <Link to="/ho-so" className="dash-user-chip">
              <User size={16} />
              <span className="user-name">{currentUser?.fullName}</span>
              <span className="user-badge-role">SV</span>
            </Link>
            <button className="dash-logout-btn" onClick={handleLogout} title="Đăng xuất">
              <LogOut size={16} />
              <span className="logout-text">Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>

      <div className="dash-body">
        <aside className={`dash-sidebar ${isMobileOpen ? 'open' : ''}`} role="navigation" aria-label="Menu sinh viên">
          <nav className="dash-nav">
            {navLinks.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `dash-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setIsMobileOpen(false)}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="nav-badge" aria-label={`${item.badge} chưa đọc`}>
                    {item.badge}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="dash-sidebar-footer">
            <Link to="/ho-so" className="sidebar-profile-link" onClick={() => setIsMobileOpen(false)}>
              <User size={16} />
              <span>Hồ sơ cá nhân</span>
            </Link>
            <div className="sidebar-demo-badge">Dữ liệu minh họa</div>
          </div>
        </aside>

        <main className="dash-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
