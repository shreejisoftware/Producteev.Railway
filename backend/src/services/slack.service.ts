import { WebClient } from '@slack/web-api';
import { ApiError } from '../utils/ApiError';

function getSlackClient(botToken: string | null | undefined) {
  const token = botToken || '';
  if (!token) throw ApiError.badRequest('Slack is not connected for this workspace');
  return new WebClient(token);
}

type ChannelListItem = { id: string; name: string; isPrivate: boolean; isMember: boolean; topic: string };

type SlackActivityItem = {
  channelId: string;
  channelName: string;
  isPrivate: boolean;
  ts: string;
  text: string;
  user: string | null;
  file?: { id: string; name: string; mimetype?: string } | null;
};

type ChannelListCacheEntry = {
  fetchedAt: number;
  data: ChannelListItem[];
  inFlight?: Promise<ChannelListItem[]>;
  rateLimitedUntil?: number;
};

// Per-process in-memory cache to avoid hammering Slack API (conversations.list is rate-limited).
// Keyed by token because we may use bot token or per-user token.
const channelListCache = new Map<string, ChannelListCacheEntry>();

function retryAfterSecondsFromSlackError(err: any): number | null {
  const direct = err?.retryAfter ?? err?.data?.retry_after ?? err?.data?.retryAfter;
  const n = Number(direct);
  if (Number.isFinite(n) && n > 0) return n;
  // Some variants put it on headers-like field
  const hdr = err?.data?.headers?.['retry-after'] ?? err?.headers?.['retry-after'];
  const hn = Number(hdr);
  if (Number.isFinite(hn) && hn > 0) return hn;
  return null;
}

