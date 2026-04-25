/**
 * IndexedDB 기반 ProjectState 저장소 (M7 walking).
 *
 * - DB 'midiplex', store 'projects', keyPath 'id'
 * - modifiedAt 인덱스로 최근 정렬
 * - SSR-safe: 모든 작업 client-only (page.tsx 의 useEffect 안에서 호출)
 *
 * 한계:
 * - 대용량 곡 (수만 노트) 도 OK — IndexedDB 는 GB 단위 가능
 * - structured clone 지원 → ProjectState 의 nested object/array 그대로 저장
 * - Set 은 직렬화 안 됨 — ProjectState 에 Set 필드 없음 (visibleTracks 는 page state)
 */

import type { ProjectState } from '../types/project';

const DB_NAME = 'midiplex';
const DB_VERSION = 1;
const STORE = 'projects';

function isAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isAvailable()) {
      reject(new Error('IndexedDB 미지원 환경'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('modifiedAt', 'modifiedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open 실패'));
  });
}

export async function saveProject(project: ProjectState): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(project);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('saveProject 실패'));
    };
  });
}

export async function loadProject(id: string): Promise<ProjectState | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as ProjectState | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error('loadProject 실패'));
    };
  });
}

export type ProjectListEntry = {
  id: string;
  title: string;
  modifiedAt: string;
  trackCount: number;
  noteCount: number;
  durationSeconds: number;
};

export async function listProjects(): Promise<ProjectListEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const items = (req.result as ProjectState[]) ?? [];
      const entries: ProjectListEntry[] = items.map((p) => ({
        id: p.id,
        title: p.title,
        modifiedAt: p.modifiedAt,
        trackCount: p.tracks.length,
        noteCount: p.tracks.reduce((s, t) => s + (t.notes?.length ?? 0), 0),
        durationSeconds: p.durationSeconds,
      }));
      entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      db.close();
      resolve(entries);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error('listProjects 실패'));
    };
  });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('deleteProject 실패'));
    };
  });
}
