/**
 * NoteWorthy Composer ClipText / Format 2.x 텍스트 파일 (.nwctxt) → ProjectState 어댑터.
 *
 * 사용자 워크플로우: NoteWorthy Composer 에서 곡 → 파일 → "Save As..." → "NoteWorthy
 * Composer Clip Text (*.nwctxt)" 또는 ClipBoard 텍스트 export.
 *
 * 지원 walking 범위 (Phase 2):
 * - 헤더: !NoteWorthyComposer(2.x) / !NoteWorthyComposerClip(2.x,...)
 * - 트랙: |AddStaff|Name:"..."|
 * - 클레프: |Clef|Type:Treble/Bass/Alto/Tenor + OctaveShift +/-8
 * - 키 시그너처: |Key|Signature:F#,C#,... (sharps) 또는 Bb,Eb,... (flats)
 * - 박자: |TimeSig|Signature:4/4
 * - 템포: |Tempo|Tempo:120
 * - 노트: |Note|Dur:Whole/Half/Quarter/Eighth/16th/32nd[,Dotted]|Pos:N[#bn]
 * - 코드: |Chord|Dur:...|Pos:n,m,k 등
 * - 쉼표: |Rest|Dur:...
 * - 마디: |Bar (단순 무시 — tick 누적은 Dur 합산)
 *
 * 미지원 (follow-up):
 * - 슬러 / 타이 (지속 처리)
 * - 다이내믹 / 헤어핀 / pedal
 * - 그레이스 노트
 * - 마이크로 어컬덴탈 (++ / --)
 * - Tuplet (3연음 등)
 * - 가사 (|Lyric1|Text:"...") — Phase 3 의 lyric 트랙 대응
 * - Repeat / DC / Coda
 *
 * SMF 표준화: ppq=480 고정. 모든 Dur 은 ppq 배수로 변환.
 */

import type { ProjectState, Track, Note, InstrumentRef } from './types/project';
import { nextNoteId } from './types/project';

const PPQ = 480;

// NWC 가 ClipText export 시 실제로 쓰는 명칭은 "4th"/"8th" 류 — Whole/Half/Quarter/Eighth
// 명칭은 alias 로 동시 매핑.
const DURATION_BASE: Record<string, number> = {
  Whole: 4 * PPQ,
  Half: 2 * PPQ,
  Quarter: PPQ,
  '4th': PPQ,
  Eighth: PPQ / 2,
  '8th': PPQ / 2,
  '16th': PPQ / 4,
  '32nd': PPQ / 8,
  '64th': PPQ / 16,
};

const LETTER_OFFSET: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
type Letter = typeof LETTERS[number];

/** 클레프 중심선의 음이름·옥타브. NWC Pos 0 이 이 위치. */
const CLEF_BASE: Record<string, [Letter, number]> = {
  Treble: ['B', 4],   // 보통자리
  Bass: ['D', 3],
  Alto: ['C', 4],
  Tenor: ['A', 3],
  Percussion: ['B', 4], // drum staff — pos 가 의미 없음 (별도 매핑 필요)
};

/** Pos N (정수) + clef → letter + octave (다이어토닉 step). */
function posToLetterOctave(
  pos: number,
  clefBase: [Letter, number],
): { letter: Letter; octave: number } {
  let letter: Letter = clefBase[0];
  let octave = clefBase[1];
  const dir = pos > 0 ? 1 : -1;
  const steps = Math.abs(pos);
  for (let i = 0; i < steps; i++) {
    const idx = LETTERS.indexOf(letter);
    let nextIdx = idx + dir;
    if (nextIdx > 6) { nextIdx = 0; octave += 1; }
    if (nextIdx < 0) { nextIdx = 6; octave -= 1; }
    letter = LETTERS[nextIdx];
  }
  return { letter, octave };
}

/** letter + octave → MIDI number (C-1 = 0 기준). */
function midiFromLetter(letter: Letter, octave: number): number {
  return (octave + 1) * 12 + LETTER_OFFSET[letter];
}

/**
 * NWC Pos 토큰 — **prefix** accidental + signed integer + 옵션 notehead/tied 후행자.
 * 예: "6" / "-2" / "#6" / "b3" / "n5" / "x6" (double sharp) / "v3" (double flat)
 *     "5o" (open notehead) / "5^" (tied)
 */
