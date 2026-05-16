// Notification sounds using Web Audio API — no external dependencies needed
import { ASSET_BASE_URL } from './constants';

let audioCtx: AudioContext | null = null;
let receivedAudio: HTMLAudioElement | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(frequencies: number[], durations: number[], volume = 0.15, type: OscillatorType = 'sine') {
  try {
    const ctx = getAudioContext();
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    masterGain.gain.setValueAtTime(volume, ctx.currentTime);

    let offset = 0;
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const noteGain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + offset);
      osc.connect(noteGain);
      noteGain.connect(masterGain);

      const dur = durations[i] || 0.15;
      // Fade in
      noteGain.gain.setValueAtTime(0, ctx.currentTime + offset);
      noteGain.gain.linearRampToValueAtTime(1, ctx.currentTime + offset + 0.02);
      // Fade out
      noteGain.gain.setValueAtTime(1, ctx.currentTime + offset + dur - 0.04);
      noteGain.gain.linearRampToValueAtTime(0, ctx.currentTime + offset + dur);

      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + dur);

      offset += dur;
    });

    // Cleanup master gain
    masterGain.gain.setValueAtTime(volume, ctx.currentTime + offset);
    masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + offset + 0.05);
  } catch (e) {
    console.log('Sound play failed:', e);
  }
}

/**
 * Sound presets for notifications
 */
export const NOTIFICATION_SOUNDS = [
  { key: 'default', label: 'Classic Ping', type: 'file', url: '/sounds/iphone_notification.mp3' },
  { key: 'chime', label: 'Gentle Chime', type: 'synth', freq: [880, 1109], dur: [0.1, 0.2] },
  { key: 'alert', label: 'Modern Alert', type: 'synth', freq: [1000, 800], dur: [0.05, 0.1] },
  { key: 'glass', label: 'Glass Tap', type: 'synth', freq: [1500], dur: [0.05] },
  { key: 'pulse', label: 'Steady Pulse', type: 'synth', freq: [600, 600], dur: [0.1, 0.1] },
  { key: 'triple', label: 'Triple Echo', type: 'synth', freq: [440, 880, 1760], dur: [0.05, 0.05, 0.1] },
];

/**
 * Plays a notification sound by its preset key or a direct URL
 */
export function playNotificationSound(soundKey: string = 'default') {
  // Check if soundKey is a direct URL (custom uploaded sound)
  if (soundKey.startsWith('/') || soundKey.startsWith('http')) {
    playCustomFile(soundKey);
    return;
  }

  const preset = NOTIFICATION_SOUNDS.find(s => s.key === soundKey) || NOTIFICATION_SOUNDS[0];

  if (preset.type === 'file' && preset.url) {
    playCustomFile(preset.url);
  } else if (preset.type === 'synth') {
    playTone(preset.freq || [880], preset.dur || [0.1], 0.15, 'sine');
  }
}

function playCustomFile(url: string) {
  try {
    // Use ASSET_BASE_URL for absolute URLs, or construct using it for relative paths
    let fullUrl: string;
    if (url.startsWith('http')) {
      fullUrl = url;
    } else if (url.startsWith('/')) {
      // Relative path - use ASSET_BASE_URL if available, else window.location.origin
      fullUrl = ASSET_BASE_URL ? `${ASSET_BASE_URL}${url}` : `${window.location.origin}${url}`;
    } else {
      fullUrl = `${window.location.origin}/${url}`;
    }

    if (!receivedAudio || receivedAudio.src !== fullUrl) {
      receivedAudio = new Audio(fullUrl);
      receivedAudio.preload = 'auto';
    }
    receivedAudio.currentTime = 0;
    const p = receivedAudio.play();
    if (p && typeof (p as Promise<void>).catch === 'function') {
      (p as Promise<void>).catch(() => {
        // Fallback to synth if file fails
        playTone([880, 1109], [0.09, 0.16], 0.12, 'sine');
      });
    }
  } catch {
    playTone([880, 1109], [0.09, 0.16], 0.12, 'sine');
  }
}

/**
 * Received notification tone (backward compatibility wrapper)
 */
export function playNotificationReceived() {
  playNotificationSound('default');
}

/**
 * Soft single pop for sent messages/notifications
 * (like iMessage send sound)
 */
export function playNotificationSent() {
  // Quick soft pop at G5
  playTone([784], [0.1], 0.1, 'sine');
}

/**
 * Gentle triple-chime for important/urgent notifications
 */
export function playNotificationUrgent() {
  // E6 → G6 → B6 — ascending triad
  playTone([1319, 1568, 1976], [0.1, 0.1, 0.2], 0.15, 'sine');
}

/**
 * Returns available system voices
 */
export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices();
}

/**
 * Uses Web Speech API to speak the provided text
 */
export function speakText(text: string, voiceName?: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    console.warn('Speech synthesis not supported in this browser');
    return;
  }

  // Cancel any ongoing speech to avoid overlap
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  // Set custom voice if provided
  const voices = window.speechSynthesis.getVoices();
  if (voiceName) {
    const selectedVoice = voices.find(v => v.name === voiceName || v.voiceURI === voiceName);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
  }

  // Fallback voice logic if no custom voice or not found
  if (!utterance.voice && voices.length > 0) {
    const englishVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
    utterance.voice = englishVoice;
  }

  window.speechSynthesis.speak(utterance);
}
