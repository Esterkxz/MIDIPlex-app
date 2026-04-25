# MPK (MIDIPlex Package) v0.1 — DRAFT

> **License: CC BY 4.0** ([../../../LICENSE-CC-BY-4.0](../../../LICENSE-CC-BY-4.0))
> **Status**: DRAFT (PM 008 Phase B 진행 예정 — 03 + 05 spec freeze 후)
> **상위 리포트**: 본 docs repo `executive-docs/04_Package_Format_Design.md` v1.1 ACCEPTED

## 빈 placeholder

PM 008 Phase B 진입은 03 (MPX) + 05 (SFW) v0.1 spec freeze 후. 현재 04 리포트 v1.1 의 결정만 박혀있는 상태.

## 사양 요약 (04 리포트 ACCEPTED)

- MPK-A (ZIP/OPC-EPUB 스타일) primary + `.mpk-mini` sub-format
- mimetype 첫 entry (압축 X, `application/x-midiplex-package`)
- manifest.json (SPDX + 트랙 목록 + 사운드폰트 + 믹싱·마스터링·AI 모티브 ref)
- PCM codec: FLAC default + Opus opt-in
- ZIP lib: fflate primary + unzipit (Range fetch)
- 디렉토리: mimetype + manifest.json + score.mpx + sfw/ + audio/ + meta/
- iOS PCM: streaming + soft limit (max 4 트랙, 트랙당 50MB)
- 확장자: `.mpk` primary, `.mpk-mini`, `.mpk.zip` 별칭
