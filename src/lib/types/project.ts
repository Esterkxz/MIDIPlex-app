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
}

export interface Note {
  /** MIDI tick 단위 시작 위치 (PPQ 기반) */
  tick: number;
  /** MIDI tick 단위 길이 */
  durationTicks: number;
  /** MIDI 음높이 0~127 */
  midi: number;
  /** 0.0 ~ 1.0 linear (Web Audio dB 변환은 재생 엔진에서) */
  velocity: number;
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
