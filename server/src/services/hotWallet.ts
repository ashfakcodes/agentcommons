import fsSync from "fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  PublicClient,
  WalletClient,
  Transport,
  Chain,
} from "viem";
import { privateKeyToAccount, PrivateKeyAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { ServerConfig } from "../config.js";
import { loadKeystoreFromFile, decryptKeystoreToPrivateKey, KeystoreV3 } from "./keystore.js";

export interface HotWalletStatus {
  address: `0x${string}`;
  chainId: number;
  balanceWei: bigint;
  balanceBnb: string;
  currentNonce: bigint;
  isGasHealthy: boolean;
  minThresholdBnb: string;
  keystoreSource: "keystore-file" | "in-memory-env" | "mock";
}

export class HotWalletManager {
  private account!: PrivateKeyAccount;
  private publicClient!: PublicClient;
  private walletClient!: WalletClient;
  private chain: Chain;
  private currentNonce: bigint | null = null;
  private nonceLock: Promise<void> = Promise.resolve();
  private keystoreSource: "keystore-file" | "in-memory-env" | "mock" = "in-memory-env";
  private isInitialized = false;
  private activePrivateKey?: `0x${string}`;

  constructor(private config: ServerConfig) {
    this.chain = config.chainId === 97 ? bscTestnet : bsc;
  }

  /**
   * Initializes the hot wallet:
   * 1. Resolves private key from encrypted keystore file or fallback environment variable.
   * 2. Sets up Viem PublicClient and WalletClient.
   * 3. Syncs the current pending nonce from BSC RPC.
   */
  public async initialize(explicitPassword?: string): Promise<HotWalletStatus> {
    if (this.isInitialized) {
      return await this.getStatus();
    }

    let privateKey: `0x${string}`;

    const password =
      explicitPassword ||
      this.config.keystorePassword ||
      process.env.KEYSTORE_PASSWORD;

    if (this.config.keystorePath && password) {
      try {
        console.log(`[HotWalletManager] Decrypting keystore from: ${this.config.keystorePath}`);
        const keystore = await loadKeystoreFromFile(this.config.keystorePath);
        privateKey = await decryptKeystoreToPrivateKey(keystore, password);
        this.keystoreSource = "keystore-file";
      } catch (err: any) {
        if (!this.config.mockMode && this.config.nodeEnv === "production") {
          throw err;
        }
        console.warn(
          `[HotWalletManager] Keystore load warning (${err.message}). Falling back to SCARLET_PRIVATE_KEY.`
        );
        privateKey = this.config.scarletPrivateKey;
        this.keystoreSource = this.config.mockMode ? "mock" : "in-memory-env";
      }
    } else {
      if (this.config.keystorePath && !password && !this.config.mockMode) {
        console.log(
          `[HotWalletManager] Keystore path is set (${this.config.keystorePath}) but KEYSTORE_PASSWORD is not set. Using SCARLET_PRIVATE_KEY fallback.`
        );
      }
      privateKey = this.config.scarletPrivateKey;
      this.keystoreSource = this.config.mockMode ? "mock" : "in-memory-env";
    }

    this.activePrivateKey = privateKey;
    this.account = privateKeyToAccount(privateKey);

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(this.config.bscRpcUrl),
    }) as PublicClient;

    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(this.config.bscRpcUrl),
    }) as WalletClient;

    // Resync nonce from on-chain RPC pending state
    if (!this.config.mockMode) {
      await this.resyncNonce();
    } else {
      this.currentNonce = 0n;
    }

    this.isInitialized = true;

    const status = await this.getStatus();
    console.log(
      `[HotWalletManager] Ready: Address=${status.address}, Balance=${status.balanceBnb} BNB, Pending Nonce=${status.currentNonce}, Source=${this.keystoreSource}`
    );

    return status;
  }

  public async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  public getAddress(): `0x${string}` {
    if (this.account) {
      return this.account.address;
    }

    if (this.config.keystorePath && fsSync.existsSync(this.config.keystorePath)) {
      try {
        const raw = fsSync.readFileSync(this.config.keystorePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.address) {
          const cleanAddr = parsed.address.startsWith("0x") ? parsed.address : `0x${parsed.address}`;
          return cleanAddr as `0x${string}`;
        }
      } catch {}
    }

    return this.config.scarletPrivateKey
      ? privateKeyToAccount(this.config.scarletPrivateKey).address
      : "0x0000000000000000000000000000000000000000";
  }

  public getAccount(): PrivateKeyAccount {
    return this.account;
  }

  public getActivePrivateKey(): `0x${string}` | undefined {
    return this.activePrivateKey;
  }

  public getWalletClient(): WalletClient {
    return this.walletClient;
  }

  public getPublicClient(): PublicClient {
    return this.publicClient;
  }

  private async runWithNonceLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureInitialized();
    let releaseLock: () => void = () => {};
    const lockWait = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const previousLock = this.nonceLock;
    this.nonceLock = lockWait;
    await previousLock;

    try {
      return await fn();
    } finally {
      releaseLock();
    }
  }

  /**
   * Acquires the next sequential nonce in a thread-safe mutex lock.
   * Guarantees monotonic ordering even if multiple transactions trigger in parallel.
   */
  public async acquireNextNonce(): Promise<bigint> {
    return await this.runWithNonceLock(async () => {
      if (this.currentNonce === null) {
        await this.resyncNonce();
      }
      const assignedNonce = this.currentNonce!;
      this.currentNonce = assignedNonce + 1n;
      return assignedNonce;
    });
  }

  /**
   * Resynchronizes local nonce against the node's pending transaction count.
   */
  public async resyncNonce(): Promise<bigint> {
    if (this.config.mockMode) {
      this.currentNonce = 0n;
      return 0n;
    }

    try {
      const pendingNonce = await this.publicClient.getTransactionCount({
        address: this.account.address,
        blockTag: "pending",
      });
      this.currentNonce = BigInt(pendingNonce);
      return this.currentNonce;
    } catch (err) {
      console.error("[HotWalletManager] Failed to fetch on-chain nonce:", err);
      if (this.currentNonce === null) this.currentNonce = 0n;
      return this.currentNonce;
    }
  }

  /**
   * Rolls back the nonce counter if a transaction fails before broadcast.
   */
  public rollbackNonce(failedNonce: bigint): void {
    if (this.currentNonce !== null && this.currentNonce === failedNonce + 1n) {
      this.currentNonce = failedNonce;
    }
  }

  /**
   * Validates gas balance against minimum threshold.
   * Prevents relaying if BNB balance is insufficient to pay for gas.
   */
  public async checkGasHealth(minThresholdBnb?: number): Promise<{
    healthy: boolean;
    balanceWei: bigint;
    balanceBnb: string;
    minThresholdBnb: string;
  }> {
    await this.ensureInitialized();
    const thresholdBnb = minThresholdBnb ?? this.config.minGasBalanceBnb ?? 0.005;
    const minThresholdWei = parseEther(thresholdBnb.toString());

    if (this.config.mockMode) {
      return {
        healthy: true,
        balanceWei: parseEther("10"),
        balanceBnb: "10.0",
        minThresholdBnb: thresholdBnb.toString(),
      };
    }

    const balanceWei = await this.publicClient.getBalance({ address: this.account.address });
    const balanceBnb = formatEther(balanceWei);
    const healthy = balanceWei >= minThresholdWei;

    return {
      healthy,
      balanceWei,
      balanceBnb,
      minThresholdBnb: thresholdBnb.toString(),
    };
  }

  /**
   * Security Guard: Asserts that destination contract is an authorized Commons contract.
   */
  public assertDestinationAllowed(targetAddress: `0x${string}`): void {
    const target = targetAddress.toLowerCase();
    const parliament = this.config.parliamentAddress.toLowerCase();
    const mesh = this.config.meshAddress.toLowerCase();
    const registrar = this.config.registrarAddress.toLowerCase();

    if (target !== parliament && target !== mesh && target !== registrar) {
      throw new Error(
        `[SECURITY POLICY VIOLATION] Destination address ${targetAddress} is not in the authorized contract whitelist.`
      );
    }
  }

  /**
   * Executes a contract write call with serialized nonce lock, gas pre-check, and resync on error.
   * Holding the nonce lock across broadcast prevents concurrent callers from creating nonce gaps.
   */
  public async writeContractGuarded(params: {
    address: `0x${string}`;
    abi: any;
    functionName: string;
    args: any[];
    value?: bigint;
  }): Promise<`0x${string}`> {
    this.assertDestinationAllowed(params.address);

    const gasHealth = await this.checkGasHealth();
    if (!gasHealth.healthy) {
      throw new Error(
        `[CIRCUIT BREAKER] Relayer hot wallet gas critically low: ${gasHealth.balanceBnb} BNB < ${gasHealth.minThresholdBnb} BNB threshold. Transaction rejected to prevent dropped batches.`
      );
    }

    return await this.runWithNonceLock(async () => {
      if (this.currentNonce === null) {
        await this.resyncNonce();
      }
      const nonce = this.currentNonce!;
      this.currentNonce = nonce + 1n;

      try {
        const hash = await this.walletClient.writeContract({
          address: params.address,
          abi: params.abi,
          functionName: params.functionName,
          args: params.args,
          value: params.value,
          nonce: Number(nonce),
          account: this.account,
          chain: this.chain,
        } as any);

        return hash;
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        if (this.config.mockMode) {
          this.rollbackNonce(nonce);
        } else {
          console.warn(
            `[HotWalletManager] Broadcast error on nonce ${nonce} (${errMsg}). Resyncing from chain...`
          );
          await this.resyncNonce();
        }
        throw err;
      }
    });
  }

  /**
   * Executes a native BNB gas/reward transfer with serialized nonce lock, gas health check, and error recovery.
   */
  public async sendNativeTransferGuarded(params: {
    to: `0x${string}`;
    valueWei: bigint;
  }): Promise<`0x${string}`> {
    if (!params.to || params.to === "0x0000000000000000000000000000000000000000") {
      throw new Error("[SECURITY POLICY VIOLATION] Destination address cannot be empty or zero address.");
    }

    if (params.valueWei <= 0n) {
      throw new Error("Transfer value must be greater than zero.");
    }

    if (this.config.mockMode) {
      const mockHash = `0x${Buffer.from(`native-transfer-${Date.now()}`).toString("hex").padEnd(64, "0").slice(0, 64)}` as `0x${string}`;
      return mockHash;
    }

    const gasHealth = await this.checkGasHealth();
    if (!gasHealth.healthy) {
      throw new Error(
        `[CIRCUIT BREAKER] Relayer hot wallet gas critically low: ${gasHealth.balanceBnb} BNB < ${gasHealth.minThresholdBnb} BNB threshold. Payout transfer rejected.`
      );
    }

    return await this.runWithNonceLock(async () => {
      if (this.currentNonce === null) {
        await this.resyncNonce();
      }
      const nonce = this.currentNonce!;
      this.currentNonce = nonce + 1n;

      try {
        const hash = await this.walletClient.sendTransaction({
          to: params.to,
          value: params.valueWei,
          nonce: Number(nonce),
          account: this.account,
          chain: this.chain,
        } as any);

        return hash;
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        console.warn(
          `[HotWalletManager] Native transfer error on nonce ${nonce} (${errMsg}). Resyncing from chain...`
        );
        await this.resyncNonce();
        throw err;
      }
    });
  }

  /**
   * Returns current hot wallet diagnostics and gas health for observability.
   */
  public async getStatus(): Promise<HotWalletStatus> {
    await this.ensureInitialized();
    const address = this.getAddress();
    const gasCheck = await this.checkGasHealth();

    return {
      address,
      chainId: this.chain.id,
      balanceWei: gasCheck.balanceWei,
      balanceBnb: gasCheck.balanceBnb,
      currentNonce: this.currentNonce ?? 0n,
      isGasHealthy: gasCheck.healthy,
      minThresholdBnb: gasCheck.minThresholdBnb,
      keystoreSource: this.keystoreSource,
    };
  }
}
