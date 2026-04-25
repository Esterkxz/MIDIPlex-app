'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import type { ProjectState, Note } from '@/lib/types/project';
import { tickToSeconds, secondsToTick, quantizeTick, nextNoteId } from '@/lib/types/project';

type Props = {
  project: ProjectState;
  currentTime?: number;
  onProjectChange?: (next: ProjectState) => void;
  /** 연필로 노트 그을 때 즉시 미리듣기 (M6 편집 UX). */
  onPreviewNote?: (midi: number, velocity?: number, channel?: number) => void;
  /** 활성 트랙 — 연필 모드에서 신규 노트 들어갈 트랙. 사이드바가 owner. */
  activeTrack?: number;
  /** 노트 표시할 트랙 인덱스 set. 미전달 시 모두 표시. */
  visibleTracks?: Set<number>;
};

type Tool = 'select' | 'pencil' | 'eraser';

type DragState =
  | {
      kind: 'move';
      startX: number; // CSS px
      startY: number;
      startTime: number; // sec
      startPitch: number; // midi
      currentX: number;
      currentY: number;
      // 시작 시점의 선택 노트 스냅샷 (트랙 인덱스 + 노트 인덱스 + 원본 tick/midi)
      initial: Array<{ trackIndex: number; noteIndex: number; tick: number; midi: number }>;
      moved: boolean; // threshold 넘은 적 있는가
    }
  | {
      kind: 'marquee';
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
      additive: boolean; // ctrl
    }
  | {
      kind: 'pencil-create';
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
      noteId: string;
      trackIndex: number;
      noteIndex: number;
      anchorTick: number;
      anchorMidi: number;
    };

const TRACK_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
];

const MIN_X_SCALE = 5;
const MAX_X_SCALE = 1500;
const MIN_PITCH_HEIGHT = 2;
const MAX_PITCH_HEIGHT = 120; // 한 옥타브가 1440px 까지 — 좁은 음역 곡 자동 fit + 여유

const DEFAULT_X_SCALE = 80;
const DEFAULT_PITCH_HEIGHT = 8;

const HEADER_PX = 22;
const KEY_LABEL_PX = 32;

const DRAG_THRESHOLD_PX = 4;

type FlatNote = {
  id: string;
  tick: number;
  durationTicks: number;
  midi: number;
  velocity: number;
  trackIndex: number;
  noteIndex: number;
};

