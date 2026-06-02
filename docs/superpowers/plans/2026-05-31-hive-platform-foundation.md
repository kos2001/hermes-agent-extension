# Hive Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend foundation (sub-project A) that turns the personal bookmark organizer into a multi-user platform: Supabase schema + RLS, a shared `@/lib/cloud` data layer, Google OAuth sign-in in the extension, and a minimal sign-in panel.

**Architecture:** Both the extension (now) and the future web app (sub-project C) talk to one Supabase project through a shared `@/lib/cloud` module. Data-access functions take a `SupabaseClient` as their first argument (dependency injection) so they unit-test against a fake client. Auth uses `chrome.identity.launchWebAuthFlow` with Supabase's implicit OAuth flow; the session persists in `chrome.storage.local` via a custom storage adapter so it survives service-worker restarts.

**Tech Stack:** TypeScript, React 18, Vite + @crxjs, Supabase (`@supabase/supabase-js`), Vitest, Chrome MV3 (`identity` permission).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/0001_init.sql` | Schema, RLS policies, profile-creation trigger |
| `.env.example` | Documents `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` |
| `src/lib/cloud/storage-adapter.ts` | `chrome.storage.local` adapter for the Supabase auth client |
| `src/lib/cloud/oauth.ts` | Pure parser: extract tokens from the OAuth redirect URL |
| `src/lib/cloud/client.ts` | Create/export the configured Supabase singleton |
| `src/lib/cloud/auth.ts` | `signInWithGoogle` / `signOut` / `getSession` / `onAuthChange` |
| `src/lib/cloud/types.ts` | DB row + insert types |
| `src/lib/cloud/folders.ts` | `publishFolder` (upsert), `getFolder` |
| `src/lib/cloud/feed.ts` | `listFeed`, `react`, `unreact` |
| `src/sidepanel/HiveSignIn.tsx` | Minimal sign-in / profile affordance |
| `manifest.config.ts` | Add `identity` permission |
| `src/lib/i18n.ts` | Add Hive sign-in strings |
| `README.md` | Supabase setup checklist |

Tests live beside source as `*.test.ts` (existing convention).

---

## Task 1: Add Supabase dependency and env config

**Files:**
- Modify: `package.json` (dependencies)
- Create: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Install the Supabase client**

Run: `npm install @supabase/supabase-js@^2`
Expected: `@supabase/supabase-js` added under `dependencies` in `package.json`.

- [ ] **Step 2: Create `.env.example`**

```
# Copy to `.env` (gitignored) and fill from your Supabase project settings.
# Settings → API → Project URL / anon public key.
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

- [ ] **Step 3: Ensure `.env` is gitignored**

Add a line `.env` to `.gitignore` if not already present.

- [ ] **Step 4: Verify the build still type-checks**

Run: `npm run type-check`
Expected: PASS (no usages yet).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore
git commit -m "build(cloud): add @supabase/supabase-js + env config"
```

---

## Task 2: Database schema, RLS, and profile trigger

**Files:**
- Create: `supabase/migrations/0001_init.sql`

- [ ] **Step 1: Write the migration**

```sql
-- profiles: one row per auth user, auto-created on sign-up.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.shared_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  source_folder_name text not null,
  summary text,
  topics text[] not null default '{}',
  item_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_folder_name)
);

create table public.shared_items (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.shared_folders (id) on delete cascade,
  title text not null,
  url text not null,
  item_summary text,
  position int not null default 0
);

create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.shared_folders (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('like', 'save')),
  created_at timestamptz not null default now(),
  unique (folder_id, user_id, kind)
);

-- Auto-create a profile row when a new auth user appears.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row-Level Security: public read for members, own-row writes.
alter table public.profiles enable row level security;
alter table public.shared_folders enable row level security;
alter table public.shared_items enable row level security;
alter table public.reactions enable row level security;

create policy "profiles readable by members" on public.profiles
  for select to authenticated using (true);
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid());

create policy "folders readable by members" on public.shared_folders
  for select to authenticated using (true);
create policy "insert own folders" on public.shared_folders
  for insert to authenticated with check (owner_id = auth.uid());
create policy "update own folders" on public.shared_folders
  for update to authenticated using (owner_id = auth.uid());
create policy "delete own folders" on public.shared_folders
  for delete to authenticated using (owner_id = auth.uid());

create policy "items readable by members" on public.shared_items
  for select to authenticated using (true);
