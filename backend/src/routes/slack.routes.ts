import { Router } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { WebClient } from '@slack/web-api';
import { authenticate } from '../middleware/auth';
import { config } from '../config';
import { prisma } from '../config/database';
import { getIO } from '../socket';
import path from 'path';
import { SlackService } from '../services/slack.service';
import { refreshSlackTeamCache } from '../integrations/slack.realtime';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { OrgRole } from '@prisma/client';

const router = Router();

// OAuth callbacks are called by Slack (no auth header), so do not apply auth globally.
const slackUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

function uploadDisplayName(raw: string) {
  const s = String(raw || '').trim() || 'file';
  const normalized = s.replace(/\\/g, '/');
  const base = path.basename(normalized);
  return base.trim() || 'file';
}

function normalizeSlackTeamId(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return /^T[A-Z0-9]{8,}$/i.test(s) ? s : null;
}

async function resolveSlackOAuthTeamId(orgId: string, queryTeam?: unknown): Promise<string | null> {
  const fromQuery = normalizeSlackTeamId(queryTeam);
  if (fromQuery) return fromQuery;
  const fromEnv = normalizeSlackTeamId(process.env.SLACK_TEAM_ID || process.env.SLACK_WORKSPACE_TEAM_ID);
  if (fromEnv) return fromEnv;

  const org: any = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const settingsRaw = org?.settings && typeof org.settings === 'object' ? org.settings : {};
  const fromSettings = normalizeSlackTeamId((settingsRaw as any)?.slack?.teamId);
  if (fromSettings) return fromSettings;

  const botToken = String((settingsRaw as any)?.slack?.botToken || '').trim();
  if (!botToken) return null;

  try {
    const client = new WebClient(botToken);
    const auth: any = await client.auth.test();
    const tid = normalizeSlackTeamId(auth?.team_id);
    if (!tid) return null;
    const settings = { ...settingsRaw };
    settings.slack = { ...(settings.slack || {}), teamId: tid };
    await prisma.organization.update({ where: { id: orgId }, data: { settings } as any });
    return tid;
  } catch {
    return null;
  }
}

async function getOrgSlackToken(orgId: string) {
  const o: any = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, settings: true } });
  const botToken = o?.settings?.slack?.botToken || null;
  return botToken ? String(botToken) : null;
}

async function setOrgSlackToken(orgId: string, token: string, teamId?: string | null, scope?: string | null) {
  const org: any = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, settings: true } });
  if (!org) throw ApiError.badRequest('Organization not found');
  const settings = org.settings || {};
  settings.slack = settings.slack || {};
  settings.slack.botToken = token;
  if (teamId) settings.slack.teamId = teamId;
  if (scope) settings.slack.scope = scope;
  await prisma.organization.update({ where: { id: orgId }, data: { settings } as any });
  try {
    await refreshSlackTeamCache();
  } catch {}
}

async function markSlackDisconnected(orgId: string) {
  const org: any = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, settings: true } });
  if (!org) return;
  const settings = org.settings || {};
  if (settings?.slack) {
    delete settings.slack;
    await prisma.organization.update({ where: { id: orgId }, data: { settings } as any });
    try {
      await refreshSlackTeamCache();
    } catch {}
  }
}

async function getUserSlackToken(orgId: string, userId: string) {
  const u: any = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, settings: true } });
  const settings = u?.settings || {};
  const byOrg = settings?.slackUserTokens?.[orgId];
  const token = byOrg?.token || null;
  return token ? String(token) : null;
}

async function setUserSlackToken(orgId: string, userId: string, token: string, scope?: string | null) {
  const u: any = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, settings: true } });
  if (!u) throw ApiError.badRequest('User not found');
  const settings = u.settings || {};
  settings.slackUserTokens = settings.slackUserTokens || {};
  settings.slackUserTokens[orgId] = { token, scope: scope || null, updatedAt: new Date().toISOString() };
  await prisma.user.update({ where: { id: userId }, data: { settings } as any });
}

