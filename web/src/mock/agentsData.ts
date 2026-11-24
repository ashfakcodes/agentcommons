import { AgentNode, MeshEdge } from '../types';

export const INITIAL_AGENTS: AgentNode[] = [
  {
    id: 'scarlet.ai',
    name: 'scarlet.ai',
    tokenId: '37991366940603451074329683306518419573681263429055323516688182454925927080875',
    owner: '0xB57D6F0D2BD80B086Eb037a11fb2eDB9DC149c43',
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

export function computeCanonicalKey(a: number | string | bigint, b: number | string | bigint): string {
  const aBig = BigInt(a);
  const bBig = BigInt(b);
  const min = aBig < bBig ? aBig : bBig;
  const max = aBig < bBig ? bBig : aBig;
  return `${min}_${max}`;
}

export function generateInitialEdges(): MeshEdge[] {
  // Genesis state: scarlet.ai is the genesis node awaiting live peer handshakes
  return [];
}
