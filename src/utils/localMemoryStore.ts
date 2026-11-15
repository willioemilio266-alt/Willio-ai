import type { DeletedTracker, MemoryItem, WillioStoreData } from '../types/willio';

const ACTIVE_EMAIL_KEY = 'willio_sync_email_v1';
const STORE_PREFIX = 'willio_memory_store_v1:';

export const CORE_LOCAL_MEMORIES: MemoryItem[] = [
  {
    id: 'mem-founder',
    content: 'Le fondateur de WILLIO est RANDRIANANTENAINA Emilio Berthino Charles.',
    category: 'identité',
    source: 'manuel',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'mem-spiritual-identity',
    content:
      "Identité spirituelle de WILLIO : les enseignements de l'Académie de l'Éveil (https://academiedeleveil.simdif.com/) — éveil de la conscience, âmes stellaires, vies antérieures, égrégores, Kundalini, chakras et libération de la conscience — constituent les fondements philosophiques et la référence spirituelle majeure de WILLIO (sans prétendre être humain ni avoir de foi personnelle).",
    category: 'spiritualité',
    source: 'manuel',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

function hydrateCoreMemories(
  memories: MemoryItem[],
  deletedMemories: string[] = []
): MemoryItem[] {
  const deletedSet = new Set(deletedMemories);
  const existingIds = new Set(memories.map((m) => m.id));
  const result = [...memories];
  for (const core of CORE_LOCAL_MEMORIES) {
    if (!existingIds.has(core.id) && !deletedSet.has(core.id)) {
      result.push(core);
    }
  }
  return result;
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

export function getSavedSyncEmail(): string {
  try {
    return normalizeEmail(localStorage.getItem(ACTIVE_EMAIL_KEY));
  } catch {
    return '';
  }
}

export function saveSyncEmail(email: string): string {
  const normalized = normalizeEmail(email);
  try {
    if (normalized) {
      localStorage.setItem(ACTIVE_EMAIL_KEY, normalized);
    } else {
      localStorage.removeItem(ACTIVE_EMAIL_KEY);
    }
  } catch {
    // ignore storage quota errors
  }
  return normalized;
}

function getStoreKey(email: string): string {
  const normalized = normalizeEmail(email);
  return `${STORE_PREFIX}${normalized || 'local'}`;
}

export function loadLocalStore(email: string): WillioStoreData | null {
  try {
    const raw = localStorage.getItem(getStoreKey(email));
    if (!raw) {
      // Fallback to legacy cache if switching for the first time
      const legacy = localStorage.getItem('willio_offline_cache');
      if (!legacy) {
        return {
          conversations: [],
          memories: [...CORE_LOCAL_MEMORIES],
          modules: [],
          deleted: { conversations: [], memories: [], modules: [] },
        };
      }
      const parsedLegacy = JSON.parse(legacy) as Partial<WillioStoreData>;
      return {
        conversations: Array.isArray(parsedLegacy.conversations)
          ? parsedLegacy.conversations
          : [],
        memories: hydrateCoreMemories(
          Array.isArray(parsedLegacy.memories) ? parsedLegacy.memories : [],
          parsedLegacy.deleted?.memories
        ),
        modules: Array.isArray(parsedLegacy.modules) ? parsedLegacy.modules : [],
        deleted: parsedLegacy.deleted,
        lastSyncedAt: parsedLegacy.lastSyncedAt,
      };
    }
    const parsed = JSON.parse(raw) as Partial<WillioStoreData>;
    return {
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      memories: hydrateCoreMemories(
        Array.isArray(parsed.memories) ? parsed.memories : [],
        parsed.deleted?.memories
      ),
      modules: Array.isArray(parsed.modules) ? parsed.modules : [],
      deleted: parsed.deleted,
      lastSyncedAt: parsed.lastSyncedAt,
    };
  } catch {
    return null;
  }
}

export function saveLocalStore(email: string, data: WillioStoreData): void {
  const payload: WillioStoreData = {
    conversations: data.conversations,
    memories: data.memories,
    modules: data.modules,
    deleted: data.deleted ?? { conversations: [], memories: [], modules: [] },
    lastSyncedAt: data.lastSyncedAt ?? new Date().toISOString(),
  };
  try {
    localStorage.setItem(getStoreKey(email), JSON.stringify(payload));
    localStorage.setItem('willio_offline_cache', JSON.stringify(payload));
  } catch {
    // Trim oldest conversation messages if Android storage quota is tight
    try {
      const compact: WillioStoreData = {
        ...payload,
        conversations: payload.conversations.slice(0, 30),
      };
      localStorage.setItem(getStoreKey(email), JSON.stringify(compact));
    } catch {
      // ignore
    }
  }
}

export function clearLocalStore(email: string): void {
  try {
    localStorage.removeItem(getStoreKey(email));
    localStorage.removeItem('willio_offline_cache');
  } catch {
    // ignore
  }
}

export function emptyDeletedTracker(): DeletedTracker {
  return { conversations: [], memories: [], modules: [] };
}
