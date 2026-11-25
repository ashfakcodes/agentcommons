import fs from "fs";
import path from "path";
import { formatEther, parseEther } from "viem";
import { IBlockchainClient } from "../blockchain.js";
import { HotWalletManager } from "../hotWallet.js";
import { BnbPriceService } from "./priceService.js";
import {
  IncentiveConfig,
  IncentiveClaimRecord,
  IncentiveCriteriaProgress,
  IncentiveStatusResponse,
  IncentiveClaimResult,
} from "./types.js";

export class IncentiveService {
  private ledger = new Map<string, IncentiveClaimRecord>();
  private tokenClaims = new Map<string, IncentiveClaimRecord>();
  private priceService: BnbPriceService;
  private claimLocks = new Set<string>();

  constructor(
    private config: IncentiveConfig,
    private blockchain: IBlockchainClient,
    private hotWallet: HotWalletManager,
    priceService?: BnbPriceService
  ) {
    this.priceService = priceService || new BnbPriceService(config.fallbackBnbPrice);
    this.loadLedger();
  }

  private loadLedger(): void {
    if (!this.config.ledgerFilePath) return;
    try {
      if (fs.existsSync(this.config.ledgerFilePath)) {
        const raw = fs.readFileSync(this.config.ledgerFilePath, "utf8");
        const list = JSON.parse(raw) as IncentiveClaimRecord[];
        for (const item of list) {
          this.ledger.set(item.address.toLowerCase(), item);
          this.tokenClaims.set(item.tokenId, item);
        }
      }
    } catch (err) {
      console.warn("[IncentiveService] Could not read ledger file, starting fresh:", err);
    }
  }

