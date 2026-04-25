/**
 * ProjectState → 표준 SMF (Standard MIDI File) ArrayBuffer.
 * @tonejs/midi 의 fromJSON 경로 — audio-engine 의 applyProject 와 동일 로직 분리.
 *
 * 사용처:
 *   - audio-engine.applyProject (sequencer reload 용)
 *   - M8 내보내기 (사용자 다운로드)
 */

import { Midi } from '@tonejs/midi';
import type { ProjectState } from './types/project';

export function projectToSmfBuffer(project: ProjectState): ArrayBuffer {
  const tsMatch = /^(\d+)\/(\d+)$/.exec(project.timeSignature);
  const ticksPerSec = (project.bpm * project.ppq) / 60;

  const json = {
    header: {
      name: project.title,
      ppq: project.ppq,
      tempos: [{ ticks: 0, bpm: project.bpm, time: 0 }],
      timeSignatures: tsMatch
        ? [
            {
              ticks: 0,
              timeSignature: [parseInt(tsMatch[1], 10), parseInt(tsMatch[2], 10)] as [number, number],
              measures: 0,
            },
          ]
        : [],
      keySignatures: [],
      meta: [],
    },
    tracks: project.tracks.map((track) => {
      const instMatch = /instrument-(\d+)/.exec(track.instrumentId ?? '');
      const programNum = instMatch ? parseInt(instMatch[1], 10) : 0;
      return {
        name: track.name,
        channel: track.channel,
        instrument: {
          number: programNum,
          family: '',
          name: '',
          percussion: track.channel === 9,
        },
        notes: (track.notes ?? []).map((n) => ({
          midi: n.midi,
          ticks: n.tick,
          durationTicks: n.durationTicks,
          velocity: n.velocity,
          time: n.tick / ticksPerSec,
          duration: n.durationTicks / ticksPerSec,
          name: '',
          noteOffVelocity: 0,
        })),
        controlChanges: {},
        pitchBends: [],
        endOfTrackTicks: 0,
      };
    }),
  };

  const midi = new Midi();
  (midi as unknown as { fromJSON: (j: unknown) => void }).fromJSON(json);
  const u8 = midi.toArray();
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** ProjectState 를 .mid 파일로 다운로드 트리거. */
export function downloadSmf(project: ProjectState, fileName?: string): void {
  const buffer = projectToSmfBuffer(project);
  const blob = new Blob([buffer], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFileName(fileName ?? project.title) + '.mid';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'untitled';
}
