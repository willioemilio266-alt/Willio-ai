import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Hand,
  Loader2,
  Mic,
  PhoneOff,
  Radio,
  Volume2,
} from 'lucide-react';
import type { WillioSettings } from '../types/willio';
import { float32ToPcm16Base64, pcm16Base64ToFloat32 } from '../utils/pcmAudio';

import {
  DEFAULT_INTERRUPTION_REACTION,
  VARIED_INTERRUPTION_REACTIONS,
} from '../utils/interruptionReactions';

export type VoiceCallEngine = 'continuous' | 'live';
export type VoicePhase =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'connecting';

interface VoiceCallBarProps {
  active: boolean;
  conversationId: string | null;
  syncEmail: string;
  settings: WillioSettings;
  isSending: boolean;
  isSpeakingExternal: boolean;
  isSpeakingReaction: boolean;
  reactionText: string | null;
  onDeactivate: () => void;
  onInterruptPlayback: (hardStop?: boolean) => void;
  onSubmitVoiceText: (text: string) => Promise<void>;
  onAppendLiveTurn: (userText: string, assistantText: string) => Promise<void>;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal?: boolean }
        >;
      }) => void)
    | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const STOP_VOICE_PHRASES = [
  'arrête le mode vocal',
  'arrete le mode vocal',
  'désactive le mode vocal',
  'desactive le mode vocal',
  'quitte le mode vocal',
  'coupe le mode vocal',
  'arrête le vocal',
  'arrete le vocal',
  'désactive le vocal',
  'desactive le vocal',
  'coupe le vocal',
  'raccroche',
  'fin de l appel',
  "fin de l'appel",
];

const INTERRUPT_PHRASES = ['tais-toi', 'tais toi', 'interromps', 'stop'];

