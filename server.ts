import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  ThinkingLevel,
  Type,
} from '@google/genai';
import {
  clearAllData,
  clearAllMemoriesOnly,
  markDeleted,
  normalizeEmailKey,
  readStore,
  syncEmailStore,
  upsertConversation,
  upsertMemory,
  writeStore,
} from './server/store.ts';
import {
  buildWillioSystemInstruction,
  isSpecialInvociomCommand,
  SPECIAL_INVOCIOM_REPLY,
} from './server/willioPrompt.ts';
import type {
  AttachedDocument,
  ChatMessage,
  Conversation,
  MemoryCategory,
  MemoryItem,
  WebSource,
  WillioModule,
  WillioStoreData,
} from './src/types/willio.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getReqEmail(req: express.Request): string {
  const headerEmail =
    typeof req.headers['x-willio-email'] === 'string'
      ? req.headers['x-willio-email']
      : '';
  const queryEmail = typeof req.query.email === 'string' ? req.query.email : '';
  const bodyEmail =
    req.body && typeof (req.body as { email?: unknown }).email === 'string'
      ? (req.body as { email: string }).email
      : '';
  return normalizeEmailKey(bodyEmail || headerEmail || queryEmail);
}

function getAiClient(apiVersion?: 'v1' | 'v1beta' | 'v1alpha'): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Clé API Gemini absente côté serveur. Veuillez configurer GEMINI_API_KEY dans les secrets de l'environnement."
    );
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      ...(apiVersion ? { apiVersion } : {}),
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatApiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('PERMISSION_DENIED') || raw.includes('403') || raw.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message:
        'Clé API invalide ou refusée. Vérifiez la variable GEMINI_API_KEY dans Settings > Secrets.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message:
        'Quota API temporairement atteint. Réessayez dans quelques instants ou vérifiez votre forfait API.',
    };
  }
  if (raw.includes('NOT_FOUND') || raw.includes('404')) {
    return {
      status: 404,
      message: 'Modèle IA introuvable ou indisponible.',
    };
  }
  return {
    status: 500,
    message: raw || 'Erreur interne du serveur WILLIO.',
  };
}

