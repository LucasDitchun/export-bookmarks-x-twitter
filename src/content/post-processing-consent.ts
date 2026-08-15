interface PostProcessingRuntime {
  stop(): void;
}

interface PostProcessingConsentDependencies {
  loadAccepted(): Promise<boolean>;
  start(): PostProcessingRuntime;
  retryDelay?: () => Promise<void>;
}

export interface PostProcessingConsentGate {
  initialize(): Promise<void>;
  enable(): void;
  stop(): void;
}

export function createPostProcessingConsentGate(
  dependencies: PostProcessingConsentDependencies,
): PostProcessingConsentGate {
  let runtime: PostProcessingRuntime | null = null;
  let stopped = false;

  const enable = (): void => {
    if (stopped || runtime) return;
    runtime = dependencies.start();
  };
  const retryDelay =
    dependencies.retryDelay ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

  return {
    async initialize() {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          if (await dependencies.loadAccepted()) enable();
          return;
        } catch (error) {
          if (attempt === 1) throw error;
          await retryDelay();
        }
      }
    },
    enable,
    stop() {
      stopped = true;
      runtime?.stop();
      runtime = null;
    },
  };
}
