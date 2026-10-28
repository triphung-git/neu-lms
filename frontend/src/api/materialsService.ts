import { apiClient, getCsrfToken, type ApiClient } from './client';
import type { components } from './schema';

export type MaterialListItem = components['schemas']['MaterialListItem'];
export type MaterialDetail = components['schemas']['MaterialDetail'];
export type MaterialCreateRequest = components['schemas']['MaterialCreateRequestRequest'];
export type MaterialUpdateRequest = components['schemas']['PatchedMaterialUpdateRequestRequest'];
export type MaterialPublishRequest = components['schemas']['MaterialPublishRequestRequest'];
export type MaterialVersionSummary = components['schemas']['MaterialVersionSummary'];
export type MaterialVersionDetail = components['schemas']['MaterialVersionDetail'];
export type MaterialVersionCreateRequest =
  components['schemas']['MaterialVersionCreateRequestRequest'];
export type MaterialFileManifestItem = components['schemas']['MaterialFileManifestItem'];
export type MaterialFileAddRequest = components['schemas']['MaterialFileAddRequestRequest'];
export type PaginatedMaterialList = components['schemas']['PaginatedMaterialList'];
export type PaginatedMaterialSearchResult =
  components['schemas']['PaginatedMaterialSearchResult'];
export type MaterialSearchResult = components['schemas']['MaterialSearchResult'];

export interface ListMaterialsParams {
  chapter_id?: string;
  tag?: string;
  page?: number;
  page_size?: number;
}

export interface SearchMaterialsParams {
  q?: string;
  type?: string;
  chapter_id?: string;
  tag?: string;
  sort_by?: string;
  page?: number;
  page_size?: number;
}

export interface SearchGlobalMaterialsParams extends SearchMaterialsParams {
  course_id?: string;
}

export class MaterialsService {
  constructor(private readonly client: ApiClient = apiClient) {}
  private snapshots = new Map<string, string>();
  private remember = (data: MaterialDetail) => {
    this.snapshots.set(data.id, data.updated_at);
    return data;
  };
  private precondition(id: string): Record<string, string> {
    const snapshot = this.snapshots.get(id);
    return snapshot ? { 'If-Match': snapshot } : {};
  }