create policy "write items of own folders" on public.shared_items
  for all to authenticated
  using (exists (select 1 from public.shared_folders f
                 where f.id = folder_id and f.owner_id = auth.uid()))
  with check (exists (select 1 from public.shared_folders f
                      where f.id = folder_id and f.owner_id = auth.uid()));

create policy "reactions readable by members" on public.reactions
  for select to authenticated using (true);
create policy "insert own reactions" on public.reactions
  for insert to authenticated with check (user_id = auth.uid());
create policy "delete own reactions" on public.reactions
  for delete to authenticated using (user_id = auth.uid());
```

- [ ] **Step 2: Verify it applies (manual, against the Supabase project)**

Run in the Supabase SQL editor (or `supabase db push`). Expected: tables visible under `public`; RLS enabled badge on each.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat(cloud): initial Supabase schema + RLS + profile trigger"
```

---

## Task 3: chrome.storage session adapter

**Files:**
- Create: `src/lib/cloud/storage-adapter.ts`
- Test: `src/lib/cloud/storage-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chromeStorageAdapter } from "./storage-adapter";

function fakeChromeStorage() {
  const data: Record<string, unknown> = {};
  return {
    local: {
      get: vi.fn(async (k: string) => ({ [k]: data[k] })),
      set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(data, obj); }),
      remove: vi.fn(async (k: string) => { delete data[k]; }),
    },
  };
}

describe("chromeStorageAdapter", () => {
  beforeEach(() => {
    (globalThis as any).chrome = fakeChromeStorage();
  });

  it("round-trips a value through get/set", async () => {
    await chromeStorageAdapter.setItem("k", "v");
    expect(await chromeStorageAdapter.getItem("k")).toBe("v");
  });

  it("returns null for a missing key", async () => {
    expect(await chromeStorageAdapter.getItem("nope")).toBeNull();
  });

  it("removes a key", async () => {
    await chromeStorageAdapter.setItem("k", "v");
    await chromeStorageAdapter.removeItem("k");
    expect(await chromeStorageAdapter.getItem("k")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- storage-adapter`
Expected: FAIL ("Cannot find module './storage-adapter'").

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * Supabase auth storage backed by `chrome.storage.local` so a session is shared
 * across the side panel and the service worker and survives SW restarts.
 * Supabase accepts an async storage object implementing get/set/removeItem.
 */
export const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const got = await chrome.storage.local.get(key);
    const v = got[key];
    return typeof v === "string" ? v : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- storage-adapter`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cloud/storage-adapter.ts src/lib/cloud/storage-adapter.test.ts
git commit -m "feat(cloud): chrome.storage session adapter for Supabase auth"
```

---

## Task 4: OAuth redirect-fragment parser

**Files:**
- Create: `src/lib/cloud/oauth.ts`
- Test: `src/lib/cloud/oauth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { parseTokensFromRedirect } from "./oauth";

describe("parseTokensFromRedirect", () => {
  it("extracts access and refresh tokens from the URL fragment", () => {
    const url = "https://abc.chromiumapp.org/#access_token=AAA&refresh_token=BBB&token_type=bearer";
    expect(parseTokensFromRedirect(url)).toEqual({ accessToken: "AAA", refreshToken: "BBB" });
  });

  it("also reads tokens from the query string (fallback)", () => {
    const url = "https://abc.chromiumapp.org/?access_token=AAA&refresh_token=BBB";
    expect(parseTokensFromRedirect(url)).toEqual({ accessToken: "AAA", refreshToken: "BBB" });
  });

  it("surfaces a provider error", () => {
    const url = "https://abc.chromiumapp.org/#error=access_denied&error_description=nope";
    expect(() => parseTokensFromRedirect(url)).toThrow(/access_denied/);
  });

  it("throws when tokens are absent", () => {
    expect(() => parseTokensFromRedirect("https://abc.chromiumapp.org/")).toThrow(/no tokens/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- cloud/oauth`
Expected: FAIL ("Cannot find module './oauth'").

- [ ] **Step 3: Write the implementation**

```typescript
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Parse the redirect URL captured by chrome.identity.launchWebAuthFlow.
 * Supabase's implicit flow returns tokens in the URL fragment; we also accept
 * the query string as a fallback. Throws on a provider error or missing tokens.
 */
export function parseTokensFromRedirect(redirectUrl: string): OAuthTokens {
  const u = new URL(redirectUrl);
  const frag = new URLSearchParams(u.hash.replace(/^#/, ""));
  const pick = (k: string) => frag.get(k) ?? u.searchParams.get(k);

  const error = pick("error");
  if (error) throw new Error(`${error}: ${pick("error_description") ?? ""}`.trim());

  const accessToken = pick("access_token");
  const refreshToken = pick("refresh_token");
  if (!accessToken || !refreshToken) throw new Error("OAuth redirect carried no tokens");
  return { accessToken, refreshToken };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- cloud/oauth`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cloud/oauth.ts src/lib/cloud/oauth.test.ts
