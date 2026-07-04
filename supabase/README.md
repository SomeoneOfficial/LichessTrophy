# Supabase Data

This folder is the Supabase-ready home for the extension data.

## Files

- `config.json`: set your Supabase project URL and public bucket name.
- `People.json`: seed data for player trophies.
- `Teams.json`: seed data for team badges.

## Expected public URLs

When `config.json` is filled in, the extension will load:

- `People.json` from `https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>/People.json`
- `Teams.json` from `https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>/Teams.json`

## Notes

- Keep the bucket public if you want the extension to fetch the files without auth.
- No secret keys belong in this folder or the extension bundle.
