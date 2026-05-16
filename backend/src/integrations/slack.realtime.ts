import { SocketModeClient } from '@slack/socket-mode';
import { prisma } from '../config/database';
import { getIO } from '../socket';
import { SlackService } from '../services/slack.service';

let started = false;
let client: SocketModeClient | null = null;

// Cache map to avoid hammering DB for every single message
// Slack TeamID -> Producteev OrgID
const teamToOrgCache = new Map<string, string>();
const orgToBotTokenCache = new Map<string, { token: string; expiresAt: number }>();
const slackUserCache = new Map<string, { name: string; avatar: string | null; expiresAt: number }>();

async function getOrgBotToken(orgId: string) {
  const now = Date.now();
  const hit = orgToBotTokenCache.get(orgId);
  if (hit && hit.expiresAt > now) return hit.token;
  const org: any = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, settings: true } });
  const fromDb = String(org?.settings?.slack?.botToken || '').trim();
  const env = String(process.env.SLACK_BOT_TOKEN || '').trim();
  const token = fromDb || env;
  orgToBotTokenCache.set(orgId, { token, expiresAt: now + 10 * 60 * 1000 });
  return token;
}

async function getSlackUser(orgId: string, botToken: string, userId: string) {
  const key = `${orgId}:${userId}`;
  const hit = slackUserCache.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit;
  const p = await SlackService.getUserProfile(botToken, userId);
  const val = { name: p.name, avatar: p.avatar, expiresAt: now + 10 * 60 * 1000 };
  slackUserCache.set(key, val);
  return val;
}

export async function refreshSlackTeamCache() {
  try {
    const orgs = await prisma.organization.findMany({ select: { id: true, settings: true } });
    for (const org of orgs as any[]) {
      const teamId = org?.settings?.slack?.teamId;
      if (teamId) {
        teamToOrgCache.set(teamId, org.id);
      }
    }
  } catch (err) {
    console.error('Failed to refresh slack team cache', err);
  }
}

export function startSlackRealtime() {
  if (started) return;
  const appToken = String(process.env.SLACK_APP_TOKEN || '').trim();
  const envBotToken = String(process.env.SLACK_BOT_TOKEN || '').trim();
  if (!appToken) {
    // Socket Mode not configured → no realtime from Slack app → website
    console.log('[SlackRealtime] Socket Mode disabled (missing SLACK_APP_TOKEN)');
    return;
  }
  console.log('[SlackRealtime] Starting Socket Mode clients…');

  client = new SocketModeClient({ appToken });

  client.on('slack_event', async ({ ack, type, body, event }: any) => {
    // If the event is a message, handle it
    // Note: some types don't require an explicit ack() with socket-mode, but events_api types typically do.
    await ack();
    
    const evt = event || body?.event;
    try {
      if (!evt || !evt.type) return;
      const teamId = body?.team_id || evt?.team;
      if (!teamId) return;

      let orgId = teamToOrgCache.get(teamId);
      
      // Cache miss? Refresh cache and try again.
      if (!orgId) {
        await refreshSlackTeamCache();
        orgId = teamToOrgCache.get(teamId);
      }

      if (!orgId) {
        // Fallback for local development if the user put tokens in .env but didn't finish OAuth
        // Broadcast globally and let the frontend filter by channel
        // Channel lifecycle events → trigger refresh
        if (String(evt.type).startsWith('channel_') || String(evt.type).startsWith('group_')) {
          getIO().emit('slack:channels_changed', { orgId: undefined, reason: String(evt.type) });
          return;
        }

        // Message events
        if (evt.type !== 'message') return;
        if (!evt.channel) return;
        const subtype = evt.subtype ? String(evt.subtype) : '';
        if (subtype === 'message_deleted') {
          getIO().emit('slack:message_deleted', {
            orgId: undefined,
            channelId: evt.channel,
            deletedTs: String(evt.deleted_ts || evt.previous_message?.ts || ''),
          });
          return;
        }
        // Allow normal messages and file shares. Ignore edits/other subtypes.
        if (subtype && !['file_share'].includes(subtype)) return;
        const hasFiles = Array.isArray(evt.files) && evt.files.length > 0;
        if (!evt.text && !hasFiles) return;
        getIO().emit('slack:message', {
          orgId: undefined,
          channelId: evt.channel,
          ts: evt.ts,
          text: evt.text,
          user: evt.user || null,
          userName: null,
          userAvatar: null,
        });
        return;
      }

      // Emit only to that org room
      const botToken = await getOrgBotToken(orgId);

      // Channel lifecycle events → trigger refresh
      if (String(evt.type).startsWith('channel_') || String(evt.type).startsWith('group_')) {
        getIO().to(`org:${orgId}`).emit('slack:channels_changed', { orgId, reason: String(evt.type) });
        return;
      }

      // Message events only below
      if (evt.type !== 'message') return;
      if (!evt.channel) return;
      const subtype = evt.subtype ? String(evt.subtype) : '';

      // Handle delete events
      if (subtype === 'message_deleted') {
        getIO().to(`org:${orgId}`).emit('slack:message_deleted', {
          orgId,
          channelId: evt.channel,
          deletedTs: String(evt.deleted_ts || evt.previous_message?.ts || ''),
        });
        return;
      }

      // Allow normal messages and file shares. Ignore edits/other subtypes for now.
      if (subtype && !['file_share'].includes(subtype)) return;
      const hasFiles = Array.isArray(evt.files) && evt.files.length > 0;
      if (!evt.text && !hasFiles) return;

      try {
        console.log(`[SlackRealtime] message event org=${orgId} channel=${evt.channel} ts=${evt.ts} subtype=${subtype || 'none'}`);
      } catch {}

      let userName: string | null = null;
      let userAvatar: string | null = null;
      try {
        if (botToken && evt.user) {
          const p = await getSlackUser(orgId, botToken, String(evt.user));
          userName = p.name;
          userAvatar = p.avatar;
        }
      } catch {}
      getIO().to(`org:${orgId}`).emit('slack:message', {
        orgId,
        channelId: evt.channel,
        ts: evt.ts,
        text: evt.text || '',
        user: evt.user || null,
        userName,
        userAvatar,
        file: hasFiles
          ? {
              id: String(evt.files[0]?.id || ''),
              name: String(evt.files[0]?.name || evt.files[0]?.title || evt.files[0]?.id || 'file'),
              mimetype: String(evt.files[0]?.mimetype || ''),
            }
          : null,
      });
    } catch {
      // non-fatal
    }
  });

  client.start()
    .then(() => {
      started = true;
      refreshSlackTeamCache();
      console.log('Slack Socket Mode started successfully.');
    })
    .catch((err) => {
      console.error('[SlackRealtime] Failed to init clients:', (err as any)?.message || err);
    });
}

