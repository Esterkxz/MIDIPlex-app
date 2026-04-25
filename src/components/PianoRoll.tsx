'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProjectState } from '@/lib/types/project';
import { tickToSeconds } from '@/lib/types/project';

type Props = {
  project: ProjectState;
  /** 재생 중 playhead 위치 (초). 0 이면 비표시 */
  currentTime?: number;
};

const TRACK_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export default function PianoRoll({ project, currentTime = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [debug, setDebug] = useState<string>('init');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth || 800;
      const cssH = canvas.clientHeight || 300;
      canvas.width = Math.max(cssW * dpr, 1);
      canvas.height = Math.max(cssH * dpr, 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const w = cssW;
      const h = cssH;

      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(0, 0, w, h);

      const allNotes = project.tracks.flatMap((track, trackIndex) =>
        (track.notes ?? []).map((n) => ({
          tick: n.tick,
          durationTicks: n.durationTicks,
          midi: n.midi,
          velocity: n.velocity,
          trackIndex,
        })),
      );

      if (allNotes.length === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '14px sans-serif';
        ctx.fillText('(노트 없음)', 10, 20);
        setDebug(`canvas ${cssW.toFixed(0)}x${cssH.toFixed(0)} dpr=${dpr} · notes=0`);
        return;
      }

      const minPitch = Math.min(...allNotes.map((n) => n.midi));
      const maxPitch = Math.max(...allNotes.map((n) => n.midi));
      const pitchRange = Math.max(maxPitch - minPitch + 1, 12);
      const totalDuration = Math.max(project.durationSeconds, 0.001);

      // 시간 그리드 (1초)
      ctx.strokeStyle = '#e5e5e5';
      ctx.lineWidth = 1;
      for (let s = 0; s <= totalDuration; s++) {
        const x = (s / totalDuration) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // 옥타브 그리드
      ctx.strokeStyle = '#eee';
      for (let p = Math.ceil(minPitch / 12) * 12; p <= maxPitch; p += 12) {
        const y = h - 10 - ((p - minPitch) / Math.max(pitchRange - 1, 1)) * (h - 20);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 노트 막대
      const noteH = Math.max((h - 20) / pitchRange, 4);
      for (const note of allNotes) {
        const noteSec = tickToSeconds(note.tick, project.ppq, project.bpm);
        const noteDurSec = tickToSeconds(note.durationTicks, project.ppq, project.bpm);
        const x = (noteSec / totalDuration) * w;
        const noteW = Math.max((noteDurSec / totalDuration) * w, 2);
        const y = h - 10 - ((note.midi - minPitch) / Math.max(pitchRange - 1, 1)) * (h - 20) - noteH / 2;
        const v = Number.isFinite(note.velocity) ? Math.max(0, Math.min(1, note.velocity)) : 0.7;
        ctx.fillStyle = TRACK_COLORS[note.trackIndex % TRACK_COLORS.length];
        ctx.globalAlpha = 0.6 + v * 0.4;
        ctx.fillRect(x, y, noteW, noteH);
      }
      ctx.globalAlpha = 1;

      // 재생 위치 playhead
      if (currentTime > 0 && currentTime <= totalDuration) {
        const playheadX = (currentTime / totalDuration) * w;
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, h);
        ctx.stroke();
        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.moveTo(playheadX - 5, 0);
        ctx.lineTo(playheadX + 5, 0);
        ctx.lineTo(playheadX, 6);
        ctx.closePath();
        ctx.fill();
      }

      // 헤더 메타
      ctx.fillStyle = '#000';
      ctx.font = '12px sans-serif';
      ctx.fillText(
        `${allNotes.length} notes · pitch ${minPitch}~${maxPitch} · ${totalDuration.toFixed(1)}s`,
        10,
        18,
      );

      setDebug(
        `canvas ${cssW.toFixed(0)}x${cssH.toFixed(0)} dpr=${dpr} · notes=${allNotes.length} · current=${currentTime.toFixed(2)}s`,
      );
    };

    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [project, currentTime]);

  return (
    <div className="w-full max-w-4xl flex flex-col gap-1">
      <div className="text-xs font-mono text-gray-500 select-all">{debug}</div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '300px', display: 'block' }}
        className="border border-gray-300 rounded"
      />
    </div>
  );
}
