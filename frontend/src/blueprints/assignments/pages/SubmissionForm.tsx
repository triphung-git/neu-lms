import {currentLocale} from '../../../shared/i18n/translate';
import {uiText} from "../../../shared/i18n/translate";
import { useState } from 'react';
import { assignmentsService } from '../../../api/assignmentsService';
import type { StoredFile } from '../../../api/filesService';
import { SecureFileUploader } from '../../files/components/SecureFileUploader';
import { mimeExtension } from '../adapters/httpAssignmentsAdapter';
import type { StudentAssignmentView } from '../contracts/assignmentsDto';

type Receipt = {
  number: number;
  submitted_at: string;
  is_late: boolean;
};

type Props = {
  assignment: StudentAssignmentView['assignment'];
  onSubmitted: () => void;
};

export function SubmissionForm({ assignment, onSubmitted }: Props) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<StoredFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  async function confirm() {
    if (!file || busy) return;

    setBusy(true);
    setError('');

    try {
      const result = await assignmentsService.submitAssignment(
        assignment.courseId,
        assignment.id,
        file.id,
      );

      setReceipt(result);
      onSubmitted();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : uiText("Chưa xác nhận được lần nộp. Bạn có thể thử lại.")
      );
    } finally {
      setBusy(false);
    }
  }

  if (receipt) {
    return (
      <p className="workflow-success" role="status">
        {uiText("Đã nộp ")}<strong>{file?.file_name}</strong>
        {' · '}{uiText("Lần ")}{receipt.number}
        {' · '}{new Date(receipt.submitted_at).toLocaleString(currentLocale())}
        {' · '}{receipt.is_late ? uiText("Nộp muộn") : uiText("Đúng hạn")}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        className="submission-start"
        type="button"
        data-testid="submit-assignment-btn"
        onClick={() => setOpen(true)}
      >
        {uiText("Nộp bài tập")}</button>
    );
  }

  return (
    <div className="submission-form">
      {!file ? (
        <SecureFileUploader
          courseId={assignment.courseId}
          assignmentId={assignment.id}
          purpose="assignment_submission"
          policy={{
            allowed_extensions:
              assignment.filePolicy.allowedMimeTypes.map(mimeExtension),
            max_file_size_bytes: assignment.filePolicy.maxFileSizeBytes,
          }}
          onUploadSuccess={setFile}
        />
      ) : (
        <>
          <p>{uiText("Tệp đã quét sạch: ")}<strong>{file.file_name}</strong></p>

          <button className="workflow-primary" type="button" disabled={busy} onClick={confirm}>
            {busy ? uiText("Đang xác nhận…") : uiText("Xác nhận nộp bài")}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setFile(null);
              setError('');
            }}
          >
            {uiText("Chọn tệp khác")}</button>
        </>
      )}

      {error && <p role="alert">{error}</p>}
    </div>
  );
}