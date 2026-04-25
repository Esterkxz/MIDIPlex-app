import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { WorkletSynthesizer, Sequencer } from 'spessasynth_lib';
import type { ProjectState } from './types/project';
import { projectToSmfBuffer } from './midi-export';

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
   * 원본 midi 의 메타 (key, meta 등) 는 toJSON 으로 보존 후 tracks 만 갈아 끼움.
   * Sequencer 가 재생 중일 때 호출하면 stop 후 reload (끊김 발생 정상).
   */
  applyProject(project: ProjectState) {
    let buffer: ArrayBuffer;
    try {
      buffer = projectToSmfBuffer(project);
    } catch (e) {
      console.warn('[AudioEngine.applyProject] SMF 직렬화 실패:', e);
      return;
    }
    const newMidi = new Midi(buffer);
    const totalNotes = newMidi.tracks.reduce((s, t) => s + (t.notes?.length ?? 0), 0);
    console.log(
      `[AudioEngine.applyProject] mode=${this.mode} sf=${this.soundFontLoaded} ` +
        `tracks=${newMidi.tracks.length} notes=${totalNotes} ` +
        `ppq=${newMidi.header.ppq} bpm=${project.bpm} bytes=${buffer.byteLength}`,
    );
    this.midi = newMidi;
    this.midiBuffer = buffer;
    this.tryLoadIntoSequencer();
  }

  /**
   * 단일 노트 즉시 미리듣기 (M6 편집 시 새 노트 그을 때 들리는 소리).
   * spessasynth 모드 = synth.noteOn/noteOff 직접 / oscillator 모드 = Tone.PolySynth.
   */
  previewNote(midi: number, velocity: number = 0.7, channel: number = 0, durationMs: number = 220) {
    const v = Math.round(Math.max(0, Math.min(1, velocity)) * 127);
    if (this.mode === 'spessasynth' && this.spessaSynth) {
      try {
        const synth = this.spessaSynth as unknown as {
          noteOn: (ch: number, midi: number, vel: number) => void;
          noteOff: (ch: number, midi: number) => void;
        };
        synth.noteOn(channel, midi, v);
        setTimeout(() => {
          try { synth.noteOff(channel, midi); } catch {}
        }, durationMs);
        return;
      } catch (e) {
        console.warn('[AudioEngine.previewNote] spessasynth 실패, oscillator fallback:', e);
      }
    }
    this.ensureOscSynth();
    if (this.oscSynth) {
      try {
        const noteName = Tone.Frequency(midi, 'midi').toNote();
        this.oscSynth.triggerAttackRelease(noteName, durationMs / 1000, undefined, velocity);
      } catch (e) {
        console.warn('[AudioEngine.previewNote] oscillator 실패:', e);
      }
    }
  }

  /**
   * SuppliedMIDIData 타입은 객체 wrap 필수 (raw ArrayBuffer 직접 전달 시
   * spessasynth 가 .binary undefined 로 읽고 "Expected MThd" 에러 — Phase 1 lesson).
   */
  private tryLoadIntoSequencer() {
    if (this.sequencer && this.midiBuffer) {
      try {
        console.log('[AudioEngine.tryLoadIntoSequencer] reload bytes=', this.midiBuffer.byteLength);
        this.sequencer.loadNewSongList([
          { binary: this.midiBuffer, fileName: this.midiFileName },
        ]);
      } catch (e) {
        console.warn('[AudioEngine] sequencer.loadNewSongList failed:', e);
      }
    } else {
      console.log(
        `[AudioEngine.tryLoadIntoSequencer] skip — sequencer=${!!this.sequencer} buffer=${!!this.midiBuffer}`,
      );
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
