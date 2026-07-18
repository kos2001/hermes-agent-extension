import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { defaultDisplayName, signInWithPassword } from "./password-auth";

/** PocketBase's "email already exists" create failure. */
const notUnique = Object.assign(new Error("exists"), {
  data: { data: { email: { code: "validation_not_unique" } } },
});

function users(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn().mockResolvedValue({}),
    authWithPassword: vi.fn().mockResolvedValue({}),
    ...overrides,
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

  it("fails when no session materializes after auth", async () => {
    const pb = mockPb({ users: users() }, null); // invalid auth store
    await expect(signInWithPassword(pb, "a@b.com", "hunter22")).rejects.toThrow(
      "No session after sign-in",
    );
  });
});
