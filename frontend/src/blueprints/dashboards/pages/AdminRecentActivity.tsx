import {uiText} from "../../../shared/i18n/translate";
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { apiClient } from '../../../api/client';
import { formatDateTimeVN } from '../../../shared/kernel/formatting';

type AuditRow = {
  id: string;
  occurred_at: string;
  actor_name: string;
  action: string;
  resource_type: string;
};

export function AdminRecentActivity() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setRows(null);
    setError('');

    apiClient
      .untypedRequest<AuditRow[]>('/api/v1/admin/recent-activity', {
        signal: controller.signal,
      })
      .then(data => {
        if (!controller.signal.aborted) setRows(data);
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : uiText("Không tải được nhật ký."));
        }
      });

    return () => controller.abort();
  }, [reload]);

  return (
    <section
      className="dash-card admin-recent-activity"
      aria-labelledby="audit-heading"
    >
      <div className="dash-card-header">
        <Activity className="card-title-icon" aria-hidden="true" />
        <h2 id="audit-heading">{uiText("Nhật ký hoạt động gần đây")}</h2>
        <Link to="/ad/nhat-ky" className="card-view-all">
          {uiText("Xem toàn bộ")}</Link>
        <button type="button" onClick={() => setReload(n => n + 1)}>
          {uiText("Làm mới")}</button>
      </div>

      {error && <p role="alert">{error}</p>}
      {!rows && !error && <p role="status">{uiText("Đang tải nhật ký…")}</p>}
      {rows?.length === 0 && <p>{uiText("Chưa có sự kiện nào được ghi nhận.")}</p>}

      {rows && rows.length > 0 && (
        <div
          className="audit-table-wrapper"
          tabIndex={0}
          role="region"
          aria-label={uiText("Bảng sự kiện gần đây")}
        >
          <table className="mini-data-table">
            <thead>
              <tr>
                <th>{uiText("Thời gian")}</th>
                <th>{uiText("Người hoặc dịch vụ")}</th>
                <th>{uiText("Hành động")}</th>
                <th>{uiText("Thực thể")}</th>
              </tr>
            </thead>

            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td>
                    <time dateTime={row.occurred_at}>
                      {formatDateTimeVN(row.occurred_at)}
                    </time>
                  </td>
                  <td>{row.actor_name || uiText("Không có tên hiển thị")}</td>
                  <td><code>{row.action}</code></td>
                  <td>{row.resource_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}