git commit -m "feat(cloud): OAuth redirect token parser"
```

---

## Task 5: Supabase client singleton

**Files:**
- Create: `src/lib/cloud/client.ts`

- [ ] **Step 1: Write the implementation**

```typescript
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromeStorageAdapter } from "./storage-adapter";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when the build was configured with Supabase credentials. */
export const cloudConfigured = Boolean(url && anonKey);

/**
 * Shared Supabase client. Uses the implicit OAuth flow (tokens arrive in the
 * redirect fragment, which suits chrome.identity.launchWebAuthFlow) and stores
 * the session in chrome.storage so it is shared across SW + side panel.
 */
export const supabase: SupabaseClient = createClient(url ?? "http://invalid.local", anonKey ?? "anon", {
  auth: {
    flowType: "implicit",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: chromeStorageAdapter,
  },
});
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cloud/client.ts
git commit -m "feat(cloud): configured Supabase client singleton"
```

---

## Task 6: Auth functions

**Files:**
- Create: `src/lib/cloud/auth.ts`

- [ ] **Step 1: Write the implementation**

```typescript
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./client";
import { parseTokensFromRedirect } from "./oauth";

/**
 * Sign in with Google via chrome.identity.launchWebAuthFlow. Asks Supabase for
 * an authorize URL (no browser redirect), runs the interactive flow, then sets
 * the captured session on the client.
 */
export async function signInWithGoogle(): Promise<Session> {
  const redirectUri = chrome.identity.getRedirectURL();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { skipBrowserRedirect: true, redirectTo: redirectUri },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Supabase did not return an authorize URL");

  const redirect = await chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true });
  if (!redirect) throw new Error("Sign-in was cancelled");

  const { accessToken, refreshToken } = parseTokensFromRedirect(redirect);
  const { data: sessionData, error: setErr } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (setErr) throw setErr;
  if (!sessionData.session) throw new Error("Failed to establish a session");
  return sessionData.session;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Subscribe to auth changes; returns an unsubscribe function. */
export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cloud/auth.ts
git commit -m "feat(cloud): Google OAuth sign-in via chrome.identity"
```

---

## Task 7: DB types

**Files:**
- Create: `src/lib/cloud/types.ts`

- [ ] **Step 1: Write the implementation**

```typescript
export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface SharedFolder {
  id: string;
  owner_id: string;
  title: string;
  source_folder_name: string;
  summary: string | null;
  topics: string[];
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface SharedItem {
  id: string;
  folder_id: string;
  title: string;
  url: string;
  item_summary: string | null;
  position: number;
}

/** Payload the extension hands to publishFolder (sub-project B fills this). */
export interface PublishFolderInput {
  title: string;
  sourceFolderName: string;
  summary: string;
  topics: string[];
  items: { title: string; url: string; itemSummary?: string }[];
}

/** A feed row joined with its owner profile and item count. */
export interface FeedEntry extends SharedFolder {
  owner: Pick<Profile, "display_name" | "avatar_url">;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cloud/types.ts
git commit -m "feat(cloud): shared DB + payload types"
```

---

## Task 8: publishFolder (upsert) + getFolder

**Files:**
- Create: `src/lib/cloud/folders.ts`
- Test: `src/lib/cloud/folders.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { publishFolder } from "./folders";
import type { PublishFolderInput } from "./types";

/** Minimal chainable fake of the Supabase query builder we use. */
function fakeClient(overrides: Record<string, any> = {}) {
  const calls: any = { upsertFolder: null, deletedItems: false, insertedItems: null };
  const folderRow = { id: "folder-1" };
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })) },
    from: vi.fn((table: string) => {
      if (table === "shared_folders") {
        return {
          upsert: vi.fn((row: any) => { calls.upsertFolder = row; return {
            select: () => ({ single: async () => ({ data: folderRow, error: null }) }),
          }; }),
        };
      }
      if (table === "shared_items") {
        return {
          delete: vi.fn(() => ({ eq: vi.fn(async () => { calls.deletedItems = true; return { error: null }; }) })),
          insert: vi.fn(async (rows: any) => { calls.insertedItems = rows; return { error: null }; }),
        };
      }
      throw new Error("unexpected table " + table);
    }),
    ...overrides,
  };
  return { client, calls };
}

