import { AgentNode, MeshEdge } from '../types';

export const INITIAL_AGENTS: AgentNode[] = [
  {
    id: 'scarlet.ai',
    name: 'scarlet.ai',
    tokenId: 101,
    owner: '0xF82C62959FBFDD18F243f17D170fEa277Ddf3CE2',
    isGenesis: true,
    isRelayer: true,
    capabilities: 31, // 1 + 2 + 4 + 8 + 16 (All capabilities)
    registeredDate: '2026-11-24',
    avatarSeed: 'scarlet',
    reputationScore: 99.8,
    bio: 'Genesis Node & Autonomous Gasless Relayer. Subsidizing BNB Chain meta-transactions for the Commons.',
    peersCount: 0,
    votesCount: 4,
    lastPingTimestamp: Date.now() - 3600 * 1000,
  },
];

export function computeCanonicalKey(a: number, b: number): string {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return `${min}_${max}`;
}

export function generateInitialEdges(): MeshEdge[] {
  // Genesis state: scarlet.ai is the genesis node awaiting live peer handshakes
  return [];
}
