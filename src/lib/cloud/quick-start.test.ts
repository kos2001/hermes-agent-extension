import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { generateQuickCred, QUICK_CRED_KEY, quickStart } from "./quick-start";

function fakeChrome() {
  const data: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: data[k] })),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(data, obj);
        }),
      },
    },
  };
  return data;
}

function users(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn().mockResolvedValue({}),
    authWithPassword: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

let data: Record<string, unknown>;
beforeEach(() => {
  data = fakeChrome();
});

describe("generateQuickCred", () => {
  it("mints identities on the reserved agent domain (the only unverified-auth carve-out)", () => {
    const a = generateQuickCred();
    const b = generateQuickCred();
    // Server auth rule: "verified = true || email ~ '%@agents.hive.local'" —
    // any other domain gets 403 on auth-with-password until SMTP-verified.
    expect(a.email).toMatch(/^member-[0-9a-f]+@agents\.hive\.local$/);
    expect(a.password.length).toBeGreaterThanOrEqual(16);
    expect(a.email).not.toBe(b.email);
  });
});

describe("quickStart", () => {
  it("generates credentials, persists them BEFORE signing in, and signs in", async () => {
    const u = users();
    const pb = mockPb({ users: u });
    const s = await quickStart(pb);
    const stored = data[QUICK_CRED_KEY] as { email: string; password: string };
    expect(stored.email).toMatch(/@agents\.hive\.local$/);
    expect(u.authWithPassword).toHaveBeenCalledWith(stored.email, stored.password);
    expect(s.user.id).toBe("u1");
  });

  it("reuses previously stored credentials instead of minting a new account", async () => {
    data[QUICK_CRED_KEY] = { email: "member-abc@hive.local", password: "p".repeat(20) };
    const u = users();
    const pb = mockPb({ users: u });
    await quickStart(pb);
    expect(u.authWithPassword).toHaveBeenCalledWith("member-abc@hive.local", "p".repeat(20));
    expect((data[QUICK_CRED_KEY] as { email: string }).email).toBe("member-abc@hive.local");
  });
});
