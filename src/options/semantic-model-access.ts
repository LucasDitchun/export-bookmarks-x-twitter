export const SEMANTIC_MODEL_ORIGINS = Object.freeze([
  "https://huggingface.co/*",
  "https://*.cdn.hf.co/*",
]);

export interface SemanticModelAccess {
  contains(): Promise<boolean>;
  request(): Promise<boolean>;
  remove(): Promise<boolean>;
}

interface PermissionsApi {
  contains(permissions: { origins: string[] }): Promise<boolean>;
  request(permissions: { origins: string[] }): Promise<boolean>;
  remove(permissions: { origins: string[] }): Promise<boolean>;
}

export function createSemanticModelAccess(
  permissions: PermissionsApi,
): SemanticModelAccess {
  const context = (): { origins: string[] } => ({
    origins: [...SEMANTIC_MODEL_ORIGINS],
  });
  return {
    contains: () => permissions.contains(context()),
    request: () => permissions.request(context()),
    remove: () => permissions.remove(context()),
  };
}
