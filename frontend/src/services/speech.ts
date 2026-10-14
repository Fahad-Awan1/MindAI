import { voiceAPI, VoiceStatus } from './api';

/**
 * Text-to-speech playback.
 *
 * Uses the server's Groq voices when they are enabled, otherwise the browser's built-in
 * speech synthesis (works offline, no setup). Only one thing speaks at a time.
 */

let statusPromise: Promise<VoiceStatus | null> | null = null;

export const getVoiceStatus = (): Promise<VoiceStatus | null> => {
  if (!statusPromise) {
    statusPromise = voiceAPI.status().catch(() => null);
  }
  return statusPromise;
};

/** Strip Markdown so text reads naturally when spoken. */
export const plainTextForSpeech = (text: string): string =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[(\d+)\]/g, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\|?[-:\s|]+\|?\s*$/gm, ' ')
    .replace(/^\s*\||\|\s*$/gm, '')
    .replace(/\s*\|\s*/g, ', ')
    .replace(/[*_~>#]/g, '')
    .replace(/\n+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();

export const browserSpeechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Two distinct English browser voices (for two-host audio overviews). */
export const pickBrowserVoices = (): SpeechSynthesisVoice[] => {
  if (!browserSpeechSupported()) return [];
  const voices = window.speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith('en'));
  if (voices.length === 0) return [];
  const second = voices.find(v => v.name !== voices[0].name && /female|zira|samantha|aria|jenny|libby|sonia|google uk english female/i.test(v.name))
    ?? voices.find(v => v.name !== voices[0].name);
  return second ? [voices[0], second] : [voices[0]];
};

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

export const stopSpeaking = () => {
  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  if (browserSpeechSupported()) window.speechSynthesis.cancel();
};

const speakWithBrowser = (text: string, voice?: SpeechSynthesisVoice): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!browserSpeechSupported()) {
      reject(new Error('Speech is not supported in this browser.'));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.rate = 1.02;
    utterance.onend = () => resolve();
    utterance.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? resolve() : reject(new Error(e.error)));
    window.speechSynthesis.speak(utterance);
  });

/**
 * Speak text aloud and resolve when finished (or when stopped).
 * `serverVoice` picks a Groq voice; `browserVoice` is used for the fallback.
 */
export const speak = async (
  text: string,
  options: { serverVoice?: string; browserVoice?: SpeechSynthesisVoice } = {}
): Promise<void> => {
  stopSpeaking();
  const plain = plainTextForSpeech(text);
  if (!plain) return;

  const status = await getVoiceStatus();
  if (status?.tts_available) {
    try {
      const blob = await voiceAPI.speak(plain, options.serverVoice);
      currentUrl = URL.createObjectURL(blob);
      const audio = new Audio(currentUrl);
      currentAudio = audio;
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onpause = () => resolve();
        audio.onerror = () => reject(new Error('Audio playback failed'));
        audio.play().catch(reject);
      });
      return;
    } catch (err) {
      console.warn('Server text-to-speech failed, using the browser voice instead:', err);
      statusPromise = Promise.resolve(status ? { ...status, tts_available: false } : null);
    }
  }
  await speakWithBrowser(plain, options.browserVoice);
};
