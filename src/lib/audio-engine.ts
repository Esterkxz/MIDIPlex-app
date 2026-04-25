import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { WorkletSynthesizer, Sequencer } from 'spessasynth_lib';
import type { ProjectState } from './types/project';

/**
 * MIDIPlex 오디오 엔진 (Phase 2 MVP).
 *
 * 결정 근거:
 * - ADR 0001 v1.1 — 듀얼 트랙 (Optional 외부 IO + Mandatory 자체 재생)
 * - ADR 0006 — Tone.Transport (oscillator fallback) + 자체 wrapper + spessasynth_core
 * - lesson 003 — AudioContext sampleRate 강제 48kHz (mount 시점)
 * - lesson 004 — 박자 정확도: spessasynth `Sequencer` 가 AudioWorklet 안에서 sample-accurate
 *
 * 듀얼 모드:
 * - SF 미로드: Tone.PolySynth oscillator (fallback, 메인 스레드 jitter 가능)
 * - SF 로드: spessasynth `Sequencer` (sample-accurate, 메인 스레드 부하 무관)
 */
export class AudioEngine {
  private mode: 'oscillator' | 'spessasynth' = 'oscillator';

  private oscSynth: Tone.PolySynth | null = null;
  private oscScheduledIds: number[] = [];

  private workletReady = false;
  private spessaSynth: WorkletSynthesizer | null = null;
  private masterGain: GainNode | null = null;
  private soundFontLoaded = false;
  private sequencer: Sequencer | null = null;

  private midi: Midi | null = null;
  private midiBuffer: ArrayBuffer | null = null;
  private midiFileName = 'song.mid';
  private endTime = 0;
  private onEnd: (() => void) | null = null;
  private pendingVolume = 0.1;

  loadMidi(midi: Midi, buffer: ArrayBuffer, fileName?: string) {
    this.midi = midi;
    this.midiBuffer = buffer;
    if (fileName) this.midiFileName = fileName;
    this.stop();
    this.tryLoadIntoSequencer();
  }

  /**
   * 편집된 ProjectState 를 SMF 로 재직렬화 → Sequencer/Tone.Transport 양쪽에 반영.
   * M6 편집 → 재생 엔진 동기 (WBS 6.5).
   *
   * 호출 시점: 사용자가 재생 누를 때 (page.tsx 가 매번 fresh 보장).
   * 재생 중 호출 시 sequencer.loadNewSongList 가 끊김 유발 가능 → stop 후 호출 권장.
   */
  applyProject(project: ProjectState) {
    const midi = projectToMidi(project);
    const u8 = midi.toArray();
    const buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    this.midi = midi;
    this.midiBuffer = buffer;
    this.tryLoadIntoSequencer();
  }

  /**
   * SuppliedMIDIData 타입은 객체 wrap 필수 (raw ArrayBuffer 직접 전달 시
   * spessasynth 가 .binary undefined 로 읽고 "Expected MThd" 에러 — Phase 1 lesson).
   */
  private tryLoadIntoSequencer() {
    if (this.sequencer && this.midiBuffer) {
      try {
        this.sequencer.loadNewSongList([
          { binary: this.midiBuffer, fileName: this.midiFileName },
        ]);
      } catch (e) {
        console.warn('[AudioEngine] sequencer.loadNewSongList failed:', e);
      }
    }
  }

  setOnEnd(cb: () => void) {
    this.onEnd = cb;
  }

  setVolume(linear: number) {
    const clamped = Math.max(0, Math.min(1, linear));
    this.pendingVolume = clamped;
    if (this.oscSynth) {
      this.oscSynth.volume.value = clamped === 0 ? -Infinity : Tone.gainToDb(clamped);
    }
    if (this.masterGain) {
      this.masterGain.gain.value = clamped;
    }
  }

