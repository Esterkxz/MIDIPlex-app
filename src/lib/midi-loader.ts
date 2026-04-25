import { Midi } from '@tonejs/midi';
import type { ProjectState, Track, Note, InstrumentRef } from './types/project';
import { nextNoteId } from './types/project';

/**
 * @tonejs/midi 의 Midi 객체 → 도메인 ProjectState 변환.
 *
 * ⚠️ lesson 002 (spread getter 함정) 회피: Note 의 prototype getter (time, duration, name)
 * 은 spread `{...n}` 에서 누락. 본 함수는 명시적으로 필요한 필드만 복사.
 */
/**
 * 의미 있는 트랙 — 노트, ControlChange, PitchBend 중 하나라도 있는 트랙.
 * SMF format 1 은 보통 트랙 0 이 conductor (tempo/timeSig/marker 메타만), 다른 트랙들에
 * 노트가 들어가는 컨벤션. 또한 일부 DAW 가 미사용 빈 트랙 (이름만 있는 placeholder) 도
 * 출력. 이런 트랙들은 ProjectState 에서 제외하고 header 메타만 활용.
 */
function isMeaningfulTrack(t: Midi['tracks'][number]): boolean {
  const notes = t.notes?.length ?? 0;
  const cc = Object.values(t.controlChanges ?? {}).reduce(
    (s, arr) => s + ((arr as unknown[])?.length ?? 0),
    0,
  );
  const pb = (t.pitchBends as unknown as { length: number } | undefined)?.length ?? 0;
  return notes > 0 || cc > 0 || pb > 0;
}

export function loadMidiFromBuffer(buffer: ArrayBuffer): { midi: Midi; project: ProjectState } {
  const midi = new Midi(buffer);

  // 진단 로그 — @tonejs/midi 가 SMF 를 어떻게 트랙 분해했는지 확인
  console.log(
    `[midi-loader] parsed: ${midi.tracks.length} tracks, ` +
      `ppq=${midi.header.ppq} duration=${midi.duration.toFixed(2)}s`,
  );
  midi.tracks.forEach((t, i) => {
    const ccCount = Object.values(t.controlChanges ?? {}).reduce(
      (s, arr) => s + ((arr as unknown[])?.length ?? 0),
      0,
    );
    const pbCount = (t.pitchBends as unknown as { length: number } | undefined)?.length ?? 0;
    const meaningful = isMeaningfulTrack(t);
    console.log(
      `  [track ${i}] name="${t.name ?? ''}" ch=${t.channel ?? '?'} ` +
        `prog=${t.instrument?.number ?? '?'} (${t.instrument?.name ?? ''}) ` +
        `family=${t.instrument?.family ?? '?'} percussion=${t.instrument?.percussion ?? false} ` +
        `notes=${t.notes?.length ?? 0} cc=${ccCount} pb=${pbCount}` +
        (meaningful ? '' : ' [SKIP empty]'),
    );
  });

  // 빈 트랙 (conductor + DAW placeholder) 필터링 → 의미 있는 음악 트랙만 ProjectState 로
  const meaningfulRaw = midi.tracks.filter(isMeaningfulTrack);

  const project: ProjectState = {
    id: cryptoRandomId(),
    title: midi.name || '(이름 없음)',
    ppq: midi.header.ppq,
    timeSignature: midi.header.timeSignatures[0]
      ? `${midi.header.timeSignatures[0].timeSignature[0]}/${midi.header.timeSignatures[0].timeSignature[1]}`
      : '4/4',
    keySignature: 'C major', // @tonejs/midi 가 keySignature 를 직접 노출 안 함 — Phase 2 후반 보강
    bpm: midi.header.tempos[0]?.bpm ?? 120,
    durationSeconds: midi.duration,
    instruments: extractInstruments(midi),
    tracks: meaningfulRaw.map((t, i) => loadTrack(t, i, midi.header.ppq)),
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };

  console.log(
    `[midi-loader] ProjectState ready: ${project.tracks.length} tracks ` +
      `(filtered ${midi.tracks.length - project.tracks.length} empty), ` +
      `total notes=${project.tracks.reduce((s, t) => s + (t.notes?.length ?? 0), 0)}`,
  );

  return { midi, project };
}

function loadTrack(
  track: Midi['tracks'][number],
  index: number,
  ppq: number,
): Track {
  return {
    id: `track-${index}`,
    name: track.name || `Track ${index}`,
    kind: 'note',
    channel: track.channel ?? 0,
    instrumentId: `instrument-${track.instrument.number}`,
    // 명시 복사 — getter 결과 보존 (lesson 002)
    notes: track.notes.map(
      (n): Note => ({
        id: nextNoteId(),
        tick: n.ticks,
        durationTicks: n.durationTicks,
        midi: n.midi,
        velocity: n.velocity,
      }),
    ),
    mute: false,
    solo: false,
    volume: 1.0,
    pan: 0,
  };
}

function extractInstruments(midi: Midi): InstrumentRef[] {
  const seen = new Map<number, InstrumentRef>();
  for (const track of midi.tracks) {
    const num = track.instrument.number ?? 0;
    if (!seen.has(num)) {
      seen.set(num, {
        id: `instrument-${num}`,
        programNumber: num,
        programName: track.instrument.name || `Program ${num}`,
      });
    }
  }
  return Array.from(seen.values());
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // SSR fallback (실제로는 client-only 호출)
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
