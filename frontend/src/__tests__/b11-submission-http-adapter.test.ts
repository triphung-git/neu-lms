import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssignmentsService,
  assignmentsService,
} from '../api/assignmentsService';
import { apiClient } from '../api/client';
import { HttpAssignmentsAdapter } from '../blueprints/assignments/adapters/httpAssignmentsAdapter';

describe('B11: secure submission HTTP integration', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('posts the uploaded clean file id to the course-scoped submission endpoint', async () => {
    const receipt = {
      id: 23,
      file_id: '00000000-0000-4000-8000-000000000023',
      number: 2,
      submitted_at: '2026-11-03T01:00:00+07:00',
      is_late: false,
    };
    const request = vi
      .spyOn(apiClient, 'untypedRequest')
      .mockResolvedValue(receipt);

    await expect(
      assignmentsService.submitAssignment(
        'course-1',
        'assignment-1',
        receipt.file_id,
      ),
    ).resolves.toEqual(receipt);

    expect(request).toHaveBeenCalledWith(
      '/api/v1/courses/course-1/assignments/assignment-1/submissions',
      expect.objectContaining({
        method: 'POST',
        body: { file_id: receipt.file_id },
      }),
    );
  });

  it('resolves course id and maps the server receipt in the assignments port', async () => {
    const service = {
      getAssignmentDirect: vi.fn().mockResolvedValue({ course_id: 'course-2' }),
      submitAssignment: vi.fn().mockResolvedValue({
        id: 24,
        file_id: 'file-24',
        number: 3,
        submitted_at: '2026-11-03T01:05:00+07:00',
        is_late: true,
      }),
    } as unknown as AssignmentsService;
    const adapter = new HttpAssignmentsAdapter(service);

    const result = await adapter.submitAssignment({
      assignmentId: 'assignment-2',
      studentId: 'legacy-student-id',
      file: { filename: 'answer.pdf', size: 1024, id: 'file-24' },
    });

    expect(service.getAssignmentDirect).toHaveBeenCalledWith('assignment-2', {
      signal: undefined,
    });
    expect(service.submitAssignment).toHaveBeenCalledWith(
      'course-2',
      'assignment-2',
      'file-24',
      { signal: undefined, idempotencyKey: undefined },
    );
    expect(result).toEqual({
      ok: true,
      data: {
        revisionNumber: 3,
        submittedAt: '2026-11-03T01:05:00+07:00',
      },
    });
  });

  it('rejects a submission request without a secure uploaded file id', async () => {
    const service = {
      getAssignmentDirect: vi.fn(),
      submitAssignment: vi.fn(),
    } as unknown as AssignmentsService;
    const adapter = new HttpAssignmentsAdapter(service);

    const result = await adapter.submitAssignment({
      assignmentId: 'assignment-3',
      studentId: 'legacy-student-id',
      file: { filename: 'answer.pdf', size: 1024 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(service.submitAssignment).not.toHaveBeenCalled();
  });
});
