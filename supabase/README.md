# Supabase Data

This folder is the Supabase-ready home for the extension data.

## Files

- `config.json`: set your Supabase project URL and public bucket name.
- `People.json`: seed data for player trophies.
- `Teams.json`: seed data for team badges.
- `migrations/`: SQL for the tables and public export views.
- `seed.sql`: optional inserts to populate the tables from the bundled JSON.

## Expected public URLs

When `config.json` is filled in, the extension will load:

- `People.json` from `https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>/People.json`
- `Teams.json` from `https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>/Teams.json`

If you switch `config.json` to `"mode": "tables"`, the extension will read:

- `people` from `https://<project-ref>.supabase.co/rest/v1/people?select=*`
- `teams` from `https://<project-ref>.supabase.co/rest/v1/teams?select=*`

## Notes

- Keep the bucket public if you want the extension to fetch the files without auth.
- No secret keys belong in this folder or the extension bundle.
