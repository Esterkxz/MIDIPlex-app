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
import {
  saveProject,
  loadProject,
  listProjects,
  deleteProject,
  type ProjectListEntry,
} from '@/lib/storage/indexeddb-store';
import { downloadSmf, projectToSmfBuffer } from '@/lib/midi-export';

const VOLUME_KEY = 'midiplex.volume';
const SIDEBAR_KEY = 'midiplex.sidebar.collapsed';
const SIDEBAR_WIDTH_KEY = 'midiplex.sidebar.width';
const DEFAULT_SIDEBAR_WIDTH = 288; // px (= w-72)
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
  const [sidebarWidth, setSidebarWidth] = useState<number>(DEFAULT_SIDEBAR_WIDTH);
  const [visibleTracks, setVisibleTracks] = useState<Set<number>>(new Set());

  // Undo / Redo / Reset 히스토리 — 파일 로드 시점 = initial. 편집마다 past 에 push, future 비움.
  const [initialProject, setInitialProject] = useState<ProjectState | null>(null);
  const [past, setPast] = useState<ProjectState[]>([]);
  const [future, setFuture] = useState<ProjectState[]>([]);
  const HISTORY_LIMIT = 100;

  // 편집 여부 — 편집 없으면 재생 시 원본 buffer 그대로 사용 (SMF 재직렬화 우회).
  const [isDirty, setIsDirty] = useState(false);

  // M7 IndexedDB 저장 상태
  const [recentProjects, setRecentProjects] = useState<ProjectListEntry[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);

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
      const sw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (sw != null) {
        const n = Number(sw);
        if (Number.isFinite(n) && n >= 180 && n <= 600) setSidebarWidth(n);
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
    if (!hydrated) return;
    try {
      window.localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0');
    } catch {}
  }, [sidebarCollapsed, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {}
  }, [sidebarWidth, hydrated]);

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
    loadedProject: ProjectState,
    loadedMidi: Midi | null,
    buffer: ArrayBuffer | null,
    fileName: string,
  ) => {
    engine.stop();
    setMidi(loadedMidi);
    setProject(loadedProject);
    if (loadedMidi && buffer) {
      // 표준 MIDI — 원본 buffer 그대로 sequencer 에 (편집 없는 상태에선 이게 정확)
      engine.loadMidi(loadedMidi, buffer, fileName);
    } else {
      // NWC 등 비-SMF 입력 — applyProject 로 SMF 재직렬화 후 sequencer
      try {
        engine.applyProject(loadedProject);
      } catch (e) {
        console.warn('[page] NWC applyProject 실패:', e);
      }
    }
    setIsPlaying(false);
    // 활성 트랙: 첫 노트 트랙
    const firstWithNotes = loadedProject.tracks.findIndex((t) => (t.notes?.length ?? 0) > 0);
    setActiveTrack(firstWithNotes < 0 ? 0 : firstWithNotes);
    // 모든 트랙 visible 로 초기화
    setVisibleTracks(new Set(loadedProject.tracks.map((_, i) => i)));
    // 히스토리 초기화 — initial = 로드 시점
    setInitialProject(loadedProject);
    setPast([]);
    setFuture([]);
    setIsDirty(false); // 새 곡 = 편집 없음, 원본 buffer 그대로 재생
  };

  const handleSoundFontLoaded = async (buffer: ArrayBuffer) => {
    await engine.loadSoundFont(buffer);
    setSfLoaded(engine.isSoundFontLoaded());
    setMode(engine.getMode());
  };

  const handleProjectChange = (next: ProjectState) => {
    if (project) {
      setPast((p) => {
        const np = [...p, project];
        if (np.length > HISTORY_LIMIT) np.splice(0, np.length - HISTORY_LIMIT);
        return np;
      });
      setFuture([]);
    }
    setProject(next);
    setIsDirty(true);
    if (!isPlaying) {
      try {
        engine.applyProject(next);
      } catch (e) {
        console.warn('[page] applyProject 실패:', e);
      }
    }
  };

  const handleUndo = () => {
    if (past.length === 0 || !project) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, project]);
    setProject(prev);
    // initial 로 되돌렸으면 dirty 해제 (원본 buffer 재사용 가능)
    setIsDirty(prev !== initialProject);
    if (!isPlaying) {
      try { engine.applyProject(prev); } catch (e) { console.warn('[page] undo applyProject:', e); }
    }
  };

  const handleRedo = () => {
    if (future.length === 0 || !project) return;
    const next = future[future.length - 1];
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, project]);
    setProject(next);
    setIsDirty(next !== initialProject);
    if (!isPlaying) {
      try { engine.applyProject(next); } catch (e) { console.warn('[page] redo applyProject:', e); }
    }
  };

  // M7 — 자동저장 (debounce 5s, 편집 직후 트리거)
  useEffect(() => {
    if (!project || !isDirty) return;
    const t = setTimeout(() => {
      saveProject(project)
        .then(() => {
          setSavedAt(new Date().toISOString());
          setIsDirty(false);
          // 최근 목록 갱신
          listProjects().then(setRecentProjects).catch(() => {});
        })
        .catch((e) => console.warn('[page] 자동저장 실패:', e));
    }, 5000);
    return () => clearTimeout(t);
  }, [project, isDirty]);

  // 최초 hydration 시 + 새 곡 로드 후 최근 목록 fetch
  useEffect(() => {
    if (!hydrated) return;
    listProjects().then(setRecentProjects).catch(() => {});
  }, [hydrated, project?.id]);

  const handleManualSave = async () => {
    if (!project) return;
    try {
      await saveProject(project);
      setSavedAt(new Date().toISOString());
      setIsDirty(false);
      const list = await listProjects();
      setRecentProjects(list);
    } catch (e) {
      console.warn('[page] 수동저장 실패:', e);
    }
  };

  const handleOpenSaved = async (id: string) => {
    try {
      console.log('[page] open IndexedDB project:', id);
      const loaded = await loadProject(id);
      if (!loaded) {
        console.warn('[page] open: project not found:', id);
        return;
      }
      console.log(
        `[page] loaded: title="${loaded.title}" tracks=${loaded.tracks.length} ` +
          `notes=${loaded.tracks.reduce((s, t) => s + (t.notes?.length ?? 0), 0)} ` +
          `ppq=${loaded.ppq} bpm=${loaded.bpm} duration=${loaded.durationSeconds}s`,
      );
      // handleMidiLoaded 와 동일 흐름 — SMF 재직렬화 후 Midi 객체 만들어 engine.loadMidi 사용
      const buffer = projectToSmfBuffer(loaded);
      const midi = new Midi(buffer);
      handleMidiLoaded(loaded, midi, buffer, `${loaded.title}.mid`);
      // handleMidiLoaded 가 setIsDirty(false) 함 — 이후 추가 정리만
      setSavedAt(loaded.modifiedAt);
    } catch (e) {
      console.warn('[page] open 실패:', e);
    }
  };

  const handleDeleteSaved = async (id: string) => {
    try {
      await deleteProject(id);
      const list = await listProjects();
      setRecentProjects(list);
    } catch (e) {
      console.warn('[page] delete 실패:', e);
    }
  };

  const handleExportSmf = () => {
    if (!project) return;
    try {
      downloadSmf(project, project.title);
    } catch (e) {
      console.warn('[page] SMF 내보내기 실패:', e);
    }
  };

  const handleTrackInstrumentChange = (trackIndex: number, programNumber: number) => {
    if (!project) return;
    const next: ProjectState = {
      ...project,
      tracks: project.tracks.map((t, i) =>
        i === trackIndex ? { ...t, instrumentId: `instrument-${programNumber}` } : t,
      ),
      modifiedAt: new Date().toISOString(),
    };
    handleProjectChange(next);
  };

  const handleReset = () => {
    if (!initialProject || !project) return;
    if (project === initialProject) return;
    setPast((p) => [...p, project]);
    setFuture([]);
    setProject(initialProject);
    setIsDirty(false); // 처음 = 원본
    if (!isPlaying) {
      try { engine.applyProject(initialProject); } catch (e) { console.warn('[page] reset applyProject:', e); }
    }
  };

  // 키보드 단축키 — Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [past, future, project, isPlaying]);

  const handlePlayToggle = async () => {
    if (!project) return;
    if (isPlaying) {
      engine.stop();
      setIsPlaying(false);
    } else {
      // 편집된 경우에만 SMF 재직렬화. 원본 buffer 가 있으면 그대로 재생.
      if (isDirty) {
        try {
          engine.applyProject(project);
        } catch (e) {
          console.warn('[page] applyProject(play) 실패:', e);
        }
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

            <div className="flex gap-1 items-center text-xs">
              <button
                onClick={handleUndo}
                disabled={past.length === 0}
                className="px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                title="실행 취소 (Ctrl+Z)"
              >
                ↶ Undo {past.length > 0 ? `(${past.length})` : ''}
              </button>
              <button
                onClick={handleRedo}
                disabled={future.length === 0}
                className="px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                title="다시 실행 (Ctrl+Shift+Z / Ctrl+Y)"
              >
                ↷ Redo {future.length > 0 ? `(${future.length})` : ''}
              </button>
              <button
                onClick={handleReset}
                disabled={!initialProject || project === initialProject}
                className="px-2 py-1 border rounded hover:bg-orange-50 text-orange-600 disabled:opacity-40 disabled:cursor-not-allowed"
                title="처음 상태로 (파일 로드 시점)"
              >
                ⟲ 처음
              </button>
            </div>

            <div className="flex gap-1 items-center text-xs">
              <button
                onClick={handleManualSave}
                className="px-2 py-1 border rounded hover:bg-green-50 text-green-700"
                title={savedAt ? `저장됨: ${new Date(savedAt).toLocaleTimeString()}` : '저장 (브라우저 IndexedDB)'}
              >
                💾 저장 {isDirty ? '*' : ''}
              </button>

              <details className="relative">
                <summary className="cursor-pointer px-2 py-1 border rounded hover:bg-gray-50 list-none">
                  📁 열기 ({recentProjects.length})
                </summary>
                <div className="absolute right-0 top-full mt-1 bg-white border rounded shadow-lg z-20 min-w-[280px] max-h-[400px] overflow-y-auto">
                  {recentProjects.length === 0 ? (
                    <div className="text-xs text-gray-400 px-3 py-3">저장된 작업 없음</div>
                  ) : (
                    <ul>
                      {recentProjects.map((entry) => (
                        <li key={entry.id} className="border-b last:border-b-0 hover:bg-gray-50">
                          <div className="flex items-center gap-2 px-3 py-2">
                            <button
                              onClick={() => handleOpenSaved(entry.id)}
                              className="flex-1 text-left min-w-0"
                            >
                              <div className="text-xs font-medium text-gray-800 truncate">
                                {entry.title}
                              </div>
                              <div className="text-[10px] text-gray-500 truncate">
                                {entry.trackCount} 트랙 · {entry.noteCount} 노트 · {entry.durationSeconds.toFixed(1)}s
                              </div>
                              <div className="text-[10px] text-gray-400">
                                {new Date(entry.modifiedAt).toLocaleString()}
                              </div>
                            </button>
                            <button
                              onClick={() => handleDeleteSaved(entry.id)}
                              className="text-xs text-red-500 hover:text-red-700 px-1"
                              title="삭제"
                            >
                              ✕
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>

              <button
                onClick={handleExportSmf}
                className="px-2 py-1 border rounded hover:bg-blue-50 text-blue-700"
                title=".mid 파일로 다운로드"
              >
                ⬇ .mid
              </button>
            </div>

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
              visibleTracks={visibleTracks}
              onVisibleChange={setVisibleTracks}
              collapsed={sidebarCollapsed}
              onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
              width={sidebarWidth}
              onWidthChange={setSidebarWidth}
              onTrackInstrumentChange={handleTrackInstrumentChange}
            />
            <section className="flex-1 min-w-0 p-2 flex flex-col">
              <PianoRoll
                project={project}
                currentTime={currentTime}
                onProjectChange={handleProjectChange}
                onPreviewNote={(midi, velocity, channel) => engine.previewNote(midi, velocity, channel)}
                activeTrack={activeTrack}
                visibleTracks={visibleTracks}
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