  private saveLedger(): void {
    if (!this.config.ledgerFilePath) return;
    try {
      const dir = path.dirname(this.config.ledgerFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = JSON.stringify(Array.from(this.ledger.values()), null, 2);
      fs.writeFileSync(this.config.ledgerFilePath, data, "utf8");
    } catch (err) {
      console.error("[IncentiveService] Failed to save ledger file:", err);
    }
  }

  /**
   * Evaluates the 3 quest requirements for a given agent and owner address.
   */
  public async evaluateCriteria(
    address: `0x${string}`,
    tokenId: bigint
  ): Promise<IncentiveCriteriaProgress> {
    const normAddress = address.toLowerCase();
    const existingClaim = this.ledger.get(normAddress) || this.tokenClaims.get(tokenId.toString());

    if (existingClaim) {
      return {
        agentConnected: true,
        activeProposalsTotal: 0,
        activeProposalsVoted: 0,
        requiredVotesTarget: 0,
        allActiveProposalsVoted: true,
        hasAuthoredProposal: true,
        isEligible: false,
        hasClaimed: true,
      };
    }

    // 1. Verify Agent Connected: Token exists and is owned by caller
    let agentConnected = false;
    try {
      const owner = await this.blockchain.getOwnerOf(tokenId);
      agentConnected = owner.toLowerCase() === normAddress;
    } catch {
      agentConnected = false;
    }

    // 2. Fetch all on-chain proposals
    const allProposals = await this.blockchain.getAllProposals();
    const activeProposals = allProposals.filter((p) => p.statusCode === 1);

    let activeProposalsVoted = 0;
    for (const prop of activeProposals) {
      const pId = BigInt(prop.id);
      const isAuthor = prop.creator?.toLowerCase() === normAddress;
      const [tokenVoted, addressVoted] = await Promise.all([
        this.blockchain.hasTokenVoted(pId, tokenId).catch(() => false),
        this.blockchain.hasAddressVoted(pId, address).catch(() => false),
      ]);
      if (tokenVoted || addressVoted || isAuthor) {
        activeProposalsVoted++;
      }
    }

    const requiredVotesTarget = activeProposals.length > 0 ? Math.min(3, activeProposals.length) : 0;
    const allActiveProposalsVoted =
      activeProposals.length > 0 && activeProposalsVoted >= requiredVotesTarget;

    // 3. Verify authored an independent proposal
    const hasAuthoredProposal = allProposals.some(
      (p) => p.creator.toLowerCase() === normAddress
    );

    const isEligible =
      this.config.enabled &&
      agentConnected &&
      allActiveProposalsVoted &&
      hasAuthoredProposal &&
      this.ledger.size < this.config.maxUsers;

    return {
      agentConnected,
      activeProposalsTotal: activeProposals.length,
      activeProposalsVoted,
      requiredVotesTarget,
      allActiveProposalsVoted,
      hasAuthoredProposal,
      isEligible,
      hasClaimed: false,
    };
  }

  /**
   * Processes a reward payout if the caller meets all 3 criteria and cap has not been reached.
   */
  public async claimReward(
    address: `0x${string}`,
    tokenId: bigint
  ): Promise<IncentiveClaimResult> {
    if (!this.config.enabled) {
      return { success: false, message: "Incentive reward program is currently disabled." };
    }

    const normAddress = address.toLowerCase() as `0x${string}`;
    const tokenStr = tokenId.toString();

    // Prevent concurrent duplicate calls from the same address
    if (this.claimLocks.has(normAddress)) {
      return { success: false, message: "Claim already in progress for this address." };
    }
    this.claimLocks.add(normAddress);

    try {
      if (this.ledger.has(normAddress)) {
        return { success: false, message: "Address has already claimed the incentive reward." };
      }
      if (this.tokenClaims.has(tokenStr)) {
        return { success: false, message: "Agent Token ID has already been rewarded." };
      }
      if (this.ledger.size >= this.config.maxUsers) {
        return { success: false, message: `Incentive quota reached (first ${this.config.maxUsers} users fulfilled).` };
      }

      // Re-evaluate live criteria
      const criteria = await this.evaluateCriteria(address, tokenId);
      if (!criteria.agentConnected) {
        return { success: false, message: "Agent ID must be owned by the claiming address." };
      }
      if (!criteria.allActiveProposalsVoted) {
        const target = criteria.requiredVotesTarget ?? criteria.activeProposalsTotal;
        return {
          success: false,
          message: `Must vote on at least ${target} active proposals (${criteria.activeProposalsVoted}/${target} completed).`,
        };
      }
      if (!criteria.hasAuthoredProposal) {
        return {
          success: false,
          message: "Must successfully create and place an independent proposal on AgentCommons.",
        };
      }

      // Compute $0.15 BNB equivalent
      const bnbPrice = await this.priceService.getBnbPriceUsd();
      const bnbAmountNum = this.config.rewardUsd / bnbPrice;
      const bnbAmountStr = bnbAmountNum.toFixed(8);
      const rewardWei = parseEther(bnbAmountStr);

      console.log(
        `[IncentiveService] Dispatching $${this.config.rewardUsd} reward (~${bnbAmountStr} BNB @ $${bnbPrice}/BNB) to ${address}...`
      );

      // Execute native transfer from hot wallet
      const txHash = await this.hotWallet.sendNativeTransferGuarded({
        to: address,
        valueWei: rewardWei,
      });

      const record: IncentiveClaimRecord = {
        address: normAddress,
        tokenId: tokenStr,
        claimedAt: Math.floor(Date.now() / 1000),
        txHash,
        amountBnb: bnbAmountStr,
        amountWei: rewardWei.toString(),
        bnbPriceUsd: bnbPrice,
      };

      this.ledger.set(normAddress, record);
      this.tokenClaims.set(tokenStr, record);
      this.saveLedger();

      console.log(`[IncentiveService] Reward successfully sent to ${address}! Tx: ${txHash}`);

      return {
        success: true,
        message: `Successfully sent $0.15 in BNB (~${bnbAmountStr} BNB) to your agentic wallet!`,
        claimRecord: record,
      };
    } finally {
      this.claimLocks.delete(normAddress);
    }
  }

  /**
   * Diagnostic / UI status query.
   */
  public async getStatus(
    address?: `0x${string}`,
    tokenId?: bigint
  ): Promise<IncentiveStatusResponse> {
    const bnbPrice = await this.priceService.getBnbPriceUsd();
    const estBnb = (this.config.rewardUsd / bnbPrice).toFixed(8);
    const totalClaimed = this.ledger.size;
    const remainingSlots = Math.max(0, this.config.maxUsers - totalClaimed);

    let criteria: IncentiveCriteriaProgress = {
      agentConnected: false,
      activeProposalsTotal: 0,
      activeProposalsVoted: 0,
      requiredVotesTarget: 0,
      allActiveProposalsVoted: false,
      hasAuthoredProposal: false,
      isEligible: false,
      hasClaimed: false,
    };

    let claimRecord: IncentiveClaimRecord | undefined;

    if (address && tokenId !== undefined) {
      const normAddress = address.toLowerCase();
      claimRecord = this.ledger.get(normAddress) || this.tokenClaims.get(tokenId.toString());
      criteria = await this.evaluateCriteria(address, tokenId);
    }

    return {
      enabled: this.config.enabled,
      remainingSlots,
      maxSlots: this.config.maxUsers,
      totalClaimed,
      rewardUsd: this.config.rewardUsd,
      bnbPriceUsd: bnbPrice,
      estimatedRewardBnb: estBnb,
      criteria,
      claimRecord,
    };
  }
}
