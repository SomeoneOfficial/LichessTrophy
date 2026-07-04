# Supabase Data

This folder is the Supabase-ready home for the extension data.

## Files

- `config.json`: set your Supabase project URL and table name.
- `seed.sql`: inserts the two JSON rows.
- `migrations/`: SQL for the single `files` table.

## Expected public URLs

When `config.json` is filled in, the extension will load:

- one table named `files` from `https://<project-ref>.supabase.co/rest/v1/files?select=*`
- one row with `file_name = people.json`
- one row with `file_name = teams.json`

## Notes

- No secret keys belong in this folder or the extension bundle.
- For GitHub auto-sync, add these repo secrets:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
