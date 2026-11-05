import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useId, useState } from 'react';
import { apiClient } from '../../../api/client';
import './GradeHistory.css';
import { RubricBreakdown } from './RubricBreakdown';
import type { Mark } from './rubricScores';

type Props = {
  submissionId: string | number;
  version: number;
};

type History = {
  items: {
    version: number;
    score: string;
    feedback: string;
    status: 'draft' | 'published';
    created_at: string;
    rubric_breakdown: Mark[];
  }[];
  pagination: {
    page: number;
    total_pages: number;
    total_items: number;
    has_next: boolean;
    has_previous: boolean;
  };
};

export function GradeHistory({ submissionId, version }: Props) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <div className="grade-history">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(value => !value)}
      >
        {open ? uiText("Ẩn lịch sử chấm điểm") : uiText("Xem lịch sử chấm điểm")}
      </button>

      <div id={contentId} hidden={!open}>
        {open && (
          <HistoryList
            key={`${submissionId}-${version}`}
            submissionId={submissionId}
          />
        )}
      </div>
    </div>
  );
}

function HistoryList({
  submissionId,
}: {
  submissionId: string | number;
}) {
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    setData(null);
    setError('');

    apiClient
      .untypedRequest<History>(
        `/api/v1/submissions/${encodeURIComponent(submissionId)}/grade-history`,
        {
          params: { page },
          signal: controller.signal,
        },
      )
      .then(result => {
        if (!controller.signal.aborted) {
          setData(result);
        }
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : uiText("Không tải được lịch sử."),
          );
        }
      });

    return () => controller.abort();
  }, [submissionId, page, reload]);

  return (
    <div className="grade-history-body">
      <button
        type="button"
        onClick={() => setReload(value => value + 1)}
      >
        {uiText("Làm mới lịch sử")}</button>

      {error && <p role="alert">{error}</p>}

      {!data && !error && (
        <p role="status">{uiText("Đang tải lịch sử…")}</p>
      )}

      {data && (
        <>
          <p>{data.pagination.total_items} {uiText(" bản ghi có thể xem")}</p>

          {data.items.length === 0 ? (
            <p>{uiText("Chưa có lịch sử chấm điểm được phép xem.")}</p>
          ) : (
            <ol className="grade-history-list">
              {data.items.map(item => (
                <li key={item.version}>
                  <div className="grade-history-heading">
                    <strong>
                      {uiText("Phiên bản ")}{item.version} · {item.score} {uiText(" điểm")}</strong>

                    <span
                      className={`grade-history-status ${item.status}`}
                    >
                      {item.status === 'published'
                        ? uiText("Đã công bố")
                        : uiText("Nháp")}
                    </span>
                  </div>

                  <time dateTime={item.created_at}>
                    {new Date(item.created_at).toLocaleString(currentLocale())}
                  </time>

                  <RubricBreakdown marks={item.rubric_breakdown} />

                  <p className="grade-history-feedback">
                    {item.feedback || uiText("Không có nhận xét.")}
                  </p>
                </li>
              ))}
            </ol>
          )}

          {data.pagination.total_pages > 1 && (
            <nav aria-label={uiText("Phân trang lịch sử điểm")}>
              <button
                type="button"
                disabled={!data.pagination.has_previous}
                onClick={() => setPage(value => value - 1)}
              >
                {uiText("Trước")}</button>

              <span>
                Trang {data.pagination.page}/
                {data.pagination.total_pages}
              </span>

              <button
                type="button"
                disabled={!data.pagination.has_next}
                onClick={() => setPage(value => value + 1)}
              >
                Sau
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}