import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    include: { organizationMemberships: { include: { organization: true } } }
  });
  
  for (const user of users) {
    console.log(`User: ${user.email}`);
    const org = user.organizationMemberships[0]?.organization;
    console.log(`  Org: ${org?.name}`);
    console.log(`  Settings:`, JSON.stringify(org?.settings));
  }
}

main().finally(() => prisma.$disconnect());
