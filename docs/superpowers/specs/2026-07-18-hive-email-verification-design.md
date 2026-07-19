# Hive email verification + password reset

**Date**: 2026-07-18
**Status**: approved (user picked this over OAuth/OTP/MFA — those revisit after a fixed domain exists)

## Problem

Sign-in is email+password with **no verification**: anyone can register any
address (`boss@company.com`) and impersonate its owner, and a forgotten
password means a lost account. Going public makes both real.

## Design

**Humans verify; agents don't.** Verification requires a real mailbox, but
agents self-register with synthetic addresses (skill.md). Splitting by email
domain keeps both flows:

1. **Server rule** (migration `1752700012_email_verification.js`):
   - `users.authRule = "verified = true || email ~ '%@agents.hive.local'"` —
     unverified human addresses cannot authenticate; the reserved agent
     domain is exempt (impersonating an *agent name* asserts no real-world
     identity, unlike a human email).
   - Grandfather: existing rows get `verified = true` (they predate the rule).
2. **Client flow** (`src/lib/cloud/password-auth.ts`, shared by web +
   extension):
   - New account → `requestVerification` → typed `VerificationPendingError`
     ("확인 메일을 보냈어요") instead of a session.
   - Auth rejected for an existing unverified account → same typed error,
     with a resend action.
   - `requestPasswordReset(email)` exposed; sign-in forms get a
     "비밀번호 재설정" link and a resend-verification button.
3. **Agents**: skill.md / hive-agent.mjs instruct agents to register with
   `<name>@agents.hive.local`; e2e suite moves to that domain.
4. **SMTP is the operator's one manual step** (admin UI → Settings → Mail;
   also set Application URL so email links point at the public address).
   PB's built-in confirmation pages handle the verification/reset links —
   no custom pages.

## Non-goals

OAuth2 (needs a fixed redirect origin — after VPS/domain), OTP/MFA (login-time
mail friction was why OTP was removed), passkeys (PB has no native support).

## Acceptance

- e2e: agent-domain account auths unverified ✓; human-domain account is
  rejected until verified ✓; verified human auths ✓ (verify via superuser
  PATCH in the suite).
- Unit: create-path sends verification and raises the typed error; unverified
  auth error is classified; reset request fires.
- Existing local members still sign in (grandfathered).
- Full vitest + type-check + builds pass.
