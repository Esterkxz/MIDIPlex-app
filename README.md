# MIDIPlex-app

> 웹 브라우저 안에서 MIDI 를 **열고 · 재생하고 · 편집**하는 작곡 · 편곡 도구.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![src License](https://img.shields.io/badge/src-MIT-green.svg)](LICENSE-MIT)
[![spec License](https://img.shields.io/badge/spec-CC%20BY%204.0-orange.svg)](LICENSE-CC-BY-4.0)

---

## 본 repo 의 역할

**MIDIPlex 의 코드 + 신규 포맷 spec 본진**. ADR 0004 단계 1 (2-repo) 의 public repo.

| 측면 | 위치 |
|----|----|
| 📘 문서·전략·리서치 도시에 (private) | `Esterkxz/MIDIPlex` (별도 repo) |
| 💻 **본 repo** (public) | `Esterkxz/MIDIPlex-app` — 코드 + spec |

문서/전략 영역은 별도 private repo `Esterkxz/MIDIPlex` 에 있고, 본 repo 는 **실행 가능한 코드** 와 **포맷 spec** 만 담는다.

## 라이선스 정책 (3-layer)

| 영역 | 라이선스 | 파일 |
|----|----|----|
| Repo 전체 default | **Apache 2.0** | [LICENSE](LICENSE) |
| `src/`, `tests/` | **MIT** | [LICENSE-MIT](LICENSE-MIT) |
| `spec/` (MPX/MPK/SFW) | **CC BY 4.0** | [LICENSE-CC-BY-4.0](LICENSE-CC-BY-4.0) |
| `public/sf/` (사운드폰트, 추후 추가) | per-file (각 SF 의 원본 라이선스) | `public/sf/<name>/LICENSE` 또는 README |

자세한 attribution 은 [NOTICE](NOTICE) 참조.

> **단계 2** (spec freeze 후): `spec/` 영역이 별도 public repo `Esterkxz/MIDIPlex-formats` 로 분리될 예정. 본 docs repo 의 [ADR 0004](https://github.com/Esterkxz/MIDIPlex/blob/main/docs/adr/0004_Repo_Split_Strategy.md) 단계 2 트리거 (MPX/MPK/SFW v1.0 spec freeze 중 1+) 도달 시.

## 디렉토리 구조

```
MIDIPlex-app/
├── LICENSE              # Apache 2.0 (default)
├── LICENSE-MIT          # src/, tests/
├── LICENSE-CC-BY-4.0    # spec/
├── NOTICE               # Apache 2.0 NOTICE + 라이선스 layer 명시
├── README.md            # 본 파일
├── package.json
├── tsconfig.json
├── next.config.ts
├── src/                 # MIT — Next.js + TS strict 코드
│   ├── app/
│   ├── components/
│   └── lib/
├── spec/                # CC BY 4.0 — 신규 포맷 spec
│   ├── README.md
│   ├── mpx/v0.1/        # MIDIPlex Markup
│   ├── mpk/v0.1/        # MIDIPlex Package
│   └── sfw/v0.1/        # Soundfont Web Format
├── public/              # 정적 자산
└── tests/
```

## 기술 스택 (확정)

| 레이어 | 기술 |
|----|----|
| Frontend | Next.js 16+ (App Router) + TypeScript strict + Tailwind |
| MIDI 파싱 | `@tonejs/midi` |
| 스케줄링 | spessasynth_lib `Sequencer` (AudioWorklet 안 sample-accurate timing) — Tone.Transport 보조 |
| 사운드폰트 합성 | `spessasynth_core` + `spessasynth_lib` (Apache-2.0) |
| Storage | IndexedDB (1차) — 사용자 답변 후 Dexie/idb 검토 |

ADR 결정 근거: [docs/adr/0001_Web_MIDI_Approach.md](https://github.com/Esterkxz/MIDIPlex/blob/main/docs/adr/0001_Web_MIDI_Approach.md), [0003_Frontend_Framework.md](https://github.com/Esterkxz/MIDIPlex/blob/main/docs/adr/0003_Frontend_Framework.md), [0006_Audio_Library_Selection.md](https://github.com/Esterkxz/MIDIPlex/blob/main/docs/adr/0006_Audio_Library_Selection.md) (모두 본 docs repo).

## 개발 시작

```bash
npm install
npm run dev
```

브라우저: <http://localhost:3000>

## Production 빌드

```bash
npm run build
npm start
```

## Phase 진행

- **Phase 1** ✅ (2026-04-25 완료, 별도 spike 에서) — walking skeleton 검증 (박자 정확 + 스테레오 정상)
- **Phase 2** 🟡 (현재 본 repo 시작) — MVP M1~M8 작업 (`MIDIPlex/.agent/PM/003_WBS.md`)
- Phase 3+ — 신규 포맷 spec (MPX/MPK/SFW) 본격 구현

## 기여 / 이슈

본 repo 는 사용자 (Esterkxz) 단독 운영 중 (2026-04-25 시점). 외부 PR 환영하지만 본격 기여 가이드는 Phase 2 출시 후 추가.

이슈는 [GitHub Issues](https://github.com/Esterkxz/MIDIPlex-app/issues).

## 출처 / 인용

```
MIDIPlex 코드: MIT License (LICENSE-MIT)
MPX/MPK/SFW spec: CC BY 4.0 (LICENSE-CC-BY-4.0)
  Attribution: "MPX (MIDIPlex Markup) v0.1 spec by Esterkxz / MIDIPlex (CC BY 4.0)"
```

---

## 부속 도구 — MIDIPlex Player (개인용)

walking skeleton 의 부산물로 Phase 1 spike 가 일상 청취 도구로 보존됨. 위치 별도 (`C:\Users\excte\dev\midiplex-spike` 또는 사용자 이동 경로). Phase 2 본격 작업과 분리됨.