const input: PublishFolderInput = {
  title: "AI papers",
  sourceFolderName: "AI",
  summary: "A folder about AI.",
  topics: ["ai", "ml"],
  items: [{ title: "Attention", url: "https://x/attention", itemSummary: "transformers" }],
};

describe("publishFolder", () => {
  it("upserts the folder keyed on owner+source name with the owner id", async () => {
    const { client, calls } = fakeClient();
    await publishFolder(client as any, input);
    expect(calls.upsertFolder).toMatchObject({
      owner_id: "user-1",
      source_folder_name: "AI",
      title: "AI papers",
      topics: ["ai", "ml"],
      item_count: 1,
    });
  });

  it("replaces items: deletes existing then inserts the new set", async () => {
    const { client, calls } = fakeClient();
    await publishFolder(client as any, input);
    expect(calls.deletedItems).toBe(true);
    expect(calls.insertedItems).toEqual([
      { folder_id: "folder-1", title: "Attention", url: "https://x/attention", item_summary: "transformers", position: 0 },
    ]);
  });

  it("throws when there is no signed-in user", async () => {
    const { client } = fakeClient({ auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) } });
    await expect(publishFolder(client as any, input)).rejects.toThrow(/signed in/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- cloud/folders`
Expected: FAIL ("Cannot find module './folders'").

- [ ] **Step 3: Write the implementation**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublishFolderInput, SharedFolder, SharedItem } from "./types";

/**
 * Publish (or re-publish) a folder. Idempotent on (owner_id, source_folder_name):
 * re-sharing the same folder updates the row and replaces its items rather than
 * creating duplicates.
 */
export async function publishFolder(
  sb: SupabaseClient,
  input: PublishFolderInput,
): Promise<{ folderId: string }> {
  const { data: userData } = await sb.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Must be signed in to publish");

  const { data: folder, error: upErr } = await sb
    .from("shared_folders")
    .upsert(
      {
        owner_id: userId,
        title: input.title,
        source_folder_name: input.sourceFolderName,
        summary: input.summary,
        topics: input.topics,
        item_count: input.items.length,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,source_folder_name" },
    )
    .select()
    .single();
  if (upErr) throw upErr;

  const folderId = (folder as { id: string }).id;

  const { error: delErr } = await sb.from("shared_items").delete().eq("folder_id", folderId);
  if (delErr) throw delErr;

  if (input.items.length > 0) {
    const rows = input.items.map((it, i) => ({
      folder_id: folderId,
      title: it.title,
      url: it.url,
      item_summary: it.itemSummary ?? null,
      position: i,
    }));
    const { error: insErr } = await sb.from("shared_items").insert(rows);
    if (insErr) throw insErr;
  }

  return { folderId };
}

/** Fetch one folder with its items, ordered by position. */
export async function getFolder(
  sb: SupabaseClient,
  folderId: string,
): Promise<{ folder: SharedFolder; items: SharedItem[] }> {
  const { data: folder, error: fErr } = await sb
    .from("shared_folders")
    .select("*")
    .eq("id", folderId)
    .single();
  if (fErr) throw fErr;

  const { data: items, error: iErr } = await sb
    .from("shared_items")
    .select("*")
    .eq("folder_id", folderId)
    .order("position", { ascending: true });
  if (iErr) throw iErr;

  return { folder: folder as SharedFolder, items: (items ?? []) as SharedItem[] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- cloud/folders`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cloud/folders.ts src/lib/cloud/folders.test.ts
git commit -m "feat(cloud): publishFolder (idempotent upsert) + getFolder"
```

---

## Task 9: feed + reactions

**Files:**
- Create: `src/lib/cloud/feed.ts`
- Test: `src/lib/cloud/feed.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { listFeed, react, unreact } from "./feed";

describe("listFeed", () => {
  it("maps joined rows to FeedEntry with a flattened owner", async () => {
    const rows = [{
      id: "f1", owner_id: "u1", title: "AI", source_folder_name: "AI", summary: "s",
      topics: ["ai"], item_count: 2, created_at: "t", updated_at: "t",
      profiles: { display_name: "Kim", avatar_url: "a.png" },
    }];
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          order: vi.fn(() => ({ limit: vi.fn(async () => ({ data: rows, error: null })) })),
        })),
      })),
    };
    const feed = await listFeed(client as any);
    expect(feed[0]).toMatchObject({ id: "f1", owner: { display_name: "Kim", avatar_url: "a.png" } });
    expect((feed[0] as any).profiles).toBeUndefined();
  });
});

