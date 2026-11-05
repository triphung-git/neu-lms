import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import { useEffect, useState } from 'react';
import { apiClient } from '../../../api/client';
import { GradeHistory } from './GradeHistory';
import { RubricBreakdown } from './RubricBreakdown';
import {
  readScore,
  rubricResult,
  type Criterion,
  type Mark,
} from './rubricScores';

type Grade = {
  version: number;
  score: string;
  feedback: string;
  status: 'draft' | 'published';
  created_at: string;
  rubric_breakdown: Mark[];
};

type Detail = {
  total_score: string;
  grade: Grade | null;
  rubric: Criterion[];
};

type Props = {
  submissionId: string | number;
  editable?: boolean;
};

export function SubmissionGradePanel({
  submissionId,
  editable = false,
}: Props) {
  return (
    <Panel
      key={`${submissionId}-${editable}`}
      submissionId={submissionId}
      editable={editable}
    />
  );
}

function Panel({ submissionId, editable }: Props) {
  const [data, setData] = useState<Detail | null>(null);
  const [useRubric, setUseRubric] = useState(false);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const [mustReload, setMustReload] = useState(false);

  const url =
    `/api/v1/submissions/${encodeURIComponent(submissionId)}/grade`;

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    setMessage('');

    apiClient.untypedRequest<Detail>(url, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;

        const saved = result.grade?.rubric_breakdown ?? [];

        setData(result);
        setMarks(Object.fromEntries(
          saved.map(item => [item.criterion_id, item.score]),
        ));
        setUseRubric(
          result.rubric.length > 0 && (!result.grade || saved.length > 0),
        );
        setScore(result.grade?.score ?? '');
        setFeedback(result.grade?.feedback ?? '');
        setMustReload(false);
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : uiText("Không tải được điểm."));
        }
      });

    return () => controller.abort();
  }, [url, reload]);

  async function save(status: Grade['status']) {
    if (!data || busy || mustReload) return;
    setError('');
    setMessage('');

    let points;
    try {
      points = useRubric
        ? { rubric_scores: rubricResult(data.rubric, marks).scores }
        : { score: (readScore(score, data.total_score, uiText("Điểm tổng")) / 100).toFixed(2) };
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText("Điểm không hợp lệ."));
      return;
    }

    setBusy(true);

    try {
      const grade = await apiClient.untypedRequest<Grade>(url, {
        method: 'POST',
        body: {
          ...points,
          feedback,
          status,
          expected_version: data.grade?.version ?? 0,
        },
      });

      setData({ ...data, grade });
      setScore(grade.score);
      setFeedback(grade.feedback);
      setMessage(status === 'published' ? uiText("Đã công bố điểm.") : uiText("Đã lưu nháp."));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : uiText("Không xác nhận được kết quả lưu."),
      );
      setMustReload(true);
    } finally {
      setBusy(false);
    }
  }

  let preview = uiText("Chưa đủ điểm hợp lệ");

  if (data && useRubric) {
    try {
      preview = `${rubricResult(data.rubric, marks).total} / ${data.total_score}`;
    } catch {
      // Khi bấm lưu, hàm save sẽ hiện tên tiêu chí cần sửa.
    }
  }

  return (
    <div className="grade-panel" aria-busy={busy}>
      {error && <p role="alert">{error}</p>}
      {message && <p className="workflow-success" role="status">{message}</p>}
      {!data && !error && <p role="status">{uiText("Đang tải điểm…")}</p>}

      {data && (
        <>
          <p>
            {data.grade
              ? `${data.grade.status === 'published' ? uiText("Đã công bố") : uiText("Bản nháp")}: ${data.grade.score}/${data.total_score}`
              : uiText("Chưa có điểm được công bố.")}
          </p>

          {editable ? (
            <>
              {data.rubric.length > 0 && (
                <label>
                  {uiText("Cách chấm")}<select
                    className="rubric-mode"
                    disabled={busy || mustReload}
                    value={useRubric ? 'rubric' : 'total'}
                    onChange={event => setUseRubric(event.target.value === 'rubric')}
                  >
                    <option value="rubric">{uiText("Theo tiêu chí")}</option>
                    <option value="total">{uiText("Nhập điểm tổng")}</option>
                  </select>
                </label>
              )}

              {useRubric ? (
                <fieldset className="rubric-editor" disabled={busy || mustReload}>
                  <legend>{uiText("Điểm theo tiêu chí")}</legend>

                  {data.rubric.map(item => (
                    <label key={item.id}>
                      {item.title} / {item.max_score}
                      <input
                        inputMode="decimal"
                        value={marks[item.id] ?? ''}
                        onChange={event => {
                          const value = event.target.value;
                          setMarks(prev => ({ ...prev, [item.id]: value }));
                        }}
                      />
                    </label>
                  ))}

                  <output>{uiText("Tổng: ")}{preview}</output>
                </fieldset>
              ) : (
                <label>
                  {uiText("Điểm / ")}{data.total_score}
                  <input
                    inputMode="decimal"
                    value={score}
                    disabled={busy || mustReload}
                    onChange={event => setScore(event.target.value)}
                  />
                </label>
              )}

              <label>
                {uiText("Nhận xét")}<textarea
                  rows={3}
                  maxLength={10000}
                  value={feedback}
                  disabled={busy || mustReload}
                  onChange={event => setFeedback(event.target.value)}
                />
              </label>

              <button
                type="button"
                disabled={busy || mustReload}
                onClick={() => void save('draft')}
              >
                {uiText("Lưu nháp")}</button>

              <button
                className="workflow-primary"
                type="button"
                disabled={busy || mustReload}
                onClick={() => void save('published')}
              >
                {uiText("Công bố điểm")}</button>

              {busy && <p role="status">{uiText("Đang lưu…")}</p>}
            </>
          ) : data.grade && (
            <>
              <RubricBreakdown marks={data.grade.rubric_breakdown} />
              <p style={{ whiteSpace: 'pre-wrap' }}>
                {data.grade.feedback || uiText("Chưa có nhận xét.")}
              </p>
              <small>
                {uiText("Công bố lúc ")}{new Date(data.grade.created_at).toLocaleString(currentLocale())}
              </small>
            </>
          )}
        </>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => setReload(value => value + 1)}
      >
        {editable ? uiText("Tải lại điểm đã lưu") : uiText("Cập nhật điểm")}
      </button>

      {editable && <small>{uiText("Tải lại sẽ bỏ phần chỉnh sửa chưa lưu.")}</small>}

      {data && (
        <GradeHistory
          submissionId={submissionId}
          version={data.grade?.version ?? 0}
        />
      )}
    </div>
  );
}