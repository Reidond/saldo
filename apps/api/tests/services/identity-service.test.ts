import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  AccessDeniedError,
  SessionEndedError,
} from "../../src/services/errors";
import {
  IdentityService,
  type IdentityConfig,
  type Principal,
} from "../../src/services/identity-service";
import type { AccessTokenClaims } from "../../src/services/ports";
import {
  FakeDatabase,
  fakeRepositories,
  fakeVerifier,
  fixedClock,
  sequentialIds,
} from "../support/fakes";

const config: IdentityConfig = {
  teamDomain: "example.cloudflareaccess.com",
  audience: "saldo-test-audience",
  ownerSubject: "owner-subject",
};
const issuer = "https://example.cloudflareaccess.com";
const ownerKey = `cloudflare_access\u0000${issuer}\u0000owner-subject`;

let db: FakeDatabase;
let clock: ReturnType<typeof fixedClock>;

function service(
  overrides: {
    config?: IdentityConfig;
    claims?: Partial<AccessTokenClaims>;
  } = {},
) {
  const verifier = fakeVerifier(overrides.claims);
  return {
    verifier,
    identity: new IdentityService({
      db: db.d1,
      repos: fakeRepositories(db),
      verifier,
      clock,
      ids: sequentialIds(),
      config: overrides.config ?? config,
    }),
  };
}

const principal = (overrides: Partial<Principal> = {}): Principal => ({
  issuer,
  subject: "owner-subject",
  issuedAt: 1_800_000_000,
  email: "owner@example.test",
  name: null,
  ...overrides,
});

beforeEach(() => {
  db = new FakeDatabase();
  clock = fixedClock();
});

describe("authenticate", () => {
  it("accepts only the configured owner subject", async () => {
    const { identity } = service({ claims: { email: " owner@example.test " } });
    expect(await identity.authenticate("token:owner-subject")).toEqual({
      issuer,
      subject: "owner-subject",
      issuedAt: 1_800_000_000,
      email: "owner@example.test",
      name: null,
    });
    expect(await identity.authenticate("token:someone-else")).toBeNull();
    expect(await identity.authenticate("forged")).toBeNull();
    expect(await identity.authenticate(null)).toBeNull();
  });

  it("fails closed without complete configuration and never calls the verifier", async () => {
    for (const broken of [
      { ...config, teamDomain: undefined },
      { ...config, audience: "" },
      { ...config, ownerSubject: undefined },
      { ...config, teamDomain: "attacker.example.com" },
      { ...config, teamDomain: "https://example.cloudflareaccess.com" },
    ]) {
      const { identity, verifier } = service({ config: broken });
      expect(await identity.authenticate("token:owner-subject")).toBeNull();
      expect(verifier.calls).toBe(0);
    }
  });

  it("keeps only usable display claims", async () => {
    const { identity } = service({
      claims: { email: 42, name: "x".repeat(161) },
    });
    expect(await identity.authenticate("token:owner-subject")).toMatchObject({
      email: null,
      name: null,
    });
  });
});

