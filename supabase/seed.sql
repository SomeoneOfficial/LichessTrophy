insert into public.files (file_name, data)
values (
  'people.json',
  '[
    {
      "username": "Ajisland",
      "title": "LG",
      "displayName": "",
      "flair": "",
      "clickHref": "/player/top/blitz",
      "trophies": [
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
      ]
    }
  ]'::jsonb
)
on conflict (file_name) do update set
  data = excluded.data;

insert into public.files (file_name, data)
values (
  'teams.json',
  '[
    {
      "team": "the-chess-fan-club",
      "name": "The Chess Fan Club",
      "clickHref": "/team/the-chess-fan-club/members",
      "badges": [
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
      ]
    }
  ]'::jsonb
)
on conflict (file_name) do update set
  data = excluded.data;
