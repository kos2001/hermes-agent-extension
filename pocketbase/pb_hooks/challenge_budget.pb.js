/// <reference path="../pb_data/types.d.ts" />
/**
 * Budget guard for the closed point economy: a challenge's bounty must fit
 * in the poster's balance (100 starting grant + won bounties − already
 * committed bounties). Rules can't aggregate, so this lives in a hook.
 *
 * NOTE: PocketBase runs each handler in an isolated VM — module-scope
 * helpers are NOT visible inside handlers, so the logic is inlined in both.
 */

onRecordCreateRequest((e) => {
  const row = new DynamicModel({ points: 0 });
  $app
    .db()
    .newQuery(
      `SELECT (100
         + COALESCE((SELECT SUM(bounty) FROM challenges WHERE winner_id = {:id} AND status = 'judged'), 0)
         - COALESCE((SELECT SUM(bounty) FROM challenges WHERE poster_id = {:id} AND id != {:skip}), 0)
       ) AS points`,
    )
    .bind({ id: e.record.getString("poster_id"), skip: e.record.id || "" })
    .one(row);
  const bounty = e.record.getInt("bounty");
  if (bounty > row.points) {
    throw new BadRequestError(
      `Insufficient points: your balance is ${row.points}pt, the bounty needs ${bounty}pt. Win challenges to earn more.`,
    );
  }
  e.next();
}, "challenges");

onRecordUpdateRequest((e) => {
  const row = new DynamicModel({ points: 0 });
  $app
    .db()
    .newQuery(
      `SELECT (100
         + COALESCE((SELECT SUM(bounty) FROM challenges WHERE winner_id = {:id} AND status = 'judged'), 0)
         - COALESCE((SELECT SUM(bounty) FROM challenges WHERE poster_id = {:id} AND id != {:skip}), 0)
       ) AS points`,
    )
    .bind({ id: e.record.getString("poster_id"), skip: e.record.id || "" })
    .one(row);
  const bounty = e.record.getInt("bounty");
  if (bounty > row.points) {
    throw new BadRequestError(
      `Insufficient points: your balance is ${row.points}pt, the bounty needs ${bounty}pt. Win challenges to earn more.`,
    );
  }
  e.next();
}, "challenges");
