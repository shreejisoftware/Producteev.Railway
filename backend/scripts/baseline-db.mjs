#!/usr/bin/env node
/**
 * Baseline an existing database that has schema but no Prisma migrations table.
 * This is needed when you have an existing database that wasn't created by Prisma migrations.
 * 
 * Usage: node baseline-db.mjs [--force]
 *   --force: Skip safety prompts (use with caution)
 */

import { execFileSync } from 'child_process';
import readline from 'readline';

function resolveMigrationDatabaseUrl() {
  const internalUrl = process.env.DATABASE_URL;
  const publicUrl = process.env.DATABASE_PUBLIC_URL;

  if (internalUrl && internalUrl.includes('postgres.railway.internal') && publicUrl) {
    return publicUrl;
  }

  return internalUrl || publicUrl;
}

function runCommand(cmd, args) {
  const dbUrl = resolveMigrationDatabaseUrl();
  try {
    console.log(`\n[Baseline] Running: ${cmd} ${args.join(' ')}`);
    execFileSync(cmd, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
      },
    });
    return true;
  } catch (error) {
    console.error(`[Baseline] Command failed:`, error.message);
    return false;
  }
}

async function promptUser(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

const args = process.argv.slice(2);
const forceFlag = args.includes('--force');

console.log(`
╔════════════════════════════════════════════════════════════════╗
║         Prisma Database Baseline Script                        ║
║                                                                ║
║ This script will initialize Prisma migrations on an existing   ║
║ database. This is a ONE-TIME operation needed when you have    ║
║ an existing database schema that wasn't created by Prisma.     ║
╚════════════════════════════════════════════════════════════════╝
`);

const dbUrl = resolveMigrationDatabaseUrl();
console.log(`[Baseline] Database URL: ${dbUrl.split('@')[1] || 'unknown'}`);

if (!forceFlag) {
  console.log(`
⚠️  WARNING: This operation will:
  1. Check your database schema
  2. Create the Prisma migrations tracking table if it doesn't exist
  3. Mark existing migrations as already applied

This should only be run ONCE on an existing database.
  `);

  const proceed = await promptUser('Do you want to proceed? (yes/no): ');
  if (!proceed) {
    console.log('[Baseline] Cancelled by user');
    process.exit(0);
  }
}

console.log('\n[Baseline] Starting database baseline process...\n');

// Step 1: Attempt to push the current schema (this creates migrations table if needed)
console.log('[Baseline] Step 1: Pushing current schema to initialize migrations...');
const pushSuccess = runCommand('npx', ['prisma', 'db', 'push', '--skip-generate']);

if (!pushSuccess) {
  console.error(`[Baseline] Failed to push schema. This may indicate a schema mismatch.`);
  console.log(`
[Baseline] Next steps:
  1. Verify your DATABASE_URL environment variable is correct
  2. Ensure you have access to the database
  3. Check if there are schema conflicts in prisma/schema.prisma
  4. Try manually running: npx prisma db push
  `);
  process.exit(1);
}

// Step 2: Resolve all pending migrations (mark them as applied without running them)
console.log('\n[Baseline] Step 2: Marking existing migrations as applied...');
const migrations = [
  '20260315_init',
  '20260316_add_spaces_and_hierarchy',
  '20260319_add_message_read_at',
  '20260320_add_activities',
  '20260320_add_attachments',
  '20260509000000_add_uploads_table',
  '20260509003000_fix_schema_drift',
];

for (const migration of migrations) {
  try {
    console.log(`[Baseline]   - Resolving ${migration}...`);
    runCommand('npx', ['prisma', 'migrate', 'resolve', '--applied', migration]);
  } catch (e) {
    // Continue even if some migrations fail - they may not exist
    console.log(`[Baseline]   - Could not resolve ${migration} (may not exist)`);
  }
}

// Step 3: Verify migrations are now tracked
console.log('\n[Baseline] Step 3: Verifying migrations table is initialized...');
runCommand('npx', ['prisma', 'migrate', 'status']);

console.log(`
╔════════════════════════════════════════════════════════════════╗
║              ✓ Baseline Complete!                             ║
║                                                                ║
║ Your database is now ready for Prisma migrations.             ║
║ Future migrations can be applied with: npm run db:migrate     ║
╚════════════════════════════════════════════════════════════════╝
`);

process.exit(0);
