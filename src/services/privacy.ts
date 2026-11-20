import {
  createKeyPairSignerFromPrivateKeyBytes,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  signTransactionWithSigners,
  type Address,
  type KeyPairSigner,
  type Transaction
} from "@solana/kit";
import {
  LocalKeys,
  ShieldedKeypair,
  SigningKey,
  SOL_MINT,
  Wallet,
  buildDepositTransaction,
  buildTransferTransaction,
  buildWithdrawalTransaction,
  buildRegistrationTransaction,
  createSprClient,
  syncWallet,
  type Bytes32
} from "@heliuslabs/spr";
import { SignedTeePolicy } from "@heliuslabs/spr/client";
import { isWalletRegistered } from "@heliuslabs/spr/wallet";
import bs58 from "bs58";
import { config } from "../config";

export type SprClientInstance = Awaited<ReturnType<typeof createSprClient>>;

export interface PrivacyBalanceResult {
  privateBalanceSol: number;
  publicBalanceSol: number;
  privateLamports: bigint;
  shieldedAddress: string;
}

export interface RegistrationResult {
  isRegistered: boolean;
  alreadyRegistered: boolean;
  publicKey: string;
  shieldedAddress: string;
  nullifierPublicKey: string;
  viewingPublicKey: string;
  signature?: string;
  slot?: bigint;
}

export class PrivacyRingsService {
  private sprClientPromise: Promise<SprClientInstance> | null = null;

  constructor() {}

  private async getSprClient(): Promise<SprClientInstance> {
    if (!this.sprClientPromise) {
      const network = config.LANA_NETWORK === "devnet" ? "devnet" : "mainnet";
      this.sprClientPromise = createSprClient({
        solanaRpcUrl: config.getRpcUrl(),
        proverTee: SignedTeePolicy.forNetwork(network),
        commitment: "confirmed"
      }).catch((err) => {
        this.sprClientPromise = null;
        throw err;
      });
    }
    return this.sprClientPromise;
  }

