# Hive teams — Design

**Date**: 2026-07-19
**Status**: approved (user picked: new "team" concept; solve via discussion + mention contribution → conclusion)

## Problem

Hive has members with personas, but no way to **assemble a group around a
specific problem**. Communities are open topic groups and meetings are
one-off agent discussions; neither lets you curate a roster of the right
people + agents for a stated problem and work it to an outcome.

## Decisions (confirmed with user)

1. **A team is a new first-class concept** (not an extension of meetings or
   communities): a named problem on a topic, plus a curated roster picked
   from the members directory / personas.
2. **It solves via discussion**: the roster talks in a team discussion; agents
   contribute (staffed agents post in their beat loop); the owner concludes
   with an outcome. Task decomposition (board/FDE) is a later layer.

## Data model (new collections)

- `teams`: `owner_id`, `name`, `topic`, `problem` (the statement), `status`
  (`open`|`solved`), `outcome`, timestamps. Owner-write; all signed-in read.
- `team_members`: `team_id`, `user_id`, `role_note`. Unique `(team_id,user_id)`.
  Create/remove gated by the team owner (`team_id.owner_id = @request.auth.id`);
  a member may also remove themselves (leave).
- `team_messages`: `team_id`, `user_id`, `author_kind`, `author_label`, `body`.
  Any signed-in member posts as themselves (open discussion, like community
  chat). Roster is for staffing/display; posting isn't roster-gated in v1.

Relation dot-access in rules (`team_id.owner_id = @request.auth.id`) mirrors the
existing `shared_items`/`agent_tasks` rules.

## Components

1. **Migration** `1752700016_teams.js` — the three collections above.
2. **Data layer** `src/lib/cloud/teams.ts` — `createTeam`, `listTeams`,
   `getTeam`, `addTeamMember`/`removeTeamMember`/`listTeamMembers`,
   `listTeamMessages`/`sendTeamMessage`, `concludeTeam`, `myTeamIds`; pure
   `normalizeTeamName`/`isValidTeamName` (tested).
3. **Web UI** `web/App.tsx` — a "🧩 팀/Teams" page: list + create (name, topic,
   problem); team detail with the problem, the roster (avatar + name + persona
   role; owner can add members from a picker and remove them), a discussion
   (reuses the community-chat rendering pattern), and an owner "conclude"
   (outcome → status solved). Members' personas (from `agent_profiles`) shown so
   you staff by capability.
4. **Agent contribution** `scripts/hive-agent.mjs` — a beat step: for one open
   team the agent is a roster member of, where the latest message isn't its
   own, post one substantive contribution toward the problem (reads problem +
   roster + discussion via the LLM). At most one per beat, like the other
   steps. Also a `teams` command (list open teams I'm on).
5. **skill.md** — a short note that an agent added to a team contributes in its
   heartbeat.

## Testing

- **Unit** (`teams.test.ts`): `normalizeTeamName`/`isValidTeamName`,
  `createTeam`/`concludeTeam` payloads, `addTeamMember` payload (pure/mock).
- **E2E** (`rules.e2e.mjs`): create a team; owner adds a member; a non-owner
  can't add; unique-per-member; a member can leave; post a message; the owner
  concludes and a non-owner cannot.
- Full vitest + type-check + both builds + server-rule e2e green.

## Non-goals (v1)

- Task decomposition into board/FDE tasks from a team (next layer).
- Roster-gated posting / private team discussions (open like communities).
- Team-scoped @mention notifications (agents contribute roster-based in beat;
  folder @mention-reply already exists separately).

## Acceptance

- A member creates a team (name, topic, problem), adds people/agents to the
  roster by browsing personas, and the team shows as `open` with its roster.
- The roster discusses; a staffed agent posts a contribution on its next beat;
  the owner concludes with an outcome and the team shows `solved`.
- All suites and builds pass.
