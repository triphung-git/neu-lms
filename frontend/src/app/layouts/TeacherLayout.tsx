import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';
import { useSession } from '../providers/SessionContext';
import {
  LayoutDashboard,
  BookOpen,
  Bell,
  Sparkles,
  User,
  LogOut,
  Menu,
  X
} from 'lucide-react';
import './DashboardLayout.css';

export const TeacherLayout: React.FC = () => {
  const { currentUser, logout } = useSession();
  const navigate = useNavigate();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/dang-nhap');
  };

  const navLinks = [
    { to: '/gv', label: 'Tổng quan công việc', icon: <LayoutDashboard size={18} />, end: true },
    { to: '/gv/mon-hoc', label: 'Môn của tôi', icon: <BookOpen size={18} /> },
    { to: '/gv/thong-bao', label: 'Thông báo môn', icon: <Bell size={18} /> },
    { to: '/gv/ban-nhap-ai', label: 'Bản nháp AI', icon: <Sparkles size={18} /> },
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
            <Link to="/gv" className="dash-brand" aria-label="Bàn làm việc Giảng viên NEU">
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
              <span className="user-badge-role">GV</span>
            </Link>
            <button className="dash-logout-btn" onClick={handleLogout} title="Đăng xuất">
              <LogOut size={16} />
              <span className="logout-text">Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>

      <div className="dash-body">
        <aside className={`dash-sidebar ${isMobileOpen ? 'open' : ''}`} role="navigation" aria-label="Menu giảng viên">
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