export class SlackService {
  static isOAuthConfigured() {
    return Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);
  }

  static async listChannels(botToken: string) {
    if (botToken === 'dummy_token') {
      return [
        { id: 'C123', name: 'general', isPrivate: false, isMember: true, topic: 'General Chat' },
        { id: 'C456', name: 'random', isPrivate: false, isMember: true, topic: 'Non-work banter' },
        { id: 'C789', name: 'dev-team', isPrivate: true, isMember: true, topic: 'Development' },
      ];
    }
    const now = Date.now();
    const ttlMs = 120_000; // 2 minutes
    const existing = channelListCache.get(botToken);

    // Fresh cache hit
    if (existing?.data?.length && now - existing.fetchedAt < ttlMs) return existing.data;

    // If we're currently rate-limited, return stale data if we have it.
    if (existing?.rateLimitedUntil && now < existing.rateLimitedUntil) {
      if (existing.data?.length) return existing.data;
      throw ApiError.badRequest('Slack API is temporarily rate limited. Please try again shortly.');
    }

    // In-flight dedupe
    if (existing?.inFlight) return await existing.inFlight;

    const doFetch = async (): Promise<ChannelListItem[]> => {
      const client = getSlackClient(botToken);
      try {
        const res = await client.conversations.list({
          exclude_archived: true,
          types: 'public_channel,private_channel',
          limit: 500,
        });
        const channels: ChannelListItem[] = (res.channels || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          isPrivate: Boolean(c.is_private),
          isMember: Boolean(c.is_member),
          topic: c.topic?.value || '',
        }));
        const sorted = channels.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        channelListCache.set(botToken, { fetchedAt: Date.now(), data: sorted });
        return sorted;
      } catch (err: any) {
        const code = String(err?.code || '');
        const apiError = String(err?.data?.error || '');
        const isRateLimited = code === 'slack_webapi_rate_limited' || apiError === 'ratelimited';
        if (isRateLimited) {
          const retryAfter = retryAfterSecondsFromSlackError(err) ?? 30;
          const until = Date.now() + retryAfter * 1000;
          const prev = channelListCache.get(botToken);
          // Keep stale data if we have it, and remember the backoff window.
          channelListCache.set(botToken, {
            fetchedAt: prev?.fetchedAt ?? 0,
            data: prev?.data ?? [],
            rateLimitedUntil: until,
          });
          if (prev?.data?.length) return prev.data;
          throw ApiError.badRequest(`Slack API rate limit exceeded. Retry after ${retryAfter}s.`);
        }
        throw err;
      } finally {
        const cur = channelListCache.get(botToken);
        if (cur?.inFlight) {
          // clear inFlight marker, keep other fields
          const { inFlight, ...rest } = cur;
          channelListCache.set(botToken, rest);
        }
      }
    };

    const p = doFetch();
    channelListCache.set(botToken, {
      fetchedAt: existing?.fetchedAt ?? 0,
      data: existing?.data ?? [],
      rateLimitedUntil: existing?.rateLimitedUntil,
      inFlight: p,
    });
    return await p;
  }

  static async getChannelHistory(botToken: string, channelId: string, limit = 50) {
    const client = getSlackClient(botToken);
    const res = await client.conversations.history({
      channel: channelId,
      limit,
      inclusive: true,
    });
    return (res.messages || []).map((m: any) => ({
      ts: m.ts,
      text: m.text || '',
      user: m.user || null,
      userName: null,
      userAvatar: null,
      bot_id: m.bot_id || null,
      subtype: m.subtype || null,
      files: Array.isArray(m.files)
        ? m.files.map((f: any) => ({
            id: f.id,
            name: f.name || f.title || f.id,
            mimetype: f.mimetype || '',
          }))
        : [],
      channel: channelId,
    }));
  }

  static async getActivityFeed(
    token: string,
    opts?: { limit?: number; channelLimit?: number; perChannelLimit?: number; concurrency?: number }
  ): Promise<SlackActivityItem[]> {
    const limit = Math.min(Math.max(Number(opts?.limit ?? 50), 1), 200);
    const channelLimit = Math.min(Math.max(Number(opts?.channelLimit ?? 80), 1), 500);
    const perChannelLimit = Math.min(Math.max(Number(opts?.perChannelLimit ?? 1), 1), 10);
    const concurrency = Math.min(Math.max(Number(opts?.concurrency ?? 6), 1), 12);

    const channels = await SlackService.listChannels(token);
    const eligible = (channels || [])
      .filter((c) => c && (c as any).id && (c as any).name)
      // Keep to channels this token can access via membership (better matches Slack UI)
      .filter((c) => Boolean((c as any).isMember))
      .slice(0, channelLimit);

    const results: SlackActivityItem[] = [];
    let idx = 0;

    const worker = async () => {
      while (idx < eligible.length) {
        const c = eligible[idx++];
        if (!c?.id) continue;
        try {
          const msgs = await SlackService.getChannelHistory(token, String(c.id), perChannelLimit);
          const m = Array.isArray(msgs) && msgs.length > 0 ? msgs[0] : null;
          if (!m?.ts) continue;
          const firstFile =
            Array.isArray((m as any).files) && (m as any).files.length > 0
              ? { id: (m as any).files[0]?.id, name: (m as any).files[0]?.name, mimetype: (m as any).files[0]?.mimetype }
              : null;
          results.push({
            channelId: String(c.id),
            channelName: String((c as any).name),
            isPrivate: Boolean((c as any).isPrivate),
            ts: String(m.ts),
            text: String((m as any).text || ''),
            user: (m as any).user ? String((m as any).user) : null,
            file: firstFile && firstFile.id ? (firstFile as any) : null,
          });
        } catch {
          // Ignore per-channel failures (missing access, not_in_channel, etc.)
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, eligible.length || 1) }, () => worker()));

    return results
      .sort((a, b) => Number(b.ts) - Number(a.ts))
      .slice(0, limit);
  }

  // Back-compat name used by routes
  static async getChannelMessages(botToken: string, channelId: string, limit = 50) {
    return SlackService.getChannelHistory(botToken, channelId, limit);
  }

  static async getUserProfile(
    botToken: string,
    userId: string
  ): Promise<{ id: string; name: string; avatar: string | null }> {
    const client = getSlackClient(botToken);
    const res: any = await (client as any).users.info({ user: userId });
    const u = res?.user;
    const profile = u?.profile || {};
    const display =
      String(profile?.display_name || '').trim() ||
      String(profile?.real_name || '').trim() ||
      String(u?.name || '').trim() ||
      userId;
    const avatar =
      profile?.image_72 ||
      profile?.image_48 ||
      profile?.image_32 ||
      profile?.image_192 ||
      null;
    return { id: userId, name: display, avatar: avatar ? String(avatar) : null };
  }

  static async postMessage(
    botToken: string,
    channelId: string,
    text: string,
    opts?: { blocks?: any[] }
  ) {
    const client = getSlackClient(botToken);
    const payload: any = {
      channel: channelId,
      text,
      mrkdwn: true,
      link_names: true,
      ...(opts?.blocks ? { blocks: opts.blocks } : {}),
    };

    const tryPost = async () => await client.chat.postMessage(payload);

    let res: any;
    try {
      res = await tryPost();
    } catch (err: any) {
      const apiError = err?.data?.error || err?.code || '';
      if (apiError === 'not_in_channel') {
        // Bots cannot always self-join and some workspaces restrict join/post behaviors.
        // Keep the permission surface minimal and ask the user to invite the app.
        throw ApiError.badRequest('Slack app is not in this channel. Invite the Slack app to the channel and retry.');
      } else {
        throw err;
      }
    }
    return {
      ok: Boolean((res as any).ok),
      ts: (res as any).ts,
      channel: (res as any).channel,
    };
  }

  static async joinChannel(botToken: string, channelId: string) {
    const client = getSlackClient(botToken);
    const res: any = await client.conversations.join({ channel: channelId });
    return {
      ok: Boolean(res?.ok),
      channel: res?.channel?.id || channelId,
    };
  }

  static async archiveChannel(botToken: string, channelId: string) {
    const client = getSlackClient(botToken);
    const tryArchive = async () => await client.conversations.archive({ channel: channelId });
    try {
      const res: any = await tryArchive();
      return { ok: Boolean(res?.ok), channel: channelId };
    } catch (err: any) {
      const apiError = err?.data?.error || err?.code || '';
      if (apiError === 'not_in_channel') {
        throw ApiError.badRequest('Slack app is not in this channel. Invite the Slack app to the channel, then retry.');
      }
      throw err;
    }
  }

  static async uploadFileToChannel(botToken: string, channelId: string, file: { name: string; size: number; buffer: Buffer }) {
    const client = getSlackClient(botToken);

    // Slack external upload flow (recommended)
    const getUrlRes: any = await (client as any).files.getUploadURLExternal({
      filename: file.name,
      length: file.size,
    });

    const uploadUrl = getUrlRes?.upload_url as string | undefined;
    const fileId = getUrlRes?.file_id as string | undefined;
    if (!uploadUrl || !fileId) {
      throw ApiError.badRequest('Slack upload URL was not returned');
    }

    // Upload bytes to Slack-provided URL
    const up = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file.buffer,
    });
    if (!up.ok) {
      throw ApiError.badRequest(`Slack upload failed (${up.status})`);
    }

    // Complete upload and share to channel
    const completeRes: any = await (client as any).files.completeUploadExternal({
      files: [{ id: fileId, title: file.name }],
      channel_id: channelId,
    });

    return {
      ok: Boolean(completeRes?.ok),
      fileId,
    };
  }

  static async downloadFile(botToken: string, fileId: string) {
    const client = getSlackClient(botToken);
    const info: any = await (client as any).files.info({ file: fileId });
    const f = info?.file;
    const url = f?.url_private_download || f?.url_private;
    if (!url) throw ApiError.badRequest('Slack file URL not available');

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!resp.ok) throw ApiError.badRequest(`Slack file download failed (${resp.status})`);
    const ab = await resp.arrayBuffer();
    const buffer = Buffer.from(ab);
    return {
      buffer,
      contentType: String(f?.mimetype || resp.headers.get('content-type') || 'application/octet-stream'),
      filename: String(f?.name || f?.title || 'file'),
    };
  }
}

