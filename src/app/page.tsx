'use client';

import { useEffect, useState } from 'react';
import { Midi } from '@tonejs/midi';
import * as Tone from 'tone';
import MidiUpload from '@/components/MidiUpload';
import SoundFontUpload from '@/components/SoundFontUpload';
import PianoRoll from '@/components/PianoRoll';
import TrackSidebar from '@/components/TrackSidebar';
import type { ProjectState } from '@/lib/types/project';
import { AudioEngine } from '@/lib/audio-engine';

const VOLUME_KEY = 'midiplex.volume';
const SIDEBAR_KEY = 'midiplex.sidebar.collapsed';
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
  const [activeTrack, setActiveTrack] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  // 볼륨 + 사이드바 hydration
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VOLUME_KEY);
      if (saved != null) {
        const parsed = Number(saved);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
          setVolume(parsed);
        }
      }
      const sb = window.localStorage.getItem(SIDEBAR_KEY);
      if (sb === '1') setSidebarCollapsed(true);
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
    if (!hydrated) return;
    try {
      window.localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0');
    } catch {}
  }, [sidebarCollapsed, hydrated]);

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
    // 활성 트랙: 첫 노트 트랙
    const firstWithNotes = loadedProject.tracks.findIndex((t) => (t.notes?.length ?? 0) > 0);
    setActiveTrack(firstWithNotes < 0 ? 0 : firstWithNotes);
  };

  const handleSoundFontLoaded = async (buffer: ArrayBuffer) => {
    await engine.loadSoundFont(buffer);
    setSfLoaded(engine.isSoundFontLoaded());
    setMode(engine.getMode());
  };

  const handleProjectChange = (next: ProjectState) => {
    setProject(next);
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
    <main className="flex flex-col h-screen w-screen bg-white text-gray-900 overflow-hidden">
      {/* 상단 헤더 + 업로드 영역 (project 로드 전) */}
      {!project ? (
        <div className="flex flex-col items-center p-8 gap-6 flex-1 overflow-y-auto">
          <header className="flex flex-col items-center gap-1">
            <h1 className="text-3xl font-bold">MIDIPlex</h1>
            <p className="text-sm text-gray-600">웹 MIDI 작곡 · 편곡 도구 (Phase 2 MVP 진행 중)</p>
          </header>
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <MidiUpload onLoaded={handleMidiLoaded} />
            <SoundFontUpload onLoaded={handleSoundFontLoaded} loaded={sfLoaded} />
          </div>
        </div>
      ) : (
        <>
          {/* 컴팩트 헤더 + 컨트롤 바 (project 로드 후) */}
          <div className="flex items-center gap-4 px-4 py-2 border-b bg-white flex-wrap">
            <h1 className="text-lg font-bold whitespace-nowrap">MIDIPlex</h1>

            <button
              onClick={handlePlayToggle}
              className="px-4 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
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
                className="w-24"
              />
              <span className="w-10 text-right tabular-nums text-xs">{Math.round(volume * 100)}%</span>
            </label>

            <span className="text-xs px-2 py-1 rounded bg-gray-100 border">
              {mode === 'spessasynth' ? '🎹 SF' : '🌊 OSC'}
            </span>

            <span className="text-xs text-gray-600 truncate flex-1 min-w-0" title={project.title}>
              {project.title} · {project.tracks.length} 트랙 · {project.durationSeconds.toFixed(1)}s · BPM {project.bpm}
            </span>

            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700">파일 교체</summary>
              <div className="absolute right-4 top-12 bg-white border rounded shadow-lg p-3 z-10 flex flex-col gap-3">
                <MidiUpload onLoaded={handleMidiLoaded} />
                <SoundFontUpload onLoaded={handleSoundFontLoaded} loaded={sfLoaded} />
              </div>
            </details>
          </div>

          {/* 메인 작업 영역 — 사이드바 + 피아노롤 */}
          <div className="flex flex-1 min-h-0">
            <TrackSidebar
              tracks={project.tracks}
              activeIndex={activeTrack}
              onActiveChange={setActiveTrack}
              collapsed={sidebarCollapsed}
              onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
            />
            <section className="flex-1 min-w-0 p-2 flex flex-col">
              <PianoRoll
                project={project}
                currentTime={currentTime}
                onProjectChange={handleProjectChange}
                onPreviewNote={(midi, velocity, channel) => engine.previewNote(midi, velocity, channel)}
                activeTrack={activeTrack}
              />
            </section>
          </div>

          <footer className="px-4 py-1 text-[10px] text-gray-400 text-center border-t bg-white">
            Phase 2 MVP — M1~M6 walking · ADR 0001 v1.1 + ADR 0006 + lesson 002·003·004 회피
          </footer>
        </>
      )}
    </main>
  );
}
