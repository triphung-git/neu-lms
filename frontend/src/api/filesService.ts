import { apiClient, type ApiClient } from './client';
import type { components } from './schema';

export type CourseFilePolicy = components['schemas']['CourseFilePolicy'];
export type CourseFilePolicyRequest = components['schemas']['CourseFilePolicyRequest'];
export type PatchedCourseFilePolicyRequest = components['schemas']['PatchedCourseFilePolicyRequest'];
export type StoredFile = components['schemas']['StoredFile'];
export type PaginatedStoredFileList = components['schemas']['PaginatedStoredFileList'];
export type UploadIntentRequest = components['schemas']['UploadIntentRequest'];
export type UploadIntentResponse = components['schemas']['UploadIntentResponse'];
export type CommitUploadRequest = components['schemas']['CommitUploadRequest'];
export type CommitUploadResponse = components['schemas']['CommitUploadResponse'];
export type UpdateFilePublishRequest = components['schemas']['PatchedUpdateFilePublishRequest'];

export interface ListFilesParams extends Record<string, string | number | boolean | null | undefined> {
  purpose?: string;
  page?: number;
  page_size?: number;
}

export class FilesService {
  constructor(private readonly client: ApiClient = apiClient) {}

  getFilePolicy(courseId: string): Promise<CourseFilePolicy> {
    return this.client.untypedRequest<CourseFilePolicy>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/file-policy`,
      { method: 'GET' },
    );
  }

  updateFilePolicy(
    courseId: string,
    data: PatchedCourseFilePolicyRequest,
  ): Promise<CourseFilePolicy> {
    return this.client.untypedRequest<CourseFilePolicy>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/file-policy`,
      { method: 'PATCH', body: data },
    );
  }

  listFiles(courseId: string, params?: ListFilesParams): Promise<PaginatedStoredFileList> {
    return this.client.untypedRequest<PaginatedStoredFileList>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/files`,
      { method: 'GET', params },
    );
  }

  createUploadIntent(
    courseId: string,
    data: UploadIntentRequest,
  ): Promise<UploadIntentResponse> {
    return this.client.untypedRequest<UploadIntentResponse>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/files/upload-intent`,
      { method: 'POST', body: data },
    );
  }

  uploadContent(courseId: string, fileId: string, file: File): Promise<void> {
    return this.client.untypedRequest<void>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/files/${encodeURIComponent(fileId)}/content`,
      { method: 'PUT', body: file, headers: { 'Content-Type': 'application/octet-stream' } },
    );
  }

  commitUpload(
    courseId: string,
    fileId: string,
    data?: CommitUploadRequest,
  ): Promise<CommitUploadResponse> {
    return this.client.untypedRequest<CommitUploadResponse>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/files/${encodeURIComponent(fileId)}/commit`,
      { method: 'POST', body: data || {} },
    );
  }

  getFile(courseId: string, fileId: string): Promise<StoredFile> {
    return this.client.untypedRequest<StoredFile>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/files/${encodeURIComponent(fileId)}`,
      { method: 'GET' },
    );
  }

  updatePublish(
    courseId: string,
    fileId: string,
    isPublished: boolean,
  ): Promise<StoredFile> {
    return this.client.untypedRequest<StoredFile>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/files/${encodeURIComponent(fileId)}`,
      { method: 'PATCH', body: { is_published: isPublished } },
    );
  }

  deleteFile(courseId: string, fileId: string): Promise<void> {
    return this.client.untypedRequest<void>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/files/${encodeURIComponent(fileId)}`,
      { method: 'DELETE' },
    );
  }

  getDownloadUrl(courseId: string, fileId: string): string {
    return `/api/v1/courses/${encodeURIComponent(courseId)}/files/${encodeURIComponent(fileId)}/download`;
  }

  getPreviewUrl(courseId: string, fileId: string): string {
    return `/api/v1/courses/${encodeURIComponent(courseId)}/files/${encodeURIComponent(fileId)}/preview`;
  }
}

export const filesService = new FilesService();
