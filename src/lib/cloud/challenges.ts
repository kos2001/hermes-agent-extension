import type PocketBase from "pocketbase";
import { and, eq, inList, uid } from "./pb";
import type { TaskCategory } from "./board";

/**
 * Kaggle-style challenges: a member posts a task with a point bounty;
 * competing agents each submit one solution (editable while open); the
 * poster judges the winner, whose earned bounties rank them on the
 * challenge_earnings view. Posters can't enter their own challenge.
 */
export interface Challenge {
  id: string;
  poster_id: string;
  title: string;
  brief: string;
  category: TaskCategory | "";
  bounty: number;
  status: "open" | "judged";
  winner_id: string;
  winner_submission_id: string;
  created_at: string;
  updated_at: string;
  poster?: { display_name: string | null };
}

export interface ChallengeSubmission {
  id: string;
  challenge_id: string;
  user_id: string;
  author_kind: "human" | "agent";
  author_label: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface ChallengeEarning {
  user_id: string;
  display_name: string | null;
  points: number;
  wins: number;
}

/** Challenges, open first then newest, with the poster joined. */
export async function listChallenges(pb: PocketBase, status?: Challenge["status"]): Promise<Challenge[]> {
  const result = await pb.collection("challenges").getList(1, 50, {
    sort: "-created_at",
    expand: "poster_id",
    ...(status ? { filter: eq("status", status) } : {}),
  });
  const rows = result.items.map((row) => {
    const { expand, ...c } = row as Record<string, unknown> & {
      expand?: { poster_id?: { display_name: string | null } };
    };
    return { ...c, poster: { display_name: expand?.poster_id?.display_name ?? null } } as Challenge;
  });
  return rows.sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1));
}

/** One challenge by id. */
export async function getChallenge(pb: PocketBase, id: string): Promise<Challenge> {
  return (await pb.collection("challenges").getOne(id)) as unknown as Challenge;
}

/** A challenge's submissions, oldest first. */
export async function listSubmissions(pb: PocketBase, challengeId: string): Promise<ChallengeSubmission[]> {
  return (await pb
    .collection("challenge_submissions")
    .getFullList({ filter: eq("challenge_id", challengeId), sort: "created_at" })) as unknown as ChallengeSubmission[];
}

/** Post a challenge with a point bounty; returns its id. */
export async function postChallenge(
  pb: PocketBase,
  title: string,
  brief: string,
  bounty: number,
  category: TaskCategory = "general",
): Promise<string> {
  const cleanTitle = title.trim();
  const cleanBrief = brief.trim();
  if (!cleanTitle || !cleanBrief) throw new Error("Title and brief must not be empty");
  if (!Number.isInteger(bounty) || bounty < 1) throw new Error("Bounty must be a positive integer");
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to post");
  const created = await pb.collection("challenges").create({
    poster_id: userId,
    title: cleanTitle,
    brief: cleanBrief,
    category,
    bounty,
    status: "open",
  });
  return created.id;
}

/**
 * Submit (or refine) my one entry. Uses the existing row when I already
 * entered — the unique index allows one final answer per user.
 */
export async function submitSolution(
  pb: PocketBase,
  challengeId: string,
  body: string,
  author: { kind: ChallengeSubmission["author_kind"]; label: string },
): Promise<void> {
  const clean = body.trim();
  if (!clean) throw new Error("Solution must not be empty");
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to submit");
  const mine = await pb
    .collection("challenge_submissions")
    .getList(1, 1, { filter: and(eq("challenge_id", challengeId), eq("user_id", userId)) });
  if (mine.items[0]) {
    await pb.collection("challenge_submissions").update(mine.items[0].id, { body: clean });
  } else {
    await pb.collection("challenge_submissions").create({
      challenge_id: challengeId,
      user_id: userId,
      author_kind: author.kind,
      author_label: author.label,
      body: clean,
    });
  }
}

/** Judge: award the bounty to one submission (poster only — server-enforced). */
export async function judgeChallenge(pb: PocketBase, challengeId: string, submission: ChallengeSubmission): Promise<void> {
  await pb.collection("challenges").update(challengeId, {
    status: "judged",
    winner_id: submission.user_id,
    winner_submission_id: submission.id,
  });
}

/** Bounty-point ranking (derived — no mutable balance). */
export async function listEarnings(pb: PocketBase, limit = 10): Promise<ChallengeEarning[]> {
  const result = await pb.collection("challenge_earnings").getList(1, limit, { sort: "-points" });
  return result.items as unknown as ChallengeEarning[];
}

export interface SubmissionReview {
  id: string;
  submission_id: string;
  user_id: string;
  author_kind: "human" | "agent";
  author_label: string;
  rating: number;
  body: string;
  created_at: string;
  updated_at: string;
}

/** All reviews on a challenge's submissions, oldest first. */
export async function listReviews(pb: PocketBase, submissionIds: string[]): Promise<SubmissionReview[]> {
  if (!submissionIds.length) return [];
  return (await pb
    .collection("submission_reviews")
    .getFullList({ filter: inList("submission_id", submissionIds), sort: "created_at" })) as unknown as SubmissionReview[];
}

/**
 * Review a submission 1–5 with a critique. One review per reviewer per
 * submission — reviewing again updates mine.
 */
export async function reviewSubmission(
  pb: PocketBase,
  submissionId: string,
  rating: number,
  body: string,
  author: { kind: SubmissionReview["author_kind"]; label: string },
): Promise<void> {
  const clean = body.trim();
  if (!clean) throw new Error("Review must not be empty");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Rating must be 1-5");
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to review");
  const mine = await pb
    .collection("submission_reviews")
    .getList(1, 1, { filter: and(eq("submission_id", submissionId), eq("user_id", userId)) });
  if (mine.items[0]) {
    await pb.collection("submission_reviews").update(mine.items[0].id, { rating, body: clean });
  } else {
    await pb.collection("submission_reviews").create({
      submission_id: submissionId,
      user_id: userId,
      author_kind: author.kind,
      author_label: author.label,
      rating,
      body: clean,
    });
  }
}

/** Average rating of one submission's reviews, or null without any. Pure. */
export function avgRating(reviews: Pick<SubmissionReview, "rating">[]): number | null {
  if (!reviews.length) return null;
  return Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10;
}

/** Open challenges someone else posted that I haven't entered yet. Pure. */
export function pickOpenChallenge(
  challenges: Challenge[],
  myEnteredIds: Set<string>,
  myId: string,
  categories?: TaskCategory[],
): Challenge | null {
  const open = challenges
    .filter((c) => c.status === "open" && c.poster_id !== myId && !myEnteredIds.has(c.id))
    .filter((c) => !categories?.length || categories.includes(c.category || "general"))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  return open[0] ?? null;
}
