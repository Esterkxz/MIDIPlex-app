import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 규약 SSoT 는 docs repo(Esterkxz/MIDIPlex) 의 AGENTS.md — `next dev` 가 이 repo 에
  // AGENTS.md/CLAUDE.md 를 자동 생성하지 않도록 끈다 (08 §5.2, 결정 D4 대기 중 임시).
  agentRules: false,
};

export default nextConfig;
