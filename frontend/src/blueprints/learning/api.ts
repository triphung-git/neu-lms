import {uiText} from "../../shared/i18n/translate";
import { apiClient, getCsrfToken } from "../../api/client";
import { filesService } from "../../api/filesService";
export const root = "/api/v1/learning";
export function get<T>(path: string, signal?: AbortSignal) {
  return apiClient.untypedRequest<T>(root + path, { method: "GET", signal });
}
export async function post(path: string, body: unknown) {
  if(!getCsrfToken()) await apiClient.untypedRequest('/api/v1/auth/csrf',{method:'GET'});
  return apiClient.untypedRequest(root + path, { method: "POST", body });
}
export async function remove(path: string) {
  if(!getCsrfToken()) await apiClient.untypedRequest('/api/v1/auth/csrf',{method:'GET'});
  return apiClient.untypedRequest(root + path, { method: "DELETE" });
}
export async function upload(course: string, file: File, assignment?: string) {
  const intent = await filesService.createUploadIntent(course, {
    purpose: assignment ? "assignment_submission" : "course_material",
    assignment_id: assignment,
    file_name: file.name,
    file_size: file.size,
  });
  await filesService.uploadContent(course, intent.file_id, file);
  await filesService.commitUpload(course, intent.file_id);
  for (let n = 0; n < 60; n++) {
    const item = await filesService.getFile(course, intent.file_id);
    if (item.status === "clean") return item.id;
    if (
      ["infected", "rejected", "deleted", "scan_failed"].includes(item.status)
    )
      throw new Error(uiText("Tệp không an toàn / File rejected."));
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(uiText("Tệp vẫn đang quét; thử lại sau / Scan still pending."));
}