describe("resolveActor", () => {
  it("provisions the owner on the first request under the Access subject's account", async () => {
    const { identity } = service();
    const actor = await identity.resolveActor(principal());
    expect(actor).toEqual({
      userId: "id-1",
      accountId: "owner-subject",
      role: "owner",
      email: "owner@example.test",
      displayName: null,
    });
    expect(db.state.accounts).toEqual(new Set(["owner-subject"]));
    expect(db.state.users.get("id-1")).toMatchObject({
      accountId: "owner-subject",
      role: "owner",
      status: "active",
    });
    expect(db.state.identities.get(ownerKey)).toEqual({
      userId: "id-1",
      lastSeenAt: "2026-10-08 12:00:00",
    });
    expect(db.state.auditEvents).toEqual([
      {
        id: "id-2",
        accountId: "owner-subject",
        actorUserId: "id-1",
        action: "identity.linked",
        targetType: "user",
        targetId: "id-1",
        summary: { provider: "cloudflare_access", newUser: true },
      },
    ]);
    expect(db.batches).toEqual([4]);
  });

  it("reuses the linked user without writing on every request", async () => {
    const { identity } = service();
    const first = await identity.resolveActor(principal());
    clock.advance(60_000);
    expect(await identity.resolveActor(principal())).toEqual(first);
    expect(db.batches).toEqual([4]);
    clock.advance(10 * 60_000);
    await identity.resolveActor(principal());
    expect(db.state.identities.get(ownerKey)?.lastSeenAt).toBe(
      "2026-10-08 12:11:00",
    );
    expect(db.state.users.size).toBe(1);
  });

  it("updates the stored email and name when the token carries new ones", async () => {
    const { identity } = service();
    await identity.resolveActor(principal());
    const actor = await identity.resolveActor(
      principal({ email: "new@example.test", name: "Synthetic Owner" }),
    );
    expect(actor).toMatchObject({
      email: "new@example.test",
      displayName: "Synthetic Owner",
    });
    expect(db.state.users.get("id-1")).toMatchObject({
      email: "new@example.test",
      displayName: "Synthetic Owner",
    });
    // A token without the claims keeps what is stored.
    expect(
      await identity.resolveActor(principal({ email: null, name: null })),
    ).toMatchObject({ email: "new@example.test" });
  });

  it("links a rotated owner subject to the existing owner and account", async () => {
    await service().identity.resolveActor(principal());
    const { identity } = service({
      config: { ...config, ownerSubject: "rotated-subject" },
    });
    const actor = await identity.resolveActor(
      principal({ subject: "rotated-subject" }),
    );
    expect(actor).toMatchObject({ userId: "id-1", accountId: "owner-subject" });
    expect(db.state.users.size).toBe(1);
    expect(db.state.auditEvents.at(-1)).toMatchObject({
      action: "identity.linked",
      summary: { newUser: false },
    });
  });

  it("never links an identity other than the configured owner", async () => {
    const { identity } = service();
    await expect(
      identity.resolveActor(principal({ subject: "someone-else" })),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(db.state.users.size).toBe(0);
  });

  it("rejects disabled users and tokens from before a sign-out", async () => {
    const { identity } = service();
    await identity.resolveActor(principal());
    const user = db.state.users.get("id-1")!;
    user.sessionsValidAfter = 1_800_000_000;
    await expect(identity.resolveActor(principal())).rejects.toBeInstanceOf(
      SessionEndedError,
    );
    expect(
      await identity.resolveActor(principal({ issuedAt: 1_800_000_001 })),
    ).toMatchObject({ userId: "id-1" });
    user.status = "disabled";
    await expect(
      identity.resolveActor(principal({ issuedAt: 1_800_000_001 })),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("recovers when a concurrent first request linked the identity", async () => {
    // The competing request links first; ours looked before that happened.
    await service().identity.resolveActor(principal());
    const repos = fakeRepositories(db);
    let lookups = 0;
    const racing = new IdentityService({
      db: db.d1,
      repos: {
        ...repos,
        findUserByIdentity: async (d, identity) =>
          ++lookups === 1 ? null : repos.findUserByIdentity(d, identity),
      },
      verifier: fakeVerifier(),
      clock,
      ids: sequentialIds("race"),
      config,
    });
    expect(await racing.resolveActor(principal())).toMatchObject({
      userId: "id-1",
    });
    expect(db.state.users.size).toBe(1);
    expect(db.state.auditEvents).toHaveLength(1);
  });

  it("describes the signed-in user without internal ids", async () => {
    const { identity } = service();
    const actor = await identity.resolveActor(principal({ name: "Owner" }));
    expect(identity.describe(actor)).toEqual({
      id: "id-1",
      email: "owner@example.test",
      displayName: "Owner",
      role: "owner",
    });
  });
});
