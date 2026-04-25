import { Midi } from '@tonejs/midi';
import type { ProjectState, Track, Note, InstrumentRef, ControlChange } from './types/project';
import { nextNoteId } from './types/project';

/**
 * @tonejs/midi 의 Midi 객체 → 도메인 ProjectState 변환.
 *
 * ⚠️ lesson 002 (spread getter 함정) 회피: Note 의 prototype getter (time, duration, name)
 * 은 spread `{...n}` 에서 누락. 본 함수는 명시적으로 필요한 필드만 복사.
 */
/**
 * 노트가 있는 트랙. ProjectState 의 음악 트랙으로 들어갈 후보.
 * SMF format 1 은 보통 트랙 0 이 conductor 메타. 또한 일부 DAW (특히 한국 DAW류) 가
 * 메타 트랙 (이름 + program change + volume/pan 만) ↔ 노트 트랙 페어 패턴으로 출력 —
 * 빈 메타 트랙은 다음 노트 트랙에 이름을 전달한 후 제외.
 */
function isNoteTrack(t: Midi['tracks'][number]): boolean {
  return (t.notes?.length ?? 0) > 0;
}

/** 의미 있는 이름 — "Track N" / "" / 공백뿐 등 default 는 무시. */
function getMeaningfulName(t: Midi['tracks'][number]): string | null {
  const name = t.name?.trim() ?? '';
  if (!name) return null;
  if (/^track\s*\d+$/i.test(name)) return null;
  return name;
}

/**
 * 메타 트랙의 의미있는 이름을 다음 노트 트랙에 전달하고, 메타 트랙은 제외.
 * 결과: 노트 트랙들만, 각자 가장 적절한 표시 이름 보유.
 */
function pairMetaToNoteTracks(
  tracks: readonly Midi['tracks'][number][],
): Array<{ track: Midi['tracks'][number]; suppliedName?: string }> {
  const out: Array<{ track: Midi['tracks'][number]; suppliedName?: string }> = [];
  let pendingName: string | undefined;
  for (const t of tracks) {
    if (isNoteTrack(t)) {
      out.push({ track: t, suppliedName: pendingName });
      pendingName = undefined;
    } else {
      const meta = getMeaningfulName(t);
      if (meta) pendingName = meta;
    }
  }
  return out;
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
    const note = isNoteTrack(t);
    console.log(
      `  [track ${i}] name="${t.name ?? ''}" ch=${t.channel ?? '?'} ` +
        `prog=${t.instrument?.number ?? '?'} (${t.instrument?.name ?? ''}) ` +
        `family=${t.instrument?.family ?? '?'} percussion=${t.instrument?.percussion ?? false} ` +
        `notes=${t.notes?.length ?? 0} cc=${ccCount} pb=${pbCount}` +
        (note ? '' : ' [META — name forwards to next note track]'),
    );
  });

  // 메타 트랙 (이름만 있고 노트 없음) 의 이름을 다음 노트 트랙으로 전달, 메타는 제외
  const paired = pairMetaToNoteTracks(midi.tracks);

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
    tracks: paired.map((entry, i) =>
      loadTrack(entry.track, i, midi.header.ppq, entry.suppliedName),
    ),
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };

  console.log(
    `[midi-loader] ProjectState ready: ${project.tracks.length} note tracks ` +
      `(filtered ${midi.tracks.length - project.tracks.length} meta), ` +
      `total notes=${project.tracks.reduce((s, t) => s + (t.notes?.length ?? 0), 0)}`,
  );

  return { midi, project };
}

function loadTrack(
  track: Midi['tracks'][number],
  index: number,
  _ppq: number,
  suppliedName?: string,
): Track {
  // 트랙 이름 우선순위:
  //   1. 의미있는 자체 이름 (default "Track N" 아님)
  //   2. 직전 메타 트랙에서 전달된 이름
  //   3. 자체 이름 (default 라도)
  //   4. fallback "Track {index}"
  const ownName = track.name?.trim() ?? '';
  const ownIsDefault = !ownName || /^track\s*\d+$/i.test(ownName);
  const displayName = !ownIsDefault
    ? ownName
    : suppliedName ?? ownName ?? `Track ${index}`;

  return {
    id: `track-${index}`,
    name: displayName || `Track ${index}`,
    kind: 'note',
    channel: track.channel ?? 0,
    instrumentId: `instrument-${track.instrument?.number ?? 0}`,
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
    controlChanges: extractControlChanges(track),
  };
}

function extractControlChanges(track: Midi['tracks'][number]): ControlChange[] {
  const out: ControlChange[] = [];
  const ccMap = track.controlChanges ?? {};
  for (const arr of Object.values(ccMap)) {
    if (!Array.isArray(arr)) continue;
    for (const cc of arr) {
      out.push({
        number: cc.number,
        value: Math.round(Math.max(0, Math.min(1, cc.value)) * 127),
        tick: cc.ticks,
      });
    }
  }
  out.sort((a, b) => a.tick - b.tick);
  return out;
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
