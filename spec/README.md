# MIDIPlex Format Specifications

> **License: CC BY 4.0** ([LICENSE-CC-BY-4.0](../LICENSE-CC-BY-4.0))

본 디렉토리는 MIDIPlex 의 신규 포맷 3종 spec 을 담는다. v1.0 freeze 후 별도 repo (`Esterkxz/MIDIPlex-formats`) 로 분리 예정 ([ADR 0004 단계 2](../../../OneDrive/Private%20Dev/Project/MIDIPlex/docs/adr/0004_Repo_Split_Strategy.md)).

## 포맷

| 포맷 | 디렉토리 | 상위 리포트 (본 docs repo) | PM Task |
|-----|--------|--------------|---------|
| **MPX** — 마크업 언어 | [`mpx/`](mpx/) | `executive-docs/03_Markup_Language_Design.md` | PM 007 |
| **MPK** — 패키지 포맷 | [`mpk/`](mpk/) | `executive-docs/04_Package_Format_Design.md` | PM 008 |
| **SFW** — 사운드폰트 웹포맷 | [`sfw/`](sfw/) | `executive-docs/05_Soundfont_Webformat.md` | PM 009 |

## 진척

- v0.1 DRAFT — 본 디렉토리에서 작업 중
- v1.0 ACTIVE freeze — 단계 2 트리거 (별도 repo 분리)

## 라이선스 정책

- **Spec 텍스트** (본 디렉토리의 모든 .md 파일): CC BY 4.0
- **참조 구현 코드** (`../src/format/`): MIT
- **Repo 전체** (Apache 2.0) 와는 별개 layer — `../NOTICE` 참조

## 외부 인용 시

```
MPX (MIDIPlex Markup) v0.1 spec by Esterkxz / MIDIPlex (CC BY 4.0)
https://github.com/Esterkxz/MIDIPlex-app/blob/main/spec/mpx/v0.1/
```

## 본 docs repo 참조

상세 결정 근거·옵션 매트릭스·도시에 archive 는 본 docs repo:
- `MIDIPlex/executive-docs/03·04·05_*.md`
- `MIDIPlex/docs/_research_archive/03·04·05_*_dossier.md`
- `MIDIPlex/.agent/_contracts/formats/`
