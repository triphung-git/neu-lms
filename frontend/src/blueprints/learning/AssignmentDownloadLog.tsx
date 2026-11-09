import type { Hub } from './LearningHub';
import { Downloads } from './WorkflowPanels';
import { Load, useData } from './ui';
import { useLanguage } from './i18n';
import './learning.css';
import './AssignmentDownloadLog.css';

export function AssignmentDownloadLog({ courseId }: { courseId: string }) {
  const { t } = useLanguage();
  const state = useData<Hub>(`/courses/${courseId}`);
  return <section className="assignment-download-log learning-card" id="assignment-download-log" aria-labelledby="download-log-title">
    <h2 id="download-log-title">{t('Lịch sử tải tài liệu bài tập', 'Assignment download history')}</h2>
    {!state.data ? <Load {...state} /> : state.data.manager
      ? <Downloads key={courseId} path={`/courses/${courseId}`} hub={state.data} />
      : <p role="alert">{t('Bạn không có quyền xem log của môn học này.', 'You cannot view this course download log.')}</p>}
  </section>;
}