async function clearUserSlackToken(orgId: string, userId: string) {
  const u: any = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, settings: true } });
  if (!u) return;
  const settings = u.settings || {};
  if (settings?.slackUserTokens?.[orgId]) {
    delete settings.slackUserTokens[orgId];
    await prisma.user.update({ where: { id: userId }, data: { settings } as any });
  }
}

async function getOrgMember(orgId: string, userId: string) {
  return await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
  });
}

function isPrivilegedRole(role: any) {
  return [OrgRole.OWNER, OrgRole.SUPER_ADMIN, OrgRole.ADMIN].includes(role as OrgRole);
}

async function getChannelAccessMap(orgId: string): Promise<Record<string, string[]>> {
  const org: any = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, settings: true } });
  const settings = org?.settings || {};
  const map = settings?.slackChannelAccess || {};
  return map && typeof map === 'object' ? map : {};
}

async function setChannelAccessMap(orgId: string, map: Record<string, string[]>) {
  const org: any = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, settings: true } });
  if (!org) throw ApiError.badRequest('Organization not found');
  const settings = org.settings || {};
  settings.slackChannelAccess = map;
  await prisma.organization.update({ where: { id: orgId }, data: { settings } as any });
}

// Reduce latency by caching Slack auth.test results briefly.
// Slack API calls can take ~0.5-1.5s, so validating on every request makes the UI feel slow.
const slackAuthTestCache = new Map<string, { okUntil: number }>();
const SLACK_AUTH_TEST_TTL_MS = 60_000;

async function ensureValidSlackToken(orgId: string, botToken: string) {
  try {
    const now = Date.now();
    const cached = slackAuthTestCache.get(botToken);
    if (cached && cached.okUntil > now) return botToken;
    const client = new WebClient(botToken);
    await client.auth.test();
    slackAuthTestCache.set(botToken, { okUntil: now + SLACK_AUTH_TEST_TTL_MS });
    return botToken;
  } catch (err: any) {
    const apiError = err?.data?.error || err?.code || '';
    const msg = String(err?.message || '');
    if (apiError === 'invalid_auth' || msg.includes('invalid_auth')) {
      slackAuthTestCache.delete(botToken);
      await markSlackDisconnected(orgId);
      throw ApiError.badRequest('Slack authorization expired/invalid. Please reconnect Slack.');
    }
    throw ApiError.badRequest(`Slack API error: ${apiError || msg || 'unknown_error'}`);
  }
}

async function ensureValidSlackUserToken(orgId: string, userId: string, token: string) {
  try {
    const now = Date.now();
    const cached = slackAuthTestCache.get(token);
    if (cached && cached.okUntil > now) return token;
    const client = new WebClient(token);
    await client.auth.test();
    slackAuthTestCache.set(token, { okUntil: now + SLACK_AUTH_TEST_TTL_MS });
    return token;
  } catch (err: any) {
    const apiError = err?.data?.error || err?.code || '';
    const msg = String(err?.message || '');
    if (apiError === 'invalid_auth' || msg.includes('invalid_auth')) {
      slackAuthTestCache.delete(token);
      await clearUserSlackToken(orgId, userId);
      throw ApiError.badRequest('Your Slack user authorization expired/invalid. Please connect Slack again.');
    }
    throw ApiError.badRequest(`Slack API error: ${apiError || msg || 'unknown_error'}`);
  }
}

async function runSlackCall<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const apiError = err?.data?.error || err?.code || '';
    const msg = String(err?.message || '');
    if (apiError === 'invalid_auth' || msg.includes('invalid_auth')) {
      await markSlackDisconnected(orgId);
      throw ApiError.badRequest('Slack authorization expired/invalid. Please reconnect Slack.');
    }
    const isMissingScope =
      apiError === 'missing_scope' ||
      apiError === 'insufficient_scope' ||
      msg.includes('missing_scope') ||
      msg.includes('insufficient_scope');
    if (isMissingScope) {
      const needed = String(err?.data?.needed || err?.data?.response_metadata?.needed || '').trim();
      const provided = String(err?.data?.provided || err?.data?.response_metadata?.provided || '').trim();
      const hint = needed ? `Add Slack OAuth scopes: \`${needed}\`` : 'Add required Slack OAuth scopes';
      const providedHint = provided ? ` (currently granted: \`${provided}\`)` : '';
      throw ApiError.badRequest(
        `Slack token is missing required permissions. ${hint}${providedHint}. Then reinstall/re-authorize the Slack app in this workspace and reconnect in Producteev, then retry.`
      );
    }
    throw err;
  }
}

