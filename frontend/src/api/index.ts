import { apiClient } from './client';
import type { components, paths } from './schema';

export * from './client';
export type { components, paths };

export async function fetchHealthLive(): Promise<components['schemas']['LivenessResponse']> {
  return apiClient.get('/api/v1/health/live');
}

export async function fetchHealthReady(): Promise<components['schemas']['ReadinessSuccessResponse']> {
  return apiClient.get('/api/v1/health/ready');
}

export * from './adminService';
export * from './assignmentsService';
export * from './authService';
export * from './coursesService';
export * from './filesService';
export * from './materialsService';
