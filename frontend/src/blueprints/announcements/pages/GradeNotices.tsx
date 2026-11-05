import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../../../api/client';
import type { components } from '../../../api/schema';
import './GradeNotices.css';
import { refreshGradeBadge } from '../useUnreadGradeCount';

type Listing = components['schemas']['GradeNoticeList'];

export function GradeNotices() {
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState('');

    const [saving, setSaving] = useState<number | 'all' | null>(null);
  const [message, setMessage] = useState('');

  async function markRead(id: number | 'all') {
    if (saving !== null) return;

    setSaving(id);
    setError('');
    setMessage('');

    try {
      if (id === 'all') {
        const result = await apiClient.untypedRequest<{ updated_count: number }>(
          '/api/v1/me/grade-notices/read-all',
          { method: 'POST' },
        );

        setMessage(
          result.updated_count > 0
            ? uiText("Đã đánh dấu {0} thông báo điểm là đã đọc.",[result.updated_count])
            : uiText("Tất cả thông báo điểm đã được đọc."),
        );
      } else {
        await apiClient.untypedRequest<void>(
          `/api/v1/me/grade-notices/${id}/read`,
          { method: 'POST' },
        );
      }

      setReload(n => n + 1);
      refreshGradeBadge();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : uiText("Không đánh dấu được thông báo."),
      );
    } finally {
      setSaving(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');

    apiClient.untypedRequest<Listing>('/api/v1/me/grade-notices', {
      params: { page, page_size: 5 },
      signal: controller.signal,
    })
      .then(result => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : uiText("Không tải được thông báo điểm."),
          );
        }
      });

    return () => controller.abort();
  }, [page, reload]);

  return (
    <section className="grade-notices" aria-label={uiText("Thông báo điểm")}>
      <header>
        <h2>{uiText("Điểm vừa công bố")}</h2>
        <button
          type="button"
          onClick={() => {
            setPage(1);
            setReload(n => n + 1);
            refreshGradeBadge();
        }}
        >
          {uiText("Làm mới")}</button>

        <button
          type="button"
          className="grade-notices-read-all"
          disabled={saving !== null || !data?.pagination.total_items}
          onClick={() => void markRead('all')}
        >
          {saving === 'all'
            ? uiText("Đang lưu…")
            : uiText("Đánh dấu tất cả thông báo điểm đã đọc")}
        </button>
      </header>

        {message && (
        <p role="status" className="grade-notices-result">
          {message}
        </p>
      )}

      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">{uiText("Đang tải thông báo điểm…")}</p>}

      {data && (
        data.items.length === 0 ? (
          <p>{uiText("Chưa có lần công bố điểm nào.")}</p>
        ) : (
          <>
            <ol>
              {data.items.map(item => (
                <li key={item.id} className={item.read_at ? 'notice-read' : 'notice-unread'}>
                    {item.read_at ? (
                        <small>{uiText("Đã đọc")}</small>
                    ) : (
                      <button
                        type="button"
                        disabled={saving !== null}
                        onClick={() => void markRead(item.id)}
                      >
                        {saving === item.id ? uiText("Đang lưu…") : uiText("Đánh dấu đã đọc")}
                      </button>
                    )}
                  <strong>{item.title} · {item.score} {uiText(" điểm")}</strong>
                  <span>{item.course_name} {uiText(" · Lần nộp ")}{item.revision}</span>
                  <time dateTime={item.published_at}>
                    {new Date(item.published_at).toLocaleString(currentLocale())}
                  </time>
                  <Link to={`/sv/mon-hoc/${item.course_id}/bai-tap/${item.assignment_id}`}>
                    {uiText("Mở bài tập")}</Link>
                </li>
              ))}
            </ol>

            {data.pagination.total_pages > 1 && (
              <nav aria-label={uiText("Phân trang thông báo điểm")}>
                <button
                  type="button"
                  disabled={!data.pagination.has_previous}
                  onClick={() => setPage(n => n - 1)}
                >
                  {uiText("Trước")}</button>
                <span>Trang {data.pagination.page}/{data.pagination.total_pages}</span>
                <button
                  type="button"
                  disabled={!data.pagination.has_next}
                  onClick={() => setPage(n => n + 1)}
                >
                  Sau
                </button>
              </nav>
            )}
          </>
        )
      )}
    </section>
  );
}