describe("react / unreact", () => {
  it("react inserts a row for the current user", async () => {
    let inserted: any = null;
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({ insert: vi.fn(async (r: any) => { inserted = r; return { error: null }; }) })),
    };
    await react(client as any, "f1", "like");
    expect(inserted).toEqual({ folder_id: "f1", user_id: "u1", kind: "like" });
  });

  it("unreact deletes the matching row", async () => {
    const eqs: any[] = [];
    const chain = { eq: vi.fn(function (this: any, k: string, v: string) { eqs.push([k, v]); return this; }) };
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({ delete: vi.fn(() => chain) })),
    };
    // Make the final eq resolve.
    chain.eq = vi.fn(async function (this: any, k: string, v: string) { eqs.push([k, v]); return { error: null }; }) as any;
    await unreact(client as any, "f1", "like");
    expect(eqs).toContainEqual(["folder_id", "f1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- cloud/feed`
Expected: FAIL ("Cannot find module './feed'").

- [ ] **Step 3: Write the implementation**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedEntry } from "./types";

type ReactionKind = "like" | "save";

/** Newest shared folders, each joined with its owner profile. */
export async function listFeed(sb: SupabaseClient, limit = 50): Promise<FeedEntry[]> {
  const { data, error } = await sb
    .from("shared_folders")
    .select("*, profiles!shared_folders_owner_id_fkey(display_name, avatar_url)")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row: any) => {
    const { profiles, ...folder } = row;
    return { ...folder, owner: { display_name: profiles?.display_name ?? null, avatar_url: profiles?.avatar_url ?? null } } as FeedEntry;
  });
}

export async function react(sb: SupabaseClient, folderId: string, kind: ReactionKind): Promise<void> {
  const { data } = await sb.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("Must be signed in to react");
  const { error } = await sb.from("reactions").insert({ folder_id: folderId, user_id: userId, kind });
  if (error) throw error;
}

