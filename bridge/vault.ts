import {
  accountSchema,
  activeAccount,
  bundleSchema,
  emptyVault,
  hasGrant,
  refreshAccount,
  validateIdentity,
  vaultSchema,
  type Account,
  type Vault,
} from "./auth.js";
import { seal, unseal, type Envelope } from "./crypto.js";
export interface EncryptedStorage {
  get(): Promise<Envelope | undefined>;
  put(value: Envelope): Promise<void>;
}
/** One owner/DO. Promise queue prevents requests racing rotating refresh tokens. */
export class SessionVault {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private storage: EncryptedStorage,
    private key: CryptoKey,
    private bootstrap?: string,
    private renew: (account: Account) => Promise<Account> = refreshAccount,
    private verify: (
      token: string,
      clientId: string,
      nonce?: string,
      subject?: string,
    ) => Promise<unknown> = validateIdentity,
  ) {}
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const work = this.queue.then(action, action);
    this.queue = work.catch(() => {});
    return work;
  }
  private async save(vault: Vault) {
    await this.storage.put(await seal(vaultSchema.parse(vault), this.key));
  }
  private async read(): Promise<Vault> {
    const saved = await this.storage.get();
    const vault = saved
      ? vaultSchema.parse(await unseal(saved, this.key))
      : emptyVault();
    // A crash/timeout after sending a refresh can leave its outcome unknown. Do not reuse the old rotating token.
    if (vault.refreshing_client_id) {
      const account = vault.accounts.find(
        (a) => a.client_id === vault.refreshing_client_id,
      );
      if (account) {
        account.reconnect_required = true;
        delete account.tokens;
      }
      delete vault.refreshing_client_id;
      await this.save(vault);
    }
    if (!saved) await this.save(vault); // Host identity is durable before any credential import.
    if (this.bootstrap) {
      const bundle = bundleSchema.parse(
        await unseal(JSON.parse(this.bootstrap) as Envelope, this.key),
      );
      if (!vault.imported_bundles.includes(bundle.bundle_id)) {
        if (
          Math.abs(Date.now() - bundle.created_at) > 30 * 60_000 ||
          !hasGrant(bundle.account)
        )
          throw new Error("BOOTSTRAP_EXPIRED");
        await this.verify(
          bundle.account.tokens.id_token,
          bundle.account.client_id,
          undefined,
          bundle.account.subject,
        );
        const previous = vault.accounts.find(
          (a) => a.client_id === bundle.account.client_id,
        );
        if (previous && previous.subject !== bundle.account.subject)
          throw new Error("IDENTITY_MISMATCH");
        vault.accounts = vault.accounts.filter(
          (a) => a.client_id !== bundle.account.client_id,
        );
        vault.accounts.push(accountSchema.parse(bundle.account));
        vault.active_client_id = bundle.account.client_id;
        vault.imported_bundles.push(bundle.bundle_id); // Never replay an old secret after sign-out or rotation.
        await this.save(vault); // Deliberately retain runtime host_id; bundle has no host field.
      }
    }
    return vault;
  }
  async accessToken(): Promise<string> {
    return this.serial(async () => {
      const vault = await this.read();
      let account = activeAccount(vault);
      if (!hasGrant(account)) throw new Error("RECONNECT_REQUIRED");
      if (account.tokens.expires_at <= Date.now() + 60_000) {
        vault.refreshing_client_id = account.client_id;
        await this.save(vault);
        try {
          account = await this.renew(account);
          if (!hasGrant(account)) throw new Error("RECONNECT_REQUIRED");
          vault.accounts = vault.accounts.map((a) =>
            a.client_id === account!.client_id ? account! : a,
          );
          delete vault.refreshing_client_id;
          await this.save(vault);
        } catch {
          const current = activeAccount(vault);
          if (current) {
            current.reconnect_required = true;
            delete current.tokens;
          }
          delete vault.refreshing_client_id;
          await this.save(vault);
          throw new Error("RECONNECT_REQUIRED");
        }
      }
      if (!hasGrant(account)) throw new Error("RECONNECT_REQUIRED");
      return account.tokens.access_token;
    });
  }
  async disconnected(): Promise<void> {
    return this.serial(async () => {
      const vault = await this.read();
      const account = activeAccount(vault);
      if (account) {
        account.reconnect_required = true;
        delete account.tokens;
      }
      await this.save(vault);
    });
  }
}
