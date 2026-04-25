'use client';

import { useEffect, useRef } from 'react';
import type { Track } from '@/lib/types/project';
import { getGmName, parseInstrumentId } from '@/lib/gm-instruments';

const TRACK_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
];

type Props = {
  tracks: Track[];
  activeIndex: number;
  onActiveChange: (idx: number) => void;
  visibleTracks: Set<number>;
  onVisibleChange: (next: Set<number>) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** 펼친 상태 폭 (px). 드래그로 조정 가능. */
  width: number;
  onWidthChange: (px: number) => void;
};

const MIN_WIDTH = 180;
const MAX_WIDTH = 600;

export default function TrackSidebar({
  tracks,
  activeIndex,
  onActiveChange,
  visibleTracks,
  onVisibleChange,
  collapsed,
  onToggleCollapsed,
  width,
  onWidthChange,
}: Props) {
  // 우측 가장자리 드래그로 폭 조정 (펼친 상태에서만)
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    if (collapsed) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (mv: MouseEvent) => {
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + (mv.clientX - startX)));
      onWidthChange(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  // 전체 체크박스 tristate 계산
  const allVisible = tracks.length > 0 && tracks.every((_, i) => visibleTracks.has(i));
  const noneVisible = tracks.every((_, i) => !visibleTracks.has(i));
  const someVisible = !allVisible && !noneVisible;

  // indeterminate 는 prop 으로 안 됨 — ref 로 직접 설정
  const allCheckRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allCheckRef.current) allCheckRef.current.indeterminate = someVisible;
  }, [someVisible]);

  const handleAllToggle = () => {
    if (allVisible) {
      // 전체 → 활성 트랙만 (솔로 패턴)
      onVisibleChange(new Set([activeIndex]));
    } else {
      // 일부 또는 비어있음 → 전체
      onVisibleChange(new Set(tracks.map((_, i) => i)));
    }
  };

  const handleTrackToggle = (i: number) => {
    const next = new Set(visibleTracks);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    onVisibleChange(next);
  };

  return (
    <aside
      className={`flex flex-col border-r bg-gray-50 overflow-hidden relative ${
        collapsed ? 'w-16 transition-all' : ''
      }`}
      style={{ flexShrink: 0, width: collapsed ? undefined : width }}
    >
      <div className={`flex items-center justify-between border-b bg-white py-2 ${collapsed ? 'px-1 gap-1' : 'px-2 gap-2'}`}>
        {!collapsed ? (
          <>
            <input
              ref={allCheckRef}
              type="checkbox"
              checked={allVisible}
              onChange={handleAllToggle}
              className="cursor-pointer"
              title={
                allVisible
                  ? '클릭: 활성 트랙만 보임'
                  : someVisible
                    ? '클릭: 전체 보임'
                    : '클릭: 전체 보임'
              }
            />
            <span className="text-sm font-medium text-gray-700 flex-1">트랙</span>
            <span className="text-[10px] text-gray-400">
              {visibleTracks.size}/{tracks.length}
            </span>
          </>
        ) : (
          <input
            ref={allCheckRef}
            type="checkbox"
            checked={allVisible}
            onChange={handleAllToggle}
            className="cursor-pointer mx-auto"
            title="전체 트랙 토글"
          />
        )}
        <button
          onClick={onToggleCollapsed}
          className="px-2 py-0.5 text-xs hover:bg-gray-100 rounded"
          title={collapsed ? '펼치기' : '접기'}
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {tracks.map((t, i) => {
          const isActive = i === activeIndex;
          const color = TRACK_COLORS[i % TRACK_COLORS.length];
          const programNum = parseInstrumentId(t.instrumentId);
          const isPercussion = t.channel === 9;
          const instLabel = isPercussion
            ? 'Drum Kit (ch10)'
            : programNum >= 0
              ? `${programNum} · ${getGmName(programNum)}`
              : '-';
          const tooltip = `${i}: ${t.name || `Track ${i}`}\n${t.notes?.length ?? 0} notes · ch ${t.channel + 1}\n${instLabel}`;
          const isVisible = visibleTracks.has(i);
          return (
            <li
              key={t.id}
              onClick={() => onActiveChange(i)}
              className={`cursor-pointer border-b transition-colors ${
                isActive ? 'bg-blue-50 border-l-4 border-l-blue-600' : 'hover:bg-gray-100 border-l-4 border-l-transparent'
              } ${!isVisible ? 'opacity-50' : ''}`}
              title={tooltip}
            >
              {collapsed ? (
                <div className="flex items-center py-2 gap-1 px-1">
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => handleTrackToggle(i)}
                    onClick={(e) => e.stopPropagation()}
                    className="cursor-pointer flex-shrink-0"
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ background: color }}
                  />
                  <span className="text-[10px] text-gray-700 font-medium tabular-nums">
                    {i}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => handleTrackToggle(i)}
                    onClick={(e) => e.stopPropagation()}
                    className="cursor-pointer flex-shrink-0"
                    title={isVisible ? '노트 숨기기' : '노트 보이기'}
                  />
                  <span
                    className="w-3 h-3 rounded-sm flex-shrink-0 mt-0.5"
                    style={{ background: color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-800 truncate">
                      {i}: {t.name || `Track ${i}`}
                    </div>
                    <div className="text-[10px] text-gray-500 truncate">
                      {t.notes?.length ?? 0} notes · ch {t.channel + 1}
                    </div>
                    <div className="text-[10px] text-gray-600 truncate" title={instLabel}>
                      {instLabel}
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {tracks.length === 0 && !collapsed && (
          <li className="text-xs text-gray-400 px-3 py-4 text-center">트랙 없음</li>
        )}
      </ul>
      {/* 우측 드래그 리사이즈 핸들 — 펼친 상태에서만 */}
      {!collapsed && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 active:bg-blue-500"
          title="드래그로 폭 조정"
        />
      )}
    </aside>
  );
}
