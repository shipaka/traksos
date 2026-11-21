/**
 * Retired in-process service demo.
 *
 * The former module shipped static orders, fake prices and a mock API in the
 * production JavaScript bundle whenever the admin opened a training address.
 * Its legacy exports remain temporarily for source compatibility with the
 * live Base* components; they NEVER activate a simulated cabinet.
 *
 * The only supported preview is the same-code, separate-database,
 * authenticated 12-role sandbox. Delete these compatibility exports only
 * after removing all historical imports in a dedicated audited cleanup.
 */
import { ApiError } from '../api.ts';

export const SERVICE_PREVIEW_ROOT = 'admin/test-center/service';
export function inServicePreview(): false { return false; }
export function servicePreviewPath(path: string): string {
  return path.replace(/^\\/+/, '');
}
export function servicePreviewHref(path: string): string {
  return '#/' + servicePreviewPath(path);
}
export function resetServicePreview(): void { /* Historical local mock data no longer exists. */ }
export async function previewServiceApi(_method: string, _path: string, _body: any = {}): Promise<never> {
  throw new ApiError(410,'legacy_demo_retired',
    'Учебная копия СТО закрыта. Используйте настоящий изолированный тестовый кабинет.');
}