async function detectAndSaveMemory(
  ai: GoogleGenAI,
  userMessage: string,
  assistantReply: string,
  email?: string
): Promise<string | null> {
  try {
    if (userMessage.trim().length < 8) return null;

    const extractionPrompt = `Analyse cet échange entre l'utilisateur (souvent le fondateur RANDRIANANTENAINA Emilio Berthino Charles) et WILLIO.
Détermine si l'utilisateur a :
1. Donné une information importante et durable sur le fondateur, ses projets, ses objectifs, son identité, son métier, ses préférences ou ses croyances spirituelles, OU
2. Corrigé une erreur ou demandé une mise à jour de connaissance de WILLIO.

Ne sauvegarde PAS les questions banales, salutations ou demandes ponctuelles sans valeur durable.
Si oui, résume l'information en une seule phrase courte, factuelle et précise en français (ex. : "Le projet X du fondateur consiste à...", "L'utilisateur préfère...", ou sous forme de fait corrigé).

Message utilisateur : "${userMessage}"
Réponse WILLIO : "${assistantReply.slice(0, 600)}"`;

    const res = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: extractionPrompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            shouldSave: { type: Type.BOOLEAN },
            isCorrection: { type: Type.BOOLEAN },
            category: {
              type: Type.STRING,
              description:
                "Une valeur parmi: identité, préférence, correction, connaissance, spiritualité, projet",
            },
            fact: { type: Type.STRING },
          },
          required: ['shouldSave', 'isCorrection', 'category', 'fact'],
        },
      },
    });

    const parsed = JSON.parse((res.text ?? '{}').trim()) as {
      shouldSave?: boolean;
      isCorrection?: boolean;
      category?: string;
      fact?: string;
    };

    if (!parsed.shouldSave || !parsed.fact || parsed.fact.trim().length < 4) {
      return null;
    }

    const allowedCategories: MemoryCategory[] = [
      'identité',
      'préférence',
      'correction',
      'connaissance',
      'spiritualité',
      'projet',
    ];
    const cat = allowedCategories.includes(parsed.category as MemoryCategory)
      ? (parsed.category as MemoryCategory)
      : parsed.isCorrection
        ? 'correction'
        : 'connaissance';

    const saved = upsertMemory(
      parsed.fact,
      cat,
      parsed.isCorrection ? 'correction' : 'auto',
      email
    );
    return saved.content;
  } catch {
    return null;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin &&
      (origin === 'https://localhost' ||
        origin === 'capacitor://localhost' ||
        origin.startsWith('http://localhost') ||
        origin.startsWith('http://127.0.0.1') ||
        (process.env.APP_URL && origin === process.env.APP_URL))
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-willio-email');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: 'WILLIO',
      aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  app.get('/api/state', (req, res) => {
    const email = getReqEmail(req);
    const store = readStore(email);
    res.json(store);
  });

  app.post('/api/sync', (req, res) => {
    const email = getReqEmail(req);
    const { store: incomingStore } = req.body as {
      store?: Partial<WillioStoreData>;
    };
    const merged = syncEmailStore(email, incomingStore ?? {});
    res.json(merged);
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const email = getReqEmail(req);
      const {
        conversationId,
        message,
        useWebSearch = false,
        deepThinking = false,
        attachment,
        clientMemories,
        clientMessages,
      } = req.body as {
        conversationId?: string;
        message?: string;
        useWebSearch?: boolean;
        deepThinking?: boolean;
        attachment?: AttachedDocument | null;
        clientMemories?: MemoryItem[];
        clientMessages?: ChatMessage[];
      };

      const userText = typeof message === 'string' ? message.trim() : '';
      if (!userText && !attachment) {
        res.status(400).json({ error: 'Message ou document requis.' });
        return;
      }

      const store = readStore(email);
      // Merge any local memories/messages sent from client localStorage if not yet synced
      if (Array.isArray(clientMemories) && clientMemories.length > 0) {
        for (const cm of clientMemories) {
          if (cm?.content && !store.memories.some((m) => m.id === cm.id)) {
            store.memories.push(cm);
          }
        }
      }

      const now = new Date().toISOString();
      let conversation: Conversation | undefined = store.conversations.find(
        (c) => c.id === conversationId
      );

      if (!conversation) {
        const titleSource = userText || attachment?.name || 'Nouvelle discussion';
        conversation = {
          id: conversationId || `conv-${crypto.randomUUID().slice(0, 8)}`,
          title:
            titleSource.length > 48
              ? `${titleSource.slice(0, 48).trim()}...`
              : titleSource,
          createdAt: now,
          updatedAt: now,
          messages: Array.isArray(clientMessages) ? clientMessages : [],
        };
      } else if (
        Array.isArray(clientMessages) &&
        clientMessages.length > conversation.messages.length
      ) {
        conversation.messages = clientMessages;
      }

      const userMsg: ChatMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        role: 'user',
        content: userText || `Analyse le document joint : ${attachment?.name}`,
        createdAt: now,
        attachmentName: attachment?.name,
      };

      // Commande spéciale INVOCIOM / Invociom
      if (!attachment && isSpecialInvociomCommand(userText)) {
        const replyMsg: ChatMessage = {
          id: `msg-${crypto.randomUUID().slice(0, 8)}`,
          role: 'assistant',
          content: SPECIAL_INVOCIOM_REPLY,
          createdAt: new Date().toISOString(),
        };
        conversation.messages.push(userMsg, replyMsg);
        conversation.updatedAt = replyMsg.createdAt;
        upsertConversation(conversation, email);

        res.json({
          conversation,
          reply: replyMsg,
          memorySaved: null,
        });
        return;
      }

      const ai = getAiClient();
      const systemInstruction = buildWillioSystemInstruction(
        store.memories,
        store.modules,
        email
      );

      // Build conversation contents (recent 16 turns to keep Android/server lean)
      const historySlice = conversation.messages.slice(-16);
      const contents: Array<{
        role: string;
        parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
      }> = historySlice.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const currentParts: Array<
        { text: string } | { inlineData: { mimeType: string; data: string } }
      > = [];

      if (attachment) {
        if (attachment.base64Data && attachment.mimeType) {
          currentParts.push({
            inlineData: {
              mimeType: attachment.mimeType,
              data: attachment.base64Data,
            },
          });
          currentParts.push({
            text: `[Document joint : ${attachment.name} (${attachment.mimeType})]`,
          });
        } else if (attachment.textContent) {
          const clipped = attachment.textContent.slice(0, 45000);
          currentParts.push({
            text: `[Contenu du document "${attachment.name}"]\n${clipped}\n[Fin du document]`,
          });
        }
      }

      currentParts.push({
        text: userText || `Lis et résume précisément le document "${attachment?.name}".`,
      });

      contents.push({
        role: 'user',
        parts: currentParts,
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction,
          thinkingConfig: {
            thinkingLevel: deepThinking ? ThinkingLevel.HIGH : ThinkingLevel.LOW,
          },
          ...(useWebSearch ? { tools: [{ googleSearch: {} }] } : {}),
        },
      });

      const replyText =
        response.text?.trim() ||
        "Je n'ai pas pu formuler de réponse pour l'instant. Peux-tu reformuler ?";

      // Extract web grounding sources if Google Search was used
      const rawChunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const seenUris = new Set<string>();
      const sources: WebSource[] = [];
      for (const chunk of rawChunks) {
        const uri = chunk?.web?.uri;
        const title = chunk?.web?.title;
        if (uri && !seenUris.has(uri)) {
          seenUris.add(uri);
          sources.push({
            uri,
            title: title || uri,
          });
        }
      }

      const memorySaved = await detectAndSaveMemory(ai, userText, replyText, email);

      const replyMsg: ChatMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        role: 'assistant',
        content: replyText,
        createdAt: new Date().toISOString(),
        sources: sources.length > 0 ? sources : undefined,
        usedWebSearch: Boolean(useWebSearch),
        memorySaved,
      };

      conversation.messages.push(userMsg, replyMsg);
      conversation.updatedAt = replyMsg.createdAt;
      upsertConversation(conversation, email);

      res.json({
        conversation,
        reply: replyMsg,
        memorySaved,
      });
    } catch (err) {
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // French warm male voice synthesis with expressive human intonation
  app.post('/api/tts', async (req, res) => {
    try {
      const {
        text,
        voiceName = 'Charon',
        tone = 'chat',
      } = req.body as {
        text?: string;
        voiceName?: 'Charon' | 'Fenrir';
        tone?: 'chat' | 'reaction';
      };

      const cleanText = (text ?? '')
        .replace(/```[\s\S]*?```/g, ' — bloc de code — ')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/^\s*[-*•]\s+/gm, ', ')
        .replace(/^\s*\d+\.\s+/gm, ', ')
        .replace(/[*_`#>]/g, '')
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n+/g, ', ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 2200);

      if (!cleanText) {
        res.status(400).json({ error: 'Texte vide pour la synthèse vocale.' });
        return;
      }

      const ai = getAiClient('v1beta');
      const selectedVoice = voiceName === 'Fenrir' ? 'Fenrir' : 'Charon';

      const stylePrompt =
        tone === 'reaction'
          ? "Voix d'homme français naturelle et expressive, ton amusé, complice et légèrement sarcastique, avec une intonation humaine vive, de micro-pauses naturelles et aucun accent robotique"
          : /[!?]{1,}|…/.test(cleanText)
            ? "Voix d'homme français grave, chaleureuse et vivante, intonation humaine authentique avec variations naturelles de hauteur et de rythme, respirations discrètes, pauses respectées sur la ponctuation, comme une vraie conversation orale"
            : "Voix d'homme français posée, grave et chaleureuse, élocution naturelle et humaine, cadence fluide avec légères inflexions conversationnelles et pauses respiratoires naturelles, jamais monotone ni synthétique";

      const buildTtsRequest = (model: string) => ({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanText,
                speechMetadata: {
                  style: stylePrompt,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

      let response;
      try {
        response = await ai.models.generateContent(
          buildTtsRequest('gemini-3.8-flash-tts')
        );
      } catch {
        response = await ai.models.generateContent(
          buildTtsRequest('gemini-3.8-flash-lite-tts')
        );
      }

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!base64Audio) {
        res.status(502).json({ error: 'Aucun flux audio généré par le moteur vocal.' });
        return;
      }

      res.json({
        audioBase64: base64Audio,
        mimeType: 'audio/wav',
      });
    } catch (err) {
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Audio transcription for voice input fallback
  app.post('/api/transcribe', async (req, res) => {
    try {
      const { audioBase64, mimeType = 'audio/webm' } = req.body as {
        audioBase64?: string;
        mimeType?: string;
      };

      if (!audioBase64) {
        res.status(400).json({ error: 'Données audio manquantes.' });
        return;
      }

      const ai = getAiClient('v1beta');
      const parts = [
        {
          inlineData: {
            mimeType,
            data: audioBase64,
          },
        },
        {
          text: 'Transcribe this audio verbatim in French. Return only the spoken words.',
        },
      ];

      let response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: { parts },
      });

      let transcript = (response.text ?? '').trim();
      if (!transcript) {
        // Fallback to gemini-4-hydrogen audio understanding if transcribe model returns empty
        const aiDefault = getAiClient();
        response = await aiDefault.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: audioBase64,
                },
              },
              {
                text: "Transcris fidèlement les paroles prononcées en français dans cet audio. Retourne uniquement les mots prononcés, ou une chaîne vide s'il n'y a que du silence.",
              },
            ],
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });
        transcript = (response.text ?? '').trim();
      }

      res.json({ text: transcript });
    } catch (err) {
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Conversation history management
  app.patch('/api/conversations/:id', (req, res) => {
    const email = getReqEmail(req);
    const store = readStore(email);
    const conv = store.conversations.find((c) => c.id === req.params.id);
    if (!conv) {
      res.status(404).json({ error: 'Conversation introuvable.' });
      return;
    }
    const { title } = req.body as { title?: string };
    if (title && title.trim()) {
      conv.title = title.trim().slice(0, 80);
      conv.updatedAt = new Date().toISOString();
      writeStore(store, email);
    }
    res.json(conv);
  });

  app.delete('/api/conversations/:id', (req, res) => {
    const email = getReqEmail(req);
    const store = readStore(email);
    store.conversations = store.conversations.filter((c) => c.id !== req.params.id);
    writeStore(store, email);
    markDeleted('conversations', req.params.id, email);
    res.json({ ok: true });
  });

  // Persistent Memory CRUD
  app.post('/api/memories', (req, res) => {
    const email = getReqEmail(req);
    const { content, category = 'connaissance', source = 'manuel' } = req.body as {
      content?: string;
      category?: MemoryCategory;
      source?: 'auto' | 'manuel' | 'correction';
    };
    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Contenu de mémoire requis.' });
      return;
    }
    const item = upsertMemory(content, category, source, email);
    res.json(item);
  });

  app.patch('/api/memories/:id', (req, res) => {
    const email = getReqEmail(req);
    const store = readStore(email);
    const item = store.memories.find((m) => m.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Mémoire introuvable.' });
      return;
    }
    const { content, category } = req.body as {
      content?: string;
      category?: MemoryCategory;
    };
    if (content && content.trim()) item.content = content.trim();
    if (category) item.category = category;
    item.updatedAt = new Date().toISOString();
    writeStore(store, email);
    res.json(item);
  });

  app.delete('/api/memories/:id', (req, res) => {
    const email = getReqEmail(req);
    const store = readStore(email);
    store.memories = store.memories.filter((m) => m.id !== req.params.id);
    writeStore(store, email);
    markDeleted('memories', req.params.id, email);
    res.json({ ok: true });
  });

  app.post('/api/memories/clear', (req, res) => {
    const email = getReqEmail(req);
    const updated = clearAllMemoriesOnly(email);
    res.json(updated);
  });

  // Extensible Modules CRUD
  app.post('/api/modules', (req, res) => {
    const email = getReqEmail(req);
    const { name, description, instruction } = req.body as {
      name?: string;
      description?: string;
      instruction?: string;
    };
    if (!name?.trim() || !instruction?.trim()) {
      res.status(400).json({ error: 'Nom et instruction du module requis.' });
      return;
    }
    const store = readStore(email);
    const mod: WillioModule = {
      id: `mod-${crypto.randomUUID().slice(0, 8)}`,
      name: name.trim(),
      description: (description ?? '').trim() || 'Module personnalisé WILLIO.',
      instruction: instruction.trim(),
      enabled: true,
      builtin: false,
      createdAt: new Date().toISOString(),
    };
    store.modules.unshift(mod);
    writeStore(store, email);
    res.json(mod);
  });

  app.patch('/api/modules/:id', (req, res) => {
    const email = getReqEmail(req);
    const store = readStore(email);
    const mod = store.modules.find((m) => m.id === req.params.id);
    if (!mod) {
      res.status(404).json({ error: 'Module introuvable.' });
      return;
    }
    const { enabled, name, description, instruction } = req.body as Partial<WillioModule>;
    if (typeof enabled === 'boolean') mod.enabled = enabled;
    if (name && name.trim()) mod.name = name.trim();
    if (typeof description === 'string') mod.description = description.trim();
    if (instruction && instruction.trim()) mod.instruction = instruction.trim();
    writeStore(store, email);
    res.json(mod);
  });

  app.delete('/api/modules/:id', (req, res) => {
    const email = getReqEmail(req);
    const store = readStore(email);
    store.modules = store.modules.filter((m) => m.id !== req.params.id);
    writeStore(store, email);
    markDeleted('modules', req.params.id, email);
    res.json({ ok: true });
  });

  // Data export & clear (Data Protection / Sovereignty)
  app.get('/api/data/export', (req, res) => {
    const email = getReqEmail(req);
    const store = readStore(email);
    res.setHeader('Content-Disposition', 'attachment; filename="willio-donnees.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      founder: 'RANDRIANANTENAINA Emilio Berthino Charles',
      syncEmail: email || null,
      ...store,
    });
  });

  app.post('/api/data/clear', (req, res) => {
    const email = getReqEmail(req);
    const fresh = clearAllData(email);
    res.json(fresh);
  });

  // Append transcribed voice turns (Gemini Live) into shared written history
  app.post('/api/conversations/append', (req, res) => {
    const email = getReqEmail(req);
    const { conversationId, userText, assistantText } = req.body as {
      conversationId?: string;
      userText?: string;
      assistantText?: string;
    };

    const uText = (userText ?? '').trim();
    const aText = (assistantText ?? '').trim();
    if (!uText && !aText) {
      res.status(400).json({ error: 'Contenu vocal vide.' });
      return;
    }

    const store = readStore(email);
    const now = new Date().toISOString();
    let conversation = store.conversations.find((c) => c.id === conversationId);
    if (!conversation) {
      const seed = uText || aText;
      conversation = {
        id: conversationId || `conv-${crypto.randomUUID().slice(0, 8)}`,
        title: seed.length > 48 ? `${seed.slice(0, 48).trim()}...` : seed,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
    }

    if (uText) {
      conversation.messages.push({
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        role: 'user',
        content: uText,
        createdAt: now,
      });
    }
    if (aText) {
      conversation.messages.push({
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        role: 'assistant',
        content: aText,
        createdAt: new Date().toISOString(),
      });
    }
    conversation.updatedAt = new Date().toISOString();
    upsertConversation(conversation, email);
    res.json({ conversation });
  });

  // Vite dev middleware vs production static serving
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });

    // When HMR/WS is disabled in middlewareMode, Vite 8's @vite/client still
    // calls transport.connect() to port 24678; strip that call so no failing
    // WebSocket connection is attempted while keeping CSS/HMR helper exports.
    app.get('/@vite/client', async (req, res, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result) {
          next();
          return;
        }
        const patched = result.code
          .replace('transport.connect(createHMRHandler(handleMessage));', '')
          .replace('setupForwardConsoleHandler(transport, forwardConsole);', '')
          .replace(
            'else throw new SendBeforeConnectError("send was called before connect");',
            'else return;'
          )
          .replace(
            'else throw new SendBeforeConnectError("invoke was called before connect");',
            'else return;'
          );
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.send(patched);
      } catch (err) {
        next(err);
      }
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  const liveWss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/ws/live') {
        liveWss.handleUpgrade(request, socket, head, (ws) => {
          liveWss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  });

  liveWss.on('connection', async (clientWs: WebSocket, request) => {
    let session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let clientClosed = false;

    clientWs.on('close', () => {
      clientClosed = true;
      try {
        session?.close();
      } catch {
        // ignore
      }
      session = null;
    });

    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host || 'localhost'}`);
      const email = normalizeEmailKey(url.searchParams.get('email'));
      const conversationId = url.searchParams.get('conversationId') || '';
      const voiceParam = url.searchParams.get('voice');
      const selectedVoice = voiceParam === 'Fenrir' ? 'Fenrir' : 'Charon';

      const store = readStore(email);
      const conv = store.conversations.find((c) => c.id === conversationId);
      const recentContext = conv?.messages.length
        ? `\n\nCONTEXTE RÉCENT DE LA CONVERSATION EN COURS :\n${conv.messages
            .slice(-8)
            .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'WILLIO'}: ${m.content}`)
            .join('\n')}`
        : '';

      const systemInstruction =
        buildWillioSystemInstruction(store.memories, store.modules, email) +
        recentContext +
        "\n\nMode conversation vocale en direct : parle avec une voix masculine française naturelle, chaleureuse, humaine et vivante, avec des intonations expressives, des pauses naturelles et un rythme conversationnel spontané (jamais monotone). Si l'interlocuteur te coupe la parole pendant que tu parles, lâche une courte remarque taquine et sarcastique (par exemple « C'est malpoli, ça ! J'ai pas fini… Mais vas-y, je t'écoute ! » ou une variante spontanée) puis écoute immédiatement ce qu'il a à dire sans monologuer.";

      const ai = getAiClient('v1beta');
      session = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
          systemInstruction,
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;
            const content = message.serverContent;

            if (content?.inputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ inputTranscript: content.inputTranscription.text })
              );
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ outputTranscript: content.outputTranscription.text })
              );
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
            if (content?.turnComplete) {
              clientWs.send(JSON.stringify({ turnComplete: true }));
            }
          },
          onerror: (err) => {
            const errObj = err as { error?: { message?: string }; message?: string };
            const errMsg =
              err instanceof Error
                ? err.message
                : errObj?.error?.message ||
                  errObj?.message ||
                  'Erreur de session Gemini Live API.';
            console.error('[WILLIO Live API error]', errMsg);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ error: errMsg }));
            }
          },
          onclose: (ev) => {
            if (ev?.reason) {
              console.warn('[WILLIO Live API closed]', ev.code, ev.reason);
            }
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close();
            }
          },
        },
      });

      if (clientClosed || clientWs.readyState !== WebSocket.OPEN) {
        session.close();
        return;
      }

      clientWs.on('message', (raw) => {
        if (!session) return;
        try {
          const msg = JSON.parse(raw.toString()) as {
            type?: string;
            data?: string;
            text?: string;
          };
          if (msg.type === 'audio' && msg.data) {
            session.sendRealtimeInput({
              audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
            });
          } else if (msg.type === 'audioEnd') {
            session.sendRealtimeInput({ audioStreamEnd: true });
          } else if (msg.type === 'text' && msg.text) {
            session.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: msg.text }] }],
              turnComplete: true,
            });
          } else if (msg.type === 'close') {
            session.close();
          }
        } catch {
          // ignore malformed frames
        }
      });

      clientWs.send(JSON.stringify({ ready: true }));
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Impossible de démarrer Gemini Live API.';
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ error: msg }));
        clientWs.close();
      }
      return;
    }
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`WILLIO server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start WILLIO server:', err);
  process.exit(1);
});
