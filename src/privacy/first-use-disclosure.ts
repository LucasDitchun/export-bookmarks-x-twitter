export const FIRST_USE_DISCLOSURE_STORAGE_KEY = "firstUseDisclosure";
export const FIRST_USE_DISCLOSURE_VERSION = 1 as const;

interface DisclosureStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface FirstUseDisclosureStatus {
  accepted: boolean;
  version: typeof FIRST_USE_DISCLOSURE_VERSION;
}

interface StoredFirstUseDisclosure {
  version: typeof FIRST_USE_DISCLOSURE_VERSION;
  acceptedAt: string;
}

function isStoredDisclosure(value: unknown): value is StoredFirstUseDisclosure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    record.version !== FIRST_USE_DISCLOSURE_VERSION ||
    typeof record.acceptedAt !== "string"
  ) {
    return false;
  }
  const parsed = new Date(record.acceptedAt);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === record.acceptedAt;
}

export class FirstUseDisclosureRepository {
  constructor(private readonly storage: DisclosureStorage) {}

  async status(): Promise<FirstUseDisclosureStatus> {
    const stored = await this.storage.get(FIRST_USE_DISCLOSURE_STORAGE_KEY);
    return {
      accepted: isStoredDisclosure(stored[FIRST_USE_DISCLOSURE_STORAGE_KEY]),
      version: FIRST_USE_DISCLOSURE_VERSION,
    };
  }

  async accept(now = new Date()): Promise<FirstUseDisclosureStatus> {
    await this.storage.set({
      [FIRST_USE_DISCLOSURE_STORAGE_KEY]: {
        version: FIRST_USE_DISCLOSURE_VERSION,
        acceptedAt: now.toISOString(),
      } satisfies StoredFirstUseDisclosure,
    });
    return { accepted: true, version: FIRST_USE_DISCLOSURE_VERSION };
  }
}
