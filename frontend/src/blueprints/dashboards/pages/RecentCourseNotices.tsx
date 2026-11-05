import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { apiClient } from '../../../api/client';
import './RecentCourseNotices.css';

type Notice = {
  id: number;
  course_id: string;
  course_name: string;
  title: string;
  published_at: string;
  is_read: boolean;
};

export function RecentCourseNotices() {
  const [items, setItems] = useState<Notice[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setItems(null);
    setError('');

    apiClient
      .untypedRequest<{ items: Notice[] }>('/api/v1/me/course-announcements', {
        params: { page: 1, page_size: 3 },
        signal: controller.signal,
      })
      .then(result => {
        if (!controller.signal.aborted) setItems(result.items);
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : uiText("Không tải được thông báo."),
          );
        }
      });

    return () => controller.abort();
  }, [attempt]);

  return (
    <section
      className="dash-card recent-course-notices"
      aria-labelledby="announcements-heading"
    >
      <div className="dash-card-header">
        <Bell className="card-title-icon" aria-hidden="true" />
        <h2 id="announcements-heading">{uiText("Thông báo môn học")}</h2>
        <Link to="/sv/thong-bao" className="card-view-all">
          {uiText("Xem tất cả")}</Link>
      </div>

      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setAttempt(n => n + 1)}>
            {uiText("Thử lại")}</button>
        </div>
      )}

      {!error && items === null && (
        <p role="status">{uiText("Đang tải thông báo…")}</p>
      )}

      {items?.length === 0 && <p>{uiText("Bạn chưa có thông báo môn học.")}</p>}

      {items && items.length > 0 && (
        <ul>
          {items.map(item => {
            const params = new URLSearchParams({
              mon: item.course_id,
              thongBao: String(item.id),
            });

            return (
              <li key={item.id}>
                <Link to={`/sv/thong-bao?${params.toString()}`}>
                  {item.title}
                </Link>
                <span>
                  {item.course_name} · {item.is_read ? uiText("Đã đọc") : uiText("Chưa đọc")}
                </span>
                <time dateTime={item.published_at}>
                  {new Date(item.published_at).toLocaleString(currentLocale())}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}