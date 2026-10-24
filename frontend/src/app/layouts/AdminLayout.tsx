import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';
import { useSession } from '../providers/SessionContext';
import {
  ShieldCheck,
  Users,
  MailCheck,
  BookMarked,
  FileText,
  Sliders,
  User,
  LogOut,
  Menu,
  X
} from 'lucide-react';
import './DashboardLayout.css';

export const AdminLayout: React.FC = () => {
  const { currentUser, logout } = useSession();
  const navigate = useNavigate();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

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
    { to: '/ad', label: 'Vận hành tổng quan', icon: <ShieldCheck size={18} />, end: true },
    { to: '/ad/tai-khoan', label: 'Tài khoản người dùng', icon: <Users size={18} /> },
    { to: '/ad/email-hop-le', label: 'Email hợp lệ', icon: <MailCheck size={18} /> },
    { to: '/ad/mon-hoc', label: 'Danh mục môn học', icon: <BookMarked size={18} /> },
    { to: '/ad/nhat-ky', label: 'Nhật ký hoạt động', icon: <FileText size={18} /> },
    { to: '/ad/cau-hinh', label: 'Cấu hình hệ thống', icon: <Sliders size={18} /> },
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
            <Link to="/ad" className="dash-brand" aria-label="Bàn làm việc Quản trị viên NEU">
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
              <span className="user-badge-role">Admin</span>
            </Link>
            <button className="dash-logout-btn" onClick={handleLogout} title="Đăng xuất">
              <LogOut size={16} />
              <span className="logout-text">Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>

      <div className="dash-body">
        <aside className={`dash-sidebar ${isMobileOpen ? 'open' : ''}`} role="navigation" aria-label="Menu quản trị">
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
