import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rootDir = process.cwd();

if (!serviceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
}

async function readJson(filePath) {
  const text = await readFile(resolve(rootDir, filePath), 'utf8');
  return JSON.parse(text);
}

async function readSupabaseConfig() {
  const config = await readJson('supabase/config.json');
  const supabaseUrl = String(config.baseUrl || '').replace(/\/+$/, '');
  const tableName = String(config.tableName || 'files').trim() || 'files';

  if (!supabaseUrl) {
    throw new Error('supabase/config.json is missing baseUrl');
  }

  return { supabaseUrl, tableName };
}

async function upsertRow(supabaseUrl, tableName, fileName, data) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${tableName}?on_conflict=file_name`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      file_name: fileName,
      data
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upsert ${fileName}: ${response.status} ${errorText}`);
  }
}

async function main() {
  const { supabaseUrl, tableName } = await readSupabaseConfig();
  const people = await readJson('supabase/People.json');
  const teams = await readJson('supabase/Teams.json');

  await upsertRow(supabaseUrl, tableName, 'People.json', people);
  await upsertRow(supabaseUrl, tableName, 'Teams.json', teams);

  console.log('Supabase sync complete.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
