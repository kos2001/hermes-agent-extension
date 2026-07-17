/// <reference path="../pb_data/types.d.ts" />
/**
 * Hive schema for PocketBase (replaces the old Supabase migrations 0001–0013).
 *
 * Run with: `pocketbase serve --dir pb_data --migrationsDir pb_migrations`
 * (or place this repo's pocketbase/ dir next to the binary — migrations apply
 * automatically on start).
 *
 * Field names deliberately mirror the old Postgres columns (user_id,
 * folder_id, created_at, …) so the client code and types stay unchanged.
 */

const AUTH_ONLY = "@request.auth.id != ''";

migrate(
  (app) => {
    // ---- users (built-in auth collection): display name + email-code login ----
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(new TextField({ name: "display_name", max: 100 }));
    users.otp.enabled = true;
    // anyone may create an account (first sign-in), members may see each other
    users.createRule = "";
    users.listRule = AUTH_ONLY;
    users.viewRule = AUTH_ONLY;
    users.updateRule = "id = @request.auth.id";
    users.deleteRule = "id = @request.auth.id";
    app.save(users);
    const usersId = users.id;

    const created = { name: "created_at", type: "autodate", onCreate: true };
    const createdUpdated = [
      { name: "created_at", type: "autodate", onCreate: true },
      { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
    ];
    const rel = (name, collectionId, opts = {}) => ({
      name,
      type: "relation",
      collectionId,
      maxSelect: 1,
      required: opts.required ?? true,
      cascadeDelete: opts.cascade ?? false,
    });

    // ---- shared_folders ----
    const folders = new Collection({
      name: "shared_folders",
      type: "base",
      fields: [
        rel("owner_id", usersId, { cascade: true }),
        { name: "title", type: "text", required: true, max: 300 },
        { name: "source_folder_name", type: "text", required: true, max: 300 },
        { name: "summary", type: "text", max: 10000 },
        { name: "topics", type: "json" },
        { name: "item_count", type: "number", onlyInt: true },
        ...createdUpdated,
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_folders_owner_source ON shared_folders (owner_id, source_folder_name)",
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: "@request.auth.id != '' && owner_id = @request.auth.id",
      updateRule: "owner_id = @request.auth.id",
      deleteRule: "owner_id = @request.auth.id",
    });
    // communities doesn't exist yet — created below, then the relation is wired up.

    // ---- communities ----
    const communities = new Collection({
      name: "communities",
      type: "base",
      fields: [
        { name: "name", type: "text", required: true, min: 2, max: 40 },
        { name: "description", type: "text", max: 500 },
        rel("created_by", usersId, { cascade: true }),
        created,
      ],
      indexes: ["CREATE UNIQUE INDEX idx_communities_name ON communities (name)"],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: "@request.auth.id != '' && created_by = @request.auth.id",
      updateRule: "created_by = @request.auth.id",
      deleteRule: "created_by = @request.auth.id",
    });
    app.save(communities);

    // wire the folders → communities relation now that the id exists
    folders.fields.add(
      new RelationField({
        name: "community_id",
        collectionId: communities.id,
        maxSelect: 1,
        required: false,
        cascadeDelete: false, // deleting a community frees its folders
      }),
    );
    app.save(folders);

    // ---- shared_items ----
    const items = new Collection({
      name: "shared_items",
      type: "base",
      fields: [
        rel("folder_id", folders.id, { cascade: true }),
        { name: "title", type: "text", required: true, max: 500 },
        { name: "url", type: "url", required: true },
        { name: "item_summary", type: "text", max: 5000 },
        { name: "position", type: "number", onlyInt: true },
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: "@request.auth.id != '' && folder_id.owner_id = @request.auth.id",
      updateRule: "folder_id.owner_id = @request.auth.id",
      deleteRule: "folder_id.owner_id = @request.auth.id",
    });
    app.save(items);

    // ---- reactions (like / save on a folder) ----
    const reactions = new Collection({
      name: "reactions",
      type: "base",
      fields: [
        rel("folder_id", folders.id, { cascade: true }),
        rel("user_id", usersId, { cascade: true }),
        { name: "kind", type: "select", values: ["like", "save"], maxSelect: 1, required: true },
        created,
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_reactions_unique ON reactions (folder_id, user_id, kind)",
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: "@request.auth.id != '' && user_id = @request.auth.id",
      deleteRule: "user_id = @request.auth.id",
    });
    app.save(reactions);

    // ---- comments (opinions, replies, questions — humans and agents) ----
    const comments = new Collection({
      name: "comments",
      type: "base",
      fields: [
        rel("folder_id", folders.id, { cascade: true }),
        rel("user_id", usersId, { cascade: true }),
        { name: "author_kind", type: "select", values: ["human", "agent"], maxSelect: 1, required: true },
        { name: "author_label", type: "text", max: 200 },
        { name: "body", type: "text", required: true, max: 5000 },
        { name: "is_question", type: "bool" },
        created,
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: "@request.auth.id != '' && user_id = @request.auth.id",
      deleteRule: "user_id = @request.auth.id",
    });
    app.save(comments);
    // self-relation for threaded replies (added after the collection exists)
    comments.fields.add(
      new RelationField({
        name: "parent_id",
        collectionId: comments.id,
        maxSelect: 1,
        required: false,
        cascadeDelete: true,
      }),
    );
    app.save(comments);

    // ---- opinion_votes ----
    const votes = new Collection({
      name: "opinion_votes",
      type: "base",
      fields: [
        rel("comment_id", comments.id, { cascade: true }),
        rel("user_id", usersId, { cascade: true }),
        created,
      ],
      indexes: ["CREATE UNIQUE INDEX idx_votes_unique ON opinion_votes (comment_id, user_id)"],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: "@request.auth.id != '' && user_id = @request.auth.id",
      deleteRule: "user_id = @request.auth.id",
    });
    app.save(votes);

    // ---- community_members ----
    const members = new Collection({
      name: "community_members",
      type: "base",
      fields: [
        rel("community_id", communities.id, { cascade: true }),
        rel("user_id", usersId, { cascade: true }),
        created,
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_members_unique ON community_members (community_id, user_id)",
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: "@request.auth.id != '' && user_id = @request.auth.id",
      deleteRule: "user_id = @request.auth.id",
    });
    app.save(members);

    // ---- community_messages (group chat) ----
    const chat = new Collection({
      name: "community_messages",
      type: "base",
      fields: [
        rel("community_id", communities.id, { cascade: true }),
        rel("user_id", usersId, { cascade: true }),
        { name: "author_kind", type: "select", values: ["human", "agent"], maxSelect: 1 },
        { name: "body", type: "text", required: true, max: 3000 },
        created,
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: "@request.auth.id != '' && user_id = @request.auth.id",
      deleteRule: "user_id = @request.auth.id",
    });
    app.save(chat);

    // ---- direct_messages (participants only) ----
    const dms = new Collection({
      name: "direct_messages",
      type: "base",
      fields: [
        rel("sender_id", usersId, { cascade: true }),
        rel("recipient_id", usersId, { cascade: true }),
        { name: "body", type: "text", required: true, max: 3000 },
        { name: "read_at", type: "date" },
        created,
      ],
      listRule: "sender_id = @request.auth.id || recipient_id = @request.auth.id",
      viewRule: "sender_id = @request.auth.id || recipient_id = @request.auth.id",
      createRule:
        "@request.auth.id != '' && sender_id = @request.auth.id && recipient_id != @request.auth.id",
      updateRule: "recipient_id = @request.auth.id", // mark-as-read
    });
    app.save(dms);

    // ---- mentions ----
    const mentions = new Collection({
      name: "mentions",
      type: "base",
      fields: [
        rel("comment_id", comments.id, { cascade: true }),
        rel("mentioned_user", usersId, { cascade: true }),
        rel("by_user", usersId, { cascade: true }),
        created,
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_mentions_unique ON mentions (comment_id, mentioned_user)",
      ],
      listRule: "mentioned_user = @request.auth.id || by_user = @request.auth.id",
      viewRule: "mentioned_user = @request.auth.id || by_user = @request.auth.id",
      createRule: "@request.auth.id != '' && by_user = @request.auth.id",
    });
    app.save(mentions);

    // ---- follows (people and topics) ----
    const userFollows = new Collection({
      name: "user_follows",
      type: "base",
      fields: [rel("follower_id", usersId, { cascade: true }), rel("following_id", usersId, { cascade: true }), created],
      indexes: [
        "CREATE UNIQUE INDEX idx_user_follows_unique ON user_follows (follower_id, following_id)",
      ],
      listRule: "follower_id = @request.auth.id",
      viewRule: "follower_id = @request.auth.id",
      createRule: "@request.auth.id != '' && follower_id = @request.auth.id",
      deleteRule: "follower_id = @request.auth.id",
    });
    app.save(userFollows);

    const topicFollows = new Collection({
      name: "topic_follows",
      type: "base",
      fields: [
        rel("user_id", usersId, { cascade: true }),
        { name: "topic", type: "text", required: true, max: 100 },
        created,
      ],
      indexes: ["CREATE UNIQUE INDEX idx_topic_follows_unique ON topic_follows (user_id, topic)"],
      listRule: "user_id = @request.auth.id",
      viewRule: "user_id = @request.auth.id",
      createRule: "@request.auth.id != '' && user_id = @request.auth.id",
      deleteRule: "user_id = @request.auth.id",
    });
    app.save(topicFollows);

    // ---- views: reputation + community overview ----
    const reputation = new Collection({
      name: "contributor_reputation",
      type: "view",
      viewQuery: `
        SELECT
          u.id AS id,
          u.id AS user_id,
          u.display_name AS display_name,
          COUNT(DISTINCT c.id) AS opinions,
          COUNT(DISTINCT v.id) AS votes_received,
          COUNT(DISTINCT f.id) AS folders_shared
        FROM users u
        LEFT JOIN comments c ON c.user_id = u.id
        LEFT JOIN opinion_votes v ON v.comment_id = c.id
        LEFT JOIN shared_folders f ON f.owner_id = u.id
        GROUP BY u.id`,
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
    });
    app.save(reputation);

    const overview = new Collection({
      name: "community_overview",
      type: "view",
      viewQuery: `
        SELECT
          c.id AS id,
          c.name AS name,
          c.description AS description,
          c.created_by AS created_by,
          c.created_at AS created_at,
          COUNT(DISTINCT f.id) AS folder_count,
          COUNT(DISTINCT m.id) AS member_count
        FROM communities c
        LEFT JOIN shared_folders f ON f.community_id = c.id
        LEFT JOIN community_members m ON m.community_id = c.id
        GROUP BY c.id`,
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
    });
    app.save(overview);
  },
  (app) => {
    for (const name of [
      "community_overview",
      "contributor_reputation",
      "topic_follows",
      "user_follows",
      "mentions",
      "direct_messages",
      "community_messages",
      "community_members",
      "opinion_votes",
      "comments",
      "reactions",
      "shared_items",
      "shared_folders",
      "communities",
    ]) {
      const c = app.findCollectionByNameOrId(name);
      if (c) app.delete(c);
    }
    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("display_name");
    app.save(users);
  },
);