  async loadSoundFont(sfBuffer: ArrayBuffer): Promise<void> {
    await Tone.start();
    const ctx = Tone.getContext().rawContext as AudioContext;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    if (!ctx.audioWorklet) {
      throw new Error('이 브라우저는 AudioWorklet 미지원입니다.');
    }

    if (!this.workletReady) {
      try {
        await ctx.audioWorklet.addModule('/spessasynth_processor.min.js');
        this.workletReady = true;
      } catch (e) {
        throw new Error(
          `AudioWorklet 모듈 로드 실패: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (!this.spessaSynth) {
      try {
        this.spessaSynth = new WorkletSynthesizer(ctx);
      } catch (e) {
        throw new Error(
          `WorkletSynthesizer 생성 실패: ${e instanceof Error ? e.message : String(e)}. ` +
            `sampleRate=${ctx.sampleRate} 가 비표준이면 Tone.setContext({ sampleRate: 48000 }) 강제 확인.`,
        );
      }
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.pendingVolume;
      this.masterGain.connect(ctx.destination);
      this.spessaSynth.connect(this.masterGain);
    }

    try {
      await this.spessaSynth.soundBankManager.addSoundBank(sfBuffer, 'main');
      await this.spessaSynth.isReady;
    } catch (e) {
      throw new Error(`사운드폰트 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!this.sequencer && this.spessaSynth) {
      try {
        this.sequencer = new Sequencer(this.spessaSynth);
        try {
          (this.sequencer as unknown as {
            eventHandler?: { addEvent?: (n: string, id: string, cb: () => void) => void };
          }).eventHandler?.addEvent?.('songEnded', 'audio-engine', () => {
            this.onEnd?.();
          });
        } catch {
          // walking skeleton 패턴 — 이벤트 등록 실패 시 RAF polling fallback
        }
      } catch (e) {
        console.warn('[AudioEngine] Sequencer 생성 실패 — oscillator only:', e);
      }
    }

    this.soundFontLoaded = true;
    this.mode = 'spessasynth';
    this.tryLoadIntoSequencer();
  }

  unloadSoundFont() {
    this.soundFontLoaded = false;
    this.mode = 'oscillator';
  }

  private ensureOscSynth() {
    if (!this.oscSynth) {
      this.oscSynth = new Tone.PolySynth(Tone.Synth).toDestination();
      this.oscSynth.set({ envelope: { release: 0.1 } });
      this.oscSynth.volume.value =
        this.pendingVolume === 0 ? -Infinity : Tone.gainToDb(this.pendingVolume);
    }
  }

  async play() {
    if (!this.midi) return;
    await Tone.start();

    if (this.mode === 'spessasynth' && this.sequencer && this.soundFontLoaded) {
      try {
        this.sequencer.currentTime = 0;
        this.sequencer.play();
        return;
      } catch (e) {
        console.warn('[AudioEngine] Sequencer.play 실패, oscillator fallback:', e);
      }
    }

    this.ensureOscSynth();
    const transport = Tone.getTransport();
    transport.cancel();
    transport.bpm.value = 120;
    transport.position = 0;

    let maxEnd = 0;
    for (const track of this.midi.tracks) {
      for (const note of track.notes) {
        const id = transport.schedule((time) => {
          this.oscSynth!.triggerAttackRelease(note.name, note.duration, time, note.velocity);
        }, note.time);
        this.oscScheduledIds.push(id);
        const end = note.time + note.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
    this.endTime = maxEnd;

    transport.schedule(() => {
      this.stop();
      this.onEnd?.();
    }, this.endTime + 0.1);

    transport.start();
  }

  stop() {
    if (this.sequencer) {
      try {
        this.sequencer.pause();
        this.sequencer.currentTime = 0;
      } catch {
        // 무시
      }
    }
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    this.oscScheduledIds = [];
  }

  getCurrentTime(): number {
    if (this.mode === 'spessasynth' && this.sequencer) {
      try {
        return this.sequencer.currentHighResolutionTime;
      } catch {
        return 0;
      }
    }
    return Tone.getTransport().seconds;
  }

  isPlayingNow(): boolean {
    if (this.mode === 'spessasynth' && this.sequencer) {
      try {
        return !this.sequencer.paused;
      } catch {
        return false;
      }
    }
    return Tone.getTransport().state === 'started';
  }

  getMode(): 'oscillator' | 'spessasynth' {
    return this.mode;
  }

  isSoundFontLoaded(): boolean {
    return this.soundFontLoaded;
  }
}

/**
 * ProjectState → @tonejs/midi Midi 객체 변환.
 * 편집 후 SMF 재직렬화용 (applyProject 가 사용).
 *
 * @tonejs/midi 의 header.ppq 는 readonly — 직접 대입 불가. fromJSON 경유로 ppq 보존.
 */
function projectToMidi(project: ProjectState): Midi {
  const tsMatch = /^(\d+)\/(\d+)$/.exec(project.timeSignature);
  const timeSignatures = tsMatch
    ? [
        {
          ticks: 0,
          timeSignature: [parseInt(tsMatch[1], 10), parseInt(tsMatch[2], 10)] as [number, number],
          measures: 0,
        },
      ]
    : [];

  const json = {
    header: {
      name: project.title,
      ppq: project.ppq,
      tempos: [{ ticks: 0, bpm: project.bpm, time: 0 }],
      timeSignatures,
      keySignatures: [],
      meta: [],
    },
    tracks: project.tracks.map((track) => {
      const instMatch = /instrument-(\d+)/.exec(track.instrumentId ?? '');
      const programNum = instMatch ? parseInt(instMatch[1], 10) : 0;
      const ticksPerSec = (project.bpm * project.ppq) / 60;
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
  // @tonejs/midi 의 fromJSON 시그니처가 strict — 우리 JSON 은 일부 메타 누락 → unknown 으로 cast
  (midi as unknown as { fromJSON: (j: unknown) => void }).fromJSON(json);
  return midi;
}
