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
};

export default function TrackSidebar({
  tracks,
  activeIndex,
  onActiveChange,
  visibleTracks,
  onVisibleChange,
  collapsed,
  onToggleCollapsed,
}: Props) {
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
      className={`flex flex-col border-r bg-gray-50 transition-all overflow-hidden ${
        collapsed ? 'w-10' : 'w-72'
      }`}
      style={{ flexShrink: 0 }}
    >
      <div className="flex items-center justify-between gap-2 border-b bg-white px-2 py-2">
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
                <div className="flex items-center justify-center py-2 gap-1">
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => handleTrackToggle(i)}
                    onClick={(e) => e.stopPropagation()}
                    className="cursor-pointer"
                  />
                  <span
                    className="w-3 h-3 rounded-sm"
                    style={{ background: color }}
                  />
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
    </aside>
  );
}
