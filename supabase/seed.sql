insert into public.people (username, title, display_name, flair, click_href)
values ('ajisland', 'LG', '', '', '/player/top/blitz')
on conflict (username) do update set
  title = excluded.title,
  display_name = excluded.display_name,
  flair = excluded.flair,
  click_href = excluded.click_href;

insert into public.trophies (
  username,
  url,
  click_url,
  title,
  class_name,
  content,
  offset_x,
  offset_y,
  scale,
  sort_order
)
values (
  'ajisland',
  'https://github.com/SomeoneOfficial/LichessTrophy/blob/main/Badges/OriginalCreator.png?raw=true',
  '/player/top/blitz',
  'Original Creator Of LichessTrophy',
  'trophy perf top1',
  'Original Creator Of LichessTrophy',
  10,
  5,
  4,
  0
)
on conflict do nothing;

insert into public.teams (slug, name, click_href)
values ('the-chess-fan-club', 'The Chess Fan Club', '/team/the-chess-fan-club/members')
on conflict (slug) do update set
  name = excluded.name,
  click_href = excluded.click_href;

insert into public.team_badges (
  team_slug,
  url,
  click_url,
  title,
  class_name,
  content,
  offset_x,
  offset_y,
  scale,
  sort_order
)
values (
  'the-chess-fan-club',
  'https://lichess1.org/assets/______4/flair/img/activity.chess.webp',
  '/team/the-chess-fan-club/members',
  'The Chess Fan Club',
  'trophy perf top1',
  '',
  3,
  -1,
  1,
  0
)
on conflict do nothing;
