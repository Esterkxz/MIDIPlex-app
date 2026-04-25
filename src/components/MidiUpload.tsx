'use client';

import { ChangeEvent, DragEvent, useState } from 'react';
import type { ProjectState } from '@/lib/types/project';
import { Midi } from '@tonejs/midi';
import { loadMidiFromBuffer } from '@/lib/midi-loader';
import { loadNwctxtFromText } from '@/lib/nwctxt-loader';

type Props = {
  /** loadedMidi/buffer 는 NWC 같은 비-SMF 입력의 경우 null. page 가 applyProject 로 폴백. */
  onLoaded: (
    project: ProjectState,
    loadedMidi: Midi | null,
    buffer: ArrayBuffer | null,
    fileName: string,
  ) => void;
};

export default function MidiUpload({ onLoaded }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      if (ext === 'nwctxt' || ext === 'nwc-txt' || file.type === 'text/plain') {
        const text = await file.text();
        const { project } = loadNwctxtFromText(text, file.name);
        onLoaded(project, null, null, file.name);
      } else {
        const buffer = await file.arrayBuffer();
        const { midi, project } = loadMidiFromBuffer(buffer);
        onLoaded(project, midi, buffer, file.name);
      }
    } catch (e) {
      setError(`파일 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
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

  return (
    <div className="w-full max-w-xl flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
        }`}
      >
        <p className="text-sm text-gray-600 mb-1">MIDI 또는 NWC 텍스트 파일을 끌어 놓거나 선택하세요</p>
        <p className="text-[10px] text-gray-400 mb-3">.mid · .midi · .nwctxt</p>
        <input
          type="file"
          accept=".mid,.midi,.nwctxt,audio/midi,audio/x-midi,text/plain"
          onChange={handleInputChange}
          className="text-sm"
        />
      </div>
      {error && <p className="text-red-600 text-sm whitespace-pre-line">{error}</p>}
    </div>
  );
}
