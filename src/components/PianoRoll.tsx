'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ProjectState } from '@/lib/types/project';
import { tickToSeconds } from '@/lib/types/project';

type Props = {
  project: ProjectState;
  currentTime?: number;
};

const TRACK_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
];

// scale 한계
const MIN_X_SCALE = 5;     // px/sec — 매우 압축
const MAX_X_SCALE = 1500;  // px/sec — 매우 확대
const MIN_PITCH_HEIGHT = 2;
const MAX_PITCH_HEIGHT = 40;

const DEFAULT_X_SCALE = 80;       // px/sec
const DEFAULT_PITCH_HEIGHT = 8;   // px per pitch

const HEADER_PX = 22;     // 상단 메타 영역
const KEY_LABEL_PX = 32;  // 좌측 옥타브 라벨

export default function PianoRoll({ project, currentTime = 0 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // viewport 상태
  const [containerSize, setContainerSize] = useState({ w: 800, h: 400 });
  const [xScale, setXScale] = useState(DEFAULT_X_SCALE);
  const [pitchHeight, setPitchHeight] = useState(DEFAULT_PITCH_HEIGHT);
  const [scrollX, setScrollX] = useState(0); // sec
  const [scrollY, setScrollY] = useState(0); // pitch
  const [autoFollow, setAutoFollow] = useState(true);

  // 곡 메타
  const allNotes = project.tracks.flatMap((track, trackIndex) =>
    (track.notes ?? []).map((n) => ({
      tick: n.tick,
      durationTicks: n.durationTicks,
      midi: n.midi,
      velocity: n.velocity,
      trackIndex,
    })),
  );
  const totalDuration = Math.max(project.durationSeconds, 0.001);
  const minPitch = allNotes.length ? Math.min(...allNotes.map((n) => n.midi)) : 60;
  const maxPitch = allNotes.length ? Math.max(...allNotes.map((n) => n.midi)) : 72;

  // 노트 시간 변환 헬퍼
  const noteToSec = (tick: number) => tickToSeconds(tick, project.ppq, project.bpm);

  // 새 곡 로드 시 scrollY 초기화 (가장 낮은 노트 기준)
  useEffect(() => {
    setScrollX(0);
    setScrollY(Math.max(0, minPitch - 6));
    // 곡 전체가 viewport 에 들어가도록 초기 xScale 자동 조정 (그러나 최소값 보장)
    const w = containerRef.current?.clientWidth ?? 800;
    const fitScale = Math.max(MIN_X_SCALE, (w - KEY_LABEL_PX) / totalDuration);
    setXScale(Math.min(fitScale, DEFAULT_X_SCALE));
  }, [project.id, totalDuration, minPitch]);

  // ResizeObserver — 부모 컨테이너 크기 추적
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

  // playhead auto-follow — 재생 중 viewport 우측 도달 시 점프
  useEffect(() => {
    if (!autoFollow || currentTime <= 0) return;
    const visibleSec = (containerSize.w - KEY_LABEL_PX) / xScale;
    const followMargin = visibleSec * 0.1; // 우측 10% 마진에서 trigger
    if (currentTime >= scrollX + visibleSec - followMargin) {
      setScrollX(Math.max(0, currentTime - visibleSec * 0.2));
    }
    if (currentTime < scrollX) {
      setScrollX(Math.max(0, currentTime - visibleSec * 0.2));
    }
  }, [currentTime, autoFollow, scrollX, xScale, containerSize.w]);

  // 그리기
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

    // 배경
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, cssW, cssH);

    if (allNotes.length === 0) {
      ctx.fillStyle = '#666';
      ctx.font = '14px sans-serif';
      ctx.fillText('(노트 없음)', 10, 20);
      return;
    }

    const rollX0 = KEY_LABEL_PX;
    const rollY0 = HEADER_PX;
    const rollW = cssW - rollX0;
    const rollH = cssH - rollY0;

    const visibleSec = rollW / xScale;
    const visiblePitches = Math.floor(rollH / pitchHeight);

    // 시간축 그리드 (1초 / zoom 따라 단위 가변)
    const gridStep =
      xScale > 200 ? 0.25 :
      xScale > 80 ? 1 :
      xScale > 30 ? 4 :
      8; // sec
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

    // 피치축 그리드 + 옥타브 라벨
    ctx.strokeStyle = '#eee';
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

    // 노트 (viewport culling)
    const tEnd = scrollX + visibleSec;
    const pEnd = scrollY + visiblePitches + 1;
    for (const note of allNotes) {
      const ns = noteToSec(note.tick);
      const nd = noteToSec(note.durationTicks);
      const ne = ns + nd;
      if (ne < scrollX || ns > tEnd) continue;
      if (note.midi < scrollY - 1 || note.midi > pEnd) continue;

      const x = rollX0 + (ns - scrollX) * xScale;
      const w = Math.max(nd * xScale, 2);
      const y = rollY0 + rollH - (note.midi - scrollY + 1) * pitchHeight;

      const v = Number.isFinite(note.velocity) ? Math.max(0, Math.min(1, note.velocity)) : 0.7;
      ctx.fillStyle = TRACK_COLORS[note.trackIndex % TRACK_COLORS.length];
      ctx.globalAlpha = 0.55 + v * 0.45;
      ctx.fillRect(x, y, w, Math.max(pitchHeight - 1, 2));
    }
    ctx.globalAlpha = 1;

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

    // 헤더 메타
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cssW, HEADER_PX);
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    const meta = `${allNotes.length} notes · pitch ${minPitch}-${maxPitch} · ${totalDuration.toFixed(1)}s · ${xScale.toFixed(0)}px/s · ${pitchHeight}px/pitch · t=[${scrollX.toFixed(1)}, ${(scrollX + visibleSec).toFixed(1)}]`;
    ctx.fillText(meta, 8, 14);

    // 좌측 라벨 영역 배경
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, rollY0, KEY_LABEL_PX, rollH);
    ctx.strokeStyle = '#ccc';
    ctx.beginPath();
    ctx.moveTo(KEY_LABEL_PX, rollY0);
    ctx.lineTo(KEY_LABEL_PX, rollY0 + rollH);
    ctx.stroke();
  }, [
    project.id,
    project.ppq,
    project.bpm,
    project.tracks,
    currentTime,
    containerSize.w,
    containerSize.h,
    xScale,
    pitchHeight,
    scrollX,
    scrollY,
  ]);

  // wheel: 가로 스크롤 / shift = 세로 / ctrl = x zoom / alt = y zoom
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dy = e.deltaY;

    if (e.ctrlKey || e.metaKey) {
      // 가로 zoom — 마우스 위치 기준
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left - KEY_LABEL_PX;
      const tUnderMouse = scrollX + mx / xScale;
      const factor = dy < 0 ? 1.2 : 1 / 1.2;
      const next = Math.max(MIN_X_SCALE, Math.min(MAX_X_SCALE, xScale * factor));
      setXScale(next);
      // 마우스 위치의 시간이 그대로 유지되도록 scrollX 보정
      setScrollX(Math.max(0, tUnderMouse - mx / next));
    } else if (e.altKey) {
      // 세로 zoom
      const factor = dy < 0 ? 1.2 : 1 / 1.2;
      setPitchHeight((p) => Math.max(MIN_PITCH_HEIGHT, Math.min(MAX_PITCH_HEIGHT, p * factor)));
    } else if (e.shiftKey) {
      // 세로 스크롤
      setScrollY((s) => Math.max(0, Math.min(127, s + Math.sign(dy) * 2)));
    } else {
      // 가로 스크롤
      const visibleSec = (containerSize.w - KEY_LABEL_PX) / xScale;
      const step = visibleSec * 0.1;
      setScrollX((s) => Math.max(0, Math.min(totalDuration, s + Math.sign(dy) * step)));
      setAutoFollow(false); // 사용자가 수동 스크롤하면 auto-follow 해제
    }
  };

  // zoom 컨트롤
  const fitAll = () => {
    const w = containerSize.w - KEY_LABEL_PX;
    setXScale(Math.max(MIN_X_SCALE, w / totalDuration));
    setScrollX(0);
    const visiblePitches = Math.max(maxPitch - minPitch + 4, 12);
    setPitchHeight(Math.max(MIN_PITCH_HEIGHT, (containerSize.h - HEADER_PX) / visiblePitches));
    setScrollY(Math.max(0, minPitch - 2));
    setAutoFollow(true);
  };

  const resetZoom = () => {
    setXScale(DEFAULT_X_SCALE);
    setPitchHeight(DEFAULT_PITCH_HEIGHT);
    setAutoFollow(true);
  };

  return (
    <div className="w-full max-w-6xl flex flex-col gap-2">
      {/* 컨트롤 바 */}
      <div className="flex gap-2 items-center text-xs flex-wrap">
        <span className="text-gray-500">시간:</span>
        <button onClick={() => setXScale((x) => Math.min(MAX_X_SCALE, x * 1.4))} className="px-2 py-1 border rounded hover:bg-gray-50">+</button>
        <button onClick={() => setXScale((x) => Math.max(MIN_X_SCALE, x / 1.4))} className="px-2 py-1 border rounded hover:bg-gray-50">−</button>
        <span className="text-gray-500 ml-3">피치:</span>
        <button onClick={() => setPitchHeight((p) => Math.min(MAX_PITCH_HEIGHT, p * 1.3))} className="px-2 py-1 border rounded hover:bg-gray-50">+</button>
        <button onClick={() => setPitchHeight((p) => Math.max(MIN_PITCH_HEIGHT, p / 1.3))} className="px-2 py-1 border rounded hover:bg-gray-50">−</button>
        <button onClick={fitAll} className="px-2 py-1 border rounded hover:bg-gray-50 ml-3">전체</button>
        <button onClick={resetZoom} className="px-2 py-1 border rounded hover:bg-gray-50">리셋</button>
        <label className="flex items-center gap-1 ml-3 text-gray-600">
          <input
            type="checkbox"
            checked={autoFollow}
            onChange={(e) => setAutoFollow(e.target.checked)}
          />
          재생 시 자동 따라가기
        </label>
        <span className="text-gray-400 ml-auto">
          wheel = 가로스크롤 / shift+wheel = 세로 / ctrl+wheel = x zoom / alt+wheel = y zoom
        </span>
      </div>

      {/* viewport — 부모 가로 100%, 세로 resize 가능 */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        className="border border-gray-300 rounded overflow-hidden bg-white"
        style={{
          width: '100%',
          height: '420px',
          resize: 'vertical',
          minHeight: '200px',
          maxHeight: '90vh',
          position: 'relative',
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
