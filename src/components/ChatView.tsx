import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Mic,
  Paperclip,
  Phone,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  AttachedDocument,
  ChatMessage,
  Conversation,
  WillioSettings,
} from '../types/willio';
import { MarkdownRenderer } from './MarkdownRenderer';
import { VoiceCallBar } from './VoiceCallBar';
import {
  DEFAULT_INTERRUPTION_REACTION,
  stripEmojisForSpeech,
  VARIED_INTERRUPTION_REACTIONS,
} from '../utils/interruptionReactions';

const REACTION_MSG_ID = '__willio_interrupt_reaction__';

interface ChatViewProps {
  conversation: Conversation | null;
  syncEmail: string;
  settings: WillioSettings;
  isSending: boolean;
  errorMsg: string | null;
  onSendMessage: (payload: {
    text: string;
    useWebSearch: boolean;
    deepThinking: boolean;
    attachment: AttachedDocument | null;
  }) => Promise<void>;
  onAppendLiveTurn: (userText: string, assistantText: string) => Promise<void>;
  onDismissError: () => void;
}

const STARTER_PROMPTS = [
  {
    label: 'Philosophie & sens critique',
    text: 'Pourquoi les humains confondent-ils souvent certitude et vérité ? Remets mes idées en question si nécessaire.',
  },
  {
    label: 'Traditions & spiritualité',
    text: 'Compare la vision de la conscience dans le Kybalion hermétique, le soufisme et le Vedanta, sans inventer de certitudes.',
  },
  {
    label: 'Architecture & science',
    text: 'Explique-moi comment concevoir une application IA sobre et sécurisée adaptée à un téléphone Android de 3 Go de RAM.',
  },
  {
    label: 'Commande spéciale',
    text: 'Invociom',
  },
];

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  conversation,
  syncEmail,
  settings,
  isSending,
  errorMsg,
  onSendMessage,
  onAppendLiveTurn,
  onDismissError,
}) => {
  const [input, setInput] = useState('');
  const [useWebSearch, setUseWebSearch] = useState(settings.defaultWebSearch);
  const [deepThinking, setDeepThinking] = useState(settings.defaultDeepThinking);
  const [attachment, setAttachment] = useState<AttachedDocument | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [voiceModeActive, setVoiceModeActive] = useState(false);

  // Voice playback state (persistent audio element unlocked on user gesture for Android Chrome)
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const [interruptReactionText, setInterruptReactionText] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const speechQueueTokenRef = useRef<number>(0);
  const reactionCacheRef = useRef<Map<string, string>>(new Map());
  const interruptCountRef = useRef<number>(0);
  const lastReactionRef = useRef<string | null>(null);

  // Voice recognition state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastAutoSpokenIdRef = useRef<string | null>(null);

  const messages: ChatMessage[] = conversation?.messages ?? [];

  function getOrCreatePlayer(): HTMLAudioElement {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    return audioRef.current;
  }

  function unlockAudioForMobile() {
    try {
      const player = getOrCreatePlayer();
      if (!player.src) {
        // Tiny silent WAV (44 bytes header + 2 zero bytes) to unlock mobile Chrome autoplay on user gesture
        player.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==';
        player.volume = 0;
        const p = player.play();
        if (p && typeof p.then === 'function') {
          void p
            .then(() => {
              player.pause();
              player.volume = 1;
            })
            .catch(() => {
              player.volume = 1;
            });
        }
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: settings.ecoRamMode ? 'auto' : 'smooth',
    });
  }, [messages.length, isSending, settings.ecoRamMode]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
    return () => {
      stopAudio();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Pre-warm default interruption reaction audio once when voice mode activates
  useEffect(() => {
    if (!voiceModeActive) {
      interruptCountRef.current = 0;
      lastReactionRef.current = null;
      return;
    }
    const cacheKey = `${settings.geminiVoiceName}:${DEFAULT_INTERRUPTION_REACTION}`;
    if (
      settings.voiceEngine === 'browser' ||
      !navigator.onLine ||
      reactionCacheRef.current.has(cacheKey)
    ) {
      return;
    }
    const controller = new AbortController();
    void fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        text: stripEmojisForSpeech(DEFAULT_INTERRUPTION_REACTION),
        voiceName: settings.geminiVoiceName,
        tone: 'reaction',
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { audioBase64?: string } | null) => {
        if (data?.audioBase64) {
          reactionCacheRef.current.set(cacheKey, data.audioBase64);
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [voiceModeActive, settings.voiceEngine, settings.geminiVoiceName]);

  // Auto-speak newest assistant message when autoSpeak or continuous voice call is active
  useEffect(() => {
    if ((!settings.autoSpeak && !voiceModeActive) || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (
      last.role === 'assistant' &&
      last.id !== lastAutoSpokenIdRef.current &&
      !isSending
    ) {
      lastAutoSpokenIdRef.current = last.id;
      void handleSpeak(last);
    }
  }, [messages, settings.autoSpeak, voiceModeActive, isSending]);

  function stopAudio(clearReaction = true) {
    speechQueueTokenRef.current += 1;
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMsgId(null);
    setTtsLoadingId(null);
    if (clearReaction) {
      setInterruptReactionText(null);
    }
  }

  function pickFrenchMaleBrowserVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const frVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('fr'));
    if (frVoices.length === 0) return null;

    const malePattern =
      /thomas|nicolas|paul|henri|daniel|remi|rémi|claude|alain|guillaume|antoine|jean|mathieu|male|homme|fr-fr-x-frd|fr-fr-x-frb|fr-fr-x-vlf/i;
    const femalePattern =
      /amélie|amelie|aurélie|aurelie|céline|celine|chloé|chloe|denise|hortense|julie|léa|lea|marie|sophie|virginie|claire|camille|female|femme|fr-fr-x-frc|fr-fr-x-fra/i;

    const explicitMale = frVoices.find((v) => malePattern.test(v.name) || malePattern.test(v.voiceURI));
    if (explicitMale) return explicitMale;

    const nonFemale = frVoices.find((v) => !femalePattern.test(v.name) && !femalePattern.test(v.voiceURI));
    return nonFemale ?? frVoices[0];
  }

  function speakTextWithBrowserFallback(rawText: string, msgId: string, onDone?: () => void) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSpeakingMsgId(null);
      onDone?.();
      return;
    }
    window.speechSynthesis.cancel();
    const token = ++speechQueueTokenRef.current;

    const clean = stripEmojisForSpeech(
      rawText
        .replace(/```[\s\S]*?```/g, ' — bloc de code — ')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[*_`#>]/g, '')
    );

    const chunks = clean
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const segments = chunks.length > 0 ? chunks : [clean];

    const selectedVoice = pickFrenchMaleBrowserVoice(window.speechSynthesis.getVoices());
    setSpeakingMsgId(msgId);

    const speakNext = (index: number) => {
      if (speechQueueTokenRef.current !== token) return;
      if (index >= segments.length) {
        setSpeakingMsgId(null);
        onDone?.();
        return;
      }

      const segment = segments[index];
      const utter = new SpeechSynthesisUtterance(segment);
      utter.lang = 'fr-FR';
      if (selectedVoice) utter.voice = selectedVoice;

      // Subtle human prosody variation across sentence types while keeping a deep male register
      const isQuestion = segment.endsWith('?');
      const isExclamation = segment.endsWith('!');
      utter.pitch = isQuestion ? 0.91 : isExclamation ? 0.89 : 0.85;
      utter.rate =
        msgId === REACTION_MSG_ID
          ? 1.03
          : isExclamation
            ? 0.99
            : isQuestion
              ? 0.97
              : 0.95;

      utter.onend = () => {
        if (speechQueueTokenRef.current !== token) return;
        speakNext(index + 1);
      };
      utter.onerror = () => {
        if (speechQueueTokenRef.current !== token) return;
        setSpeakingMsgId(null);
        onDone?.();
      };
      window.speechSynthesis.speak(utter);
    };

    speakNext(0);
  }

  function pickNextInterruptionReaction(): string {
    let chosen = DEFAULT_INTERRUPTION_REACTION;
    if (interruptCountRef.current > 0) {
      const pool = VARIED_INTERRUPTION_REACTIONS.filter(
        (r) => r !== lastReactionRef.current
      );
      chosen =
        pool[Math.floor(Math.random() * pool.length)] || DEFAULT_INTERRUPTION_REACTION;
    }
    interruptCountRef.current += 1;
    lastReactionRef.current = chosen;
    return chosen;
  }

  async function playCachedOrTtsReaction(reaction: string) {
    stopAudio(false);
    setInterruptReactionText(reaction);

    const onReactionFinished = () => {
      setSpeakingMsgId(null);
      setTtsLoadingId(null);
    };

    if (settings.voiceEngine === 'browser' || !navigator.onLine) {
      speakTextWithBrowserFallback(reaction, REACTION_MSG_ID, onReactionFinished);
      return;
    }

    const cacheKey = `${settings.geminiVoiceName}:${reaction}`;
    const cached = reactionCacheRef.current.get(cacheKey);
    if (cached) {
      try {
        const audio = getOrCreatePlayer();
        audio.volume = 1;
        audio.src = `data:audio/wav;base64,${cached}`;
        setSpeakingMsgId(REACTION_MSG_ID);
        audio.onended = () => {
          onReactionFinished();
        };
        audio.onerror = () => {
          onReactionFinished();
        };
        await audio.play();
        return;
      } catch {
        // Fallback below if browser autoplay rejects
      }
    }

    const controller = new AbortController();
    ttsAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 3500);
    try {
      setTtsLoadingId(REACTION_MSG_ID);
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: stripEmojisForSpeech(reaction),
          voiceName: settings.geminiVoiceName,
          tone: 'reaction',
        }),
      });
      window.clearTimeout(timeoutId);
      if (!res.ok) throw new Error('TTS API indisponible');
      const data = (await res.json()) as { audioBase64?: string; mimeType?: string };
      if (!data.audioBase64) throw new Error('Audio vide');
      if (ttsAbortRef.current !== controller) return;

      reactionCacheRef.current.set(cacheKey, data.audioBase64);
      const audio = getOrCreatePlayer();
      audio.volume = 1;
      audio.src = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
      setTtsLoadingId(null);
      setSpeakingMsgId(REACTION_MSG_ID);
      audio.onended = () => {
        onReactionFinished();
      };
      audio.onerror = () => {
        onReactionFinished();
      };
      await audio.play();
    } catch {
      window.clearTimeout(timeoutId);
      setTtsLoadingId(null);
      // Only fall back to browser speech if this reaction wasn't explicitly aborted by hardStop
      if (ttsAbortRef.current === controller) {
        ttsAbortRef.current = null;
        speakTextWithBrowserFallback(reaction, REACTION_MSG_ID, onReactionFinished);
      }
    }
  }

  function handleInterruptPlayback(hardStop = false) {
    const isCurrentlySpeaking = speakingMsgId !== null || ttsLoadingId !== null;
    if (hardStop || !isCurrentlySpeaking || speakingMsgId === REACTION_MSG_ID || ttsLoadingId === REACTION_MSG_ID) {
      stopAudio(true);
      return;
    }
    const reaction = pickNextInterruptionReaction();
    void playCachedOrTtsReaction(reaction);
  }

  async function handleSpeak(msg: ChatMessage) {
    if (speakingMsgId === msg.id) {
      if (voiceModeActive) {
        handleInterruptPlayback(false);
      } else {
        stopAudio(true);
      }
      return;
    }
    stopAudio(true);

    if (settings.voiceEngine === 'browser' || !navigator.onLine) {
      speakTextWithBrowserFallback(msg.content, msg.id);
      return;
    }

    const controller = new AbortController();
    ttsAbortRef.current = controller;

    try {
      setTtsLoadingId(msg.id);
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: stripEmojisForSpeech(msg.content),
          voiceName: settings.geminiVoiceName,
          tone: 'chat',
        }),
      });
      if (!res.ok) {
        throw new Error('TTS API indisponible');
      }
      const data = (await res.json()) as { audioBase64?: string; mimeType?: string };
      if (!data.audioBase64) {
        throw new Error('Audio vide');
      }
      if (ttsAbortRef.current !== controller) return;

      const audio = getOrCreatePlayer();
      audio.volume = 1;
      audio.src = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
      setTtsLoadingId(null);
      setSpeakingMsgId(msg.id);
      audio.onended = () => {
        setSpeakingMsgId(null);
      };
      audio.onerror = () => {
        setSpeakingMsgId(null);
      };
      await audio.play();
    } catch {
      setTtsLoadingId(null);
      if (ttsAbortRef.current === controller) {
        ttsAbortRef.current = null;
        speakTextWithBrowserFallback(msg.content, msg.id);
      }
    }
  }

  async function startMediaRecorderFallback() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size < 200) return;

        setIsTranscribing(true);
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const res = String(reader.result || '');
              resolve(res.split(',')[1] || '');
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          const res = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioBase64: base64, mimeType }),
          });
          const data = (await res.json()) as { text?: string; error?: string };
          if (data.text) {
            setInput((prev) => (prev ? `${prev} ${data.text}` : data.text!));
          } else if (data.error) {
            setFileError(data.error);
          }
        } catch {
          setFileError('Impossible de transcrire le message vocal.');
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      recorder.start();
    } catch {
      setFileError(
        "Accès au microphone refusé ou indisponible sur ce navigateur."
      );
      setIsRecording(false);
    }
  }

  async function toggleVoiceRecording() {
    if (isRecording) {
      setIsRecording(false);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    stopAudio(true);
    setFileError(null);

    // Prefer native Web Speech API if available for instant French dictation
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (SpeechRec) {
      try {
        const rec = new SpeechRec();
        rec.lang = 'fr-FR';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onresult = (event) => {
          const transcript = event.results?.[0]?.[0]?.transcript;
          if (transcript) {
            setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
          }
        };
        rec.onerror = (ev?: { error?: string }) => {
          setIsRecording(false);
          recognitionRef.current = null;
          const code = ev?.error || '';
          if (code === 'not-allowed' || code === 'service-not-allowed') {
            setFileError(
              "Accès au microphone refusé. Autorisez le micro dans les réglages du navigateur."
            );
          } else if (code !== 'no-speech' && code !== 'aborted') {
            void startMediaRecorderFallback();
          }
        };
        rec.onend = () => {
          setIsRecording(false);
        };
        recognitionRef.current = rec;
        setIsRecording(true);
        rec.start();
        return;
      } catch {
        // Fallback to MediaRecorder + Gemini transcribe below
      }
    }

    await startMediaRecorderFallback();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      setFileError('Document trop volumineux (maximum 8 Mo pour préserver la RAM).');
      return;
    }

    const isText =
      file.type.startsWith('text/') ||
      /\.(txt|md|csv|json|ts|tsx|js|jsx|py|html|css|xml|log)$/i.test(file.name);

    const isBinarySupported =
      file.type === 'application/pdf' ||
      file.type.startsWith('image/') ||
      /\.pdf$/i.test(file.name);

    if (!isText && !isBinarySupported) {
      setFileError(
        'Format accepté : TXT, Markdown, CSV, JSON, code source, PDF ou image (PNG/JPG).'
      );
      return;
    }

    const reader = new FileReader();
    if (isText) {
      reader.onload = () => {
        setAttachment({
          id: `doc-${Date.now()}`,
          name: file.name,
          mimeType: file.type || 'text/plain',
          size: file.size,
          textContent: String(reader.result || ''),
        });
      };
      reader.readAsText(file);
    } else {
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.split(',')[1] || '';
        setAttachment({
          id: `doc-${Date.now()}`,
          name: file.name,
          mimeType: file.type || 'application/pdf',
          size: file.size,
          base64Data: base64,
        });
      };
      reader.readAsDataURL(file);
    }
  }

  async function submitMessage(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if ((!text && !attachment) || isSending) return;

    unlockAudioForMobile();

    const lower = text.toLowerCase();
    if (
      !attachment &&
      (lower === 'active le mode vocal' ||
        lower === 'activer le mode vocal' ||
        lower === 'active le vocal' ||
        lower === 'activer le vocal' ||
        lower === 'mode vocal' ||
        lower === 'mode vocal on')
    ) {
      if (!textOverride) setInput('');
      setVoiceModeActive(true);
      return;
    }
    if (
      !attachment &&
      (lower === 'désactive le mode vocal' ||
        lower === 'desactive le mode vocal' ||
        lower === 'arrête le mode vocal' ||
        lower === 'arrete le mode vocal' ||
        lower === 'désactive le vocal' ||
        lower === 'desactive le vocal' ||
        lower === 'arrête le vocal' ||
        lower === 'arrete le vocal' ||
        lower === 'coupe le vocal' ||
        lower === 'mode vocal off')
    ) {
      if (!textOverride) setInput('');
      stopAudio(true);
      setVoiceModeActive(false);
      return;
    }

    stopAudio(true);
    const currentAttachment = attachment;
    if (!textOverride) setInput('');
    setAttachment(null);
    setFileError(null);
    setInterruptReactionText(null);

    await onSendMessage({
      text,
      useWebSearch,
      deepThinking,
      attachment: currentAttachment,
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitMessage();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <VoiceCallBar
        active={voiceModeActive}
        conversationId={conversation?.id ?? null}
        syncEmail={syncEmail}
        settings={settings}
        isSending={isSending}
        isSpeakingExternal={speakingMsgId !== null || ttsLoadingId !== null}
        isSpeakingReaction={
          speakingMsgId === REACTION_MSG_ID || ttsLoadingId === REACTION_MSG_ID
        }
        reactionText={interruptReactionText}
        onDeactivate={() => setVoiceModeActive(false)}
        onInterruptPlayback={handleInterruptPlayback}
        onSubmitVoiceText={async (spokenText) => {
          setInterruptReactionText(null);
          await onSendMessage({
            text: spokenText,
            useWebSearch,
            deepThinking,
            attachment: null,
          });
        }}
        onAppendLiveTurn={onAppendLiveTurn}
      />

      {/* Scrollable conversation stream */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
        <div className="max-w-3xl mx-auto">
          {messages.length === 0 ? (
            <div className="py-8 sm:py-14">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400 tracking-wide">
                WILLIO · Fondé par RANDRIANANTENAINA Emilio Berthino Charles
              </p>
              <h1 className="mt-3 font-display text-3xl sm:text-4xl font-semibold text-slate-900 dark:text-slate-50 leading-tight text-balance">
                Parlons vrai, avec rigueur et profondeur.
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-slate-600 dark:text-slate-400 max-w-2xl">
                Je suis WILLIO, votre intelligence artificielle personnelle. Je réponds en
                français avec franchise, esprit critique, mémoire persistante, recherche
                Internet, lecture de documents et voix masculine naturelle.
              </p>

              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {STARTER_PROMPTS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => void submitMessage(item.text)}
                    className="text-left p-4 rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 hover:border-amber-500/60 dark:hover:border-amber-500/50 transition-colors min-h-[44px]"
                  >
                    <span className="block text-xs font-semibold text-amber-700 dark:text-amber-400">
                      {item.label}
                    </span>
                    <span className="mt-1.5 block text-sm text-slate-700 dark:text-slate-300 leading-snug">
                      {item.text}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6 pb-4">
              {messages.map((msg) => {
                const isUser = msg.role === 'user';
                const isSpeaking = speakingMsgId === msg.id;
                const isLoadingTts = ttsLoadingId === msg.id;

                if (isUser) {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[88%] sm:max-w-[78%] rounded-2xl bg-slate-900 dark:bg-slate-800 text-slate-50 px-4 py-3 text-[15px] leading-relaxed shadow-xs">
                        {msg.attachmentName && (
                          <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-300">
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{msg.attachmentName}</span>
                          </div>
                        )}
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      </div>
                    </div>
                  );
                }

                return (
                  <article key={msg.id} className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          WILLIO
                        </span>
                        <span aria-hidden="true">·</span>
                        <time className="tabular-nums">
                          {new Date(msg.createdAt).toLocaleTimeString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                        {msg.usedWebSearch && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Recherche Web</span>
                          </>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleSpeak(msg)}
                        aria-label={
                          isSpeaking ? 'Arrêter la lecture vocale' : 'Écouter la réponse'
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 min-h-[36px] rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                      >
                        {isLoadingTts ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isSpeaking ? (
                          <VolumeX className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {isLoadingTts ? 'Voix...' : isSpeaking ? 'Arrêter' : 'Écouter'}
                        </span>
                      </button>
                    </div>

                    <div className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800/90 px-4 sm:px-5 py-4">
                      <MarkdownRenderer content={msg.content} />

                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                            Sources consultées
                          </p>
                          <div className="flex flex-col gap-1.5">
                            {msg.sources.map((src) => (
                              <a
                                key={src.uri}
                                href={src.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 hover:underline truncate"
                              >
                                <ExternalLink className="w-3 h-3 shrink-0" />
                                <span className="truncate">{src.title}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {msg.memorySaved && (
                        <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-800 flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <BookOpen className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <span>Mémoire mise à jour : {msg.memorySaved}</span>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}

              {isSending && (
                <div className="flex items-center gap-2.5 text-sm text-slate-500 dark:text-slate-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-600 dark:text-amber-400" />
                  <span>WILLIO réfléchit...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Bottom composer in natural thumb zone */}
      <div className="shrink-0 border-t border-slate-200 dark:border-slate-800/80 bg-[#F6F7F9]/95 dark:bg-[#0B0F17]/95 backdrop-blur-sm px-3 sm:px-6 pt-2.5 pb-3">
        <div className="max-w-3xl mx-auto space-y-2">
          {(errorMsg || fileError) && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-xl bg-rose-500/10 border border-rose-500/30 px-3.5 py-2 text-xs text-rose-700 dark:text-rose-300"
            >
              <span>{errorMsg || fileError}</span>
              <button
                type="button"
                onClick={() => {
                  onDismissError();
                  setFileError(null);
                }}
                aria-label="Fermer l'alerte"
                className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg hover:bg-rose-500/10"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {attachment && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                  {attachment.name}
                </span>
                <span className="text-slate-500 tabular-nums shrink-0">
                  ({Math.max(1, Math.round(attachment.size / 1024))} Ko)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                aria-label="Retirer le document"
                className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-300 dark:border-slate-700/80 focus-within:border-amber-500 transition-colors p-2">
            <label htmlFor="willio-chat-input" className="sr-only">
              Votre message pour WILLIO
            </label>
            <textarea
              id="willio-chat-input"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Écrivez à WILLIO, joignez un document ou dites Invociom..."
              className="w-full resize-none bg-transparent px-2.5 py-1.5 text-[15px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none max-h-36"
            />

            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-1 overflow-x-auto">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp,.ts,.js,.py"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Lire un document (TXT, PDF, image, code)"
                  className="inline-flex items-center gap-1.5 px-2.5 min-h-[40px] rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                >
                  <Paperclip className="w-4 h-4" />
                  <span className="hidden sm:inline">Document</span>
                </button>

                <button
                  type="button"
                  onClick={() => setUseWebSearch((v) => !v)}
                  aria-pressed={useWebSearch}
                  title="Activer la recherche Internet"
                  className={`inline-flex items-center gap-1.5 px-2.5 min-h-[40px] rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    useWebSearch
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Globe className="w-4 h-4" />
                  <span>Web</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDeepThinking((v) => !v)}
                  aria-pressed={deepThinking}
                  title="Activer la réflexion approfondie"
                  className={`inline-flex items-center gap-1.5 px-2.5 min-h-[40px] rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    deepThinking
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  <span className="hidden sm:inline">Approfondi</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (voiceModeActive) {
                      stopAudio(true);
                      setVoiceModeActive(false);
                    } else {
                      unlockAudioForMobile();
                      setVoiceModeActive(true);
                    }
                  }}
                  aria-pressed={voiceModeActive}
                  title="Activer ou désactiver la conversation vocale continue"
                  className={`inline-flex items-center gap-1.5 px-2.5 min-h-[40px] rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    voiceModeActive
                      ? 'bg-amber-600 text-slate-950 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Phone className="w-4 h-4" />
                  <span>{voiceModeActive ? 'Vocal actif' : 'Mode vocal'}</span>
                </button>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void toggleVoiceRecording()}
                  disabled={isTranscribing}
                  aria-label={
                    isRecording
                      ? "Arrêter l'écoute vocale"
                      : 'Dicter un message vocal'
                  }
                  className={`min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl transition-colors ${
                    isRecording
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {isTranscribing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isRecording ? (
                    <Square className="w-4 h-4" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => void submitMessage()}
                  disabled={isSending || (!input.trim() && !attachment)}
                  aria-label="Envoyer le message"
                  className="min-h-[42px] min-w-[44px] px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-slate-950 font-semibold text-xs transition-colors"
                >
                  <ArrowUp className="w-4 h-4" />
                  <span className="hidden sm:inline">Envoyer</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
