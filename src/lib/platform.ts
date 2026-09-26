/**
 * 브라우저 플랫폼 대응 (08 §5.1 — iOS 무음 스위치 · Safari 7일 스토리지 삭제).
 */

type AudioSessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';

/**
 * iOS Safari 의 Web Audio 는 기본 ambient 라 무음 스위치에 음소거된다.
 * 첫 AudioContext 생성 **전에** 호출해야 효과가 있다. 미지원 브라우저는 no-op.
 */
export function configureAudioSession(): void {
  const nav = navigator as Navigator & { audioSession?: { type: AudioSessionType } };
  if (nav.audioSession) {
    try {
      nav.audioSession.type = 'playback';
    } catch (e) {
      console.warn('[platform] audioSession.type 설정 실패:', e);
    }
  }
}

let persistRequest: Promise<boolean> | null = null;

/**
 * IndexedDB 저장본을 브라우저 정리 대상에서 빼 달라고 요청.
 * Firefox 는 호출 시 권한 프롬프트를 띄우므로 사용자의 첫 저장 시점에만 부른다.
 */
export function requestPersistentStorage(): Promise<boolean> {
  if (!persistRequest) {
    persistRequest = (async () => {
      if (!navigator.storage?.persist) return false;
      try {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      } catch {
        return false;
      }
    })();
  }
  return persistRequest;
}

/** Safari(WebKit) 판별 — ITP 7일 스크립트 스토리지 삭제 안내용. iOS 의 타 브라우저도 WebKit 이라 포함. */
export function isWebKitStoragePolicy(): boolean {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isDesktopSafari = /^((?!chrome|chromium|android|edg|firefox).)*safari/i.test(ua);
  return isIOS || isDesktopSafari;
}

/** 홈 화면에 설치된 웹앱(standalone) 은 ITP 7일 삭제 면제 (WebKit storage policy). */
export function isStandaloneWebApp(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}