export async function unreact(sb: SupabaseClient, folderId: string, kind: ReactionKind): Promise<void> {
  const { data } = await sb.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("Must be signed in to react");
  const { error } = await sb
    .from("reactions")
    .delete()
    .eq("folder_id", folderId)
    .eq("user_id", userId)
    .eq("kind", kind);
  if (error) throw error;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- cloud/feed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cloud/feed.ts src/lib/cloud/feed.test.ts
git commit -m "feat(cloud): feed listing + like/save reactions"
```

---

## Task 10: Manifest `identity` permission

**Files:**
- Modify: `manifest.config.ts:38`

- [ ] **Step 1: Add the permission**

In the `permissions` array, add `"identity"`:

```typescript
  permissions: ["storage", "sidePanel", "activeTab", "scripting", "tabs", "bookmarks", "alarms", "notifications", "downloads", "identity"],
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add manifest.config.ts
git commit -m "feat(cloud): request identity permission for Google OAuth"
```

---

## Task 11: i18n strings for Hive sign-in

**Files:**
- Modify: `src/lib/i18n.ts` (add entries to the `STR` table)

- [ ] **Step 1: Add the strings**

Add these entries inside the `STR` object:

```typescript
  hiveSignIn: { ko: "Hive 로그인", en: "Sign in to Hive", zh: "登录 Hive" },
  hiveSignInTitle: { ko: "Google로 Hive에 로그인", en: "Sign in to Hive with Google", zh: "使用 Google 登录 Hive" },
  hiveSignOut: { ko: "로그아웃", en: "Sign out", zh: "退出登录" },
  hiveSignedInAs: { ko: "{name} 님으로 로그인됨", en: "Signed in as {name}", zh: "已登录：{name}" },
  hiveSignInError: { ko: "로그인 실패. 다시 시도하세요.", en: "Sign-in failed. Please try again.", zh: "登录失败，请重试。" },
  hiveNotConfigured: { ko: "Hive가 구성되지 않았습니다.", en: "Hive is not configured.", zh: "Hive 尚未配置。" },
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "feat(cloud): i18n strings for Hive sign-in"
```

---

## Task 12: Sign-in panel component

**Files:**
- Create: `src/sidepanel/HiveSignIn.tsx`
- Modify: `src/sidepanel/App.tsx` (render `<HiveSignIn lang={lang} />` in the top bar area)

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { t, type Lang } from "@/lib/i18n";
import { cloudConfigured } from "@/lib/cloud/client";
import { getSession, onAuthChange, signInWithGoogle, signOut } from "@/lib/cloud/auth";

/**
 * Minimal Hive auth affordance: a Google sign-in button when signed out, or the
 * profile name + sign-out when signed in. No publish/feed UI yet (sub-projects
 * B/C). Renders nothing when the build has no Supabase credentials.
 */
export function HiveSignIn({ lang }: { lang: Lang }) {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudConfigured) return;
    getSession().then(setSession).catch(() => {});
    return onAuthChange(setSession);
  }, []);

  if (!cloudConfigured) return null;

  const name = session?.user?.user_metadata?.full_name ?? session?.user?.email ?? "";

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      setSession(await signInWithGoogle());
    } catch {
      setError(t(lang, "hiveSignInError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
      setSession(null);
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    return (
      <span className="hive-auth" title={t(lang, "hiveSignedInAs").replace("{name}", name)}>
        <span className="hive-auth-name">{name}</span>
        <button className="icon-btn" disabled={busy} onClick={handleSignOut}>
          {t(lang, "hiveSignOut")}
        </button>
      </span>
    );
  }

  return (
    <span className="hive-auth">
      <button className="icon-btn" disabled={busy} title={t(lang, "hiveSignInTitle")} onClick={handleSignIn}>
        {t(lang, "hiveSignIn")}
      </button>
      {error && <span className="hive-auth-error">{error}</span>}
    </span>
  );
}
```

- [ ] **Step 2: Wire it into the side panel top bar**

In `src/sidepanel/App.tsx`, import `HiveSignIn` and render `<HiveSignIn lang={lang} />` in the top-bar control cluster (next to the existing settings / language controls). Use the existing `lang` state variable.

```tsx
import { HiveSignIn } from "./HiveSignIn";
// ...in the top-bar JSX, alongside the other control buttons:
<HiveSignIn lang={lang} />
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS (tsc + vite). No `[INEFFECTIVE_DYNAMIC_IMPORT]` warnings.

- [ ] **Step 4: Manual verification (real Supabase project required)**

Load `dist/` unpacked, open the side panel. Expect a "Sign in to Hive" button. Click → Google consent → on return the button shows your name. Reload the panel → still signed in (session persisted). Click sign out → button returns.

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/HiveSignIn.tsx src/sidepanel/App.tsx
git commit -m "feat(cloud): minimal Hive sign-in panel in the side panel"
```

---

## Task 13: README setup checklist

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Hive (cloud) setup" section**

Document, as a checklist: create a Supabase project; run `supabase/migrations/0001_init.sql`; enable the Google provider under Auth → Providers (with Google OAuth client id/secret); add `https://<extension-id>.chromiumapp.org/` to Auth → URL Configuration → Redirect URLs; copy Project URL + anon key into `.env` (see `.env.example`); rebuild. Note that the extension id is shown on `chrome://extensions` after loading `dist/`.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(cloud): Supabase/Hive setup checklist"
```

---

## Self-Review

**Spec coverage:**
- Schema + RLS → Task 2 ✓
- `@/lib/cloud` (client/auth/folders/feed/types) → Tasks 3–9 ✓
- `publishFolder` in A → Task 8 ✓
- Config via env + `.env.example` → Task 1 ✓
- Manifest `identity` → Task 10 ✓
- Minimal sign-in panel → Task 12 ✓
- Tests for data-access layer → Tasks 3, 4, 8, 9 ✓
- README setup → Task 13 ✓
- Error handling (localized messages, idempotent publish) → Tasks 8, 11, 12 ✓
- RLS verified by SQL test → covered by manual step in Task 2 + policies; a dedicated cross-user SQL test can be added during execution if desired.

**Type consistency:** `publishFolder(sb, input)`, `getFolder(sb, id)`, `listFeed(sb, limit?)`, `react(sb, folderId, kind)`, `unreact(sb, folderId, kind)` — signatures consistent between tasks and tests. `PublishFolderInput`, `FeedEntry`, `SharedFolder`, `SharedItem` defined in Task 7 and used consistently.

**Placeholder scan:** No TBD/TODO; every code step contains real code.

**Note for executor:** Tasks 5, 6, 12's manual steps require the live Supabase project from Task 13's checklist. Tasks 1–4, 7–11 are fully verifiable offline (type-check + vitest).