export const VoiceCallBar: React.FC<VoiceCallBarProps> = ({
  active,
  conversationId,
  syncEmail,
  settings,
  isSending,
  isSpeakingExternal,
  isSpeakingReaction,
  reactionText,
  onDeactivate,
  onInterruptPlayback,
  onSubmitVoiceText,
  onAppendLiveTurn,
}) => {
  const [engine, setEngine] = useState<VoiceCallEngine>('continuous');
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [liveReaction, setLiveReaction] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [useFallbackRecorder, setUseFallbackRecorder] = useState(false);

  const activeRef = useRef(active);
  const engineRef = useRef(engine);
  const isSpeakingRef = useRef(isSpeakingExternal);
  const isSendingRef = useRef(isSending);
  const conversationIdRef = useRef(conversationId);
  const useFallbackRecorderRef = useRef(useFallbackRecorder);
  const liveInterruptCountRef = useRef(0);
  const lastLiveReactionRef = useRef<string | null>(null);
  const liveReactionTimerRef = useRef<number | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fallbackChunksRef = useRef<Blob[]>([]);
  const restartTimerRef = useRef<number | null>(null);

  // Gemini Live refs
  const liveWsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef<number>(0);
  const liveUserBufRef = useRef<string>('');
  const liveAssistantBufRef = useRef<string>('');

  const triggerLiveReactionBanner = useCallback(() => {
    let chosen = DEFAULT_INTERRUPTION_REACTION;
    if (liveInterruptCountRef.current > 0) {
      const pool = VARIED_INTERRUPTION_REACTIONS.filter(
        (r) => r !== lastLiveReactionRef.current
      );
      chosen = pool[Math.floor(Math.random() * pool.length)] || DEFAULT_INTERRUPTION_REACTION;
    }
    liveInterruptCountRef.current += 1;
    lastLiveReactionRef.current = chosen;
    setLiveReaction(chosen);
    if (liveReactionTimerRef.current !== null) {
      window.clearTimeout(liveReactionTimerRef.current);
    }
    liveReactionTimerRef.current = window.setTimeout(() => {
      setLiveReaction(null);
      liveReactionTimerRef.current = null;
    }, 4500);
  }, []);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);

  useEffect(() => {
    isSpeakingRef.current = isSpeakingExternal;
  }, [isSpeakingExternal]);

  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    useFallbackRecorderRef.current = useFallbackRecorder;
  }, [useFallbackRecorder]);

  const stopContinuousCapture = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    mediaRecorderRef.current = null;
  }, []);

  const stopLivePlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // ignore
      }
    }
    activeSourcesRef.current = [];
    if (outputAudioCtxRef.current) {
      nextStartTimeRef.current = outputAudioCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
  }, []);

  const stopLiveSession = useCallback(() => {
    stopLivePlayback();
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      void inputAudioCtxRef.current.close().catch(() => undefined);
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      void outputAudioCtxRef.current.close().catch(() => undefined);
      outputAudioCtxRef.current = null;
    }
    if (liveWsRef.current) {
      try {
        if (liveWsRef.current.readyState === WebSocket.OPEN) {
          liveWsRef.current.send(JSON.stringify({ type: 'close' }));
        }
        liveWsRef.current.close();
      } catch {
        // ignore
      }
      liveWsRef.current = null;
    }
  }, [stopLivePlayback]);

  const startContinuousListening = useCallback(() => {
    if (!activeRef.current || engineRef.current !== 'continuous') return;
    if (isSpeakingRef.current || isSendingRef.current || useFallbackRecorderRef.current) return;

    stopContinuousCapture();
    setVoiceError(null);

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      useFallbackRecorderRef.current = true;
      setUseFallbackRecorder(true);
      setPhase('idle');
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = 'fr-FR';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;

      rec.onresult = (event) => {
        let interim = '';
        let finalText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          const text = item[0]?.transcript ?? '';
          if (item.isFinal) {
            finalText += ` ${text}`;
          } else {
            interim += ` ${text}`;
          }
        }

        if (interim.trim()) {
          setLiveTranscript(interim.trim());
        }

        const cleaned = finalText.trim();
        if (cleaned) {
          setLiveTranscript(cleaned);
          const lower = cleaned.toLowerCase();

          if (STOP_VOICE_PHRASES.some((p) => lower.includes(p))) {
            stopContinuousCapture();
            onInterruptPlayback(true);
            onDeactivate();
            return;
          }

          if (INTERRUPT_PHRASES.includes(lower)) {
            onInterruptPlayback(true);
            setLiveTranscript('');
            return;
          }

          stopContinuousCapture();
          setPhase('thinking');
          void onSubmitVoiceText(cleaned).finally(() => {
            setLiveTranscript('');
          });
        }
      };

      rec.onerror = (ev) => {
        const errCode = ev?.error || '';
        if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
          setVoiceError(
            "Accès au microphone refusé. Autorisez le micro dans Chrome pour parler à WILLIO."
          );
          setPhase('idle');
          return;
        }
        if (errCode === 'no-speech' || errCode === 'aborted') {
          return;
        }
        useFallbackRecorderRef.current = true;
        setUseFallbackRecorder(true);
        setPhase('idle');
      };

      rec.onend = () => {
        recognitionRef.current = null;
        if (
          activeRef.current &&
          engineRef.current === 'continuous' &&
          !isSpeakingRef.current &&
          !isSendingRef.current &&
          !useFallbackRecorderRef.current
        ) {
          restartTimerRef.current = window.setTimeout(() => {
            startContinuousListening();
          }, 350);
        }
      };

      recognitionRef.current = rec;
      setPhase('listening');
      rec.start();
    } catch {
      useFallbackRecorderRef.current = true;
      setUseFallbackRecorder(true);
      setPhase('idle');
    }
  }, [
    onDeactivate,
    onInterruptPlayback,
    onSubmitVoiceText,
    stopContinuousCapture,
  ]);

  const startLiveSession = useCallback(async () => {
    stopContinuousCapture();
    stopLiveSession();
    setVoiceError(null);
    setLiveTranscript('');
    setPhase('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      await inputCtx.resume().catch(() => undefined);
      await outputCtx.resume().catch(() => undefined);
      inputAudioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams();
      if (syncEmail) params.set('email', syncEmail);
      if (conversationIdRef.current) params.set('conversationId', conversationIdRef.current);
      params.set('voice', settings.geminiVoiceName);

      const ws = new WebSocket(`${proto}//${location.host}/ws/live?${params.toString()}`);
      liveWsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            ready?: boolean;
            audio?: string;
            inputTranscript?: string;
            outputTranscript?: string;
            interrupted?: boolean;
            turnComplete?: boolean;
            error?: string;
          };

          if (msg.error) {
            setVoiceError(
              `Gemini Live indisponible (${msg.error}). Basculez sur « Mode Continu » pour continuer en vocal.`
            );
            stopLiveSession();
            setPhase('idle');
            return;
          }

          if (msg.ready) {
            setPhase('listening');
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (!liveWsRef.current || liveWsRef.current.readyState !== WebSocket.OPEN) {
                return;
              }
              const channel = e.inputBuffer.getChannelData(0);
              const base64 = float32ToPcm16Base64(channel, inputCtx.sampleRate);
              liveWsRef.current.send(JSON.stringify({ type: 'audio', data: base64 }));
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
          }

          if (msg.inputTranscript) {
            liveUserBufRef.current += msg.inputTranscript;
            const currentTranscript = liveUserBufRef.current.trim();
            setLiveTranscript(currentTranscript);
            setLiveReaction(null);
            const lowerLive = currentTranscript.toLowerCase();
            if (STOP_VOICE_PHRASES.some((p) => lowerLive.includes(p))) {
              liveUserBufRef.current = '';
              liveAssistantBufRef.current = '';
              stopLiveSession();
              onDeactivate();
              return;
            }
          }

          if (msg.outputTranscript) {
            liveAssistantBufRef.current += msg.outputTranscript;
          }

          if (msg.interrupted) {
            stopLivePlayback();
            triggerLiveReactionBanner();
            setPhase('listening');
          }

          if (msg.audio && outputAudioCtxRef.current) {
            setPhase('speaking');
            const ctx = outputAudioCtxRef.current;
            const samples = pcm16Base64ToFloat32(msg.audio);
            const audioBuffer = ctx.createBuffer(1, samples.length, 24000);
            audioBuffer.copyToChannel(new Float32Array(samples), 0);

            const node = ctx.createBufferSource();
            node.buffer = audioBuffer;
            node.connect(ctx.destination);

            const startAt = Math.max(ctx.currentTime, nextStartTimeRef.current);
            node.start(startAt);
            nextStartTimeRef.current = startAt + audioBuffer.duration;
            activeSourcesRef.current.push(node);

            node.onended = () => {
              activeSourcesRef.current = activeSourcesRef.current.filter(
                (n) => n !== node
              );
            };
          }

          if (msg.turnComplete) {
            const u = liveUserBufRef.current.trim();
            const a = liveAssistantBufRef.current.trim();
            liveUserBufRef.current = '';
            liveAssistantBufRef.current = '';
            if (u || a) {
              void onAppendLiveTurn(u, a);
            }
            setLiveTranscript('');
            if (activeSourcesRef.current.length === 0) {
              setPhase('listening');
            }
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        setVoiceError(
          'Connexion Gemini Live impossible ici. Utilisez « Mode Continu » compatible Android/Chrome.'
        );
        stopLiveSession();
        setPhase('idle');
      };

      ws.onclose = () => {
        if (activeRef.current && engineRef.current === 'live') {
          setPhase('idle');
        }
      };
    } catch {
      setVoiceError(
        'Microphone refusé ou indisponible pour Gemini Live.'
      );
      stopLiveSession();
      setPhase('idle');
    }
  }, [
    onAppendLiveTurn,
    onDeactivate,
    settings.geminiVoiceName,
    stopContinuousCapture,
    stopLivePlayback,
    stopLiveSession,
    syncEmail,
  ]);

  // Synchronize continuous loop phase with speaking/sending state
  useEffect(() => {
    if (!active) {
      stopContinuousCapture();
      stopLiveSession();
      setPhase('idle');
      setLiveTranscript('');
      setLiveReaction(null);
      setVoiceError(null);
      if (liveReactionTimerRef.current !== null) {
        window.clearTimeout(liveReactionTimerRef.current);
        liveReactionTimerRef.current = null;
      }
      return;
    }

    if (engine === 'live') {
      void startLiveSession();
      return () => {
        stopLiveSession();
      };
    }

    // Continuous mode
    stopLiveSession();
    if (isSending) {
      stopContinuousCapture();
      setPhase('thinking');
    } else if (isSpeakingExternal) {
      stopContinuousCapture();
      setPhase('speaking');
    } else {
      startContinuousListening();
    }
  }, [
    active,
    engine,
    isSending,
    isSpeakingExternal,
    startContinuousListening,
    startLiveSession,
    stopContinuousCapture,
    stopLiveSession,
  ]);

  // Fallback push-to-talk recorder if Web SpeechRecognition is absent
  async function toggleFallbackRecorder() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setPhase('thinking');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';
      const rec = new MediaRecorder(stream, { mimeType });
      fallbackChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) fallbackChunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(fallbackChunksRef.current, { type: mimeType });
        if (blob.size < 200) {
          setPhase('idle');
          return;
        }
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () =>
              resolve(String(reader.result || '').split(',')[1] || '');
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
            await onSubmitVoiceText(data.text);
          } else if (data.error) {
            setVoiceError(data.error);
          }
        } catch {
          setVoiceError('Transcription audio impossible.');
        } finally {
          setPhase('idle');
        }
      };
      mediaRecorderRef.current = rec;
      setPhase('listening');
      rec.start();
    } catch {
      setVoiceError('Accès au microphone refusé.');
      setPhase('idle');
    }
  }

  function handleInterrupt() {
    if (engine === 'live') {
      stopLivePlayback();
      triggerLiveReactionBanner();
      setPhase('listening');
    } else if (isSpeakingReaction) {
      // Second tap while WILLIO is delivering his quip -> cut immediately and listen
      onInterruptPlayback(true);
      setPhase('listening');
      startContinuousListening();
    } else {
      // First interruption while WILLIO is speaking -> stop main voice & deliver witty quip
      onInterruptPlayback(false);
    }
  }

  if (!active) return null;

  const displayedReaction = reactionText || liveReaction;
  const statusText =
    phase === 'connecting'
      ? 'Connexion temps réel...'
      : phase === 'listening'
        ? 'Je vous écoute, parlez...'
        : phase === 'thinking'
          ? 'WILLIO réfléchit...'
          : phase === 'speaking'
            ? isSpeakingReaction
              ? 'WILLIO réagit… (appuyez pour couper aussitôt)'
              : 'WILLIO parle — appuyez sur Interrompre pour couper'
            : 'Mode vocal prêt';

  return (
    <div className="shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#131A26]/95 px-3 sm:px-6 py-3">
      <div className="max-w-3xl mx-auto space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              {phase === 'thinking' || phase === 'connecting' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : phase === 'speaking' ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                Conversation vocale · {statusText}
              </div>
              {displayedReaction && (
                <div className="text-xs italic text-amber-700 dark:text-amber-300 mt-0.5 leading-snug">
                  « {displayedReaction} »
                </div>
              )}
              {liveTranscript && (
                <div className="text-xs text-slate-600 dark:text-slate-300 truncate">
                  « {liveTranscript} »
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Engine switch */}
            <div className="flex items-center rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5">
              <button
                type="button"
                onClick={() => setEngine('continuous')}
                className={`px-2.5 min-h-[34px] rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                  engine === 'continuous'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Continu
              </button>
              <button
                type="button"
                onClick={() => setEngine('live')}
                className={`px-2.5 min-h-[34px] rounded-lg text-[11px] font-medium inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                  engine === 'live'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Radio className="w-3 h-3" />
                <span>Gemini Live</span>
              </button>
            </div>

            {(phase === 'speaking' || isSpeakingExternal) && (
              <button
                type="button"
                onClick={handleInterrupt}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs px-3 min-h-[40px] whitespace-nowrap shrink-0"
              >
                <Hand className="w-3.5 h-3.5" />
                <span>Interrompre</span>
              </button>
            )}

            {engine === 'continuous' && useFallbackRecorder && phase !== 'speaking' && (
              <button
                type="button"
                onClick={() => void toggleFallbackRecorder()}
                className={`inline-flex items-center gap-1.5 rounded-xl text-xs font-semibold px-3 min-h-[40px] whitespace-nowrap shrink-0 ${
                  phase === 'listening'
                    ? 'bg-rose-600 text-white'
                    : 'bg-amber-600 text-slate-950'
                }`}
              >
                <Mic className="w-3.5 h-3.5" />
                <span>{phase === 'listening' ? 'Envoyer' : 'Parler'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                onInterruptPlayback(true);
                onDeactivate();
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-3 min-h-[40px] whitespace-nowrap shrink-0"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              <span>Quitter</span>
            </button>
          </div>
        </div>

        {voiceError && (
          <p className="text-xs text-rose-600 dark:text-rose-400">{voiceError}</p>
        )}
      </div>
    </div>
  );
};
