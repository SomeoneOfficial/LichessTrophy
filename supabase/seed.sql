insert into public.people (username, title, display_name, flair, click_href, trophies)
values (
  'ajisland',
  'LG',
  '',
  '',
  '/player/top/blitz',
  '[
  {
    "url": "https://github.com/SomeoneOfficial/LichessTrophy/blob/main/Badges/OriginalCreator.png?raw=true",
    "clickUrl": "/player/top/blitz",
    "title": "Original Creator Of LichessTrophy",
    "className": "trophy perf top1",
    "content": "Original Creator Of LichessTrophy",
    "offsetX": 10,
    "offsetY": 5,
    "scale": 4
  }
]'::jsonb
)
on conflict (username) do update set
  title = excluded.title,
  display_name = excluded.display_name,
  flair = excluded.flair,
  click_href = excluded.click_href,
  trophies = excluded.trophies;

insert into public.teams (slug, name, click_href, badges)
values (
  'the-chess-fan-club',
  'The Chess Fan Club',
  '/team/the-chess-fan-club/members',
  '[
  {
    "url": "https://lichess1.org/assets/______4/flair/img/activity.chess.webp",
    "clickUrl": "/team/the-chess-fan-club/members",
    "title": "The Chess Fan Club",
    "className": "trophy perf top1",
    "content": "",
    "offsetX": 3,
    "offsetY": -1,
    "scale": 1
  }
]'::jsonb
)
on conflict (slug) do update set
  name = excluded.name,
  click_href = excluded.click_href,
  badges = excluded.badges;
