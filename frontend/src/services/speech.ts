import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { voiceAPI, VoiceStatus } from './api';

/**
 * Text-to-speech playback.
 *
 * Uses the server's Groq voices when they are enabled, otherwise the device's own voice: the browser's
 * speech synthesis on the web, the phone's text-to-speech engine in the Android app (its WebView has no
 * Web Speech). Only one thing speaks at a time.
 */

const native = Capacitor.isNativePlatform();

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

export const browserSpeechSupported = () => !native && typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Whether this device can speak text without the server (browser voices, or the phone's TTS in the app). */
export const deviceSpeechSupported = () => native || browserSpeechSupported();

/**
 * Speak one piece of text with the device voice; resolves when it finishes or is stopped.
 * `voiceIndex` 0/1 alternates hosts (browser voices; in the app a different pitch tells them apart).
 */
export const speakWithDevice = async (text: string, opts: { rate?: number; pitch?: number; voice?: SpeechSynthesisVoice } = {}): Promise<void> => {
  if (native) {
    try {
      await TextToSpeech.speak({ text, lang: 'en-US', rate: opts.rate ?? 1, pitch: opts.pitch ?? 1, volume: 1, category: 'playback' });
    } catch (err) {
      // stop() makes the pending speak() reject: that's a normal stop, not a failure
      if (/interrupt|stop|cancel/i.test(err instanceof Error ? err.message : String(err))) return;
      throw err;
    }
    return;
  }
  return speakWithBrowser(text, opts.voice, opts.rate, opts.pitch);
};

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
  if (native) TextToSpeech.stop().catch(() => {});
};

const speakWithBrowser = (text: string, voice?: SpeechSynthesisVoice, rate = 1.02, pitch = 1): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!browserSpeechSupported()) {
      reject(new Error('Speech is not supported in this browser.'));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = pitch;
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
  await speakWithDevice(plain, { voice: options.browserVoice, rate: 1.02 });
};
