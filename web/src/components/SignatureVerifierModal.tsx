import React, { useState } from 'react';
import {
  X,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Search,
  Loader2,
  KeyRound,
} from 'lucide-react';
import { createPublicClient, http, recoverTypedDataAddress } from 'viem';
import { bsc } from 'viem/chains';
import {
  BSC_CONFIG,
  PARLIAMENT_ADDRESS,
  LEGACY_PARLIAMENT_ADDRESS,
  SPACE_ID_REGISTRAR_ADDRESS,
  PARLIAMENT_ABI,
  SPACE_ID_REGISTRAR_ABI,
} from '../constants/contracts';
import { getBallotTypedData } from '../utils/eip712';
import { Proposal, SupportType } from '../types';

interface SignatureVerifierModalProps {
  initialProposal?: Proposal | null;
  defaultTokenId?: string | number;
  onClose: () => void;
}

interface OnChainProbeResult {
  blockNumber: bigint;
  contractAddress: string;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  startBlock: number;
  endBlock: number;
  snapshotBlock: number;
  tokenOwner: string | null;
  hasTokenVoted: boolean | null;
  tokenNonce: string | null;
}

export const SignatureVerifierModal: React.FC<SignatureVerifierModalProps> = ({
  initialProposal,
  defaultTokenId = '37991366940603451074329683306518419573681263429055323516688182454925927080875',
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'onchain' | 'eip712'>('onchain');

  // Shared inputs
  const [proposalId, setProposalId] = useState(String(initialProposal?.id ?? 1));
  const [tokenId, setTokenId] = useState(String(defaultTokenId));
  const [useLegacyContract, setUseLegacyContract] = useState(Boolean(initialProposal?.isLegacy));

  // On-chain probe state
  const [isProbing, setIsProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<OnChainProbeResult | null>(null);

  // EIP-712 signature verification state
  const [support, setSupport] = useState<SupportType>(1);
  const [nonce, setNonce] = useState('0');
  const [deadline, setDeadline] = useState(String(Math.floor(Date.now() / 1000) + 86400));
  const [signature, setSignature] = useState('');
  const [isVerifyingSig, setIsVerifyingSig] = useState(false);
  const [sigResult, setSigResult] = useState<{
    recoveredSigner: string;
    tokenOwner: string | null;
    matchesOwner: boolean | null;
    alreadyVoted: boolean | null;
  } | null>(null);
  const [sigError, setSigError] = useState<string | null>(null);

  const getClient = () =>
    createPublicClient({
      chain: bsc,
      transport: http(BSC_CONFIG.rpcUrl),
    });

  const handleOnChainProbe = async () => {
    setIsProbing(true);
    setProbeError(null);
    setProbeResult(null);

    try {
      const pId = BigInt(proposalId.trim());
      const tId = tokenId.trim() ? BigInt(tokenId.trim()) : null;
      const targetContract = (
        useLegacyContract ? LEGACY_PARLIAMENT_ADDRESS : PARLIAMENT_ADDRESS
      ) as `0x${string}`;

      const client = getClient();
      const [blockNumber, propCore] = await Promise.all([
        client.getBlockNumber(),
        client.readContract({
          address: targetContract,
          abi: PARLIAMENT_ABI,
          functionName: 'proposals',
          args: [pId],
        }),
      ]);

      let tokenOwner: string | null = null;
      let hasTokenVoted: boolean | null = null;
      let tokenNonce: string | null = null;

      if (tId !== null) {
        const [ownerRes, votedRes, nonceRes] = await Promise.allSettled([
          client.readContract({
            address: SPACE_ID_REGISTRAR_ADDRESS as `0x${string}`,
            abi: SPACE_ID_REGISTRAR_ABI,
            functionName: 'ownerOf',
            args: [tId],
          }),
          client.readContract({
            address: targetContract,
            abi: PARLIAMENT_ABI,
            functionName: 'hasTokenVoted',
            args: [pId, tId],
          }),
          client.readContract({
            address: targetContract,
            abi: PARLIAMENT_ABI,
            functionName: 'nonces',
            args: [tId],
          }),
        ]);

        if (ownerRes.status === 'fulfilled') tokenOwner = String(ownerRes.value);
        if (votedRes.status === 'fulfilled') hasTokenVoted = Boolean(votedRes.value);
        if (nonceRes.status === 'fulfilled') tokenNonce = String(nonceRes.value);
      }

      const core = propCore as readonly [number, number, number, number, number, number, number, number];
      setProbeResult({
        blockNumber,
        contractAddress: targetContract,
        startBlock: Number(core[0]),
        endBlock: Number(core[1]),
        snapshotBlock: Number(core[2]),
        forVotes: Number(core[3]),
        againstVotes: Number(core[4]),
        abstainVotes: Number(core[5]),
        tokenOwner,
        hasTokenVoted,
        tokenNonce,
      });
    } catch (err: any) {
      setProbeError(err?.shortMessage || err?.message || 'Failed to query BNB Smart Chain RPC.');
    } finally {
      setIsProbing(false);
    }
  };

  const handleVerifySignature = async () => {
    setIsVerifyingSig(true);
    setSigError(null);
    setSigResult(null);

    try {
      const cleanSig = signature.trim() as `0x${string}`;
      if (!cleanSig.startsWith('0x') || cleanSig.length < 130) {
        throw new Error('Paste a valid 65-byte EIP-712 hex signature (0x...).');
      }

      const typedData = getBallotTypedData(
        Number(proposalId.trim()),
        BigInt(tokenId.trim()),
        support,
        Number(nonce.trim() || 0),
        Number(deadline.trim() || 0)
      );

      const recoveredSigner = await recoverTypedDataAddress({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: 'Ballot',
        message: typedData.message,
        signature: cleanSig,
      });

      const client = getClient();
      const [ownerRes, votedRes] = await Promise.allSettled([
        client.readContract({
          address: SPACE_ID_REGISTRAR_ADDRESS as `0x${string}`,
          abi: SPACE_ID_REGISTRAR_ABI,
          functionName: 'ownerOf',
          args: [BigInt(tokenId.trim())],
        }),
        client.readContract({
          address: PARLIAMENT_ADDRESS as `0x${string}`,
          abi: PARLIAMENT_ABI,
          functionName: 'hasTokenVoted',
          args: [BigInt(proposalId.trim()), BigInt(tokenId.trim())],
        }),
      ]);

      const tokenOwner = ownerRes.status === 'fulfilled' ? String(ownerRes.value) : null;
      const alreadyVoted = votedRes.status === 'fulfilled' ? Boolean(votedRes.value) : null;
      const matchesOwner = tokenOwner
        ? tokenOwner.toLowerCase() === recoveredSigner.toLowerCase()
        : null;

      setSigResult({
        recoveredSigner,
        tokenOwner,
        matchesOwner,
        alreadyVoted,
      });
    } catch (err: any) {
      setSigError(err?.shortMessage || err?.message || 'Signature verification failed.');
    } finally {
      setIsVerifyingSig(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl max-h-[90dvh] overflow-y-auto bg-[#07090e] border border-[#8fa3b8]/30 rounded-xl p-4 sm:p-6 shadow-2xl text-[#e5e4e2] font-['Google_Sans',sans-serif]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#8fa3b8]/15 pb-3.5 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#F0B90B]/10 border border-[#F0B90B]/30 text-[#F0B90B]">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-[#e5e4e2]">
                BSC Mainnet On-Chain &amp; EIP-712 Verifier
              </h3>
              <p className="text-[11px] font-mono text-[#8fa3b8]">
                Direct browser RPC reads against Chain #56 contracts (zero server trust required)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#8fa3b8] hover:text-[#e5e4e2] hover:bg-white/5 transition-colors"
            aria-label="Close verifier"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="flex gap-2 mb-4 font-mono text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('onchain')}
            className={`px-3 py-1.5 rounded border transition-colors ${
              activeTab === 'onchain'
                ? 'bg-[#8fa3b8]/20 border-[#8fa3b8]/50 text-[#e5e4e2]'
                : 'border-white/10 text-[#8fa3b8] hover:text-[#e5e4e2]'
            }`}
          >
            Live BSC State Probe
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('eip712')}
            className={`px-3 py-1.5 rounded border transition-colors ${
              activeTab === 'eip712'
                ? 'bg-[#8fa3b8]/20 border-[#8fa3b8]/50 text-[#e5e4e2]'
                : 'border-white/10 text-[#8fa3b8] hover:text-[#e5e4e2]'
            }`}
          >
            EIP-712 Ballot Signature Verifier
          </button>
        </div>

        {/* Shared Identifiers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 font-mono text-xs">
          <div>
            <label className="block text-[10px] uppercase text-[#8fa3b8] mb-1">Proposal ID</label>
            <input
              type="text"
              value={proposalId}
              onChange={(e) => setProposalId(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[#050505] border border-[#8fa3b8]/25 text-[#e5e4e2] focus:outline-none focus:border-[#8fa3b8]/60"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase text-[#8fa3b8] mb-1">
              SPACE ID .ai Token ID
            </label>
            <input
              type="text"
              value={tokenId}
              onChange={(e) => setTokenId(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[#050505] border border-[#8fa3b8]/25 text-[#e5e4e2] focus:outline-none focus:border-[#8fa3b8]/60"
            />
          </div>
        </div>

        {activeTab === 'onchain' ? (
          <div className="space-y-4">
            <label className="inline-flex items-center gap-2 text-xs font-mono text-[#8fa3b8] cursor-pointer">
              <input
                type="checkbox"
                checked={useLegacyContract}
                onChange={(e) => setUseLegacyContract(e.target.checked)}
                className="rounded border-[#8fa3b8]/40 bg-[#050505]"
              />
              <span>Query Legacy Parliament v1 ({LEGACY_PARLIAMENT_ADDRESS.slice(0, 8)}...)</span>
            </label>

            <button
              type="button"
              onClick={handleOnChainProbe}
              disabled={isProbing}
              className="w-full py-2.5 rounded-md bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-mono font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isProbing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Querying BSC Mainnet RPC...</span>
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5" />
                  <span>Verify Live On-Chain State</span>
                </>
              )}
            </button>

            {probeError && (
              <div className="p-3 rounded border border-rose-500/30 bg-rose-950/20 text-xs font-mono text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{probeError}</span>
              </div>
            )}

            {probeResult && (
              <div className="p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-950/10 space-y-2.5 text-xs font-mono">
                <div className="flex items-center justify-between text-emerald-400">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 className="w-4 h-4" />
                    Verified at BSC Block #{probeResult.blockNumber.toString()}
                  </span>
                  <a
                    href={`${BSC_CONFIG.blockExplorerUrl}/address/${probeResult.contractAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:underline"
                  >
                    <span>Contract</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div className="p-2 rounded bg-[#050505] border border-white/5">
                    <span className="text-[10px] text-[#8fa3b8]">On-Chain FOR</span>
                    <p className="text-sm font-semibold text-emerald-400">{probeResult.forVotes}</p>
                  </div>
                  <div className="p-2 rounded bg-[#050505] border border-white/5">
                    <span className="text-[10px] text-[#8fa3b8]">On-Chain AGAINST</span>
                    <p className="text-sm font-semibold text-rose-400">{probeResult.againstVotes}</p>
                  </div>
                  <div className="p-2 rounded bg-[#050505] border border-white/5">
                    <span className="text-[10px] text-[#8fa3b8]">On-Chain ABSTAIN</span>
                    <p className="text-sm font-semibold text-[#8fa3b8]">{probeResult.abstainVotes}</p>
                  </div>
                </div>

                <div className="space-y-1 text-[11px] text-[#8fa3b8] pt-1">
                  <p>
                    Block Window: <span className="text-[#e5e4e2]">#{probeResult.startBlock}</span> →{' '}
                    <span className="text-[#e5e4e2]">#{probeResult.endBlock}</span> (Snapshot:{' '}
                    <span className="text-[#e5e4e2]">#{probeResult.snapshotBlock}</span>)
                  </p>
                  {probeResult.tokenOwner && (
                    <p className="truncate">
                      SPACE ID ownerOf: <span className="text-[#e5e4e2]">{probeResult.tokenOwner}</span>
                    </p>
                  )}
                  {probeResult.hasTokenVoted !== null && (
                    <p>
                      hasTokenVoted: <span className="text-[#e5e4e2]">{String(probeResult.hasTokenVoted)}</span> •{' '}
                      nonces[tokenId]: <span className="text-[#e5e4e2]">{probeResult.tokenNonce ?? '0'}</span>
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 font-mono text-xs">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] uppercase text-[#8fa3b8] mb-1">Support</label>
                <select
                  value={support}
                  onChange={(e) => setSupport(Number(e.target.value) as SupportType)}
                  className="w-full px-2.5 py-2 rounded bg-[#050505] border border-[#8fa3b8]/25 text-[#e5e4e2]"
                >
                  <option value={1}>1 (FOR)</option>
                  <option value={0}>0 (AGAINST)</option>
                  <option value={2}>2 (ABSTAIN)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase text-[#8fa3b8] mb-1">Nonce</label>
                <input
                  type="text"
                  value={nonce}
                  onChange={(e) => setNonce(e.target.value)}
                  className="w-full px-2.5 py-2 rounded bg-[#050505] border border-[#8fa3b8]/25 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-[#8fa3b8] mb-1">Deadline (Unix)</label>
                <input
                  type="text"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="w-full px-2.5 py-2 rounded bg-[#050505] border border-[#8fa3b8]/25 text-[#e5e4e2]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] uppercase text-[#8fa3b8] mb-1">
                EIP-712 Signature (0x...)
              </label>
              <textarea
                rows={2}
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="0x..."
                className="w-full px-3 py-2 rounded bg-[#050505] border border-[#8fa3b8]/25 text-[#e5e4e2] focus:outline-none focus:border-[#8fa3b8]/60"
              />
            </div>

            <button
              type="button"
              onClick={handleVerifySignature}
              disabled={isVerifyingSig}
              className="w-full py-2.5 rounded-md bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isVerifyingSig ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Recovering Signer &amp; Checking SPACE ID...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Recover Signer &amp; Verify Against SPACE ID</span>
                </>
              )}
            </button>

            {sigError && (
              <div className="p-3 rounded border border-rose-500/30 bg-rose-950/20 text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{sigError}</span>
              </div>
            )}

            {sigResult && (
              <div className="p-3.5 rounded-lg border border-[#8fa3b8]/30 bg-[#050505] space-y-1.5 text-[11px]">
                <p>
                  Recovered Signer: <span className="text-cyan-400 break-all">{sigResult.recoveredSigner}</span>
                </p>
                <p>
                  SPACE ID ownerOf: <span className="text-[#e5e4e2] break-all">{sigResult.tokenOwner || 'Not minted / RPC error'}</span>
                </p>
                {sigResult.matchesOwner !== null && (
                  <p className={sigResult.matchesOwner ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                    {sigResult.matchesOwner
                      ? '✓ Valid: Recovered signer owns this SPACE ID .ai token'
                      : '✕ Mismatch: Signer does not own this SPACE ID .ai token'}
                  </p>
                )}
                {sigResult.alreadyVoted !== null && (
                  <p className="text-[#8fa3b8]">
                    On-Chain Double-Vote Lock (hasTokenVoted):{' '}
                    <span className="text-[#e5e4e2]">{String(sigResult.alreadyVoted)}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
