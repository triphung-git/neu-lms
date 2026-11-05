import {uiText} from "../../../shared/i18n/translate";
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminRecentActivity } from './AdminRecentActivity';
import { Button } from '../../../shared/ui/Button';
import { AdminOverviewCards } from './AdminOverviewCards';
import { AdminFileLimitsPanel } from './AdminFileLimitsPanel';
import {
  Users,
  BookOpen,
  MailCheck,
  Shield
} from 'lucide-react';
import './DashboardPages.css';

export const AdminDashboardPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="dash-page-container">
      <div className="dash-page-header">
        <div>
          <h1 className="dash-page-title">{uiText("Vận hành Tổng quan Hệ thống")}</h1>
          <p className="dash-page-subtitle">
            {uiText("Giám sát tài khoản, tình trạng phân bổ môn học và nhật ký an toàn toàn trường.")}</p>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="stat-cards-row">
        <AdminOverviewCards />
      </div>

      <div className="dash-grid-sections">
        {/* Left Column: Recent Audit Logs */}
        <div className="dash-col-main">
          <AdminRecentActivity />
        </div>

        {/* Right Column: AI & System Configurations Status */}
        <div className="dash-col-side">
          <AdminFileLimitsPanel />

          {/* Quick Shortcuts */}
          <section className="dash-card" aria-labelledby="shortcuts-heading">
            <div className="dash-card-header">
              <Shield className="card-title-icon" />
              <h2 id="shortcuts-heading">{uiText("Lối tắt tác vụ")}</h2>
            </div>
            <div className="shortcuts-list">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/ad/duyet-giang-vien')}
                icon={<MailCheck size={16} />}
              >
                {uiText("Duyệt yêu cầu giảng viên")}</Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/ad/tai-khoan')}
                icon={<Users size={16} />}
              >
                {uiText("Rà soát tài khoản người dùng")}</Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/ad/mon-hoc')}
                icon={<BookOpen size={16} />}
              >
                {uiText("Chuyển giao giảng viên môn học")}</Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