async function exchangeOAuthCode(clientId: string, clientSecret: string, code: string, redirectUri: string) {
  const client = new WebClient();
  return await (client as any).oauth.v2.access({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
}

router.get(
  '/status',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = String((req.query as any)?.orgId || '');
    if (!orgId) return res.json({ success: true, data: { configured: false, oauthReady: SlackService.isOAuthConfigured(), userConnected: false } });
    const botToken = await getOrgSlackToken(orgId);
    if (!botToken) return res.json({ success: true, data: { configured: false, oauthReady: SlackService.isOAuthConfigured(), userConnected: false } });
    try {
      await ensureValidSlackToken(orgId, botToken);
      const userConnected = req.user?.id ? Boolean(await getUserSlackToken(orgId, String(req.user.id))) : false;
      return res.json({ success: true, data: { configured: true, oauthReady: SlackService.isOAuthConfigured(), userConnected } });
    } catch {
      return res.json({ success: true, data: { configured: false, oauthReady: SlackService.isOAuthConfigured(), userConnected: false } });
    }
  })
);

router.get(
  '/user/oauth/start',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = String((req.query as any)?.orgId || '');
    if (!orgId) throw ApiError.badRequest('orgId is required');
    if (!SlackService.isOAuthConfigured()) throw ApiError.badRequest('Slack OAuth is not configured (missing SLACK_CLIENT_ID/SLACK_CLIENT_SECRET)');
    if (!req.user) throw ApiError.unauthorized();

    const allowedOrigins = (config.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
    const isAllowedDevLocalhost = (origin: string) => config.NODE_ENV === 'development' && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    const reqOrigin = String(req.headers.origin || '');
    const reqReferer = String(req.headers.referer || '');
    const fallbackFrontend = allowedOrigins[0] || 'http://localhost:5173';
    const inferredFrontend =
      (reqOrigin && (allowedOrigins.includes(reqOrigin) || isAllowedDevLocalhost(reqOrigin)) ? reqOrigin : '') ||
      (() => {
        try {
          const u = new URL(reqReferer);
          return allowedOrigins.includes(u.origin) || isAllowedDevLocalhost(u.origin) ? u.origin : '';
        } catch {
          return '';
        }
      })() ||
      fallbackFrontend;

    const state = jwt.sign({ orgId, userId: req.user.id, frontend: inferredFrontend, mode: 'user' }, config.JWT_SECRET, { expiresIn: '10m' });
    const redirectUri = process.env.SLACK_USER_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/v1/slack/user/oauth/callback`;
    const clientId = String(process.env.SLACK_CLIENT_ID || '').trim();
    if (!clientId) throw ApiError.badRequest('Slack OAuth is not configured (missing SLACK_CLIENT_ID)');

    // Keep user scopes minimal so they match common workspace-allowed scopes.
    // (Extra scopes must be added in Slack app config or OAuth will fail with invalid_scope.)
    const userScopes = [
      'chat:write',
      'channels:write',
      'channels:read',
      'channels:history',
      'groups:read',
      'groups:history',
      'im:read',
      'im:history',
      'mpim:read',
      'mpim:history',
    ].join(',');

    const teamId = await resolveSlackOAuthTeamId(orgId, (req.query as any)?.team);
    const teamParam = teamId ? `&team=${encodeURIComponent(teamId)}` : '';

    const url =
      `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(clientId)}` +
      `&user_scope=${encodeURIComponent(userScopes)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      teamParam;

    res.json({ success: true, data: { url } });
  })
);

router.post(
  '/user/disconnect',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = String((req.body as any)?.orgId || '');
    if (!orgId) throw ApiError.badRequest('orgId is required');
    if (!req.user?.id) throw ApiError.unauthorized();
    await clearUserSlackToken(orgId, String(req.user.id));
    res.json({ success: true });
  })
);

