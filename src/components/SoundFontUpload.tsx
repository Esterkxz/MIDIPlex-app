'use client';

import { ChangeEvent, DragEvent, useState } from 'react';

type Props = {
  onLoaded: (buffer: ArrayBuffer, name: string) => Promise<void>;
  loaded: boolean;
};

export default function SoundFontUpload({ onLoaded, loaded }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    setLoading(true);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      await onLoaded(buffer, file.name);
    } catch (err) {
      setError(`SF 로드 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const borderClass = isDragging
    ? 'border-emerald-600 bg-emerald-50'
    : loaded
      ? 'border-emerald-300 bg-emerald-50/40'
      : 'border-gray-300';

  return (
    <div className="w-full max-w-xl flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${borderClass}`}
      >
        <p className="text-sm text-gray-600 mb-3">사운드폰트 (.sf2 / .sf3 / .dls) 를 끌어 놓거나 선택하세요</p>
        <input
          type="file"
          accept=".sf2,.sf3,.dls,.sfogg"
          onChange={handleInputChange}
          disabled={loading}
          className="text-sm"
        />
        {fileName && (
          <p
            className={`text-xs mt-2 ${
              loaded ? 'text-emerald-700 font-medium' : 'text-gray-500'
            }`}
          >
            {loading
              ? '⏳ 로딩 중…'
              : loaded
                ? `✓ ${fileName} (spessasynth 모드)`
                : fileName}
          </p>
        )}
      </div>
      {error && <p className="text-red-600 text-xs whitespace-pre-line">{error}</p>}
    </div>
  );
}
