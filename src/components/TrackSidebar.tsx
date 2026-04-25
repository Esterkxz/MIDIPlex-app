'use client';

import type { Track } from '@/lib/types/project';

const TRACK_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
];

type Props = {
  tracks: Track[];
  activeIndex: number;
  onActiveChange: (idx: number) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

export default function TrackSidebar({
  tracks,
  activeIndex,
  onActiveChange,
  collapsed,
  onToggleCollapsed,
}: Props) {
  return (
    <aside
      className={`flex flex-col border-r bg-gray-50 transition-all overflow-hidden ${
        collapsed ? 'w-10' : 'w-64'
      }`}
      style={{ flexShrink: 0 }}
    >
      <div className="flex items-center justify-between border-b bg-white px-2 py-2">
        {!collapsed && <span className="text-sm font-medium text-gray-700">트랙</span>}
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
          return (
            <li
              key={t.id}
              onClick={() => onActiveChange(i)}
              className={`cursor-pointer border-b transition-colors ${
                isActive ? 'bg-blue-50 border-l-4 border-l-blue-600' : 'hover:bg-gray-100 border-l-4 border-l-transparent'
              }`}
              title={collapsed ? `${i}: ${t.name} (${t.notes?.length ?? 0} notes)` : undefined}
            >
              {collapsed ? (
                <div className="flex items-center justify-center py-2">
                  <span
                    className="w-3 h-3 rounded-sm"
                    style={{ background: color }}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2">
                  <span
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ background: color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-800 truncate">
                      {i}: {t.name || `Track ${i}`}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {t.notes?.length ?? 0} notes · ch {t.channel} · {t.instrumentId ?? '-'}
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
