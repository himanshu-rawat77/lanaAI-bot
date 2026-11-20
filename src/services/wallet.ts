import crypto from "crypto";
import bs58 from "bs58";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { config } from "../config";
import { userDb, UserRecord, WalletItem } from "./db";

export class WalletService {
  private encryptionKey: Buffer;

  constructor() {
    this.encryptionKey = crypto
      .createHash("sha256")
      .update(config.WALLET_ENCRYPTION_KEY)
      .digest();
  }

  public encrypt(data: Uint8Array): { encrypted: string; iv: string; authTag: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      encrypted: encrypted.toString("hex"),
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex")
    };
  }

  public decrypt(encryptedHex: string, ivHex: string, authTagHex: string): Uint8Array {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.encryptionKey,
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final()
    ]);
    return new Uint8Array(decrypted);
  }

  public async getOrCreateWallet(
    telegramId: number,
    username?: string
  ): Promise<{ record: UserRecord; isNew: boolean }> {
    let existing = userDb.getUser(telegramId);
    if (existing) {
      if (username && existing.username !== username) {
        existing.username = username;
        userDb.saveUser(existing);
      }
      return { record: existing, isNew: false };
    }

    const ownerSeed = crypto.randomBytes(32);
    const signer = await createKeyPairSignerFromPrivateKeyBytes(ownerSeed);
    const publicKey = signer.address;

    const { encrypted, iv, authTag } = this.encrypt(ownerSeed);

    const defaultWallet: WalletItem = {
      id: "wallet_default",
      label: "Default Bot Wallet",
      publicKey,
      encryptedPrivateKey: encrypted,
      iv,
      authTag,
      createdAt: new Date().toISOString(),
      registeredOnChain: false
    };

    const record: UserRecord = {
      telegramId,
      username,
      publicKey,
      encryptedPrivateKey: encrypted,
      iv,
      authTag,
      createdAt: new Date().toISOString(),
      registeredOnChain: false,
      wallets: [defaultWallet],
      activeWalletId: defaultWallet.id
    };

    userDb.saveUser(record);
    return { record, isNew: true };
  }

  /**
   * Parse a private key provided as Base58, Hex, or JSON array [1,2,...]
   * into a 32-byte Ed25519 seed.
   */
  public parsePrivateKeyInput(input: string): Uint8Array {
    const clean = input.trim();

    // 1. Check if JSON byte array (e.g. [12, 34, ...])
    if (clean.startsWith("[") && clean.endsWith("]")) {
      try {
        const arr = JSON.parse(clean);
        if (Array.isArray(arr) && (arr.length === 64 || arr.length === 32)) {
          const u8 = new Uint8Array(arr);
          return arr.length === 64 ? u8.slice(0, 32) : u8;
        }
      } catch {}
    }

    // 2. Check Base58
    try {
      const decoded = bs58.decode(clean);
      if (decoded.length === 64) {
        return decoded.slice(0, 32);
      }
      if (decoded.length === 32) {
        return decoded;
      }
    } catch {}

    // 3. Check Hex
    if (/^[0-9a-fA-F]+$/.test(clean)) {
      const buf = Buffer.from(clean, "hex");
      if (buf.length === 64) {
        return new Uint8Array(buf.subarray(0, 32));
      }
      if (buf.length === 32) {
        return new Uint8Array(buf);
      }
    }

    throw new Error(
      "Invalid private key format. Please provide a valid Base58 private key from Phantom (or 64-byte keypair array)."
    );
  }

  /**
   * Import an external wallet (Phantom, Solflare, etc.) using its private key.
   * Derives public key and shielded keys, encrypts at rest, and sets it as active.
   */
  public async importWallet(
    telegramId: number,
    privateKeyInput: string,
    label?: string,
    username?: string
  ): Promise<{ record: UserRecord; wallet: WalletItem; isNew: boolean }> {
    const { record } = await this.getOrCreateWallet(telegramId, username);
    const seed = this.parsePrivateKeyInput(privateKeyInput);

    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const publicKey = signer.address;

    // Check if user already has this wallet in their list
    const wallets = record.wallets || [];
    const existingWallet = wallets.find((w) => w.publicKey === publicKey);

    if (existingWallet) {
      if (label) {
        existingWallet.label = label;
      }
      // Set as active
      record.activeWalletId = existingWallet.id;
      this.syncActiveWalletProperties(record, existingWallet);
      userDb.saveUser(record);
      return { record, wallet: existingWallet, isNew: false };
    }

    const { encrypted, iv, authTag } = this.encrypt(seed);
    const walletId = `wallet_${Date.now()}`;
    const defaultLabel = label || `Phantom (${publicKey.slice(0, 4)}...${publicKey.slice(-4)})`;

    const newWallet: WalletItem = {
      id: walletId,
      label: defaultLabel,
      publicKey,
      encryptedPrivateKey: encrypted,
      iv,
      authTag,
      createdAt: new Date().toISOString(),
      registeredOnChain: false
    };

    wallets.push(newWallet);
    record.wallets = wallets;
    record.activeWalletId = walletId;
    this.syncActiveWalletProperties(record, newWallet);

    userDb.saveUser(record);
    return { record, wallet: newWallet, isNew: true };
  }

  /**
   * Switch the active wallet by ID, public key, or 1-based index (e.g. "1", "2").
   */
  public switchActiveWallet(
    telegramId: number,
    target: string
  ): { record: UserRecord; activeWallet: WalletItem } {
    const record = userDb.getUser(telegramId);
    if (!record) {
      throw new Error("User record not found");
    }

    const wallets = record.wallets || [];
    if (wallets.length === 0) {
      throw new Error("No wallets found for user");
    }

    let targetWallet: WalletItem | undefined;

    // Check 1-based index (e.g. "1", "2")
    const index = parseInt(target, 10);
    if (!isNaN(index) && index >= 1 && index <= wallets.length) {
      targetWallet = wallets[index - 1];
    } else {
      // Check ID or Public Key
      targetWallet = wallets.find(
        (w) => w.id === target || w.publicKey.toLowerCase() === target.toLowerCase()
      );
    }

    if (!targetWallet) {
      throw new Error(`Wallet '${target}' not found. You have ${wallets.length} wallet(s).`);
    }

    record.activeWalletId = targetWallet.id;
    this.syncActiveWalletProperties(record, targetWallet);
    userDb.saveUser(record);

    return { record, activeWallet: targetWallet };
  }

  private syncActiveWalletProperties(record: UserRecord, activeWallet: WalletItem): void {
    record.publicKey = activeWallet.publicKey;
    record.encryptedPrivateKey = activeWallet.encryptedPrivateKey;
    record.iv = activeWallet.iv;
    record.authTag = activeWallet.authTag;
    record.registeredOnChain = activeWallet.registeredOnChain;
  }

  public getWallets(telegramId: number): WalletItem[] {
    const record = userDb.getUser(telegramId);
    return record?.wallets || [];
  }

  public getActiveWallet(telegramId: number): WalletItem | null {
    const record = userDb.getUser(telegramId);
    if (!record) return null;
    const wallets = record.wallets || [];
    return wallets.find((w) => w.id === record.activeWalletId) || wallets[0] || null;
  }

  public getActiveLabel(record: UserRecord): string {
    const active = record.wallets?.find((w) => w.id === record.activeWalletId);
    return active ? active.label : "Default Bot Wallet";
  }

  public getOwnerSeed(record: UserRecord): Uint8Array {
    return this.decrypt(record.encryptedPrivateKey, record.iv, record.authTag);
  }

  public exportSeedHex(record: UserRecord): string {
    const seed = this.getOwnerSeed(record);
    return Buffer.from(seed).toString("hex");
  }

  public exportSeedBase58(record: UserRecord): string {
    const seed = this.getOwnerSeed(record);
    return bs58.encode(seed);
  }

  public getAddress(telegramId: number): string | null {
    const record = userDb.getUser(telegramId);
    return record ? record.publicKey : null;
  }

  public getAddressByUsername(username: string): string | null {
    const record = userDb.getUserByUsername(username);
    return record ? record.publicKey : null;
  }
}

export const walletService = new WalletService();
