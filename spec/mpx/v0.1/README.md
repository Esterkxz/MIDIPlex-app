# MPX (MIDIPlex Markup) v0.1 — DRAFT

> **License: CC BY 4.0** ([../../../LICENSE-CC-BY-4.0](../../../LICENSE-CC-BY-4.0))
> **Status**: DRAFT (PM 007 Phase B 진행 예정)
> **상위 리포트**: 본 docs repo `executive-docs/03_Markup_Language_Design.md` v1.2 ACCEPTED

## 빈 placeholder

PM 007 Phase B (DRAFT spec 작성) 시점에 본 디렉토리가 채워진다. 현재 03 리포트 v1.2 의 결정만 박혀있는 상태.

## 사양 요약 (03 리포트 ACCEPTED)

- 옵션 E (Markdown-like 신규 단일체) + 옵션 D (MML import 어댑터)
- YAML frontmatter + Markdown heading 트랙 + 인라인 `{{...}}` 어노테이션
- 표기 모드: Solfa / ABC 알파벳 / Nashville / **QWERTY chromatic** (z=A, s=A♯, x=B, c=C, ...) / MML
- phoneme: X-SAMPA default (k 트랙)
- MML 호환: One-way import only
- 파서: Phase 1 Peggy → Phase 2 Chevrotain + Lezer (CodeMirror 6)
- 확장자: `.mpx` primary, `.mp.md` 별칭

## 다음 작업 (PM 007 Phase B)

- [ ] EBNF / PEG 문법 정의
- [ ] AST 타입 (TypeScript)
- [ ] 예제 파일 ≥ 5개 (멜로디 / 코드 / 가사 / 다중 트랙 / 조변환)
- [ ] Peggy 파서 시제품 (`../src/format/mpx/`)
- [ ] MIDI ↔ MPX 왕복 변환 검증
