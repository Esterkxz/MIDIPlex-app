/**
 * NoteWorthy Composer 1.x (1.5/1.7/1.75) binary parser walking.
 *
 * 2.7+ 는 본문에 nwctext embedded → nwctxt-loader 위임 (nwc-binary-loader).
 * 1.x 는 본격 binary parser — 본 모듈.
 *
 * Spec 출처: zz85/nwc-viewer 의 src/nwc.js + src/nwc_parser.js cleanroom 분석
 * (GPL-2.0 호환 위해 코드 직접 이전 X, byte layout / token byte map 만 추출).
 *
 * 지원 walking 범위 (1차):
 *   - Header / Info / PageSetup (skip 위주, 메타만 추출)
 *   - Score → staves count
 *   - StaffInfo → name, channel, staff_type, lyrics 카운트, tokens 카운트
 *   - Token loop — Note (8) / Rest (9) / Chord (10) / Clef (0) / KeySignature (1) /
 *     TimeSignature (5) / Tempo (6) / Barline (2) / InstrumentPatch (4)
 *   - Note 8 byte 디코딩 — duration / position / accidental / triplet / dots / grace
 *
 * 미지원 (follow-up):
 *   - Lyrics (가사 텍스트)
 *   - MidiInstruction (MPC pitch bend 등)
 *   - PerformanceStyle / Dynamic / Pedal / Flow / Boundary
 *   - 1.5 의 일부 변종 byte layout
 */

import type { ProjectState, Track, Note } from './types/project';
import { nextNoteId } from './types/project';

const PPQ = 480;

const DURATION_BASE = [4 * PPQ, 2 * PPQ, PPQ, PPQ / 2, PPQ / 4, PPQ / 8, PPQ / 16];

const CLEF_NAMES = ['Treble', 'Bass', 'Alto', 'Tenor', 'Percussion'] as const;

const CLEF_BASE: Record<string, [string, number]> = {
  Treble: ['B', 4],
  Bass: ['D', 3],
  Alto: ['C', 4],
  Tenor: ['A', 3],
  Percussion: ['B', 4],
};

const LETTER_OFFSET: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

const FONT_STYLES = ['Regular', 'Italic', 'Bold', 'Bold Italic'];

// ============================================================================

class Reader {
  pos = 0;
  constructor(public buf: Uint8Array) {}

  readByte(): number {
    if (this.pos >= this.buf.length) return 0;
    return this.buf[this.pos++];
  }

  readShort(): number {
    const lo = this.readByte();
    const hi = this.readByte();
    return lo | (hi << 8);
  }

  readBytes(n: number): Uint8Array {
    const r = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return r;
  }

  readString(): string {
    const start = this.pos;
    while (this.pos < this.buf.length && this.buf[this.pos] !== 0) this.pos++;
    const s = new TextDecoder('latin1').decode(this.buf.subarray(start, this.pos));
    if (this.pos < this.buf.length) this.pos++; // skip NUL
    return s;
  }

  readUntilNonZero(): void {
    while (this.pos < this.buf.length && this.buf[this.pos] === 0) this.pos++;
  }

  readUntil(target: number): void {
    while (this.pos < this.buf.length && this.buf[this.pos] !== target) this.pos++;
    if (this.pos < this.buf.length) this.pos++;
  }

  skip(n = 1) {
    this.pos += n;
  }

  ended(): boolean {
    return this.pos >= this.buf.length;
  }
}

// ============================================================================

interface V1Header {
  company: string;
  product: string;
  version: number;
  name1: string;
  name2: string;
}

interface V1Staff {
  name: string;
  group: string;
  channel: number;
  staff_type: number; // 0=Treble, 1=Bass, ...
  programNumber: number;
  programSet: boolean;
  notes: Note[];
  currentTick: number;
  /** 마디 컨텍스트 임시 accidental (letter+octave → ±1/±2/0) */
  measureAccidentals: Map<string, number>;
  /** Key signature 의 sharp/flat letter set */
  keySharps: Set<string>;
  keyFlats: Set<string>;
  /** 현재 클레프 (token Clef 가 변경) */
  clef: string;
  clefOctaveShift: number;
}

// ============================================================================

