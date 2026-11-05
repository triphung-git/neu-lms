import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import {
  aiSummaryDraftService,
  type MaterialSummaryDraft,
} from '../api/aiAssistantService';

const draft: MaterialSummaryDraft = {
  id: '00000000-0000-4000-8000-000000000101',
  course_id: '00000000-0000-4000-8000-000000000001',
  course_code: 'WEB101',
  course_name: 'Phát triển Web',
  material_id: '00000000-0000-4000-8000-000000000201',
  material_title: 'Giáo trình Web',
  material_version_id: '00000000-0000-4000-8000-000000000301',
  version_number: 2,
  summary: 'Tóm tắt cần được giảng viên rà soát.',
  source_file_names: ['web101.pdf'],
  status: 'pending',
  created_at: '2026-11-03T01:00:00+07:00',
  reviewed_at: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('B14 AI summary draft service', () => {
  it('loads drafts belonging to the current teacher', async () => {
    const request = vi.spyOn(apiClient, 'untypedRequest').mockResolvedValue([draft]);

    await expect(aiSummaryDraftService.list()).resolves.toEqual([draft]);
    expect(request).toHaveBeenCalledWith('/api/v1/ai/teacher/summary-drafts', {
      method: 'GET',
    });
  });

  it('creates a summary draft for one selected course material', async () => {
    const request = vi.spyOn(apiClient, 'untypedRequest').mockResolvedValue(draft);

    await expect(
      aiSummaryDraftService.create(draft.course_id, draft.material_id),
    ).resolves.toEqual(draft);
    expect(request).toHaveBeenCalledWith(
      `/api/v1/ai/courses/${draft.course_id}/materials/${draft.material_id}/summary-drafts`,
      { method: 'POST' },
    );
  });

  it('sends an edited summary only when the teacher confirms it', async () => {
    const request = vi.spyOn(apiClient, 'untypedRequest').mockResolvedValue({
      ...draft,
      summary: 'Bản tóm tắt đã được giảng viên duyệt.',
      status: 'confirmed',
      reviewed_at: '2026-11-03T01:10:00+07:00',
    });

    await aiSummaryDraftService.review(
      draft.id,
      'confirmed',
      'Bản tóm tắt đã được giảng viên duyệt.',
    );

    expect(request).toHaveBeenCalledWith(
      `/api/v1/ai/teacher/summary-drafts/${draft.id}/review`,
      {
        method: 'POST',
        body: {
          status: 'confirmed',
          summary: 'Bản tóm tắt đã được giảng viên duyệt.',
        },
      },
    );
  });

  it('can discard a draft without sending edited text', async () => {
    const request = vi.spyOn(apiClient, 'untypedRequest').mockResolvedValue({
      ...draft,
      status: 'discarded',
      reviewed_at: '2026-11-03T01:10:00+07:00',
    });

    await aiSummaryDraftService.review(draft.id, 'discarded');

    expect(request).toHaveBeenCalledWith(
      `/api/v1/ai/teacher/summary-drafts/${draft.id}/review`,
      {
        method: 'POST',
        body: { status: 'discarded', summary: undefined },
      },
    );
  });
});
