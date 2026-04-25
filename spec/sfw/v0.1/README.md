# SFW (Soundfont Web Format) v0.1 — DRAFT

> **License: CC BY 4.0** ([../../../LICENSE-CC-BY-4.0](../../../LICENSE-CC-BY-4.0))
> **Status**: DRAFT (PM 009 Phase B 진행 예정 — spessasynth_core API 추가 조사 후)
> **상위 리포트**: 본 docs repo `executive-docs/05_Soundfont_Webformat.md` v1.1 ACCEPTED

## 빈 placeholder

PM 009 Phase B 진입은 spessasynth_core 의 partial load API 추가 조사(Q1c) 완료 후. 현재 05 리포트 v1.1 의 결정만 박혀있는 상태.

## 사양 요약 (05 리포트 ACCEPTED)

- SFW-B (SF3 + manifest + Range request) 1순위 + SFW-A (SF2) fallback 듀얼 트랙
- 큐레이션: SF3 (압축 70%) / 사용자 업로드: SF2 그대로 (라이선스 안전)
- manifest: JSON + SPDX 라이선스 + byte range + decoded_bytes
- iOS 메모리: hard 150MB / soft 250MB + LRU eviction
- 사용자 SF 저장: **클라이언트 only + 서버 옵션 둘 다** (Q7c)
- **Lossless 모드 opt-in** 제공 (Q8a — SFW-A 강제)