router.get(
  '/user/oauth/callback',
  asyncHandler(async (req, res) => {
    let safeFrontend = 'http://localhost:5173';
    try {
      const code = String((req.query as any)?.code || '');
      const state = String((req.query as any)?.state || '');

      const allowedOrigins = (config.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
      const isAllowedDevLocalhost = (origin: string) => config.NODE_ENV === 'development' && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
      const fallbackFrontend = allowedOrigins[0] || 'http://localhost:5173';
      safeFrontend = fallbackFrontend;

      if (!code || !state) return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?error=missing_code`);

      let payload: any;
      try {
        payload = jwt.verify(state, config.JWT_SECRET);
      } catch {
        return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?error=invalid_state`);
      }

      const orgId = String(payload?.orgId || '');
      const userId = String(payload?.userId || '');
      const frontend = String(payload?.frontend || fallbackFrontend);
      if (frontend && (allowedOrigins.includes(frontend) || isAllowedDevLocalhost(frontend))) safeFrontend = frontend;
      if (!orgId || !userId) return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?error=invalid_payload`);

      const clientId = String(process.env.SLACK_CLIENT_ID || '').trim();
      const clientSecret = String(process.env.SLACK_CLIENT_SECRET || '').trim();
      if (!clientId || !clientSecret) return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?error=missing_oauth_env`);
      const redirectUri = process.env.SLACK_USER_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/v1/slack/user/oauth/callback`;

      const tokenRes: any = await exchangeOAuthCode(clientId, clientSecret, code, redirectUri);
      const userToken = tokenRes?.authed_user?.access_token;
      const scope = tokenRes?.authed_user?.scope || tokenRes?.scope || null;
      if (!userToken) return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?error=no_user_token`);
      await setUserSlackToken(orgId, userId, String(userToken), scope ? String(scope) : null);
      return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?userConnected=1`);
    } catch {
      return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?error=oauth_failed`);
    }
  })
);

router.get(
  '/oauth/start',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = String((req.query as any)?.orgId || '');
    if (!orgId) throw ApiError.badRequest('orgId is required');
    if (!SlackService.isOAuthConfigured()) throw ApiError.badRequest('Slack OAuth is not configured (missing SLACK_CLIENT_ID/SLACK_CLIENT_SECRET)');
    const clientId = String(process.env.SLACK_CLIENT_ID || '').trim();
    if (!clientId) throw ApiError.badRequest('Slack OAuth is not configured (missing SLACK_CLIENT_ID)');

    const state = jwt.sign({ orgId, mode: 'bot' }, config.JWT_SECRET, { expiresIn: '10m' });
    const redirectUri = process.env.SLACK_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/v1/slack/oauth/callback`;
    const scopes = [
      'channels:read',
      'groups:read',
      'im:read',
      'mpim:read',
      'channels:history',
      'groups:history',
      'im:history',
      'mpim:history',
      'chat:write',
      'users:read',
      'files:read',
      'files:write',
    ].join(',');

    const teamId = await resolveSlackOAuthTeamId(orgId, (req.query as any)?.team);
    const teamParam = teamId ? `&team=${encodeURIComponent(teamId)}` : '';

    const url =
      `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(clientId)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      teamParam;

    res.json({ success: true, data: { url } });
  })
);

