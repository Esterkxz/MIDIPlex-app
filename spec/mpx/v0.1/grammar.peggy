// =============================================================================
// MPX v0.1 grammar (Peggy PEG)
// MIDIPlex Markup eXtended — Markdown-like single-source notation
// License: CC BY 4.0 (spec/ 폴더 정책)
// 03 리포트 v1.2 ACCEPTED 결정 사항 기반 (옵션 E + 옵션 D 어댑터 별도)
// =============================================================================
//
// Top-level 구조:
//   Document := Frontmatter? BlankLine* Track*
//   Track    := TrackHeader Measure*
//   Measure  := "|" Cell* "|"
//   Cell     := Rest | Note | Annotation
//
// 표기 모드 (트랙 헤더 notation= 로 명시 필수):
//   - solfa             : 도 레 미 파 솔 라 시
//   - abc               : c d e f g a b (+sharp / -flat)
//   - nashville         : 1 2 3 4 5 6 7 (+ m for minor chord)
//   - mml               : c d e f g a b + duration suffix (c8 = 8th)
//   - qwerty-chromatic  : 사용자 발명 자판 매핑 (z=A x=B c=C v=D b=E n=F m=G,
//                          검은건반 s f g j k = A# C# D# F# G#)
//
// 보조 표기 (모든 모드 공통):
//   - 옥타브 prefix : O4
//   - inline shift : > (옥타브↑) / < (옥타브↓)
//   - rest         : _ 또는 .
//   - duration     : 후행 숫자 (MML 식, 4=4분, 8=8분, 16=16분 ...)
//
// 인라인 어노테이션 : {{key: value, key=value, ...}}
// 라인 주석         : # ... (라인 끝까지)
// =============================================================================

{
  // ---------------------------------------------------------------------------
  // Helper builders — AST 노드 생성기
  // ---------------------------------------------------------------------------

  // qwerty-chromatic 자판 → 음이름 매핑 (octave-base 적용은 후처리 단계)
  const QWERTY_MAP = {
    'z': { pc: 'A', accidental: 0 },
    'x': { pc: 'B', accidental: 0 },
    'c': { pc: 'C', accidental: 0 },
    'v': { pc: 'D', accidental: 0 },
    'b': { pc: 'E', accidental: 0 },
    'n': { pc: 'F', accidental: 0 },
    'm': { pc: 'G', accidental: 0 },
    's': { pc: 'A', accidental: 1 },
    'f': { pc: 'C', accidental: 1 },
    'g': { pc: 'D', accidental: 1 },
    'j': { pc: 'F', accidental: 1 },
    'k': { pc: 'G', accidental: 1 },
  };

  const SOLFA_MAP = {
    '도': 'C', 'do': 'C',
    '레': 'D', 're': 'D',
    '미': 'E', 'mi': 'E',
    '파': 'F', 'fa': 'F',
    '솔': 'G', 'sol': 'G', 'so': 'G',
    '라': 'A', 'la': 'A',
    '시': 'B', 'ti': 'B', 'si': 'B',
  };

  function buildAttrs(pairs) {
    const out = {};
    for (const p of pairs) out[p.key] = p.value;
    return out;
  }

  function normalizeCells(cells) {
    return cells.filter(c => c !== null && c !== undefined);
  }

  function loc() {
    return location();
  }
}

// =============================================================================
// 1. TOP-LEVEL — 문서 진입점
// =============================================================================

Document
  = _nl* fm:Frontmatter? _nl* tracks:Track* _nl* {
      return {
        type: 'Document',
        frontmatter: fm,
        tracks: tracks,
        loc: loc(),
      };
    }

Frontmatter
  = "---" EOL body:FrontmatterBody "---" EOL {
      return {
        type: 'Frontmatter',
        raw: body,
        loc: loc(),
      };
    }

FrontmatterBody
  = lines:FrontmatterLine* { return lines.join('\n'); }

FrontmatterLine
  = !("---" EOL) chars:$([^\n\r]*) EOL { return chars; }

// =============================================================================
// 2. TRACK
// =============================================================================

Track
  = header:TrackHeader body:TrackBody {
      return {
        type: 'Track',
        id: header.id,
        attrs: header.attrs,
        measures: body,
        loc: loc(),
      };
    }

TrackHeader
  = "##" __ "track" _ ":" _ id:TrackId _ attrs:AttrBlock? EOL {
      return { id: id, attrs: attrs || {} };
    }

TrackId
  = $([a-zA-Z_][a-zA-Z0-9_\-]*)

AttrBlock
  = "{" _ pairs:AttrList? _ "}" { return buildAttrs(pairs || []); }

AttrList
  = head:AttrPair tail:(_ "," _ AttrPair)* {
      return [head, ...tail.map(t => t[3])];
    }

AttrPair
  = key:AttrKey _ ("=" / ":") _ value:AttrValue {
      return { key, value };
    }

AttrKey
  = $([a-zA-Z_][a-zA-Z0-9_\-]*)

AttrValue
  = QuotedString
  / Number
  / $([a-zA-Z0-9_\-./]+)

TrackBody
  = lines:TrackBodyLine* { return lines.filter(l => l !== null); }

TrackBodyLine
  = !TrackHeaderLookahead l:(MeasureLine / CommentLine / BlankLine) { return l; }

TrackHeaderLookahead
  = "##" __ "track" _ ":"

MeasureLine
  = _ measures:Measure+ _ trailing:LineComment? EOL {
      return {
        type: 'MeasureLine',
        measures: measures,
        comment: trailing,
        loc: loc(),
      };
    }