  /**
   * Direct JSON-RPC call to Helius Solana Privacy Rings API (/v1/spr/{method}).
   * Matches the official specification at https://www.helius.dev/docs/privacy
   */
  public async callSprApi<T = any>(
    method: string,
    params: Record<string, any>
  ): Promise<T | null> {
    if (!config.hasValidHeliusKey()) {
      return null;
    }
    try {
      const network = config.LANA_NETWORK === "devnet" ? "devnet" : "mainnet";
      const url = `https://${network}.helius-rpc.com/v1/spr/${method}?api-key=${config.HELIUS_API_KEY.trim()}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method,
          params
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`Helius SPR API ${method} HTTP ${response.status}:`, errText);
        return null;
      }

      const data = (await response.json()) as { result?: T; error?: any };
      if (data.error) {
        console.warn(`Helius SPR API ${method} returned error:`, data.error);
        return null;
      }

      return data.result ?? null;
    } catch (err: any) {
      console.warn(`Failed to execute SPR API call ${method}:`, err?.message || String(err));
      return null;
    }
  }

  /**
   * Lookup public user records (shielded registration) from the Privacy Rings registry.
   */
  public async getUserRecords(owners: string[]): Promise<any> {
    return this.callSprApi("getUserRecords", { owners });
  }

  /**
   * Query shielded events for a specific Solana transaction signature.
   */
  public async getShieldedTransactionEvents(signature: string): Promise<any> {
    return this.callSprApi("getShieldedTransactionsBySignature", { signature });
  }

  /**
   * Helper to set up signers, shielded keypair, and wallet instance from 32-byte owner seed.
   */
  private async getSprWalletContext(ownerSeed: Uint8Array) {
    const client = await this.getSprClient();
    const seedCopy = new Uint8Array(ownerSeed);
    const feePayer = await createKeyPairSignerFromPrivateKeyBytes(seedCopy);
    const signingKey = SigningKey.fromEd25519Bytes(seedCopy as unknown as Bytes32);
    const keypair = ShieldedKeypair.fromKeypair(signingKey);
    const wallet = new Wallet({ identity: keypair.shieldedAddress() });
    const keys = LocalKeys.fromKeypair(keypair, client.proofService);

    return { client, feePayer, keypair, wallet, keys };
  }

  /**
   * Sign and submit transaction via SPR / @solana/kit.
   */
  private async submitSprTransaction(
    client: SprClientInstance,
    transaction: Transaction,
    signer: KeyPairSigner
  ): Promise<string> {
    const sendAndConfirm = sendAndConfirmTransactionFactory({
      rpc: client.solanaRpc,
      rpcSubscriptions: client.solanaRpcSubscriptions
    });
    const signed = await signTransactionWithSigners([signer], transaction);
    await (sendAndConfirm as (tx: any, opts: any) => Promise<void>)(signed, {
      commitment: "confirmed"
    });
    return getSignatureFromTransaction(signed);
  }

  /**
   * Fetch public SOL balance using standard Solana JSON-RPC with automatic fallback.
   */
  public async getPublicBalance(publicKeyBase58: string): Promise<number> {
    const urlsToTry = [
      config.getRpcUrl(),
      config.LANA_NETWORK === "devnet"
        ? "https://api.devnet.solana.com"
        : "https://api.mainnet-beta.solana.com"
    ];

    for (const url of urlsToTry) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getBalance",
            params: [publicKeyBase58]
          })
        });

        if (!response.ok) {
          continue;
        }

        const data = (await response.json()) as { result?: { value?: number } };
        const lamports = data?.result?.value ?? 0;
        return lamports / 1_000_000_000;
      } catch {
        continue;
      }
    }
    return 0;
  }

  /**
   * Ensure user's shielded address is registered on-chain in the SPR user registry.
   */
  public async ensureRegistered(ownerSeed: Uint8Array): Promise<boolean> {
    try {
      const { client, feePayer, keypair } = await this.getSprWalletContext(ownerSeed);
      const registration = await buildRegistrationTransaction({
        client,
        owner: feePayer.address,
        address: keypair.shieldedAddress()
      });

      if (registration !== undefined) {
        await this.submitSprTransaction(client, registration, feePayer);
      }
      return true;
    } catch (err: any) {
      console.warn("Shielded registration check / submit notice:", err?.message || String(err));
      return false;
    }
  }

  /**
   * Get full details about wallet registration status in Solana Privacy Rings.
   */
  public async getRegistrationStatus(ownerSeed: Uint8Array): Promise<RegistrationResult> {
    const { feePayer, keypair } = await this.getSprWalletContext(ownerSeed);
    const shielded = keypair.shieldedAddress();
    const shieldedBase58 = bs58.encode(shielded.toBytes());
    const nullifierHex = Buffer.from(shielded.nullifierPublicKey).toString("hex");
    const viewingHex = Buffer.from(shielded.viewingPublicKey.toBytes()).toString("hex");

    const isRegistered = await this.isAddressRegistered(feePayer.address);
    return {
      isRegistered,
      alreadyRegistered: isRegistered,
      publicKey: feePayer.address,
      shieldedAddress: shieldedBase58,
      nullifierPublicKey: nullifierHex,
      viewingPublicKey: viewingHex
    };
  }

  /**
   * Advanced wallet registration in Solana Privacy Rings on-chain registry.
   * Maps user's Solana address to ShieldedAddress (Nullifier + Viewing keys)
   * and configures MergeEncryptionScheme.PoseidonCtrV1.
   */
  public async registerWallet(ownerSeed: Uint8Array): Promise<RegistrationResult> {
    const { client, feePayer, keypair } = await this.getSprWalletContext(ownerSeed);
    const shielded = keypair.shieldedAddress();
    const shieldedBase58 = bs58.encode(shielded.toBytes());
    const nullifierHex = Buffer.from(shielded.nullifierPublicKey).toString("hex");
    const viewingHex = Buffer.from(shielded.viewingPublicKey.toBytes()).toString("hex");

    const isRegistered = await this.isAddressRegistered(feePayer.address);
    if (isRegistered) {
      return {
        isRegistered: true,
        alreadyRegistered: true,
        publicKey: feePayer.address,
        shieldedAddress: shieldedBase58,
        nullifierPublicKey: nullifierHex,
        viewingPublicKey: viewingHex
      };
    }

    const registration = await buildRegistrationTransaction({
      client,
      owner: feePayer.address,
      address: shielded
    });

    if (registration === undefined) {
      return {
        isRegistered: true,
        alreadyRegistered: true,
        publicKey: feePayer.address,
        shieldedAddress: shieldedBase58,
        nullifierPublicKey: nullifierHex,
        viewingPublicKey: viewingHex
      };
    }

    const signature = await this.submitSprTransaction(client, registration, feePayer);
    const slot = await client.confirmTransaction(signature as any);

    return {
      isRegistered: true,
      alreadyRegistered: false,
      publicKey: feePayer.address,
      shieldedAddress: shieldedBase58,
      nullifierPublicKey: nullifierHex,
      viewingPublicKey: viewingHex,
      signature,
      slot
    };
  }

  /**
   * Sync wallet and fetch both private shielded balance and public SOL balance.
   */
  public async getBalances(
    ownerSeed: Uint8Array,
    publicKeyBase58: string
  ): Promise<PrivacyBalanceResult> {
    const publicBalanceSol = await this.getPublicBalance(publicKeyBase58);
    let privateLamports = 0n;
    let shieldedAddress = "";

    try {
      const { client, wallet, keys, keypair } = await this.getSprWalletContext(ownerSeed);
      const rawShielded = keypair.shieldedAddress();
      shieldedAddress = bs58.encode(rawShielded.toBytes());

      if (config.hasValidHeliusKey()) {
        await syncWallet({ client, wallet, keys });
        const solBalance = wallet.balance(SOL_MINT);
        privateLamports = solBalance?.amount ?? 0n;
      } else {
        console.warn(
          "[Privacy Rings] HELIUS_API_KEY is not set in .env. Private balance sync requires an API key from https://dashboard.helius.dev/."
        );
      }
    } catch (err: any) {
      console.warn("Notice: Private balance sync skipped:", err?.message || String(err));
    }

    const privateBalanceSol = Number(privateLamports) / 1_000_000_000;
    return {
      privateBalanceSol,
      publicBalanceSol,
      privateLamports,
      shieldedAddress
    };
  }

  /**
   * Deposit SOL from public balance into Privacy Ring shielded balance.
   */
  public async deposit(
    ownerSeed: Uint8Array,
    amountSol: number
  ): Promise<{ signature: string; slot: bigint }> {
    const { client, feePayer, keypair, wallet, keys } = await this.getSprWalletContext(ownerSeed);
    const amountLamports = BigInt(Math.round(amountSol * 1_000_000_000));

    // Register shielded address if needed
    await this.ensureRegistered(ownerSeed);

    const depositTx = await buildDepositTransaction({
      client,
      feePayer: feePayer.address,
      recipient: keypair.shieldedAddress(),
      amount: amountLamports
    });

    const signature = await this.submitSprTransaction(client, depositTx, feePayer);
    const slot = await client.confirmTransaction(signature as any);

    await syncWallet({
      client,
      wallet,
      keys,
      config: { requireSlot: slot }
    });

    return { signature, slot };
  }

  /**
   * Check whether an address is registered in the Privacy Rings user registry.
   */
  public async isAddressRegistered(ownerAddress: string): Promise<boolean> {
    try {
      // 1. Direct on-chain registry verification via SPR SDK
      const client = await this.getSprClient();
      const isReg = await isWalletRegistered({ rpc: client, owner: ownerAddress as Address });
      if (isReg) {
        return true;
      }
    } catch (rpcErr) {
      // Fallback to indexer API if RPC check throws
    }

    try {
      // 2. Fallback check via Helius Privacy Indexer API
      const res = await this.getUserRecords([ownerAddress]);
      if (Array.isArray(res) && res.length > 0) {
        return true;
      }
      if (res && Array.isArray(res.records) && res.records.length > 0) {
        return true;
      }
      if (res && Array.isArray(res.data) && res.data.length > 0) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Send private SOL to another address.
   * If recipient is registered in the Privacy Ring, builds a confidential private transfer.
   * If recipient is a standard public Solana address, routes via private-to-public withdrawal.
   */
  public async sendPrivate(
    ownerSeed: Uint8Array,
    recipientSolanaAddress: string,
    amountSol: number
  ): Promise<{ signature: string; slot: bigint; transferType: "private" | "withdrawal" }> {
    const { client, feePayer, wallet, keys } = await this.getSprWalletContext(ownerSeed);
    const amountLamports = BigInt(Math.round(amountSol * 1_000_000_000));

    await syncWallet({ client, wallet, keys });

    try {
      const transferTx = await buildTransferTransaction({
        client,
        wallet,
        keys,
        feePayer: feePayer.address,
        recipient: recipientSolanaAddress as Address,
        amount: amountLamports
      });

      const signature = await this.submitSprTransaction(client, transferTx, feePayer);
      const slot = await client.confirmTransaction(signature as any);

      await syncWallet({
        client,
        wallet,
        keys,
        config: { requireSlot: slot }
      });

      return { signature, slot, transferType: "private" };
    } catch (err: any) {
      // Recipient is a public Solana address not registered in the Privacy Ring registry.
      // Automatically route as a private-to-public withdrawal directly to their public address:
      const isUnregistered =
        err?.code === "WALLET_BUILD_TRANSFER" ||
        err?.causeCode === "WALLET_RECIPIENT_NOT_REGISTERED" ||
        err?.causeCodes?.includes("WALLET_RECIPIENT_NOT_REGISTERED") ||
        String(err?.message || "").includes("WALLET_RECIPIENT_NOT_REGISTERED");

      if (isUnregistered) {
        const withdrawRes = await this.withdraw(ownerSeed, recipientSolanaAddress, amountSol);
        return { ...withdrawRes, transferType: "withdrawal" };
      }
      throw err;
    }
  }

  /**
   * Withdraw funds from Privacy Ring back to a public Solana address.
   */
  public async withdraw(
    ownerSeed: Uint8Array,
    recipientPublicAddress: string,
    amountSol: number
  ): Promise<{ signature: string; slot: bigint }> {
    const { client, feePayer, wallet, keys } = await this.getSprWalletContext(ownerSeed);
    const amountLamports = BigInt(Math.round(amountSol * 1_000_000_000));

    await syncWallet({ client, wallet, keys });

    const withdrawalTx = await buildWithdrawalTransaction({
      client,
      wallet,
      keys,
      feePayer: feePayer.address,
      recipient: recipientPublicAddress as Address,
      amount: amountLamports
    });

    const signature = await this.submitSprTransaction(client, withdrawalTx, feePayer);
    const slot = await client.confirmTransaction(signature as any);

    await syncWallet({
      client,
      wallet,
      keys,
      config: { requireSlot: slot }
    });

    return { signature, slot };
  }

  /**
   * Generate Solana Explorer URL for given transaction signature.
   */
  public getExplorerUrl(signature: string): string {
    const cluster = config.LANA_NETWORK === "devnet" ? "?cluster=devnet" : "";
    return `https://explorer.solana.com/tx/${signature}${cluster}`;
  }
}

export const privacyService = new PrivacyRingsService();
