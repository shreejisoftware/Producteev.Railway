import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'shreejisoftware1@gmail.com' },
    include: { organizationMemberships: { include: { organization: true } } }
  });
  
  if (!user || user.organizationMemberships.length === 0) return;
  const orgId = user.organizationMemberships[0].organizationId;
  
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      settings: {
        slack: {
          connected: true,
          botToken: 'dummy_token'
        }
      }
    }
  });
  console.log('Dummy token injected.');
}

main().finally(() => prisma.$disconnect());
