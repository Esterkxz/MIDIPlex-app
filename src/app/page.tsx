'use client';

import { useEffect, useState } from 'react';
import { Midi } from '@tonejs/midi';
import * as Tone from 'tone';
import MidiUpload from '@/components/MidiUpload';
import SoundFontUpload from '@/components/SoundFontUpload';
import PianoRoll from '@/components/PianoRoll';
import type { ProjectState } from '@/lib/types/project';
import { AudioEngine } from '@/lib/audio-engine';

const VOLUME_KEY = 'midiplex.volume';
const DEFAULT_VOLUME = 0.1;
const DESIRED_SAMPLE_RATE = 48000; // lesson 003 — Windows 고급 오디오 device 의 비표준 rate (384kHz 등) 호환

export default function Home() {
  const [project, setProject] = useState<ProjectState | null>(null);
  // Midi 객체 보존 — 향후 편집 후 SMF 내보내기 + audio engine fallback 의 트랙 노트 직접 사용
  const [, setMidi] = useState<Midi | null>(null);
  const [engine] = useState(() => new AudioEngine());
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [hydrated, setHydrated] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [sfLoaded, setSfLoaded] = useState(false);
  const [mode, setMode] = useState<'oscillator' | 'spessasynth'>('oscillator');

  // ctx sampleRate 강제 (lesson 003)
  useEffect(() => {
    try {
      const currentRate = Tone.getContext().rawContext.sampleRate;
      if (currentRate !== DESIRED_SAMPLE_RATE) {
        console.log(`[page] AudioContext sampleRate ${currentRate} → ${DESIRED_SAMPLE_RATE} 강제 변경`);
        const ctx = new AudioContext({ sampleRate: DESIRED_SAMPLE_RATE });
        Tone.setContext(ctx);
      }
    } catch (e) {
      console.warn('[page] AudioContext sampleRate 강제 실패:', e);
    }
  }, []);

  // 볼륨 hydration
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VOLUME_KEY);
      if (saved != null) {
        const parsed = Number(saved);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
          setVolume(parsed);
        }
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {}
  }, [volume, hydrated]);

  useEffect(() => {
    engine.setOnEnd(() => setIsPlaying(false));
  }, [engine]);

  useEffect(() => {
    engine.setVolume(volume);
  }, [engine, volume]);

  // playhead RAF + sequencer 자동 종료 감지
  useEffect(() => {
    if (!isPlaying) {
      setCurrentTime(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      setCurrentTime(engine.getCurrentTime());
      if (!engine.isPlayingNow()) {
        setIsPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, engine]);

  const handleMidiLoaded = (
    loadedMidi: Midi,
    loadedProject: ProjectState,
    buffer: ArrayBuffer,
    fileName: string,
  ) => {
    engine.stop();
    setMidi(loadedMidi);
    setProject(loadedProject);
    engine.loadMidi(loadedMidi, buffer, fileName);
    setIsPlaying(false);
  };

  const handleSoundFontLoaded = async (buffer: ArrayBuffer) => {
    await engine.loadSoundFont(buffer);
    setSfLoaded(engine.isSoundFontLoaded());
    setMode(engine.getMode());
  };

  const handleProjectChange = (next: ProjectState) => {
    setProject(next);
    // 재생 중이면 다음 play 때 반영 (sequencer reload 가 끊김 유발 가능). 정지 중이면 즉시 반영.
    if (!isPlaying) {
      try {
        engine.applyProject(next);
      } catch (e) {
        console.warn('[page] applyProject 실패:', e);
      }
    }
  };

  const handlePlayToggle = async () => {
    if (!project) return;
    if (isPlaying) {
      engine.stop();
      setIsPlaying(false);
    } else {
      // 매번 fresh 보장 — 편집 후 첫 play 의 동기 누락 방지
      try {
        engine.applyProject(project);
      } catch (e) {
        console.warn('[page] applyProject(play) 실패:', e);
      }
      await engine.play();
      setIsPlaying(true);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-8 gap-6 bg-white text-gray-900">
      <header className="flex flex-col items-center gap-1">
        <h1 className="text-3xl font-bold">MIDIPlex</h1>
        <p className="text-sm text-gray-600">웹 MIDI 작곡 · 편곡 도구 (Phase 2 MVP 진행 중)</p>
      </header>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        <MidiUpload onLoaded={handleMidiLoaded} />
        <SoundFontUpload onLoaded={handleSoundFontLoaded} loaded={sfLoaded} />
      </div>

      {project && (
        <>
          <div className="flex gap-6 items-center flex-wrap justify-center">
            <button
              onClick={handlePlayToggle}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              {isPlaying ? '⏹ 정지' : '▶ 재생'}
            </button>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <span className="text-xs text-gray-500">볼륨</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(volume * 100)}
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
                className="w-32"
              />
              <span className="w-10 text-right tabular-nums">{Math.round(volume * 100)}%</span>
            </label>

            <span className="text-xs px-2 py-1 rounded bg-gray-100 border">
              모드: {mode === 'spessasynth' ? '🎹 SoundFont (spessasynth)' : '🌊 Oscillator (임시)'}
            </span>

            <span className="text-sm text-gray-600">
              {project.title} · {project.tracks.length} 트랙 · {project.durationSeconds.toFixed(1)}s · BPM {project.bpm}
            </span>
          </div>

          <PianoRoll
            project={project}
            currentTime={currentTime}
            onProjectChange={handleProjectChange}
            onPreviewNote={(midi, velocity, channel) => engine.previewNote(midi, velocity, channel)}
          />

          <details className="text-sm text-gray-600 max-w-3xl w-full">
            <summary className="cursor-pointer">트랙 정보</summary>
            <ul className="mt-2 space-y-1 list-disc list-inside">
              {project.tracks.map((t) => (
                <li key={t.id}>
                  {t.name} · {t.notes?.length ?? 0} notes · channel {t.channel} · instrument {t.instrumentId}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}

      <footer className="mt-8 text-xs text-gray-400 text-center">
        Phase 2 MVP — M1 (업로드) · M2 (파싱) · M3 (피아노롤) · M4/M5 (재생 + 사운드폰트) · M6 (편집: 선택/연필/지우개/드래그/마키/Delete) — `MIDIPlex/.agent/PM/003_WBS.md`
        <br />
        ADR 0001 v1.1 + ADR 0006 + lesson 002·003·004 회피.
      </footer>
    </main>
  );
}
