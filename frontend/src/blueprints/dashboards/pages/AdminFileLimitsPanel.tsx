import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useState } from 'react';
import { apiClient } from '../../../api/client';

type Limits = {
  max_file_bytes: number;
  max_course_quota_bytes: number;
  default_file_bytes: number;
  default_course_quota_bytes: number;
  default_extensions: string[];
};

function size(bytes: number, unit: 'MiB' | 'GiB') {
  const divisor = unit === 'MiB' ? 1024 ** 2 : 1024 ** 3;

  return (
    (bytes / divisor).toLocaleString(currentLocale(), {
      maximumFractionDigits: 2,
    }) + ' ' + unit
  );
}

export function AdminFileLimitsPanel() {
  const [data, setData] = useState<Limits | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');

    apiClient
      .untypedRequest<Limits>('/api/v1/admin/file-limits', {
        signal: controller.signal,
      })
      .then(result => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : uiText("Không tải được giới hạn tệp."),
          );
        }
      });

    return () => controller.abort();
  }, [attempt]);

  return (
    <section
      className="dash-card admin-file-limits"
      aria-labelledby="file-limits-heading"
    >
      <h2 id="file-limits-heading">{uiText("Giới hạn tệp và dung lượng môn học")}</h2>

      {error && (
        <div role="alert">
          {error}{' '}
          <button type="button" onClick={() => setAttempt(n => n + 1)}>
            {uiText("Thử lại")}</button>
        </div>
      )}

      {!data && !error && <p role="status">{uiText("Đang tải giới hạn…")}</p>}

      {data && (
        <>
          <dl>
            <div>
              <dt>{uiText("Dung lượng tối đa mỗi tệp")}</dt>
              <dd>{size(data.max_file_bytes, 'MiB')}</dd>
            </div>
            <div>
              <dt>{uiText("Hạn mức tối đa mỗi môn")}</dt>
              <dd>{size(data.max_course_quota_bytes, 'GiB')}</dd>
            </div>
            <div>
              <dt>{uiText("Mặc định mỗi tệp của môn mới")}</dt>
              <dd>{size(data.default_file_bytes, 'MiB')}</dd>
            </div>
            <div>
              <dt>{uiText("Dung lượng mặc định mỗi môn mới")}</dt>
              <dd>{size(data.default_course_quota_bytes, 'GiB')}</dd>
            </div>
            <div>
              <dt>{uiText("Định dạng mặc định")}</dt>
              <dd>{data.default_extensions.join(', ')}</dd>
            </div>
          </dl>

          <p>{uiText("Từng môn hoặc bài tập có thể áp dụng giới hạn nhỏ hơn.")}</p>
        </>
      )}
    </section>
  );
}