CommentLine
  = _ c:LineComment EOL { return { type: 'CommentLine', text: c, loc: loc() }; }

BlankLine
  = _ EOL { return null; }

// =============================================================================
// 3. MEASURE
// =============================================================================

Measure
  = "|" _ cells:CellSeq _ &("|") {
      return {
        type: 'Measure',
        cells: normalizeCells(cells),
        loc: loc(),
      };
    }

CellSeq
  = head:Cell? tail:(__ Cell)* {
      const all = head ? [head] : [];
      for (const t of tail) all.push(t[1]);
      return all;
    }

Cell
  = Annotation
  / Rest
  / Note

Rest
  = sym:("_" / ".") dur:Duration? {
      return {
        type: 'Rest',
        symbol: sym,
        duration: dur,
        loc: loc(),
      };
    }

// =============================================================================
// 4. NOTE — 표기 모드별 sub-grammar (union)
// =============================================================================

Note
  = OctaveAbsolute
  / NoteWithShifts

OctaveAbsolute
  = "O" oct:$([0-9]+) rest:NoteCore? {
      return {
        type: rest ? 'Note' : 'OctaveSet',
        octaveAbs: parseInt(oct, 10),
        ...(rest || {}),
        loc: loc(),
      };
    }

NoteWithShifts
  = shifts:OctaveShift* core:NoteCore {
      const delta = shifts.reduce((a, s) => a + (s === '>' ? 1 : -1), 0);
      return {
        type: 'Note',
        octaveShift: delta,
        ...core,
        loc: loc(),
      };
    }

OctaveShift
  = ">" / "<"

NoteCore
  = SolfaNote
  / NashvilleChord
  / NashvilleNote
  / AbcMmlNote
  / QwertyNote

SolfaNote
  = name:SolfaSyllable acc:Accidental? dur:Duration? {
      return {
        notation: 'solfa',
        raw: name,
        pc: SOLFA_MAP[name] || null,
        accidental: acc || 0,
        duration: dur,
      };
    }

SolfaSyllable
  = $("도" / "레" / "미" / "파" / "솔" / "라" / "시"
    / "do" / "re" / "mi" / "fa" / "sol" / "so" / "la" / "ti" / "si")

NashvilleChord
  = degree:[1-7] qual:ChordQuality ext:ChordExtension? dur:Duration? {
      return {
        notation: 'nashville',
        kind: 'chord',
        degree: parseInt(degree, 10),
        quality: qual,
        extension: ext,
        duration: dur,
      };
    }

NashvilleNote
  = degree:[1-7] acc:Accidental? dur:Duration? !ChordQuality {
      return {
        notation: 'nashville',
        kind: 'note',
        degree: parseInt(degree, 10),
        accidental: acc || 0,
        duration: dur,
      };
    }

ChordQuality
  = $("maj" / "min" / "dim" / "aug" / "sus" / "m")

ChordExtension
  = $([0-9]+ ("/" [a-zA-Z0-9#b+-]+)?)

AbcMmlNote
  = name:AbcMmlPitch acc:Accidental? dur:Duration? {
      return {
        notation: 'abc-or-mml',
        raw: name,
        pc: name.toUpperCase(),
        accidental: acc || 0,
        duration: dur,
      };
    }

AbcMmlPitch
  = $[a-gA-G]

QwertyNote
  = key:QwertyKey dur:Duration? {
      const m = QWERTY_MAP[key];
      return {
        notation: 'qwerty-chromatic',
        raw: key,
        pc: m ? m.pc : null,
        accidental: m ? m.accidental : 0,
        duration: dur,
      };
    }

QwertyKey
  = $[zxcvbnmsfgjk]

Accidental
  = "+" { return  1; }
  / "#" { return  1; }
  / "-" { return -1; }
  / "b" { return -1; }

Duration
  = n:$([0-9]+) dots:$("."*) {
      return {
        denominator: parseInt(n, 10),
        dots: dots.length,
      };
    }

// =============================================================================
// 5. ANNOTATION
// =============================================================================

Annotation
  = "{{" _ name:AnnotationName _ args:AnnotationArgs? _ "}}" {
      return {
        type: 'Annotation',
        name: name,
        args: args || {},
        loc: loc(),
      };
    }

AnnotationName
  = $([a-zA-Z_][a-zA-Z0-9_\-]*)

AnnotationArgs
  = ":" _ pairs:AttrList { return buildAttrs(pairs); }
  / "," _ pairs:AttrList { return buildAttrs(pairs); }

// =============================================================================
// 6. LITERALS
// =============================================================================

QuotedString
  = '"' chars:$([^"\n\r]*) '"' { return chars; }
  / "'" chars:$([^'\n\r]*) "'" { return chars; }

Number
  = n:$("-"? [0-9]+ ("." [0-9]+)?) { return parseFloat(n); }

// =============================================================================
// 7. COMMENT & WHITESPACE
// =============================================================================

LineComment
  = "#" text:$([^\n\r]*) { return text.trim(); }

_  = [ \t]*
__ = [ \t]+
_nl = [ \t\n\r]+

EOL
  = "\r\n"
  / "\n"
  / "\r"
  / !.

// =============================================================================
// 향후 확장 (post-v0.1):
//   - tuplet (`(3 c d e)` triplet)
//   - tie / slur (`~` / `(...)`)
//   - microtonal accidental (`++` / `--` / cents)
//   - dynamic marks as first-class
//   - mode context injection (parser arg 로 트랙별 notation 강제)
// =============================================================================