function parsePosToken(tok: string): { pos: number; accidental: number; isNatural: boolean } {
  // [accidental?] [signed pos] [notehead?] [tied?]
  const m = /^([#bnxv]?)(-?\d+)[oxXzyYabcdefghijklmnpqrstuvw]?\^?$/.exec(tok.trim());
  if (!m) return { pos: 0, accidental: 0, isNatural: false };
  const acc = m[1];
  const pos = parseInt(m[2], 10);
  if (acc === '#') return { pos, accidental: 1, isNatural: false };
  if (acc === 'b') return { pos, accidental: -1, isNatural: false };
  if (acc === 'n') return { pos, accidental: 0, isNatural: true };
  if (acc === 'x') return { pos, accidental: 2, isNatural: false };
  if (acc === 'v') return { pos, accidental: -2, isNatural: false };
  return { pos, accidental: 0, isNatural: false };
}

/** Dur 토큰 ("Quarter,Dotted,Slur" 등) → tick 길이 (Slur/Tie 같은 비-duration 플래그 무시). */
function parseDuration(durValue: string): number {
  const tokens = durValue.split(',').map((t) => t.trim());
  const baseTok = tokens[0] || 'Quarter';
  const base = DURATION_BASE[baseTok] ?? PPQ;
  let mult = 1;
  for (const t of tokens.slice(1)) {
    if (t === 'Dotted') mult *= 1.5;
    else if (t === 'DblDotted') mult *= 1.75;
    // Slur, Tie, Staccato, Accent 등은 duration 영향 없음 (또는 별도 처리)
  }
  return Math.round(base * mult);
}

/** Key Signature 의 sharp/flat 적용 letter set. */
function parseKeySig(sigValue: string): { sharps: Set<Letter>; flats: Set<Letter> } {
  const sharps = new Set<Letter>();
  const flats = new Set<Letter>();
  for (const tok of sigValue.split(',').map((s) => s.trim())) {
    if (tok.length < 2) continue;
    const letter = tok[0].toUpperCase() as Letter;
    if (!LETTERS.includes(letter)) continue;
    const sym = tok.slice(1);
    if (sym === '#') sharps.add(letter);
    else if (sym === 'b') flats.add(letter);
  }
  return { sharps, flats };
}

/** 한 줄 |Type|Key:Value|Key:Value| 파싱. */
function parseLine(line: string): { type: string; props: Record<string, string> } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const parts = trimmed.split('|').filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const type = parts[0];
  const props: Record<string, string> = {};
  for (const seg of parts.slice(1)) {
    const colonIdx = seg.indexOf(':');
    if (colonIdx < 0) {
      props[seg] = '';
      continue;
    }
    const key = seg.slice(0, colonIdx).trim();
    let val = seg.slice(colonIdx + 1).trim();
    // 따옴표 제거
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    props[key] = val;
  }
  return { type, props };
}

interface StaffState {
  name: string;
  clef: string;
  clefOctaveShift: number; // -1 = 8va bassa, +1 = 8va alta
  keySharps: Set<Letter>;
  keyFlats: Set<Letter>;
  /** 현재 마디 안에서 일시적으로 변경된 accidental (letter+octave 정확히) */
  measureAccidentals: Map<string, number>;
  notes: Note[];
  currentTick: number;
  /** GM program number (트랙 자체엔 명시 안 됨 — Patch 정보가 있으면 거기서) */
  programNumber: number;
  /** 명시 채널이 없으면 staff index */
  channel: number;
}

function makeStaffState(name: string, channel: number): StaffState {
  return {
    name,
    clef: 'Treble',
    clefOctaveShift: 0,
    keySharps: new Set(),
    keyFlats: new Set(),
    measureAccidentals: new Map(),
    notes: [],
    currentTick: 0,
    programNumber: 0,
    channel,
  };
}

export function loadNwctxtFromText(
  text: string,
  fileName?: string,
): { project: ProjectState; warnings: string[] } {
  const warnings: string[] = [];
  const lines = text.split(/\r\n|\r|\n/);

  // 헤더 검증
  const header = lines.find((l) => l.startsWith('!NoteWorthyComposer'));
  if (!header) {
    throw new Error('NWC ClipText 헤더가 없습니다 (!NoteWorthyComposer 또는 !NoteWorthyComposerClip 필요)');
  }

  let bpm = 120;
  let bpmSet = false;
  let timeSig = '4/4';
  let title = '(이름 없음)';

  const staves: StaffState[] = [];
  let currentStaff: StaffState | null = null;

  for (const rawLine of lines) {
    const parsed = parseLine(rawLine);
    if (!parsed) continue;
    const { type, props } = parsed;

    switch (type) {
      case 'SongInfo':
        if (props.Title) title = props.Title;
        break;

      case 'AddStaff':
        currentStaff = makeStaffState(props.Name || `Staff ${staves.length + 1}`, staves.length);
        staves.push(currentStaff);
        break;

      case 'StaffProperties':
        // 채널 명시 등
        if (currentStaff && props.Channel) {
          const ch = parseInt(props.Channel, 10);
          if (Number.isFinite(ch)) currentStaff.channel = Math.max(0, ch - 1);
        }
        break;

      case 'StaffInstrument':
        if (currentStaff && props.Patch) {
          const p = parseInt(props.Patch, 10);
          if (Number.isFinite(p)) currentStaff.programNumber = Math.max(0, Math.min(127, p));
        }
        if (currentStaff && props.Trans) {
          // 이조 처리 — walking 으로 무시. follow-up.
          warnings.push(`StaffInstrument Trans 무시됨: ${props.Trans}`);
        }
        break;

      case 'Clef':
        if (currentStaff && props.Type) {
          currentStaff.clef = props.Type;
          if (props.OctaveShift === 'Octave Down') currentStaff.clefOctaveShift = -1;
          else if (props.OctaveShift === 'Octave Up') currentStaff.clefOctaveShift = 1;
          else currentStaff.clefOctaveShift = 0;
        }
        break;

      case 'Key':
        if (currentStaff && props.Signature) {
          const { sharps, flats } = parseKeySig(props.Signature);
          currentStaff.keySharps = sharps;
          currentStaff.keyFlats = flats;
        }
        break;

      case 'TimeSig':
        if (props.Signature) timeSig = props.Signature;
        break;

      case 'Tempo':
        // 첫 번째 Tempo 만 사용 — NWC 가 곡 안에 여러 |Tempo| 라인을 둘 수 있음
        // (Pos: 위치별 변동). M7/M8 후 멀티 tempo 처리 따로.
        if (!bpmSet && props.Tempo) {
          const t = parseFloat(props.Tempo);
          if (Number.isFinite(t)) {
            bpm = t;
            bpmSet = true;
          }
        }
        break;

      case 'Bar':
        // 마디 시작 — 임시 accidental 초기화
        if (currentStaff) currentStaff.measureAccidentals.clear();
        break;

      case 'Rest': {
        if (!currentStaff) break;
        const dur = parseDuration(props.Dur || 'Quarter');
        currentStaff.currentTick += dur;
        break;
      }

      case 'Note': {
        if (!currentStaff) break;
        const dur = parseDuration(props.Dur || 'Quarter');
        const posTok = props.Pos || '0';
        const { pos, accidental, isNatural } = parsePosToken(posTok);
        const clefBase = CLEF_BASE[currentStaff.clef] ?? CLEF_BASE.Treble;
        const { letter, octave: rawOctave } = posToLetterOctave(pos, clefBase);
        const octave = rawOctave + currentStaff.clefOctaveShift;
        let midi = midiFromLetter(letter, octave);
        // accidental: 명시 > 마디 컨텍스트 > 키 시그너처
        const measureKey = `${letter}${octave}`;
        if (accidental !== 0 || isNatural) {
          midi += accidental;
          currentStaff.measureAccidentals.set(measureKey, accidental);
        } else if (currentStaff.measureAccidentals.has(measureKey)) {
          midi += currentStaff.measureAccidentals.get(measureKey)!;
        } else if (currentStaff.keySharps.has(letter)) {
          midi += 1;
        } else if (currentStaff.keyFlats.has(letter)) {
          midi -= 1;
        }
        currentStaff.notes.push({
          id: nextNoteId(),
          tick: currentStaff.currentTick,
          durationTicks: dur,
          midi: Math.max(0, Math.min(127, midi)),
          velocity: 0.7,
        });
        currentStaff.currentTick += dur;
        break;
      }

      case 'Chord': {
        if (!currentStaff) break;
        const dur = parseDuration(props.Dur || 'Quarter');
        const posList = (props.Pos || '0').split(',');
        const clefBase = CLEF_BASE[currentStaff.clef] ?? CLEF_BASE.Treble;
        for (const posTok of posList) {
          const { pos, accidental, isNatural } = parsePosToken(posTok);
          const { letter, octave: rawOctave } = posToLetterOctave(pos, clefBase);
          const octave = rawOctave + currentStaff.clefOctaveShift;
          let midi = midiFromLetter(letter, octave);
          const measureKey = `${letter}${octave}`;
          if (accidental !== 0 || isNatural) {
            midi += accidental;
            currentStaff.measureAccidentals.set(measureKey, accidental);
          } else if (currentStaff.measureAccidentals.has(measureKey)) {
            midi += currentStaff.measureAccidentals.get(measureKey)!;
          } else if (currentStaff.keySharps.has(letter)) {
            midi += 1;
          } else if (currentStaff.keyFlats.has(letter)) {
            midi -= 1;
          }
          currentStaff.notes.push({
            id: nextNoteId(),
            tick: currentStaff.currentTick,
            durationTicks: dur,
            midi: Math.max(0, Math.min(127, midi)),
            velocity: 0.7,
          });
        }
        currentStaff.currentTick += dur;
        break;
      }

      // 무시 (walking 미지원 류) — 향후 확장
      case 'Lyric1':
      case 'Lyric2':
      case 'Lyric3':
      case 'Lyric4':
      case 'Lyrics':
      case 'Dynamic':
      case 'TempoVariance':
      case 'PerformanceStyle':
      case 'Slur':
      case 'Tie':
      case 'TextIns':
      case 'Boundary':
      case 'StaffSig':
      case 'Editor':
      case 'PgSetup':
      case 'PgMargins':
      case 'Font':
        // walking 단계 무시
        break;

      default:
        // 알려지지 않은 토큰
        // warnings.push(`Unknown line type: ${type}`);
        break;
    }
  }

  if (staves.length === 0) {
    throw new Error('NWC 파일에 staff 가 없습니다');
  }

  // 빈 staff (Tempo / Conductor 등 메타만 있는 staff) 필터링
  const meaningfulStaves = staves.filter((s) => s.notes.length > 0);
  if (meaningfulStaves.length === 0 && staves.length > 0) {
    // 모든 staff 가 빈 경우 — 적어도 첫 staff 는 보존
    meaningfulStaves.push(staves[0]);
  }

  // ProjectState 조립
  const tracks: Track[] = meaningfulStaves.map((s, i) => ({
    id: `track-${i}`,
    name: s.name,
    kind: 'note',
    channel: s.channel,
    instrumentId: `instrument-${s.programNumber}`,
    notes: s.notes,
    mute: false,
    solo: false,
    volume: 1.0,
    pan: 0,
  }));

  const totalTicks = Math.max(...staves.map((s) => s.currentTick), 0);
  const durationSeconds = (totalTicks / PPQ) * (60 / bpm);

  // instruments — 실제 사용된 program 만
  const instMap = new Map<number, InstrumentRef>();
  for (const s of staves) {
    if (!instMap.has(s.programNumber)) {
      instMap.set(s.programNumber, {
        id: `instrument-${s.programNumber}`,
        programNumber: s.programNumber,
        programName: '', // GM 이름은 사이드바 에서 조회
      });
    }
  }

  const project: ProjectState = {
    id: cryptoRandomId(),
    title: fileName ? fileName.replace(/\.nwctxt$/i, '') : title,
    ppq: PPQ,
    timeSignature: timeSig,
    keySignature: 'C major',
    bpm,
    durationSeconds,
    instruments: Array.from(instMap.values()),
    tracks,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };

  console.log(
    `[nwctxt-loader] parsed: staves=${staves.length}, ` +
      `total notes=${tracks.reduce((s, t) => s + (t.notes?.length ?? 0), 0)}, ` +
      `bpm=${bpm}, timeSig=${timeSig}`,
  );
  staves.forEach((s, i) => {
    console.log(
      `  [staff ${i}] name="${s.name}" clef=${s.clef}${s.clefOctaveShift !== 0 ? ` (8${s.clefOctaveShift > 0 ? 'va' : 'vb'})` : ''} ` +
        `key=#${s.keySharps.size}/b${s.keyFlats.size} ` +
        `prog=${s.programNumber} ch=${s.channel + 1} notes=${s.notes.length}`,
    );
  });
  if (warnings.length > 0) {
    console.warn(`[nwctxt-loader] ${warnings.length} warnings:`, warnings);
  }

  return { project, warnings };
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
