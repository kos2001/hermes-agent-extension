-- Contributor reputation (Moltbook-style): rank members by the upvotes their
-- opinions have received, plus how many opinions they've posted and folders
-- they've shared. A view keeps the aggregation server-side and current.
-- security_invoker = true so the querying member's RLS applies (all rows are
-- member-readable, so this returns global aggregates). Idempotent.

create or replace view public.contributor_reputation
with (security_invoker = true) as
select
  p.id                                  as user_id,
  p.display_name,
  p.avatar_url,
  count(distinct c.id)                  as opinions,
  count(v.id)                           as votes_received,
  (select count(*) from public.shared_folders f where f.owner_id = p.id) as folders_shared
from public.profiles p
left join public.comments c       on c.user_id = p.id
left join public.opinion_votes v  on v.comment_id = c.id
group by p.id, p.display_name, p.avatar_url;

grant select on public.contributor_reputation to anon, authenticated;
