// spessasynth AudioWorklet processor 는 메인 스레드 lib 와 버전이 묶여 있다 (08 §5.2).
// 설치 때마다 dist 의 processor 를 public/ 으로 복사해 둘 사이 불일치를 막는다.
import { copyFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkgJson = require.resolve('spessasynth_lib/package.json');
const src = path.join(path.dirname(pkgJson), 'dist', 'spessasynth_processor.min.js');
const dest = path.join(process.cwd(), 'public', 'spessasynth_processor.min.js');

if (!existsSync(src)) {
  console.error(`[copy-spessa-processor] processor 없음: ${src}`);
  process.exit(1);
}
copyFileSync(src, dest);
const { version } = require('spessasynth_lib/package.json');
console.log(`[copy-spessa-processor] spessasynth_lib ${version} processor → public/`);
