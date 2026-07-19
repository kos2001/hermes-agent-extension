import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import {
  defaultDisplayName,
  ensureFreshSession,
  requestPasswordReset,
  signInWithPassword,
  VerificationPendingError,
} from "./password-auth";

/** PocketBase's authRule rejection for an unverified account (403). */
const unverified = Object.assign(
  new Error("The request doesn't satisfy the collection requirements to authenticate."),
  { status: 403 },
);

/** PocketBase's "email already exists" create failure. */
const notUnique = Object.assign(new Error("exists"), {
  data: { data: { email: { code: "validation_not_unique" } } },
});

function users<T extends Record<string, unknown>>(overrides?: T) {
  return {
    create: vi.fn().mockResolvedValue({}),
    authWithPassword: vi.fn().mockResolvedValue({}),
    ...(overrides ?? ({} as T)),
  };
}

describe("defaultDisplayName", () => {
  it("uses the normalized email prefix", () => {
    expect(defaultDisplayName("  Ada@Example.COM ")).toBe("ada");
  });
});

describe("signInWithPassword", () => {
  it("creates the account on first sign-in, then authenticates", async () => {
    const u = users();
    const pb = mockPb({ users: u });
    const s = await signInWithPassword(pb, " New@X.io ", "hunter22");
    expect(u.create).toHaveBeenCalledWith({
      email: "new@x.io",
      password: "hunter22",
      passwordConfirm: "hunter22",
      display_name: "new",
    });
    expect(u.authWithPassword).toHaveBeenCalledWith("new@x.io", "hunter22");
    expect(s.user.id).toBe("u1");
  });

  it("treats an existing account as the normal path", async () => {
    const u = users({ create: vi.fn().mockRejectedValue(notUnique) });
    const pb = mockPb({ users: u });
    await signInWithPassword(pb, "old@x.io", "hunter22");
    expect(u.authWithPassword).toHaveBeenCalledWith("old@x.io", "hunter22");
  });

  it("surfaces create failures other than the duplicate email", async () => {
    const boom = Object.assign(new Error("too short"), {
      data: { data: { password: { code: "validation_length_out_of_range" } } },
    });
    const u = users({ create: vi.fn().mockRejectedValue(boom) });
    const pb = mockPb({ users: u });
    await expect(signInWithPassword(pb, "a@b.com", "x")).rejects.toThrow("too short");
    expect(u.authWithPassword).not.toHaveBeenCalled();
  });

  it("propagates a wrong password", async () => {
    const u = users({
      create: vi.fn().mockRejectedValue(notUnique),
      authWithPassword: vi.fn().mockRejectedValue(new Error("Failed to authenticate.")),
    });
    const pb = mockPb({ users: u });
    await expect(signInWithPassword(pb, "old@x.io", "wrong!")).rejects.toThrow(
      "Failed to authenticate.",
    );
  });

  it("sends a verification mail and reports pending for a brand-new human email", async () => {
    const u = users({
      authWithPassword: vi.fn().mockRejectedValue(unverified),
      requestVerification: vi.fn().mockResolvedValue(true),
    });
    const pb = mockPb({ users: u });
    await expect(signInWithPassword(pb, " New@Human.dev ", "hunter22")).rejects.toBeInstanceOf(
      VerificationPendingError,
    );
    expect(u.requestVerification).toHaveBeenCalledWith("new@human.dev");
  });

  it("re-sends verification when an existing unverified account signs in", async () => {
    const u = users({
      create: vi.fn().mockRejectedValue(notUnique),
      authWithPassword: vi.fn().mockRejectedValue(unverified),
      requestVerification: vi.fn().mockResolvedValue(true),
    });
    const pb = mockPb({ users: u });
    await expect(signInWithPassword(pb, "old@human.dev", "hunter22")).rejects.toBeInstanceOf(
      VerificationPendingError,
    );
    expect(u.requestVerification).toHaveBeenCalledWith("old@human.dev");
  });

  it("fails when no session materializes after auth", async () => {
    const pb = mockPb({ users: users() }, null); // invalid auth store
    await expect(signInWithPassword(pb, "a@b.com", "hunter22")).rejects.toThrow(
      "No session after sign-in",
    );
  });
});

describe("ensureFreshSession", () => {
  it("clears a stored session the server no longer honors (e.g. token secret rotated)", async () => {
    const dead = Object.assign(new Error("The request requires valid record authorization token."), {
      status: 401,
    });
    const u = users({ authRefresh: vi.fn().mockRejectedValue(dead) });
    const clear = vi.fn();
    const pb = mockPb({ users: u });
    (pb.authStore as unknown as { clear: () => void }).clear = clear;
    expect(await ensureFreshSession(pb)).toBeNull();
    expect(clear).toHaveBeenCalled();
  });

  it("keeps the session on transient network failures", async () => {
    const offline = Object.assign(new Error("Failed to fetch"), { status: 0 });
    const u = users({ authRefresh: vi.fn().mockRejectedValue(offline) });
    const pb = mockPb({ users: u });
    const s = await ensureFreshSession(pb);
    expect(s?.user.id).toBe("u1");
  });

  it("returns the session when the server confirms it", async () => {
    const u = users({ authRefresh: vi.fn().mockResolvedValue({}) });
    const pb = mockPb({ users: u });
    const s = await ensureFreshSession(pb);
    expect(s?.user.id).toBe("u1");
  });

  it("is null without a stored session (no server call)", async () => {
    const u = users({ authRefresh: vi.fn() });
    const pb = mockPb({ users: u }, null);
    expect(await ensureFreshSession(pb)).toBeNull();
    expect(u.authRefresh).not.toHaveBeenCalled();
  });
});

describe("requestPasswordReset", () => {
  it("normalizes the email and asks the server for a reset mail", async () => {
    const u = users({ requestPasswordReset: vi.fn().mockResolvedValue(true) });
    const pb = mockPb({ users: u });
    await requestPasswordReset(pb, " Ada@Example.COM ");
    expect(u.requestPasswordReset).toHaveBeenCalledWith("ada@example.com");
  });
});
