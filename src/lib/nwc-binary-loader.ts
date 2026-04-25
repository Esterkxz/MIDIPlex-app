/**
 * NoteWorthy Composer 2.x 바이너리 (.nwc) → ProjectState 어댑터.
 *
 * spec 발견 (사용자 페어 샘플 + zz85/nwc-viewer 의 schema 참고, cleanroom):
 *   - 외부 envelope: 옵션 BOM + "[NWZ]\0" magic (5 byte ASCII + 1 NUL) + zlib stream
 *     (Z_SYNC_FLUSH 변종 — Adler32 trailer 없이 잘림)
 *   - 또는 비압축: "[Note..." 시작 (1.x 일부 빌드)
 *   - 본문 헤더: "[NoteWorthy ArtWare]\0" + zeros + "[NoteWorthy Composer]\0" +
 *     2 byte version (LE: minor, major) + zeros + "N/A\0" 등록자 + 등록키\0
 *   - 버전 = major + minor * 0.01
 *
 * 버전 분기:
 *   - 2.70+: 본문 안에 ".nwctxt" 형식 텍스트가 그대로 embedded
 *     → "!NoteWorthyComposer" ~ "!NoteWorthyComposer-End" 추출 후 nwctxt-loader 위임
 *   - 2.70 미만 (1.75 등): 옛 binary parsing 필요 — 본 walking 미지원, 사용자에게
 *     안내 (NWC 에서 2.7+ 형식으로 다시 저장 또는 .nwctxt export 권장)
 */

import { unzlibSync } from 'fflate';
import type { ProjectState } from './types/project';
import { loadNwctxtFromText } from './nwctxt-loader';

const MAGIC_NWZ = '[NWZ]';
const MAGIC_NOTE = '[Note';
const MARKER_START = '!NoteWorthyComposer';
const MARKER_END = '!NoteWorthyComposer-End';

export function loadNwcFromBuffer(
  buffer: ArrayBuffer,
  fileName?: string,
): { project: ProjectState; warnings: string[] } {
  const u8 = new Uint8Array(buffer);
  const warnings: string[] = [];

  // 1. BOM 제거
  let start = 0;
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    start = 3;
  }

  // 2. 시그너처 검증
  const sig = String.fromCharCode(...u8.subarray(start, start + 5));
  let bodyRaw: Uint8Array;
  if (sig === MAGIC_NWZ) {
    // [NWZ]\0 (6 bytes) + zlib stream.
    // NWC 의 zlib stream 은 Z_SYNC_FLUSH 변종 — Adler32 trailer 없이 잘림.
    // fflate 의 unzlibSync 는 strict 라 EOF 실패 → 끝에 final empty stored block
    // trailer (01 00 00 FF FF) 추가하면 정상 종료로 인식.
    const compressed = u8.subarray(start + 6);
    const padded = new Uint8Array(compressed.length + 5);
    padded.set(compressed, 0);
    padded.set([0x01, 0x00, 0x00, 0xff, 0xff], compressed.length);
    try {
      bodyRaw = unzlibSync(padded);
    } catch (e) {
      throw new Error(
        `NWC zlib decompress 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else if (sig === MAGIC_NOTE) {
    // 비압축 binary — 1.x 일부 빌드 (희귀)
    bodyRaw = u8.subarray(start);
    warnings.push('비압축 NWC binary 감지 — 1.x 일부 빌드. 본 walking 은 미지원.');
  } else {
    throw new Error(
      `NWC 시그너처 인식 실패. 처음 5 bytes: "${sig}" (기대: [NWZ] 또는 [Note)`,
    );
  }

  // 3. Inner header parse — version 추출
  const header = parseInnerHeader(bodyRaw);
  console.log(
    `[nwc-binary-loader] version=${header.version} ` +
      `company="${header.company}" product="${header.product}" ` +
      `name1="${header.name1}" name2="${header.name2}"`,
  );

  // 4. 버전 분기
  if (header.version < 2.7) {
    throw new Error(
      `NWC ${header.version.toFixed(2)} (binary 1.x) 은 현재 지원 안 됨. 해결 방법:\n` +
        `  1. NoteWorthy Composer 2.x 에서 파일을 열어 "Save As..." → 2.x 형식으로 저장\n` +
        `  2. 또는 "File → Save As..." → "NoteWorthy Composer Clip Text (*.nwctxt)" 으로 export 후 .nwctxt 파일 import`,
    );
  }

  // 5. 2.7+ — nwctext embedded 추출
  const text = extractEmbeddedNwctext(bodyRaw);
  if (!text) {
    throw new Error(
      `NWC ${header.version.toFixed(2)} 에서 embedded nwctext 를 찾지 못함. ` +
        `예상 패턴 "!NoteWorthyComposer" ~ "!NoteWorthyComposer-End" 누락.`,
    );
  }
  console.log(`[nwc-binary-loader] embedded nwctext: ${text.length} chars`);

  const result = loadNwctxtFromText(text, fileName);
  warnings.push(...result.warnings);
  return { project: result.project, warnings };
}

// ============================================================================

interface InnerHeader {
  company: string;
  product: string;
  version: number;
  name1: string; // 등록자 이름 (보통 "N/A")
  name2: string; // 등록키 토큰
}

function parseInnerHeader(buf: Uint8Array): InnerHeader {
  let pos = 0;

  const company = readZeroTerminatedString(buf, pos);
  pos += company.length + 1;
  pos = skipZeros(buf, pos);

  const product = readZeroTerminatedString(buf, pos);
  pos += product.length + 1;
  pos = skipZeros(buf, pos);

  // version: 2 bytes (minor, major)
  const versionMinor = buf[pos];
  const versionMajor = buf[pos + 1];
  pos += 2;
  const version = versionMajor + versionMinor * 0.01;

  // skip 1 byte + zeros
  pos += 1;
  pos = skipZeros(buf, pos);

  const name1 = readZeroTerminatedString(buf, pos);
  pos += name1.length + 1;
  pos = skipZeros(buf, pos);

  const name2 = readZeroTerminatedString(buf, pos);

  return { company, product, version, name1, name2 };
}

function readZeroTerminatedString(buf: Uint8Array, start: number): string {
  let end = start;
  while (end < buf.length && buf[end] !== 0) end++;
  return new TextDecoder('latin1').decode(buf.subarray(start, end));
}

function skipZeros(buf: Uint8Array, pos: number): number {
  while (pos < buf.length && buf[pos] === 0) pos++;
  return pos;
}

/** body 안에서 "!NoteWorthyComposer" ~ "!NoteWorthyComposer-End" 영역 추출. */
function extractEmbeddedNwctext(buf: Uint8Array): string | null {
  const text = new TextDecoder('latin1').decode(buf);
  const startIdx = text.indexOf(MARKER_START);
  if (startIdx < 0) return null;
  const endIdx = text.indexOf(MARKER_END, startIdx);
  if (endIdx < 0) {
    // 끝 마커 없으면 EOF 까지 — partial 허용
    return text.slice(startIdx);
  }
  return text.slice(startIdx, endIdx + MARKER_END.length);
}
