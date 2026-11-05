import { apiClient } from './client';

export interface CourseChatCitation {
  id: string;
  material_id: string;
  file_id?: string;
  version_id?: string;
  file_hash?: string;
  material_title: string;
  course_code: string;
  course_name: string;
  file_name: string;
  page_number: number | null;
  excerpt: string;
}

export interface CourseChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CourseChatResponse {
  answer: string;
  citations: CourseChatCitation[];
  course: {
    id: string;
    code: string;
    name: string;
  };
}

export interface SavedChatTurn {
  id: number;
  request_id: string;
  question: string;
  answer: string;
  citations: CourseChatCitation[];
  created_at: string;
}

export const aiAssistantService = {
  history(courseId: string, signal?: AbortSignal): Promise<SavedChatTurn[]> {
    return apiClient.untypedRequest(`/api/v1/ai/courses/${encodeURIComponent(courseId)}/chat/history`, { signal });
  },
  clear(courseId: string): Promise<void> {
    return apiClient.untypedRequest(`/api/v1/ai/courses/${encodeURIComponent(courseId)}/chat/history`, { method: 'DELETE' });
  },
  chat(
    courseId: string,
    question: string,
    history?: CourseChatHistoryMessage[],
    requestId?: string,
  ): Promise<CourseChatResponse> {
    return apiClient.untypedRequest<CourseChatResponse>(
      `/api/v1/ai/courses/${encodeURIComponent(courseId)}/chat`,
      {
        method: 'POST',
        body: { question, ...(history ? { history: history.slice(-8) } : {}),
          ...(requestId ? { request_id: requestId } : {}) },
      },
    );
  },
};

export interface MaterialSummaryDraft {
  id: string;
  course_id: string;
  course_code: string;
  course_name: string;
  material_id: string;
  material_title: string;
  material_version_id: string;
  version_number: number;
  summary: string;
  source_file_names: string[];
  status: 'pending' | 'confirmed' | 'discarded';
  created_at: string;
  reviewed_at: string | null;
}

export const aiSummaryDraftService = {
  async list(courseId?:string): Promise<MaterialSummaryDraft[]> {
    const all:MaterialSummaryDraft[]=[];
    for(let page=1;;page++){
      const rows=await apiClient.untypedRequest<MaterialSummaryDraft[]>('/api/v1/ai/teacher/summary-drafts', {method:'GET', ...(courseId||page>1?{params:{course_id:courseId,page}}:{})});
      all.push(...rows);if(rows.length<100)return all;
    }
  },

  create(courseId: string, materialId: string): Promise<MaterialSummaryDraft> {
    return apiClient.untypedRequest<MaterialSummaryDraft>(
      `/api/v1/ai/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/summary-drafts`,
      { method: 'POST' },
    );
  },

  review(
    draftId: string,
    status: 'confirmed' | 'discarded',
    summary?: string,
  ): Promise<MaterialSummaryDraft> {
    return apiClient.untypedRequest<MaterialSummaryDraft>(
      `/api/v1/ai/teacher/summary-drafts/${encodeURIComponent(draftId)}/review`,
      {
        method: 'POST',
        body: { status, summary },
      },
    );
  },
};
