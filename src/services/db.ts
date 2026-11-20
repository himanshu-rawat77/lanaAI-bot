import fs from "fs";
import path from "path";
import { config } from "../config";

export interface WalletItem {
  id: string;
  label: string;
  publicKey: string;
  encryptedPrivateKey: string;
  iv: string;
  authTag: string;
  createdAt: string;
  registeredOnChain?: boolean;
}

export interface UserRecord {
  telegramId: number;
  username?: string;
  publicKey: string;
  encryptedPrivateKey: string;
  iv: string;
  authTag: string;
  createdAt: string;
  registeredOnChain?: boolean;
  wallets?: WalletItem[];
  activeWalletId?: string;
}

interface DatabaseSchema {
  users: Record<string, UserRecord>;
}

export class UserDatabase {
  private filePath: string;
  private users: Map<string, UserRecord> = new Map();
  private usernameIndex: Map<string, string> = new Map(); // lowercase username -> telegramId

  constructor(filePath?: string) {
    const dir = filePath ? path.dirname(filePath) : path.resolve(process.cwd(), config.DATA_DIR);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.filePath = filePath || path.join(dir, "users.json");
    this.load();
  }

  private ensureWalletsMigrated(user: UserRecord): UserRecord {
    if (!user.wallets || user.wallets.length === 0) {
      user.wallets = [
        {
          id: "wallet_default",
          label: "Default Bot Wallet",
          publicKey: user.publicKey,
          encryptedPrivateKey: user.encryptedPrivateKey,
          iv: user.iv,
          authTag: user.authTag,
          createdAt: user.createdAt,
          registeredOnChain: user.registeredOnChain
        }
      ];
      user.activeWalletId = "wallet_default";
    } else if (!user.activeWalletId) {
      user.activeWalletId = user.wallets[0].id;
    }
    return user;
  }

  private load(): void {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const data = JSON.parse(raw) as DatabaseSchema;
        if (data && data.users) {
          for (const [id, user] of Object.entries(data.users)) {
            const migrated = this.ensureWalletsMigrated(user);
            this.users.set(id, migrated);
            if (migrated.username) {
              this.usernameIndex.set(migrated.username.toLowerCase(), id);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load user database from", this.filePath, err);
      }
    }
  }

  private persist(): void {
    try {
      const data: DatabaseSchema = {
        users: Object.fromEntries(this.users.entries())
      };
      const tmpPath = `${this.filePath}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error("Failed to persist user database", err);
    }
  }

  public getUser(telegramId: number): UserRecord | null {
    const user = this.users.get(telegramId.toString());
    return user ? this.ensureWalletsMigrated(user) : null;
  }

  public getUserByUsername(username: string): UserRecord | null {
    const clean = username.replace(/^@/, "").toLowerCase().trim();
    const id = this.usernameIndex.get(clean);
    if (!id) return null;
    const user = this.users.get(id);
    return user ? this.ensureWalletsMigrated(user) : null;
  }

  public getUserByPublicKey(publicKey: string): UserRecord | null {
    for (const user of this.users.values()) {
      if (user.publicKey === publicKey) {
        return this.ensureWalletsMigrated(user);
      }
      if (user.wallets?.some((w) => w.publicKey === publicKey)) {
        return this.ensureWalletsMigrated(user);
      }
    }
    return null;
  }

  public saveUser(user: UserRecord): void {
    const migrated = this.ensureWalletsMigrated(user);
    const idStr = migrated.telegramId.toString();
    this.users.set(idStr, migrated);
    if (migrated.username) {
      this.usernameIndex.set(migrated.username.toLowerCase(), idStr);
    }
    this.persist();
  }

  public getAllUsers(): UserRecord[] {
    return Array.from(this.users.values()).map((u) => this.ensureWalletsMigrated(u));
  }
}

export const userDb = new UserDatabase();
