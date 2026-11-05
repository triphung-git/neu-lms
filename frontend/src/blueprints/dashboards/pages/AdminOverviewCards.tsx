import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BookOpen, MailCheck, Users } from 'lucide-react';
import { apiClient } from '../../../api/client';

type Counts = {
  active_users: number;
  inactive_users: number;
  open_courses: number;
  archived_courses: number;
  infected_material_files: number;
  scanning_material_files: number;
  pending_teacher_requests: number;
};

export function AdminOverviewCards() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');

    apiClient
      .untypedRequest<Counts>('/api/v1/admin/overview', {
        signal: controller.signal,
      })
      .then(data => {
        if (!controller.signal.aborted) setCounts(data);
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : uiText("Không tải được thống kê."),
          );
        }
      });

    return () => controller.abort();
  }, [attempt]);

  if (error) {
    return (
      <div className="stat-metric-card admin-overview-error" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => setAttempt(n => n + 1)}>
          {uiText("Tải lại thống kê")}</button>
      </div>
    );
  }

  return (
    <>
      <Link className="stat-metric-card" to="/ad/tai-khoan">
        <div className="metric-header">
          <span className="metric-title">{uiText("Tài khoản hoạt động")}</span>
          <Users size={20} aria-hidden="true" />
        </div>
        <span className="metric-number">{counts?.active_users ?? '…'}</span>
        <span className="metric-sub">
          {counts
            ? uiText("{0} tài khoản không hoạt động",[counts.inactive_users])
            : uiText("Đang tải…")}
        </span>
      </Link>

      <Link className="stat-metric-card" to="/ad/mon-hoc">
        <div className="metric-header">
          <span className="metric-title">{uiText("Môn học đang mở")}</span>
          <BookOpen size={20} aria-hidden="true" />
        </div>
        <span className="metric-number">{counts?.open_courses ?? '…'}</span>
        <span className="metric-sub">
          {counts ? uiText("{0} môn đã lưu trữ",[counts.archived_courses]) : uiText("Đang tải…")}
        </span>
      </Link>
      <div className="stat-metric-card">
        <div className="metric-header">
          <span className="metric-title">{uiText("Tệp học liệu bị chặn")}</span>
          <AlertTriangle
            size={20}
            aria-hidden="true"
            className={counts?.infected_material_files ? 'text-danger' : 'text-muted'}
          />
        </div>

        <span className="metric-number">
          {counts?.infected_material_files ?? '…'}
        </span>

        <span className="metric-sub">
          {counts
            ? uiText("{0} tệp học liệu đang quét",[counts.scanning_material_files])
            : uiText("Đang tải…")}
        </span>
      </div>    
      <Link
        className="stat-metric-card admin-approval-card"
        to="/ad/duyet-giang-vien"
      >
        <div className="metric-header">
          <span className="metric-title">{uiText("Yêu cầu giảng viên chờ duyệt")}</span>
          <MailCheck size={20} aria-hidden="true" />
        </div>

        <span className="metric-number">
          {counts?.pending_teacher_requests ?? '…'}
        </span>

        <span className="metric-sub">{uiText("Mở danh sách chờ duyệt")}</span>
      </Link>
    </>
  );
}