/**
 * MIDIPlex 도메인 타입 — 여러 파트 공유.
 *
 * 출처: MIDIPlex/.agent/_contracts/types/README.md 의 권고.
 * spec freeze 시 spec/ 으로 ref 이동 가능.
 */

/** 한 곡의 전체 상태. IndexedDB 저장 + URL 공유 가능한 직렬화 형식. */
export interface ProjectState {
  /** 프로젝트 ID (uuid 또는 hash) */
  id: string;
  /** 곡 제목 */
  title: string;
  /** 작자 (사용자명 또는 익명) */
  author?: string;
  /** Pulses Per Quarter note (MIDI 표준) */
  ppq: number;
  /** 마디 박자 (예: '4/4') */
  timeSignature: string;
  /** 키 (예: 'C major', 'A minor') */
  keySignature: string;
  /** BPM */
  bpm: number;
  /** 트랙 목록 */
  tracks: Track[];
  /** 곡 길이 (초) — derived (가장 늦은 noteEnd) */
  durationSeconds: number;
  /** 사용 악기 ref (SFW 슬라이스 또는 GM 폴백) */
  instruments: InstrumentRef[];
  /** 메타 */
  createdAt: string; // ISO
  modifiedAt: string; // ISO
}

export type TrackKind = 'note' | 'lyric' | 'phoneme' | 'articulation' | 'chord' | 'pcm';

export interface Track {
  id: string;
  /** UI 표시용 트랙 이름 */
  name: string;
  kind: TrackKind;
  /** MIDI 채널 (0~15, GM 9 = drums) */
  channel: number;
  /** 사용 악기 ID (instruments 배열 ref) */
  instrumentId?: string;
  /** 노트 목록 (kind === 'note' 또는 'phoneme' 일 때) */
  notes?: Note[];
  /** 가사 이벤트 (kind === 'lyric') */
  lyrics?: LyricEvent[];
  /** 트랙 메타 (음소거, 솔로, 볼륨, 팬) */
  mute?: boolean;
  solo?: boolean;
  /** 0.0 ~ 1.0 linear */
  volume?: number;
  /** -1.0 (좌) ~ 1.0 (우) */
  pan?: number;
  /** Control Change 이벤트 시계열 (sustain/expression/volume/pan inline 변경) */
  controlChanges?: ControlChange[];
}

export interface Note {
  /** 안정 식별자 — 편집/선택 추적용. 파서가 생성, 신규 노트는 nextNoteId() */
  id: string;
  /** MIDI tick 단위 시작 위치 (PPQ 기반) */
  tick: number;
  /** MIDI tick 단위 길이 */
  durationTicks: number;
  /** MIDI 음높이 0~127 */
  midi: number;
  /** 0.0 ~ 1.0 linear (Web Audio dB 변환은 재생 엔진에서) */
  velocity: number;
}

/** MIDI Control Change event (CC#0~127) — 트랙별 sustain/expression/volume/pan 등. */
export interface ControlChange {
  /** CC number 0~127 (예: 7=volume, 10=pan, 11=expression, 64=sustain) */
  number: number;
  /** 값 0~127 */
  value: number;
  /** MIDI tick 위치 */
  tick: number;
}

/** 편집 추적을 위한 안정 ID 생성 */
let _noteIdCounter = 0;
export function nextNoteId(): string {
  _noteIdCounter += 1;
  return `n-${Date.now().toString(36)}-${_noteIdCounter}`;
}

/** 그리드 스냅 (1/snapDenom note 단위로 tick 반올림) */
export function quantizeTick(tick: number, ppq: number, snapDenom: number): number {
  const step = (ppq * 4) / snapDenom; // 1/snapDenom note 의 tick 수
  return Math.round(tick / step) * step;
}

export interface LyricEvent {
  tick: number;
  text: string;
}

export interface InstrumentRef {
  id: string;
  /** GM program number 0~127 */
  programNumber: number;
  /** GM program name */
  programName: string;
  /** SFW 슬라이스 path (있으면) — public/sf/... 또는 사용자 업로드 */
  sfwPath?: string;
}

/** 노트 좌표 헬퍼 — PPQ + BPM 기반 tick → 초 변환 */
export function tickToSeconds(tick: number, ppq: number, bpm: number): number {
  return (tick / ppq) * (60 / bpm);
}

export function secondsToTick(seconds: number, ppq: number, bpm: number): number {
  return Math.round((seconds * bpm * ppq) / 60);
}