export function parseV1Binary(
  body: Uint8Array,
  fileName?: string,
): { project: ProjectState; warnings: string[] } {
  const reader = new Reader(body);
  const warnings: string[] = [];

  // ---- 1. Header (이미 nwc-binary-loader 의 parseInnerHeader 와 동일 흐름)
  const header = parseV1Header(reader);
  console.log(
    `[nwc-v1-parser] header version=${header.version} ` +
      `name1="${header.name1}" name2="${header.name2}"`,
  );
  if (header.version >= 2.0) {
    warnings.push(`v${header.version}는 1.x parser 가 아님 — 호출부 분기 확인 필요`);
  }

  // ---- 2. Info
  const info = parseV1Info(reader, header.version);
  console.log(`[nwc-v1-parser] info title="${info.title}" author="${info.author}"`);

  // ---- 3. PageSetup (margins + fonts) — skip 위주
  try {
    parseV1PageSetup(reader, header.version);
  } catch (e) {
    warnings.push(`PageSetup 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ---- 4. Score header — staves count
  let staveCount: number;
  try {
    staveCount = parseV1ScoreHeader(reader, header.version);
  } catch (e) {
    warnings.push(`Score header 실패: ${e instanceof Error ? e.message : String(e)}`);
    staveCount = 0;
  }
  console.log(`[nwc-v1-parser] staves count: ${staveCount}`);

  // ---- 5. StaffInfo loop
  const staves: V1Staff[] = [];
  const globalBpm = { value: 120, set: false };
  let timeSig = '4/4';
  for (let i = 0; i < staveCount; i++) {
    try {
      const s = parseV1Staff(reader, header.version, warnings, globalBpm);
      staves.push(s);
      if (s.notes.length > 0) {
        console.log(
          `[nwc-v1-parser] staff[${i}] "${s.name}" ch=${s.channel + 1} prog=${s.programNumber} notes=${s.notes.length}`,
        );
      }
    } catch (e) {
      warnings.push(
        `staff[${i}] 파싱 실패: ${e instanceof Error ? e.message : String(e)} @ pos=${reader.pos}`,
      );
      break;
    }
  }

  // ---- 6. ProjectState 조립
  const meaningful = staves.filter((s) => s.notes.length > 0);
  const tracks: Track[] = (meaningful.length > 0 ? meaningful : staves).map((s, i) => ({
    id: `track-${i}`,
    name: s.name || `Staff ${i + 1}`,
    kind: 'note',
    channel: s.channel,
    instrumentId: `instrument-${s.programNumber}`,
    notes: s.notes,
    mute: false,
    solo: false,
    volume: 1.0,
    pan: 0,
  }));

  const totalTicks = Math.max(0, ...staves.map((s) => s.currentTick));
  const finalBpm = globalBpm.value;
  const durationSeconds = (totalTicks / PPQ) * (60 / finalBpm);
  console.log(`[nwc-v1-parser] global bpm=${finalBpm} (set=${globalBpm.set})`);

  const project: ProjectState = {
    id: cryptoRandomId(),
    title: fileName ? fileName.replace(/\.nwc$/i, '') : info.title || '(이름 없음)',
    ppq: PPQ,
    timeSignature: timeSig,
    keySignature: 'C major',
    bpm: finalBpm,
    durationSeconds,
    instruments: [],
    tracks,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };

  console.log(
    `[nwc-v1-parser] done — ${tracks.length} tracks, ` +
      `${tracks.reduce((s, t) => s + (t.notes?.length ?? 0), 0)} notes total`,
  );
  return { project, warnings };
}

// ============================================================================

function parseV1Header(reader: Reader): V1Header {
  const company = reader.readString();
  reader.readUntilNonZero();
  const product = reader.readString();
  reader.readUntilNonZero();
  const v = reader.readBytes(2);
  reader.skip(1);
  reader.readUntilNonZero();
  const name1 = reader.readString();
  reader.readUntilNonZero();
  const name2 = reader.readString();
  const version = v[1] + v[0] * 0.01;
  if (version >= 2.75) {
    reader.readUntil(0x24); // '$'
  }
  reader.readUntilNonZero();
  return { company, product, version, name1, name2 };
}

function parseV1Info(reader: Reader, version: number) {
  const _infoHeader = reader.readBytes(2); // 0x10 = nwc175, 0x18 = nwc2
  const title = reader.readString();
  const author = reader.readString();
  let lyricist = '';
  let copyright1 = '';
  let copyright2 = '';
  if (version >= 2) {
    lyricist = reader.readString();
    copyright1 = reader.readString();
    copyright2 = reader.readString();
  } else {
    copyright1 = reader.readString();
    if (version < 1.7) reader.skip(1); // 1.5 변종
    copyright2 = reader.readString();
  }
  const comments = reader.readString();
  return { title, author, lyricist, copyright1, copyright2, comments };
}

function parseV1PageSetup(reader: Reader, version: number) {
  // Margins
  reader.readUntil(0x46); // 'F'
  reader.readUntil(0x32); // '2'
  reader.skip(3);
  reader.readByte(); // measureStart
  reader.skip(1);
  reader.readString(); // margins string

  // Fonts
  if (version < 2) {
    reader.skip(36);
    reader.readByte(); // staff_size
    reader.skip(1);
  } else {
    reader.readUntil(0xff);
    reader.readBytes(3);
  }
  const FONTS_TO_READ = version < 1.7 ? 10 : 12;
  for (let i = 0; i < FONTS_TO_READ; i++) {
    reader.readString();
    reader.readByte(); // style
    reader.readByte(); // size
    reader.skip(1);
    reader.readByte(); // typeface
  }
}

function parseV1ScoreHeader(reader: Reader, version: number): number {
  if (version < 1.7) {
    reader.readBytes(2);
    reader.readByte();
    reader.skip(1);
  } else {
    reader.readUntil(0xff);
    reader.readBytes(2);
    reader.readByte();
  }
  if (version < 2) {
    return reader.readShort();
  } else {
    if (version >= 2.05) reader.skip(13);
    reader.readByte();
    return reader.readByte();
  }
}

function parseV1Staff(
  reader: Reader,
  version: number,
  warnings: string[],
  globalBpm: { value: number; set: boolean },
): V1Staff {
  if (version > 2) {
    reader.readShort();
    reader.readShort();
    reader.readUntilNonZero();
  }

  const staff_name = reader.readString();
  const group_name = reader.readString();
  reader.readByte(); // end_bar (& 7)
  reader.readByte(); // muted (& 1)
  reader.skip(1);
  const channel = reader.readByte();
  reader.skip(9);
  const staff_type = reader.readByte() & 3;
  reader.skip(1);
  reader.readByte(); // uppersize (256-byte)
  reader.readUntil(0xff);
  reader.readByte(); // lowersize
  reader.skip(1);
  reader.readByte(); // lines
  reader.readByte(); // layer
  reader.readByte(); // part_volume
  reader.skip(1);
  reader.readByte(); // stereo_pan

  if (version === 1.7) {
    reader.skip(2);
  } else {
    reader.skip(3);
  }
  reader.skip(2);

  if (version < 1.7) {
    reader.pos -= 2;
  }

  const lyricsCount = reader.readShort();
  const noLyrics = reader.readShort();

  if (lyricsCount) {
    reader.readShort(); // lyricsOption
    reader.skip(3);
    for (let i = 0; i < noLyrics; i++) {
      skipV1Lyrics(reader);
    }
    reader.skip(1);
  }

  reader.skip(1);
  reader.readByte(); // color
  const tokensCount = reader.readShort();

  let realTokens = tokensCount;
  if (version >= 1.7) realTokens -= 2;

  // NWC channel byte 는 0-based (사용자 페어 검증 — staff 0 byte=1 → MIDI ch2)
  const staff: V1Staff = {
    name: staff_name,
    group: group_name,
    channel: Math.max(0, Math.min(15, channel)),
    staff_type,
    programNumber: 0,
    programSet: false,
    notes: [],
    currentTick: 0,
    measureAccidentals: new Map(),
    keySharps: new Set(),
    keyFlats: new Set(),
    clef: CLEF_NAMES[staff_type] ?? 'Treble',
    clefOctaveShift: 0,
  };
  console.log(
    `[v1-parser.Staff] "${staff_name}" channel byte=${channel} → display ch${staff.channel + 1}`,
  );

  for (let i = 0; i < realTokens; i++) {
    if (version === 1.7) reader.skip(2);
    const tokenByte = reader.readByte();
    if (version < 1.7) reader.skip(1);
    else reader.skip(2);

    parseV1Token(reader, tokenByte, staff, version, warnings, globalBpm);
  }

  return staff;
}

function skipV1Lyrics(reader: Reader) {
  const blockHeader = reader.readByte();
  const lyricsLen = reader.readShort();
  reader.skip(1);
  const blocks = blockHeader === 4 ? 1 : blockHeader === 8 ? 2 : 0;
  const lyricBlock = blocks ? 1024 * blocks : lyricsLen + 2;
  reader.readBytes(lyricBlock);
}

// ============================================================================

function parseV1Token(
  reader: Reader,
  tokenByte: number,
  staff: V1Staff,
  version: number,
  warnings: string[],
  globalBpm: { value: number; set: boolean },
) {
  switch (tokenByte) {
    case 0: // Clef
      parseClefToken(reader, staff);
      return;
    case 1: // KeySignature
      parseKeySigToken(reader, staff);
      return;
    case 2: // Barline
      parseBarlineToken(reader, staff);
      return;
    case 4: // InstrumentPatch
      parseInstrumentPatchToken(reader, staff);
      return;
    case 5: // TimeSignature
      // 6 byte: top(short) + denomShift(short) + skip 2
      reader.readShort();
      reader.readShort();
      reader.readShort();
      return;
    case 6: // Tempo
      parseTempoToken(reader, globalBpm);
      return;
    case 7: // Dynamic
      skipDynamic(reader, version);
      return;
    case 8: // Note
      parseNoteToken(reader, staff, version);
      return;
    case 9: // Rest
      parseRestToken(reader, staff, version);
      return;
    case 10: // Chord
      parseChordToken(reader, staff, version);
      return;
    case 11: // Pedal
      skipPedal(reader, version);
      return;
    case 13: // MidiInstruction
      reader.readByte(); // pos
      reader.readByte(); // placement
      reader.readBytes(32);
      return;
    case 14: // TempoVariance
      reader.readBytes(4);
      return;
    case 15: // DynamicVariance
      reader.readBytes(version >= 2 ? 3 : 2);
      return;
    case 16: // PerformanceStyle
      reader.readBytes(version >= 2 ? 3 : 2);
      return;
    case 17: // Text
      reader.readByte();
      reader.readByte();
      reader.readString();
      return;
    case 18: // RestChord
      parseChordToken(reader, staff, version);
      return;
    default:
      warnings.push(`unknown token byte 0x${tokenByte.toString(16)} @ ${reader.pos}`);
      return;
  }
}

function parseClefToken(reader: Reader, staff: V1Staff) {
  const clefByte = reader.readShort() & 7;
  const octaveByte = reader.readShort() & 3;
  staff.clef = CLEF_NAMES[clefByte] ?? 'Treble';
  // octave shift: 1=8va alta, 2=8vb bassa (NWC), 0=normal
  staff.clefOctaveShift = octaveByte === 1 ? 1 : octaveByte === 2 ? -1 : 0;
}

function parseKeySigToken(reader: Reader, staff: V1Staff) {
  const data = reader.readBytes(10);
  const sharps = data[0]; // bitmap A=bit0, B=bit1, ..., G=bit6
  const flats = data[2];
  staff.keySharps = bitmapToLetters(sharps);
  staff.keyFlats = bitmapToLetters(flats);
}

function bitmapToLetters(bitmap: number): Set<string> {
  const AG = 'ABCDEFG';
  const out = new Set<string>();
  for (let i = 0; i < 7; i++) {
    if ((bitmap >> i) & 1) out.add(AG.charAt(i));
  }
  return out;
}

function parseBarlineToken(reader: Reader, staff: V1Staff) {
  reader.readByte(); // styleByte
  reader.readByte(); // repeat
  staff.measureAccidentals.clear();
}

function parseInstrumentPatchToken(reader: Reader, staff: V1Staff) {
  const data = reader.readBytes(8);
  console.log(
    `[v1-parser.InstrumentPatch] staff="${staff.name}" data: ${[...data].map(b => b.toString(16).padStart(2, '0')).join(' ')}`,
  );
  // NWC InstrumentPatch byte 는 1-based GM (사용자 페어 검증 — byte 1 → Acoustic Grand
  // Piano (GM 0), byte 49 → String Ensemble 1 (GM 48)). 즉 MIDI prog = byte - 1.
  if (!staff.programSet) {
    for (const candidate of [data[0], data[2], data[4], data[6]]) {
      if (candidate >= 1 && candidate <= 128) {
        staff.programNumber = candidate - 1;
        staff.programSet = true;
        break;
      }
    }
  }
}

function parseTempoToken(reader: Reader, globalBpm: { value: number; set: boolean }) {
  // Tempo (5 byte fixed + zero-terminated string):
  //   position (signed byte 1)
  //   placement (signed byte 1)
  //   duration (short 2)  ← BPM 값 (Quarter base 가정)
  //   note (byte 1)       ← TempoBase index
  //   text (zero-terminated)
  reader.readByte(); // position
  reader.readByte(); // placement
  const duration = reader.readShort();
  reader.readByte(); // note (base)
  // text label
  while (reader.pos < reader.buf.length && reader.buf[reader.pos] !== 0) reader.skip(1);
  if (reader.pos < reader.buf.length) reader.skip(1); // skip terminating NUL
  if (!globalBpm.set && duration > 0 && duration < 500) {
    globalBpm.value = duration;
    globalBpm.set = true;
    console.log(`[v1-parser.Tempo] BPM = ${duration}`);
  }
}

function skipDynamic(reader: Reader, version: number) {
  if (version < 1.7) {
    reader.readByte(); // style
    reader.readShort(); // velocity
    reader.readShort(); // volume
  } else {
    reader.readByte(); // placement
    reader.readByte(); // position
    reader.readShort(); // velocity
    reader.readShort(); // volume
    reader.readByte(); // style
  }
}

function skipPedal(reader: Reader, version: number) {
  if (version < 1.7) {
    reader.readByte(); // pos
    reader.readByte(); // placement
    reader.readByte(); // style
  } else if (version >= 2) {
    reader.readByte();
    reader.readByte(); // unknown
    reader.readByte();
    reader.readByte();
  } else {
    reader.readByte();
    reader.readByte();
    reader.readByte();
  }
}

function parseNoteToken(reader: Reader, staff: V1Staff, version: number) {
  const data = reader.readBytes(8);
  // stem length flag (byteMarking5 bit 6) — parseNoteValue 안에서 처리됨, 8 byte 직후
  if (data[7] & 0x40) reader.readByte();
  appendNoteFromData(data, staff);
  // Note 만의 1.5 변종 skip(2) — Rest 에는 없음
  if (version < 1.7) reader.skip(2);
}

function parseRestToken(reader: Reader, staff: V1Staff, _version: number) {
  const data = reader.readBytes(8);
  // stem length flag (byteMarking5 bit 6) — 1 byte 추가 read
  if (data[7] & 0x40) reader.readByte();
  const dur = decodeNoteDuration(data);
  if (!dur.isGrace) staff.currentTick += dur.ticks;
}

/**
 * Chord layout (zz85 spec):
 *   - 10 byte core ([0..9]) — data[8] = sub-note 수 (chords count)
 *   - sub-note 마다: skip 1 + skip 2 + 8 byte note record (= 11 byte each)
 *   - sub-note 의 position[6] 와 accidental[7] 가 실제 chord 노트들의 음정
 *   - 모든 sub-note 는 같은 currentTick 에서 시작, duration 은 첫 sub-note 기준
 *   - 1.5 변종: 첫 sub-note 시작 전 skip 1 + skip 2 (포함되어 있어 추가 처리 X)
 */
function parseChordToken(reader: Reader, staff: V1Staff, _version: number) {
  const data = reader.readBytes(10);
  const chordsCount = data[8];
  const startTick = staff.currentTick;
  let mainDur: { ticks: number; isGrace: boolean } | null = null;

  for (let i = 0; i < chordsCount; i++) {
    reader.skip(1);
    reader.skip(2);
    const subData = reader.readBytes(8);
    if (subData[7] & 0x40) reader.readByte(); // stem length flag
    const dur = decodeNoteDuration(subData);
    if (i === 0) mainDur = dur;

    // sub-note 추가 — currentTick 누적 안 함 (모두 같은 시작 시간)
    const savedTick = staff.currentTick;
    appendNoteFromData(subData, staff);
    staff.currentTick = savedTick; // appendNoteFromData 가 누적한 거 되돌림
  }

  // chord 전체의 시간 누적 — main duration 만큼
  if (mainDur && !mainDur.isGrace) {
    staff.currentTick = startTick + mainDur.ticks;
  }
}

function decodeNoteDuration(data: Uint8Array): { ticks: number; isGrace: boolean } {
  const byteDuration = data[0];
  const byteMarking2 = data[4]; // accent / tie / dots
  const byteMarking3 = data[5]; // grace / slur / tenuto
  const byteMarking1 = data[2]; // triplet / stem

  const durBit = byteDuration & 7;
  const base = DURATION_BASE[durBit] ?? PPQ;

  let mult = 1;
  // dots — bit 2 = 1 dot, bit 0 = 2 dots (역순)
  if (byteMarking2 & 0x04) mult *= 1.5;
  else if (byteMarking2 & 0x01) mult *= 1.75;

  // triplet (byteMarking1 bit 2~3) — non-zero → × 2/3
  const triplet = (byteMarking1 >> 2) & 3;
  if (triplet) mult *= 2 / 3;

  const grace = !!((byteMarking3 >> 5) & 1);

  return { ticks: Math.round(base * mult), isGrace: grace };
}

function appendNoteFromData(data: Uint8Array, staff: V1Staff) {
  const { ticks, isGrace } = decodeNoteDuration(data);

  // position decode: byte > 127 ? 256 - byte : -byte
  // → 양수 = staff 위쪽, 음수 = 아래쪽
  const posByte = data[6];
  const pos = posByte > 127 ? 256 - posByte : -posByte;

  // position → letter + octave (clef base 기준 다이어토닉)
  const clefBase = (CLEF_BASE[staff.clef] ?? CLEF_BASE.Treble) as [string, number];
  const { letter, octave: rawOctave } = posToLetterOctave(pos, clefBase);
  const octave = rawOctave + staff.clefOctaveShift;
  let midi = midiFromLetter(letter, octave);

  // accidental — byteMarking5 (data[7]) bit 0~2: 0=# 1=b 2=n 3=x 4=v 5=auto
  const accBits = data[7] & 0x07;
  const measureKey = `${letter}${octave}`;
  let accidentalShift = 0;
  let isExplicit = false;
  switch (accBits) {
    case 0: accidentalShift = 1; isExplicit = true; break;
    case 1: accidentalShift = -1; isExplicit = true; break;
    case 2: accidentalShift = 0; isExplicit = true; break; // natural
    case 3: accidentalShift = 2; isExplicit = true; break;
    case 4: accidentalShift = -2; isExplicit = true; break;
    case 5: break; // auto — apply key sig / measure context
  }

  if (isExplicit) {
    midi += accidentalShift;
    staff.measureAccidentals.set(measureKey, accidentalShift);
  } else if (staff.measureAccidentals.has(measureKey)) {
    midi += staff.measureAccidentals.get(measureKey)!;
  } else if (staff.keySharps.has(letter)) {
    midi += 1;
  } else if (staff.keyFlats.has(letter)) {
    midi -= 1;
  }

  const noteDur = isGrace ? Math.max(PPQ / 8, 24) : ticks;
  staff.notes.push({
    id: nextNoteId(),
    tick: staff.currentTick,
    durationTicks: noteDur,
    midi: Math.max(0, Math.min(127, midi)),
    velocity: 0.7,
  });
  if (!isGrace) staff.currentTick += ticks;
}

function posToLetterOctave(
  pos: number,
  clefBase: [string, number],
): { letter: string; octave: number } {
  let letter = clefBase[0];
  let octave = clefBase[1];
  const dir = pos > 0 ? 1 : -1;
  const steps = Math.abs(pos);
  for (let i = 0; i < steps; i++) {
    const idx = LETTERS.indexOf(letter as typeof LETTERS[number]);
    let next = idx + dir;
    if (next > 6) {
      next = 0;
      octave += 1;
    }
    if (next < 0) {
      next = 6;
      octave -= 1;
    }
    letter = LETTERS[next];
  }
  return { letter, octave };
}

function midiFromLetter(letter: string, octave: number): number {
  return (octave + 1) * 12 + (LETTER_OFFSET[letter] ?? 0);
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
