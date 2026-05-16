import { execSync } from 'child_process';

function resolveMigrationDatabaseUrl() {
  const internalUrl = process.env.DATABASE_URL;
  const publicUrl = process.env.DATABASE_PUBLIC_URL;

  if (internalUrl && internalUrl.includes('postgres.railway.internal') && publicUrl) {
    return publicUrl;
  }

  return internalUrl || publicUrl;
}

function runPrisma(args) {
  try {
    const result = execSync(`npx prisma ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DATABASE_URL: migrationDatabaseUrl,
      },
    });
    console.log(result);
    return { success: true, output: result };
  } catch (error) {
    return { success: false, output: error.message || error.toString(), stderr: error.stderr };
  }
}

const migrationDatabaseUrl = resolveMigrationDatabaseUrl();

if (!migrationDatabaseUrl) {
  console.error('[Migrations] No database URL available for Prisma migrate deploy');
  process.exit(1);
}

console.log(`[Migrations] Using database URL: ${migrationDatabaseUrl.includes('postgres.railway.internal') ? 'internal' : 'public/proxy'}`);

function baselineDatabase() {
  console.log('[Migrations] Attempting to baseline database by marking all migrations as applied...');
  
  const migrations = [
    '20260315_init',
    '20260316_add_spaces_and_hierarchy',
    '20260319_add_message_read_at',
    '20260320_add_activities',
    '20260320_add_attachments',
    '20260320_add_comments',
    '20260320_add_time_entries',
    '20260401051834_update_task_statuses',
    '20260402055218_add_granular_memberships',
    '20260402082900_add_granular_permissions_v2',
    '20260417065855_pms',
    '20260422044123_set_task_priority_default',
    '20260509000000_add_uploads_table',
    '20260509003000_fix_schema_drift',
  ];
  
  for (const migration of migrations) {
    console.log(`[Migrations] Marking as applied: ${migration}`);
    const result = runPrisma(['migrate', 'resolve', '--applied', migration]);
    if (!result.success) {
      console.log(`[Migrations] Migration ${migration}: ${result.output}`);
    }
  }
  
  console.log('[Migrations] Baseline complete. Retrying migrate deploy...');
  const deployResult = runPrisma(['migrate', 'deploy']);
  if (deployResult.success) {
    console.log('[Migrations] Deploy successful after baseline');
    console.log(deployResult.output);
    return true;
  } else {
    console.error('[Migrations] Deploy still failed after baseline:', deployResult.output);
    return false;
  }
}

try {
  const result = runPrisma(['migrate', 'deploy']);
  if (result.success) {
    console.log('[Migrations] Deploy successful');
    console.log(result.output);
    process.exit(0);
  } else {
    throw new Error(result.output);
  }
} catch (error) {
  const errorMsg = error.toString();
  console.log('[Migrations] First migration attempt failed, checking for P3005...');
  console.log('[Migrations] Error output:', errorMsg);
  
  // Check if this is a P3005 error (database schema not empty) - indicates baseline needed
  if (errorMsg.includes('P3005') || errorMsg.includes('Database schema is not empty')) {
    console.warn('[Migrations] P3005 Error detected. Attempting automatic baseline...');
    const success = baselineDatabase();
    process.exit(success ? 0 : 1);
  }
  
  // Check if this is an invariant violation with no migrations table
  if (errorMsg.includes('markMigrationRolledBack') || errorMsg.includes('without migrations table')) {
    console.warn('[Migrations] Migrations table issue detected. Attempting to initialize...');
    const success = baselineDatabase();
    process.exit(success ? 0 : 1);
  }
  
  // Unknown error
  console.error('[Migrations] Unexpected error during migration deploy:');
  console.error(error);
  process.exit(1);
}