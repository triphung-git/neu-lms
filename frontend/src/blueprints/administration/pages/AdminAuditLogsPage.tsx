import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../../../api/client';
import { formatDateTimeVN } from '../../../shared/kernel/formatting';
import './AdminAuditLogsPage.css';

type Row = {
  id: string;
  occurred_at: string;
  actor_name: string;
  action: string;
  resource_type: string;
  resource_id: string;
  correlation_id: string;
};

type Listing = {
  items: Row[];
  pagination: {
    total_items: number;
    total_pages: number;
    page: number;
    has_next: boolean;
    has_previous: boolean;
  };
};

const empty = { search: '', start: '', end: '' };

export function AdminAuditLogsPage() {
  const [form, setForm] = useState(empty);
  const [filters, setFilters] = useState(empty);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');

    apiClient.untypedRequest<Listing>('/api/v1/admin/audit-log', {
      params: {
        page,
        page_size: 15,
        ...(filters.search ? { search: filters.search } : {}),
        ...(filters.start ? { start: filters.start } : {}),
        ...(filters.end ? { end: filters.end } : {}),
      },
      signal: controller.signal,
    })
      .then(result => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : uiText("Không tải được nhật ký."));
        }
      });

    return () => controller.abort();
  }, [filters, page, reload]);

  return (
    <section className="live-audit">
      <Link to="/ad">{uiText("← Tổng quan quản trị")}</Link>
      <h1>{uiText("Nhật ký hoạt động")}</h1>

      <form onSubmit={event => {
        event.preventDefault();
        setPage(1);
        setFilters({ ...form, search: form.search.trim() });
      }}>
        <label>
          {uiText("Tìm theo người, dịch vụ, hành động hoặc thực thể")}<input
            type="search"
            maxLength={120}
            value={form.search}
            onChange={e => setForm({ ...form, search: e.target.value })}
          />
        </label>

        <label>
          {uiText("Từ ngày")}<input
            type="date"
            value={form.start}
            max={form.end || undefined}
            onChange={e => setForm({ ...form, start: e.target.value })}
          />
        </label>

        <label>
          {uiText("Đến ngày")}<input
            type="date"
            value={form.end}
            min={form.start || undefined}
            onChange={e => setForm({ ...form, end: e.target.value })}
          />
        </label>

        <button type="submit">{uiText("Áp dụng")}</button>

        <button type="button" onClick={() => {
          setForm(empty);
          setFilters({ ...empty });
          setPage(1);
        }}>
          {uiText("Xóa lọc")}</button>
      </form>

      {error && (
        <div role="alert">
          {error}{' '}
          <button type="button" onClick={() => setReload(n => n + 1)}>
            {uiText("Thử lại")}</button>
        </div>
      )}

      {!error && !data && <p role="status">{uiText("Đang tải nhật ký…")}</p>}

      {data && (
        <>
          <p>{data.pagination.total_items} {uiText(" sự kiện phù hợp")}</p>

          {data.items.map(row => (
            <details key={row.id}>
              <summary>
                {formatDateTimeVN(row.occurred_at)} ·{' '}
                {row.actor_name || uiText("Chưa có tên")} · {row.action}
              </summary>
              <p>{uiText("Thực thể: ")}{row.resource_type}</p>
              <p>{uiText("Mã thực thể: ")}{row.resource_id}</p>
              <p>{uiText("Mã liên kết sự kiện: ")}{row.correlation_id}</p>
            </details>
          ))}

          {data.pagination.total_pages > 1 && (
            <nav aria-label={uiText("Phân trang nhật ký")}>
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
      )}
    </section>
  );
}