export default function PianoRoll({
  project,
  currentTime = 0,
  onProjectChange,
  onPreviewNote,
  activeTrack: activeTrackProp,
  visibleTracks,
}: Props) {
  const isVisible = (trackIndex: number) =>
    visibleTracks ? visibleTracks.has(trackIndex) : true;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // viewport
  const [containerSize, setContainerSize] = useState({ w: 800, h: 400 });
  const [xScale, setXScale] = useState(DEFAULT_X_SCALE);
  const [pitchHeight, setPitchHeight] = useState(DEFAULT_PITCH_HEIGHT);
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [autoFollow, setAutoFollow] = useState(true);

  // 편집 상태
  const [tool, setTool] = useState<Tool>('select');
  const [snapDenom, setSnapDenom] = useState<number>(16); // 1/16 default
  // activeTrack 은 prop 우선, fallback 으로 0
  const activeTrack = activeTrackProp ?? 0;
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [dragState, setDragState] = useState<DragState | null>(null);

  // 메타
  const allNotes: FlatNote[] = project.tracks.flatMap((track, trackIndex) =>
    (track.notes ?? []).map((n, noteIndex) => ({
      id: n.id,
      tick: n.tick,
      durationTicks: n.durationTicks,
      midi: n.midi,
      velocity: n.velocity,
      trackIndex,
      noteIndex,
    })),
  );
  const totalDuration = Math.max(project.durationSeconds, 0.001);
  const minPitch = allNotes.length ? Math.min(...allNotes.map((n) => n.midi)) : 60;
  const maxPitch = allNotes.length ? Math.max(...allNotes.map((n) => n.midi)) : 72;

  const noteToSec = useCallback(
    (tick: number) => tickToSeconds(tick, project.ppq, project.bpm),
    [project.ppq, project.bpm],
  );

  // 새 곡 로드 시 viewport 리셋 + 사용자 zoom 플래그 해제
  const [userZoomed, setUserZoomed] = useState(false);
  useEffect(() => {
    setSelection(new Set());
    setDragState(null);
    setUserZoomed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // 자동 fit — 사용자가 직접 zoom 한 적 없을 때 컨테이너 측정 변할 때마다 재계산.
  //   시간축: 곡 전체가 가로 100% 차지
  //   피치축: 모든 노트가 보이면서 최대한 확대 — 세로 95% 차지 (cap 없음)
  // ResizeObserver 가 첫 callback 에서 작은 값을 보고했더라도, layout 안정 후 큰 값
  // 들어오면 다시 fit. 사용자가 직접 zoom 하면 그 시점 plag 세팅 → 자동 fit 중단.
  useEffect(() => {
    if (userZoomed) return;
    if (containerSize.w < 100 || containerSize.h < 100) return;
    if (allNotes.length === 0) return;
    const w = containerSize.w - KEY_LABEL_PX;
    const fitX = Math.max(MIN_X_SCALE, Math.min(MAX_X_SCALE, w / totalDuration));
    setXScale(fitX);
    setScrollX(0);
    const pitchRange = Math.max(maxPitch - minPitch + 4, 1);
    const targetH = (containerSize.h - HEADER_PX) * 0.95;
    const fitPH = Math.max(MIN_PITCH_HEIGHT, targetH / pitchRange);
    setPitchHeight(fitPH);
    setScrollY(Math.max(0, minPitch - 2));
  }, [userZoomed, containerSize.w, containerSize.h, allNotes.length, totalDuration, minPitch, maxPitch]);

  // ResizeObserver
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setContainerSize({ w: width, h: height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // playhead auto-follow
  useEffect(() => {
    if (!autoFollow || currentTime <= 0) return;
    const visibleSec = (containerSize.w - KEY_LABEL_PX) / xScale;
    const followMargin = visibleSec * 0.1;
    if (currentTime >= scrollX + visibleSec - followMargin) {
      setScrollX(Math.max(0, currentTime - visibleSec * 0.2));
    }
    if (currentTime < scrollX) {
      setScrollX(Math.max(0, currentTime - visibleSec * 0.2));
    }
  }, [currentTime, autoFollow, scrollX, xScale, containerSize.w]);

  // ----- 좌표 변환 -----
  const rollX0 = KEY_LABEL_PX;
  const rollY0 = HEADER_PX;
  const rollW = containerSize.w - rollX0;
  const rollH = containerSize.h - rollY0;

  const cssToTime = useCallback(
    (cssX: number) => Math.max(0, scrollX + (cssX - rollX0) / xScale),
    [scrollX, xScale, rollX0],
  );
  const cssToPitch = useCallback(
    (cssY: number) => {
      const fromTop = cssY - rollY0;
      const pitchOffsetFromBottom = (rollH - fromTop) / pitchHeight;
      return Math.max(0, Math.min(127, Math.floor(scrollY + pitchOffsetFromBottom)));
    },
    [scrollY, pitchHeight, rollY0, rollH],
  );

  // hit-test (top-most first) — 숨김 트랙 노트는 클릭 불가
  const hitTestNote = useCallback(
    (cssX: number, cssY: number): FlatNote | null => {
      for (let i = allNotes.length - 1; i >= 0; i--) {
        const n = allNotes[i];
        if (!isVisible(n.trackIndex)) continue;
        const ns = noteToSec(n.tick);
        const nd = noteToSec(n.durationTicks);
        const ne = ns + nd;
        const xLeft = rollX0 + (ns - scrollX) * xScale;
        const xRight = rollX0 + (ne - scrollX) * xScale;
        const yTop = rollY0 + rollH - (n.midi - scrollY + 1) * pitchHeight;
        const yBot = yTop + Math.max(pitchHeight - 1, 2);
        if (cssX >= xLeft && cssX <= xRight && cssY >= yTop && cssY <= yBot) {
          return n;
        }
      }
      return null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allNotes, noteToSec, scrollX, scrollY, xScale, pitchHeight, rollX0, rollY0, rollH, visibleTracks],
  );

  // ----- 그리기 -----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = containerSize.w;
    const cssH = containerSize.h;
    canvas.width = Math.max(cssW * dpr, 1);
    canvas.height = Math.max(cssH * dpr, 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, cssW, cssH);

    const visibleSec = rollW / xScale;
    const visiblePitches = Math.floor(rollH / pitchHeight);

    // 시간 그리드
    const gridStep =
      xScale > 200 ? 0.25 :
      xScale > 80 ? 1 :
      xScale > 30 ? 4 : 8;
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#999';
    const tStart = Math.floor(scrollX / gridStep) * gridStep;
    for (let t = tStart; t < scrollX + visibleSec; t += gridStep) {
      const x = rollX0 + (t - scrollX) * xScale;
      if (x < rollX0 - 1) continue;
      ctx.beginPath();
      ctx.moveTo(x, rollY0);
      ctx.lineTo(x, rollY0 + rollH);
      ctx.stroke();
      ctx.fillText(`${t.toFixed(t < 10 ? 1 : 0)}s`, x + 2, rollY0 - 6);
    }

    // 피치 그리드
    for (let p = scrollY; p <= scrollY + visiblePitches + 1; p++) {
      const isC = p % 12 === 0;
      const y = rollY0 + rollH - (p - scrollY) * pitchHeight;
      if (y < rollY0 || y > rollY0 + rollH) continue;
      ctx.strokeStyle = isC ? '#ddd' : '#f0f0f0';
      ctx.beginPath();
      ctx.moveTo(rollX0, y);
      ctx.lineTo(cssW, y);
      ctx.stroke();
      if (isC && pitchHeight >= 6) {
        const octave = Math.floor(p / 12) - 1;
        ctx.fillStyle = '#666';
        ctx.fillText(`C${octave}`, 4, y - 2);
      }
    }

    // 드래그 중인 move 의 delta 계산 (preview 용)
    let moveDeltaTick = 0;
    let moveDeltaMidi = 0;
    if (dragState?.kind === 'move' && dragState.moved) {
      const dx = dragState.currentX - dragState.startX;
      const dy = dragState.currentY - dragState.startY;
      const deltaSec = dx / xScale;
      const rawDeltaTick = secondsToTick(deltaSec, project.ppq, project.bpm);
      const step = (project.ppq * 4) / snapDenom;
      moveDeltaTick = Math.round(rawDeltaTick / step) * step;
      moveDeltaMidi = -Math.round(dy / pitchHeight);
    }

    // 노트 (viewport culling + 트랙 visibility culling)
    const tEnd = scrollX + visibleSec;
    const pEnd = scrollY + visiblePitches + 1;
    for (const note of allNotes) {
      if (!isVisible(note.trackIndex)) continue;
      const isSel = selection.has(note.id);
      // move preview 적용
      let drawTick = note.tick;
      let drawMidi = note.midi;
      if (isSel && dragState?.kind === 'move') {
        drawTick = note.tick + moveDeltaTick;
        drawMidi = note.midi + moveDeltaMidi;
      }
      const ns = noteToSec(drawTick);
      const nd = noteToSec(note.durationTicks);
      const ne = ns + nd;
      if (ne < scrollX || ns > tEnd) continue;
      if (drawMidi < scrollY - 1 || drawMidi > pEnd) continue;

      const x = rollX0 + (ns - scrollX) * xScale;
      const w = Math.max(nd * xScale, 2);
      const y = rollY0 + rollH - (drawMidi - scrollY + 1) * pitchHeight;
      const h = Math.max(pitchHeight - 1, 2);

      const v = Number.isFinite(note.velocity) ? Math.max(0, Math.min(1, note.velocity)) : 0.7;
      ctx.fillStyle = TRACK_COLORS[note.trackIndex % TRACK_COLORS.length];
      ctx.globalAlpha = 0.55 + v * 0.45;
      ctx.fillRect(x, y, w, h);

      if (isSel) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
      }
    }
    ctx.globalAlpha = 1;

    // 마키 사각형
    if (dragState?.kind === 'marquee') {
      const x = Math.min(dragState.startX, dragState.currentX);
      const y = Math.min(dragState.startY, dragState.currentY);
      const w = Math.abs(dragState.currentX - dragState.startX);
      const h = Math.abs(dragState.currentY - dragState.startY);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }

    // playhead
    if (currentTime > 0 && currentTime <= totalDuration) {
      const px = rollX0 + (currentTime - scrollX) * xScale;
      if (px >= rollX0 && px <= cssW) {
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, rollY0);
        ctx.lineTo(px, rollY0 + rollH);
        ctx.stroke();
        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.moveTo(px - 5, rollY0);
        ctx.lineTo(px + 5, rollY0);
        ctx.lineTo(px, rollY0 + 6);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 헤더
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cssW, HEADER_PX);
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    const meta = `${allNotes.length} notes · sel ${selection.size} · pitch ${minPitch}-${maxPitch} · ${totalDuration.toFixed(1)}s · ${xScale.toFixed(0)}px/s · t=[${scrollX.toFixed(1)}, ${(scrollX + visibleSec).toFixed(1)}]`;
    ctx.fillText(meta, 8, 14);

    // 좌측 라벨 영역
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, rollY0, KEY_LABEL_PX, rollH);
    ctx.strokeStyle = '#ccc';
    ctx.beginPath();
    ctx.moveTo(KEY_LABEL_PX, rollY0);
    ctx.lineTo(KEY_LABEL_PX, rollY0 + rollH);
    ctx.stroke();
  }, [
    allNotes, selection, dragState, visibleTracks,
    project.ppq, project.bpm, snapDenom,
    currentTime, totalDuration,
    containerSize.w, containerSize.h,
    xScale, pitchHeight, scrollX, scrollY,
    rollW, rollH, noteToSec, minPitch, maxPitch,
  ]);

  // ----- 마우스 핸들러 -----

  const getCanvasCoords = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 2) return; // left or right
    const { x, y } = getCanvasCoords(e);
    if (x < rollX0 || y < rollY0) return; // 라벨/헤더 영역 무시

    const hit = hitTestNote(x, y);

    // 우클릭: 어디든 노트 위면 즉시 삭제 (eraser shortcut)
    if (e.button === 2) {
      e.preventDefault();
      if (hit) {
        deleteNotes([hit.id]);
      }
      return;
    }

    // tool 별 분기
    if (tool === 'eraser') {
      if (hit) deleteNotes([hit.id]);
      return;
    }

    if (tool === 'pencil') {
      if (hit) {
        // pencil 도 노트 위 클릭 시 선택만 (실수 add 방지)
        setSelection(new Set([hit.id]));
        return;
      }
      // 빈 공간 → 신규 노트 생성 + drag 로 길이 조절
      const tick = quantizeTick(secondsToTick(cssToTime(x), project.ppq, project.bpm), project.ppq, snapDenom);
      const midi = cssToPitch(y);
      const step = (project.ppq * 4) / snapDenom;
      const newId = nextNoteId();

      // active 트랙에 추가
      const trackIdx = Math.max(0, Math.min(project.tracks.length - 1, activeTrack));
      const track = project.tracks[trackIdx];
      if (!track) return;
      const newNote: Note = {
        id: newId,
        tick,
        durationTicks: step,
        midi,
        velocity: 0.7,
      };
      const nextTracks = project.tracks.map((t, i) =>
        i === trackIdx ? { ...t, notes: [...(t.notes ?? []), newNote] } : t,
      );
      const noteIdx = (track.notes?.length ?? 0);
      commitProject({ ...project, tracks: nextTracks, modifiedAt: new Date().toISOString() });
      setSelection(new Set([newId]));
      // 즉시 미리듣기
      onPreviewNote?.(midi, 0.8, track.channel ?? 0);
      setDragState({
        kind: 'pencil-create',
        startX: x, startY: y, currentX: x, currentY: y,
        noteId: newId,
        trackIndex: trackIdx,
        noteIndex: noteIdx,
        anchorTick: tick,
        anchorMidi: midi,
      });
      return;
    }

    // tool === 'select'
    if (hit) {
      // 클릭 시 선택 + 드래그 시작 (move)
      let nextSel: Set<string>;
      if (e.ctrlKey || e.metaKey) {
        nextSel = new Set(selection);
        if (nextSel.has(hit.id)) nextSel.delete(hit.id);
        else nextSel.add(hit.id);
      } else if (selection.has(hit.id)) {
        nextSel = selection;
      } else {
        nextSel = new Set([hit.id]);
      }
      setSelection(nextSel);
      // initial 스냅샷
      const initial: Array<{ trackIndex: number; noteIndex: number; tick: number; midi: number }> = [];
      for (const fn of allNotes) {
        if (nextSel.has(fn.id)) {
          initial.push({ trackIndex: fn.trackIndex, noteIndex: fn.noteIndex, tick: fn.tick, midi: fn.midi });
        }
      }
      setDragState({
        kind: 'move',
        startX: x, startY: y, currentX: x, currentY: y,
        startTime: cssToTime(x), startPitch: cssToPitch(y),
        initial,
        moved: false,
      });
    } else {
      // 빈 공간 → 마키
      setDragState({
        kind: 'marquee',
        startX: x, startY: y, currentX: x, currentY: y,
        additive: e.ctrlKey || e.metaKey,
      });
      if (!(e.ctrlKey || e.metaKey)) {
        setSelection(new Set());
      }
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragState) return;
    const { x, y } = getCanvasCoords(e);
    if (dragState.kind === 'move') {
      const dx = x - dragState.startX;
      const dy = y - dragState.startY;
      const moved = dragState.moved || Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX;
      setDragState({ ...dragState, currentX: x, currentY: y, moved });
    } else if (dragState.kind === 'marquee') {
      setDragState({ ...dragState, currentX: x, currentY: y });
    } else if (dragState.kind === 'pencil-create') {
      setDragState({ ...dragState, currentX: x, currentY: y });
    }
  };

  const onMouseUp = () => {
    if (!dragState) return;

    if (dragState.kind === 'move' && dragState.moved) {
      const dx = dragState.currentX - dragState.startX;
      const dy = dragState.currentY - dragState.startY;
      const deltaSec = dx / xScale;
      const rawDeltaTick = secondsToTick(deltaSec, project.ppq, project.bpm);
      const step = (project.ppq * 4) / snapDenom;
      const deltaTick = Math.round(rawDeltaTick / step) * step;
      const deltaMidi = -Math.round(dy / pitchHeight);

      if (deltaTick !== 0 || deltaMidi !== 0) {
        const nextTracks = project.tracks.map((t) => ({
          ...t,
          notes: t.notes?.map((n) =>
            selection.has(n.id)
              ? {
                  ...n,
                  tick: Math.max(0, n.tick + deltaTick),
                  midi: Math.max(0, Math.min(127, n.midi + deltaMidi)),
                }
              : n,
          ),
        }));
        commitProject({ ...project, tracks: nextTracks, modifiedAt: new Date().toISOString() });
      }
    } else if (dragState.kind === 'marquee') {
      // 마키 안의 노트 선택
      const x0 = Math.min(dragState.startX, dragState.currentX);
      const x1 = Math.max(dragState.startX, dragState.currentX);
      const y0 = Math.min(dragState.startY, dragState.currentY);
      const y1 = Math.max(dragState.startY, dragState.currentY);
      const newSel = dragState.additive ? new Set(selection) : new Set<string>();
      for (const n of allNotes) {
        if (!isVisible(n.trackIndex)) continue;
        const ns = noteToSec(n.tick);
        const nd = noteToSec(n.durationTicks);
        const ne = ns + nd;
        const xLeft = rollX0 + (ns - scrollX) * xScale;
        const xRight = rollX0 + (ne - scrollX) * xScale;
        const yTop = rollY0 + rollH - (n.midi - scrollY + 1) * pitchHeight;
        const yBot = yTop + Math.max(pitchHeight - 1, 2);
        // 사각형 교차
        if (xRight < x0 || xLeft > x1 || yBot < y0 || yTop > y1) continue;
        newSel.add(n.id);
      }
      setSelection(newSel);
    } else if (dragState.kind === 'pencil-create') {
      // duration 확정
      const dx = dragState.currentX - dragState.startX;
      if (dx > DRAG_THRESHOLD_PX) {
        const deltaSec = dx / xScale;
        const rawDeltaTick = secondsToTick(deltaSec, project.ppq, project.bpm);
        const step = (project.ppq * 4) / snapDenom;
        const newDur = Math.max(step, Math.round(rawDeltaTick / step) * step);
        const nextTracks = project.tracks.map((t, i) =>
          i === dragState.trackIndex
            ? {
                ...t,
                notes: t.notes?.map((n) => (n.id === dragState.noteId ? { ...n, durationTicks: newDur } : n)),
              }
            : t,
        );
        commitProject({ ...project, tracks: nextTracks, modifiedAt: new Date().toISOString() });
      }
    }
    setDragState(null);
  };

  // 키 이벤트 — Delete/Backspace
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size > 0) {
        e.preventDefault();
        deleteNotes([...selection]);
      } else if (e.key === 'Escape') {
        setSelection(new Set());
        setDragState(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, project]);

  const commitProject = (next: ProjectState) => {
    onProjectChange?.(next);
  };

  const deleteNotes = (ids: string[]) => {
    const idSet = new Set(ids);
    const nextTracks = project.tracks.map((t) => ({
      ...t,
      notes: t.notes?.filter((n) => !idSet.has(n.id)),
    }));
    commitProject({ ...project, tracks: nextTracks, modifiedAt: new Date().toISOString() });
    setSelection((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  };

  // ----- 휠 (native listener — React onWheel 은 passive 라 preventDefault 안 먹음) -----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaY;
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left - KEY_LABEL_PX;
        const tUnderMouse = scrollX + mx / xScale;
        const factor = dy < 0 ? 1.2 : 1 / 1.2;
        const next = Math.max(MIN_X_SCALE, Math.min(MAX_X_SCALE, xScale * factor));
        setXScale(next);
        setScrollX(Math.max(0, tUnderMouse - mx / next));
        setUserZoomed(true);
      } else if (e.altKey) {
        const factor = dy < 0 ? 1.2 : 1 / 1.2;
        setPitchHeight((p) => Math.max(MIN_PITCH_HEIGHT, Math.min(MAX_PITCH_HEIGHT, p * factor)));
        setUserZoomed(true);
      } else if (e.shiftKey) {
        setScrollY((s) => Math.max(0, Math.min(127, s + Math.sign(dy) * 2)));
      } else {
        const visibleSec = (containerSize.w - KEY_LABEL_PX) / xScale;
        const step = visibleSec * 0.1;
        setScrollX((s) => Math.max(0, Math.min(totalDuration, s + Math.sign(dy) * step)));
        setAutoFollow(false);
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [scrollX, xScale, containerSize.w, totalDuration]);

  const fitAll = () => {
    const w = containerSize.w - KEY_LABEL_PX;
    setXScale(Math.max(MIN_X_SCALE, w / totalDuration));
    setScrollX(0);
    const pitchRange = Math.max(maxPitch - minPitch + 4, 1);
    const targetH = (containerSize.h - HEADER_PX) * 0.95;
    setPitchHeight(Math.max(MIN_PITCH_HEIGHT, targetH / pitchRange));
    setScrollY(Math.max(0, minPitch - 2));
    setAutoFollow(true);
  };

  const resetZoom = () => {
    setXScale(DEFAULT_X_SCALE);
    setPitchHeight(DEFAULT_PITCH_HEIGHT);
    setAutoFollow(true);
  };

  const editable = !!onProjectChange;
  const cursorClass =
    tool === 'pencil' ? 'cursor-crosshair' :
    tool === 'eraser' ? 'cursor-not-allowed' :
    'cursor-default';

  return (
    <div className="w-full h-full flex flex-col gap-2 min-h-0">
      {/* 도구 바 */}
      {editable && (
        <div className="flex gap-2 items-center text-xs flex-wrap">
          <span className="text-gray-500">도구:</span>
          {(['select', 'pencil', 'eraser'] as Tool[]).map((t) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              className={`px-2 py-1 border rounded ${tool === t ? 'bg-blue-600 text-white border-blue-700' : 'hover:bg-gray-50'}`}
            >
              {t === 'select' ? '선택' : t === 'pencil' ? '연필' : '지우개'}
            </button>
          ))}
          <span className="text-gray-500 ml-3">스냅:</span>
          <select
            value={snapDenom}
            onChange={(e) => setSnapDenom(Number(e.target.value))}
            className="px-2 py-1 border rounded bg-white"
          >
            {[1, 2, 4, 8, 16, 32].map((d) => (
              <option key={d} value={d}>1/{d}</option>
            ))}
          </select>
          <span className="text-gray-400 ml-3">활성 트랙: {project.tracks[activeTrack]?.name ?? '-'}</span>
          {selection.size > 0 && (
            <button
              onClick={() => deleteNotes([...selection])}
              className="px-2 py-1 border rounded hover:bg-red-50 text-red-600 ml-3"
            >
              선택 삭제 ({selection.size})
            </button>
          )}
        </div>
      )}

      {/* 줌 컨트롤 */}
      <div className="flex gap-2 items-center text-xs flex-wrap">
        <span className="text-gray-500">시간:</span>
        <button onClick={() => { setXScale((x) => Math.min(MAX_X_SCALE, x * 1.4)); setUserZoomed(true); }} className="px-2 py-1 border rounded hover:bg-gray-50">+</button>
        <button onClick={() => { setXScale((x) => Math.max(MIN_X_SCALE, x / 1.4)); setUserZoomed(true); }} className="px-2 py-1 border rounded hover:bg-gray-50">−</button>
        <span className="text-gray-500 ml-3">피치:</span>
        <button onClick={() => { setPitchHeight((p) => Math.min(MAX_PITCH_HEIGHT, p * 1.3)); setUserZoomed(true); }} className="px-2 py-1 border rounded hover:bg-gray-50">+</button>
        <button onClick={() => { setPitchHeight((p) => Math.max(MIN_PITCH_HEIGHT, p / 1.3)); setUserZoomed(true); }} className="px-2 py-1 border rounded hover:bg-gray-50">−</button>
        <button onClick={() => { fitAll(); setUserZoomed(false); }} className="px-2 py-1 border rounded hover:bg-gray-50 ml-3">전체</button>
        <button onClick={() => { resetZoom(); setUserZoomed(true); }} className="px-2 py-1 border rounded hover:bg-gray-50">리셋</button>
        <label className="flex items-center gap-1 ml-3 text-gray-600">
          <input
            type="checkbox"
            checked={autoFollow}
            onChange={(e) => setAutoFollow(e.target.checked)}
          />
          재생 시 자동 따라가기
        </label>
        <span className="text-gray-400 ml-auto hidden lg:inline">
          wheel = 가로스크롤 / shift = 세로 / ctrl = x zoom / alt = y zoom
        </span>
      </div>

      {/* viewport — 부모 flex-1 안에서 가로/세로 모두 채움 */}
      <div
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { if (dragState) onMouseUp(); }}
        onContextMenu={(e) => e.preventDefault()}
        className={`border border-gray-300 rounded overflow-hidden bg-white flex-1 min-h-0 ${cursorClass}`}
        style={{
          width: '100%',
          position: 'relative',
          userSelect: 'none',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
}