router.get(
  '/oauth/callback',
  asyncHandler(async (req, res) => {
    try {
      const code = String((req.query as any)?.code || '');
      const state = String((req.query as any)?.state || '');
      const safeFrontend = (String(config.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean)[0]) || 'http://localhost:5173';
      if (!code || !state) return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?error=missing_code`);

      let payload: any;
      try {
        payload = jwt.verify(state, config.JWT_SECRET);
      } catch {
        return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?error=invalid_state`);
      }

      const orgId = String(payload?.orgId || '');
      if (!orgId) return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?error=invalid_payload`);

      const clientId = String(process.env.SLACK_CLIENT_ID || '').trim();
      const clientSecret = String(process.env.SLACK_CLIENT_SECRET || '').trim();
      if (!clientId || !clientSecret) return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?error=missing_oauth_env`);
      const redirectUri = process.env.SLACK_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/v1/slack/oauth/callback`;

      const tokenRes: any = await exchangeOAuthCode(clientId, clientSecret, code, redirectUri);
      const botToken = tokenRes?.access_token || null;
      const teamId = tokenRes?.team?.id || tokenRes?.team_id || null;
      const scope = tokenRes?.scope || null;
      if (!botToken) return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?error=no_bot_token`);

      await setOrgSlackToken(orgId, String(botToken), teamId ? String(teamId) : null, scope ? String(scope) : null);
      return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?connected=1`);
    } catch {
      const safeFrontend = (String(config.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean)[0]) || 'http://localhost:5173';
      return res.redirect(`${safeFrontend.replace(/\/$/, '')}/slack?error=oauth_failed`);
    }
  })
);

router.get(
  '/channels',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = String((req.query as any)?.orgId || '');
    if (!orgId) throw ApiError.badRequest('orgId is required');
    if (!req.user) throw ApiError.unauthorized();
    const membership = await getOrgMember(orgId, String(req.user.id));
    if (!membership) throw ApiError.forbidden('You are not a member of this organization');
    const botToken = await getOrgSlackToken(orgId);
    if (!botToken) throw ApiError.badRequest('Slack is not connected for this workspace');
    await ensureValidSlackToken(orgId, botToken);
    // Prefer user token when connected so "isMember" matches what the user sees in Slack.
    const userId = String(req.user.id);
    const userToken = await getUserSlackToken(orgId, userId);
    const tokenToUse = userToken ? await ensureValidSlackUserToken(orgId, userId, userToken) : botToken;
    const data = await runSlackCall(orgId, () => SlackService.listChannels(tokenToUse));

    // If org has per-channel access rules, apply them for non-privileged roles only.
    // Privileged roles (Owner/Super Admin/Admin) always see all channels.
    const access = await getChannelAccessMap(orgId);
    const hasRules = Object.keys(access || {}).length > 0;
    if (!hasRules || isPrivilegedRole(membership.role)) {
      return res.json({ success: true, data });
    }

    const uid = String(req.user.id);
    const filtered = (data || []).filter((c: any) => {
      const allowed = access?.[String(c.id)];
      if (!Array.isArray(allowed)) return false; // if rules exist, unlisted channels are hidden
      return allowed.includes(uid);
    });
    return res.json({ success: true, data: filtered });
  })
);

router.get(
  '/channel-access',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = String((req.query as any)?.orgId || '');
    if (!orgId) throw ApiError.badRequest('orgId is required');
    if (!req.user) throw ApiError.unauthorized();
    const membership = await getOrgMember(orgId, String(req.user.id));
    if (!membership) throw ApiError.forbidden('You are not a member of this organization');
    if (!isPrivilegedRole(membership.role)) throw ApiError.forbidden('Only admins can manage Slack channel access');
    const access = await getChannelAccessMap(orgId);
    res.json({ success: true, data: access });
  })
);

router.put(
  '/channel-access',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = String((req.body as any)?.orgId || '');
    const channelId = String((req.body as any)?.channelId || '');
    const userIds = (req.body as any)?.userIds as any;
    if (!orgId) throw ApiError.badRequest('orgId is required');
    if (!channelId) throw ApiError.badRequest('channelId is required');
    if (!Array.isArray(userIds)) throw ApiError.badRequest('userIds must be an array');
    if (!req.user) throw ApiError.unauthorized();
    const membership = await getOrgMember(orgId, String(req.user.id));
    if (!membership) throw ApiError.forbidden('You are not a member of this organization');
    if (!isPrivilegedRole(membership.role)) throw ApiError.forbidden('Only admins can manage Slack channel access');

    const access = await getChannelAccessMap(orgId);
    access[channelId] = userIds.map((x) => String(x));
    await setChannelAccessMap(orgId, access);
    res.json({ success: true, data: access });
  })
);

router.get(
  '/channels/:channelId/messages',
  authenticate,
  asyncHandler(async (req, res) => {
    const { channelId } = req.params as any;
    const orgId = String((req.query as any)?.orgId || '');
    const limit = Number((req.query as any)?.limit || 50);
    if (!orgId) throw ApiError.badRequest('orgId is required');
    const botToken = await getOrgSlackToken(orgId);
    if (!botToken) throw ApiError.badRequest('Slack is not connected for this workspace');
    await ensureValidSlackToken(orgId, botToken);
    // Prefer user token for consistency with Slack UI (private channels/DM visibility, membership).
    const userId = req.user?.id ? String(req.user.id) : '';
    const userToken = userId ? await getUserSlackToken(orgId, userId) : null;
    const tokenToUse = userToken ? await ensureValidSlackUserToken(orgId, userId, userToken) : botToken;
    const data = await runSlackCall(orgId, () => SlackService.getChannelMessages(tokenToUse, channelId, Math.min(Math.max(limit, 1), 200)));
    res.json({ success: true, data });
  })
);

router.get(
  '/activity',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = String((req.query as any)?.orgId || '');
    const limit = Number((req.query as any)?.limit || 40);
    if (!orgId) throw ApiError.badRequest('orgId is required');
    const botToken = await getOrgSlackToken(orgId);
    // Notification polling can hit this route even before Slack is connected.
    // Return an empty feed instead of surfacing an avoidable 400 on each poll.
    if (!botToken) {
      res.json({ success: true, data: [] });
      return;
    }
    await ensureValidSlackToken(orgId, botToken);

    // Prefer user token so activity matches what the user sees (private channels, membership).
    const userId = req.user?.id ? String(req.user.id) : '';
    const userToken = userId ? await getUserSlackToken(orgId, userId) : null;
    const tokenToUse = userToken ? await ensureValidSlackUserToken(orgId, userId, userToken) : botToken;

    const data = await runSlackCall(orgId, () => SlackService.getActivityFeed(tokenToUse, { limit }));
    res.json({ success: true, data });
  })
);

router.get(
  '/users/:slackUserId/profile',
  authenticate,
  asyncHandler(async (req, res) => {
    const { slackUserId } = req.params as any;
    const orgId = String((req.query as any)?.orgId || '');
    if (!orgId) throw ApiError.badRequest('orgId is required');
    if (!slackUserId) throw ApiError.badRequest('slackUserId is required');
    const botToken = await getOrgSlackToken(orgId);
    if (!botToken) throw ApiError.badRequest('Slack is not connected for this workspace');
    await ensureValidSlackToken(orgId, botToken);
    const p = await SlackService.getUserProfile(botToken, String(slackUserId));
    res.json({ success: true, data: { id: String(slackUserId), name: p.name, avatar: p.avatar } });
  })
);

router.post(
  '/channels/:channelId/join',
  authenticate,
  asyncHandler(async (req, res) => {
    const { channelId } = req.params as any;
    const { orgId } = req.body as any;
    if (!orgId) throw ApiError.badRequest('orgId is required');
    const botToken = await getOrgSlackToken(String(orgId));
    if (!botToken) throw ApiError.badRequest('Slack is not connected for this workspace');
    await ensureValidSlackToken(String(orgId), botToken);
    const data = await runSlackCall(String(orgId), () => SlackService.joinChannel(botToken, channelId));
    res.json({ success: true, data });
  })
);

router.post(
  '/channels/:channelId/archive',
  authenticate,
  asyncHandler(async (req, res) => {
    const { channelId } = req.params as any;
    const orgId = String((req.body as any)?.orgId || '');
    if (!orgId) throw ApiError.badRequest('orgId is required');
    if (!req.user) throw ApiError.unauthorized();
    const membership = await getOrgMember(orgId, String(req.user.id));
    if (!membership) throw ApiError.forbidden('You are not a member of this organization');
    if (!isPrivilegedRole(membership.role)) throw ApiError.forbidden('Only admins can delete/archive Slack channels');
    const botToken = await getOrgSlackToken(String(orgId));
    if (!botToken) throw ApiError.badRequest('Slack is not connected for this workspace');
    await ensureValidSlackToken(String(orgId), botToken);
    const data = await runSlackCall(String(orgId), () => SlackService.archiveChannel(botToken, channelId));
    res.json({ success: true, data });
  })
);

router.post(
  '/channels/:channelId/message',
  authenticate,
  asyncHandler(async (req, res) => {
    const { channelId } = req.params as any;
    const { orgId } = req.body as any;
    if (!orgId) throw ApiError.badRequest('orgId is required');
    const botToken = await getOrgSlackToken(String(orgId));
    if (!botToken) throw ApiError.badRequest('Slack is not connected for this workspace');
    await ensureValidSlackToken(String(orgId), botToken);
    const { text } = req.body as { text?: string };
    if (!text || !String(text).trim()) throw ApiError.badRequest('Message text is required');

    const userId = req.user?.id ? String(req.user.id) : '';
    const userToken = userId ? await getUserSlackToken(String(orgId), userId) : null;
    const rawText = String(text);

    const data = await runSlackCall(String(orgId), async () => {
      if (userToken) {
        await ensureValidSlackUserToken(String(orgId), userId, userToken);
        return await SlackService.postMessage(userToken, channelId, rawText);
      }
      return await SlackService.postMessage(botToken, channelId, rawText);
    });

    // Emit immediately so the web UI (NotificationBell / Activity) updates even if Slack Socket Mode
    // isn't delivering message events (missing event subscriptions, app not in channel, etc.).
    try {
      getIO().to(`org:${String(orgId)}`).emit('slack:message', {
        orgId: String(orgId),
        channelId: String(channelId),
        ts: String((data as any)?.ts || Date.now()),
        text: rawText,
        user: null,
        userName: req.user?.firstName ? `${req.user.firstName}${req.user.lastName ? ` ${req.user.lastName}` : ''}` : null,
        userAvatar: (req.user as any)?.avatarUrl || null,
        file: null,
        channelName: null,
      });
    } catch {}

    res.json({ success: true, data });
  })
);

router.post(
  '/channels/:channelId/file',
  authenticate,
  slackUpload.single('file'),
  asyncHandler(async (req, res) => {
    const { channelId } = req.params as any;
    const orgId = String((req.body as any)?.orgId || '');
    if (!orgId) throw ApiError.badRequest('orgId is required');
    const botToken = await getOrgSlackToken(String(orgId));
    if (!botToken) throw ApiError.badRequest('Slack is not connected for this workspace');
    await ensureValidSlackToken(String(orgId), botToken);

    const f: any = (req as any).file;
    if (!f?.buffer || !f?.originalname) throw ApiError.badRequest('file is required');

    const clientFilename = String((req.body as any)?.clientFilename || '').trim();
    const resolvedName = uploadDisplayName(clientFilename || String(f.originalname));

    const userId = req.user?.id ? String(req.user.id) : '';
    const userToken = userId ? await getUserSlackToken(String(orgId), userId) : null;
    const tokenToUse = userToken || botToken;

    const data = await runSlackCall(String(orgId), async () => {
      if (userToken) await ensureValidSlackUserToken(String(orgId), userId, userToken);
      return await SlackService.uploadFileToChannel(tokenToUse, channelId, {
        name: resolvedName,
        size: Number(f.size || f.buffer.length || 0),
        buffer: f.buffer,
      });
    });

    res.json({ success: true, data });
  })
);

router.get(
  '/files/:fileId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { fileId } = req.params as any;
    const orgId = String((req.query as any)?.orgId || '');
    if (!orgId) throw ApiError.badRequest('orgId is required');
    const botToken = await getOrgSlackToken(String(orgId));
    if (!botToken) throw ApiError.badRequest('Slack is not connected for this workspace');
    await ensureValidSlackToken(String(orgId), botToken);
    const data = await runSlackCall(String(orgId), () => SlackService.downloadFile(botToken, String(fileId)));
    res.setHeader('Content-Type', data.contentType);
    res.setHeader('Content-Disposition', `inline; filename=\"${encodeURIComponent(data.filename)}\"`);
    res.send(data.buffer);
  })
);

export default router;