  listMaterials(
    courseId: string,
    params?: ListMaterialsParams,
  ): Promise<PaginatedMaterialList> {
    return this.client.untypedRequest<PaginatedMaterialList>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials`,
      { method: 'GET', params: params as Record<string, string | number | boolean | null | undefined> },
    ).then(page => { for (const item of page.items) this.snapshots.set(item.id, item.updated_at); return page; });
  }

  createMaterial(
    courseId: string,
    data: MaterialCreateRequest,
    commandKey?: string,
  ): Promise<MaterialDetail> {
    return this.client.untypedRequest<MaterialDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials`,
      { method: 'POST', body: data, headers: commandKey ? { 'Idempotency-Key': commandKey } : {} },
    ).then(this.remember);
  }

  getMaterial(courseId: string, materialId: string): Promise<MaterialDetail> {
    return this.client.untypedRequest<MaterialDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}`,
      { method: 'GET' },
    ).then(this.remember);
  }

  getMaterialById(materialId: string): Promise<MaterialDetail> {
    return this.client.untypedRequest<MaterialDetail>(
      `/api/v1/materials/${encodeURIComponent(materialId)}`,
      { method: 'GET' },
    ).then(this.remember);
  }

  updateMaterial(
    courseId: string,
    materialId: string,
    data: MaterialUpdateRequest,
  ): Promise<MaterialDetail> {
    return this.client.untypedRequest<MaterialDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}`,
      { method: 'PATCH', body: data, headers: this.precondition(materialId) },
    ).then(this.remember);
  }

  deleteMaterial(courseId: string, materialId: string): Promise<void> {
    return this.client.untypedRequest<void>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}`,
      { method: 'DELETE', headers: this.precondition(materialId) },
    );
  }

  listVersions(
    courseId: string,
    materialId: string,
  ): Promise<MaterialVersionSummary[]> {
    return this.client.untypedRequest<MaterialVersionSummary[]>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/versions`,
      { method: 'GET' },
    );
  }

  createRevision(
    courseId: string,
    materialId: string,
    data?: MaterialVersionCreateRequest,
    commandKey?: string,
  ): Promise<MaterialVersionDetail> {
    return this.client.untypedRequest<MaterialVersionDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/versions`,
      { method: 'POST', body: data || {}, headers: commandKey ? { 'Idempotency-Key': commandKey } : {} },
    );
  }

  getVersion(
    courseId: string,
    materialId: string,
    versionId: string,
  ): Promise<MaterialVersionDetail> {
    return this.client.untypedRequest<MaterialVersionDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/versions/${encodeURIComponent(versionId)}`,
      { method: 'GET' },
    );
  }

  addFileToVersion(
    courseId: string,
    materialId: string,
    versionId: string,
    data: MaterialFileAddRequest,
  ): Promise<MaterialFileManifestItem> {
    return this.client.untypedRequest<MaterialFileManifestItem>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/versions/${encodeURIComponent(versionId)}/files`,
      { method: 'POST', body: data },
    );
  }

  removeFileFromVersion(
    courseId: string,
    materialId: string,
    versionId: string,
    fileId: string,
  ): Promise<void> {
    return this.client.untypedRequest<void>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/versions/${encodeURIComponent(versionId)}/files/${encodeURIComponent(fileId)}`,
      { method: 'DELETE' },
    );
  }

  finalizeVersion(
    courseId: string,
    materialId: string,
    versionId: string,
  ): Promise<MaterialVersionDetail> {
    return this.client.untypedRequest<MaterialVersionDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/versions/${encodeURIComponent(versionId)}/finalize`,
      { method: 'POST' },
    );
  }

  retryExtraction(courseId: string, materialId: string, versionId: string): Promise<MaterialVersionDetail> {
    return this.client.untypedRequest<MaterialVersionDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/versions/${encodeURIComponent(versionId)}/retry`,
      { method: 'POST' },
    );
  }

  publishMaterial(
    courseId: string,
    materialId: string,
    data: MaterialPublishRequest,
  ): Promise<MaterialDetail> {
    return this.client.untypedRequest<MaterialDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/publish`,
      { method: 'POST', body: data, headers: this.precondition(materialId) },
    ).then(this.remember);
  }

  hideMaterial(courseId: string, materialId: string): Promise<MaterialDetail> {
    return this.client.untypedRequest<MaterialDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/hide`,
      { method: 'POST', headers: this.precondition(materialId) },
    ).then(this.remember);
  }

  unhideMaterial(courseId: string, materialId: string): Promise<MaterialDetail> {
    return this.client.untypedRequest<MaterialDetail>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/unhide`,
      { method: 'POST', headers: this.precondition(materialId) },
    ).then(this.remember);
  }

  async downloadMaterialFile(
    courseId: string,
    materialId: string,
    fileId: string,
  ): Promise<Blob> {
    const res = await fetch(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/files/${encodeURIComponent(fileId)}/download`,
      {
        method: 'GET',
        headers: {
          'X-CSRFToken': getCsrfToken() || '',
        },
      },
    );
    if (!res.ok) {
      throw new Error(`Tải tệp thất bại (HTTP ${res.status})`);
    }
    return res.blob();
  }

  async previewMaterialFile(
    courseId: string,
    materialId: string,
    fileId: string,
  ): Promise<Blob> {
    const res = await fetch(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}/files/${encodeURIComponent(fileId)}/preview`,
      {
        method: 'GET',
        headers: {
          'X-CSRFToken': getCsrfToken() || '',
        },
      },
    );
    if (!res.ok) {
      throw new Error(`Xem trước tệp thất bại (HTTP ${res.status})`);
    }
    return res.blob();
  }

  searchCourseMaterials(
    courseId: string,
    params?: SearchMaterialsParams,
  ): Promise<PaginatedMaterialSearchResult> {
    return this.client.untypedRequest<PaginatedMaterialSearchResult>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/materials/search`,
      { method: 'GET', params: params as Record<string, string | number | boolean | null | undefined> },
    );
  }

  searchGlobalMaterials(
    params?: SearchGlobalMaterialsParams,
  ): Promise<PaginatedMaterialSearchResult> {
    return this.client.untypedRequest<PaginatedMaterialSearchResult>(
      '/api/v1/materials/search',
      { method: 'GET', params: params as Record<string, string | number | boolean | null | undefined> },
    );
  }
}

export const materialsService = new MaterialsService();
