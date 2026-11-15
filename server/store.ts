import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  Conversation,
  DeletedTracker,
  MemoryCategory,
  MemoryItem,
  WillioModule,
  WillioStoreData,
} from '../src/types/willio.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
const DEFAULT_STORE_PATH = path.join(DATA_DIR, 'willio-store.json');

const DEFAULT_MODULES: WillioModule[] = [
  {
    id: 'mod-dialectique',
    name: 'Esprit critique & Dialectique',
    description:
      "Pousse WILLIO à confronter les hypothèses, repérer les biais logiques et proposer un contre-argument structuré.",
    instruction:
      "Analyse systématiquement les angles morts de la question et propose, si pertinent, une objection argumentée avant de conclure.",
    enabled: true,
    builtin: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'mod-traditions',
    name: 'Synthèse des Traditions & Hermétisme',
    description:
      'Relie les questions philosophiques et existentielles aux traditions éthiopiennes, hermétiques, orientales et abrahamiques.',
    instruction:
      'Quand la question touche au sens, à la conscience ou aux symboles, éclaire-la en comparant avec tact les traditions anciennes sans dogmatisme.',
    enabled: true,
    builtin: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'mod-ingenierie',
    name: 'Architecture & Code sobre',
    description:
      'Optimise les réponses techniques pour des architectures légères, sécurisées et adaptées aux appareils modestes (Android 10, 3 Go RAM).',
    instruction:
      'Pour toute question technique ou de programmation, privilégie la sobriété, la sécurité, la clarté du code complet et la faible consommation mémoire.',
    enabled: true,
    builtin: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

const CORE_MEMORY_IDS = new Set(['mem-founder', 'mem-spiritual-identity']);

const DEFAULT_MEMORIES: MemoryItem[] = [
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

export function normalizeEmailKey(email?: string | null): string {
  return (email ?? '').trim().toLowerCase();
}

function getStorePath(email?: string | null): string {
  const normalized = normalizeEmailKey(email);
  if (!normalized) {
    return DEFAULT_STORE_PATH;
  }
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  return path.join(PROFILES_DIR, `${hash}.json`);
}

function ensureStoreFile(storePath: string): void {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(storePath)) {
    const initial: WillioStoreData = {
      conversations: [],
      memories: [...DEFAULT_MEMORIES],
      modules: [...DEFAULT_MODULES],
      deleted: { conversations: [], memories: [], modules: [] },
      lastSyncedAt: new Date().toISOString(),
    };
    writeStore(initial, undefined, storePath);
  }
}

function hydrateCoreMemories(
  memories: MemoryItem[],
  deletedMemories: string[] = []
): MemoryItem[] {
  const deletedSet = new Set(deletedMemories);
  const existingIds = new Set(memories.map((m) => m.id));
  const result = [...memories];
  for (const core of DEFAULT_MEMORIES) {
    if (!existingIds.has(core.id) && !deletedSet.has(core.id)) {
      result.push(core);
    }
  }
  return result;
}

export function readStore(email?: string | null): WillioStoreData {
  const storePath = getStorePath(email);
  ensureStoreFile(storePath);
  try {
    const raw = fs.readFileSync(storePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WillioStoreData>;
    const deleted = parsed.deleted ?? { conversations: [], memories: [], modules: [] };
    const rawMemories = Array.isArray(parsed.memories) ? parsed.memories : [...DEFAULT_MEMORIES];
    return {
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      memories: hydrateCoreMemories(rawMemories, deleted.memories),
      modules: Array.isArray(parsed.modules) ? parsed.modules : [...DEFAULT_MODULES],
      deleted,
      lastSyncedAt: parsed.lastSyncedAt ?? new Date().toISOString(),
    };
  } catch {
    return {
      conversations: [],
      memories: [...DEFAULT_MEMORIES],
      modules: [...DEFAULT_MODULES],
      deleted: { conversations: [], memories: [], modules: [] },
      lastSyncedAt: new Date().toISOString(),
    };
  }
}

export function writeStore(
  data: WillioStoreData,
  email?: string | null,
  explicitPath?: string
): void {
  const storePath = explicitPath ?? getStorePath(email);
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload: WillioStoreData = {
    conversations: data.conversations,
    memories: data.memories,
    modules: data.modules,
    deleted: data.deleted ?? { conversations: [], memories: [], modules: [] },
    lastSyncedAt: new Date().toISOString(),
  };
  const tmpPath = `${storePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmpPath, storePath);
}

function mergeDeleted(a?: DeletedTracker, b?: DeletedTracker): DeletedTracker {
  const cap = (arr: string[]) => Array.from(new Set(arr)).slice(-300);
  return {
    conversations: cap([...(a?.conversations ?? []), ...(b?.conversations ?? [])]),
    memories: cap([...(a?.memories ?? []), ...(b?.memories ?? [])]),
    modules: cap([...(a?.modules ?? []), ...(b?.modules ?? [])]),
  };
}

export function syncEmailStore(
  email: string | null | undefined,
  incoming: Partial<WillioStoreData>
): WillioStoreData {
  const current = readStore(email);
  const deleted = mergeDeleted(current.deleted, incoming.deleted);
  const deletedConvSet = new Set(deleted.conversations);
  const deletedMemSet = new Set(deleted.memories);
  const deletedModSet = new Set(deleted.modules);

  // Merge conversations by id (keep whichever has more messages or newer updatedAt)
  const convMap = new Map<string, Conversation>();
  for (const c of [...current.conversations, ...(incoming.conversations ?? [])]) {
    if (!c?.id || deletedConvSet.has(c.id)) continue;
    const prev = convMap.get(c.id);
    if (!prev) {
      convMap.set(c.id, c);
    } else if (
      c.messages.length > prev.messages.length ||
      (c.messages.length === prev.messages.length && c.updatedAt > prev.updatedAt)
    ) {
      convMap.set(c.id, c);
    }
  }
  const conversations = Array.from(convMap.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );

  // Merge memories by id and normalized content
  const memMap = new Map<string, MemoryItem>();
  const seenContent = new Set<string>();
  for (const m of [...current.memories, ...(incoming.memories ?? [])]) {
    if (!m?.id || deletedMemSet.has(m.id)) continue;
    const norm = m.content.trim().toLowerCase();
    if (!norm) continue;
    const existing = memMap.get(m.id);
    if (existing) {
      if (m.updatedAt > existing.updatedAt) memMap.set(m.id, m);
    } else if (!seenContent.has(norm)) {
      seenContent.add(norm);
      memMap.set(m.id, m);
    }
  }
  const memories = Array.from(memMap.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );

  // Merge modules by id
  const modMap = new Map<string, WillioModule>();
  for (const mod of [...current.modules, ...(incoming.modules ?? [])]) {
    if (!mod?.id || deletedModSet.has(mod.id)) continue;
    modMap.set(mod.id, mod);
  }
  const modules = Array.from(modMap.values());

  const merged: WillioStoreData = {
    conversations,
    memories,
    modules,
    deleted,
    lastSyncedAt: new Date().toISOString(),
  };
  writeStore(merged, email);
  return merged;
}

export function upsertMemory(
  content: string,
  category: MemoryCategory,
  source: 'auto' | 'manuel' | 'correction',
  email?: string | null
): MemoryItem {
  const store = readStore(email);
  const normalized = content.trim().toLowerCase();
  const existing = store.memories.find(
    (m) => m.content.trim().toLowerCase() === normalized
  );
  const now = new Date().toISOString();
  if (existing) {
    existing.category = category;
    existing.source = source;
    existing.updatedAt = now;
    writeStore(store, email);
    return existing;
  }

  const item: MemoryItem = {
    id: `mem-${crypto.randomUUID().slice(0, 8)}`,
    content: content.trim(),
    category,
    source,
    createdAt: now,
    updatedAt: now,
  };
  store.memories.unshift(item);
  writeStore(store, email);
  return item;
}

export function upsertConversation(
  conversation: Conversation,
  email?: string | null
): Conversation {
  const store = readStore(email);
  const idx = store.conversations.findIndex((c) => c.id === conversation.id);
  if (idx >= 0) {
    store.conversations[idx] = conversation;
  } else {
    store.conversations.unshift(conversation);
  }
  if (store.deleted) {
    store.deleted.conversations = store.deleted.conversations.filter(
      (id) => id !== conversation.id
    );
  }
  writeStore(store, email);
  return conversation;
}

export function markDeleted(
  type: keyof DeletedTracker,
  id: string,
  email?: string | null
): void {
  const store = readStore(email);
  const deleted = store.deleted ?? { conversations: [], memories: [], modules: [] };
  if (!deleted[type].includes(id)) {
    deleted[type].push(id);
  }
  store.deleted = deleted;
  writeStore(store, email);
}

export function clearAllMemoriesOnly(email?: string | null): WillioStoreData {
  const store = readStore(email);
  const deletedIds = store.memories
    .filter((m) => !CORE_MEMORY_IDS.has(m.id))
    .map((m) => m.id);
  const deleted = store.deleted ?? { conversations: [], memories: [], modules: [] };
  deleted.memories = Array.from(new Set([...deleted.memories, ...deletedIds])).slice(-300);
  store.memories = [...DEFAULT_MEMORIES];
  store.deleted = deleted;
  writeStore(store, email);
  return store;
}

export function clearAllData(email?: string | null): WillioStoreData {
  const fresh: WillioStoreData = {
    conversations: [],
    memories: [...DEFAULT_MEMORIES],
    modules: [...DEFAULT_MODULES],
    deleted: { conversations: [], memories: [], modules: [] },
    lastSyncedAt: new Date().toISOString(),
  };
  writeStore(fresh, email);
  return fresh;
}
