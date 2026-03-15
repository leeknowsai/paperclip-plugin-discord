import type { PluginContext } from "@paperclipai/plugin-sdk";
import { DISCORD_API_BASE } from "./constants.js";

const GATEWAY_VERSION = "10";
const GATEWAY_ENCODING = "json";

interface GatewayPayload {
  op: number;
  d: unknown;
  s: number | null;
  t: string | null;
}

interface ReadyEvent {
  session_id: string;
  resume_gateway_url: string;
}

interface InteractionCreateEvent {
  id: string;
  token: string;
  type: number;
  data?: Record<string, unknown>;
  member?: { user: { username: string } };
  guild_id?: string;
  channel_id?: string;
}

type InteractionHandler = (interaction: InteractionCreateEvent) => Promise<unknown>;

export async function respondViaCallback(
  ctx: PluginContext,
  interactionId: string,
  interactionToken: string,
  responseData: unknown,
): Promise<void> {
  const url = `${DISCORD_API_BASE}/interactions/${interactionId}/${interactionToken}/callback`;
  try {
    const response = await ctx.http.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(responseData),
    });
    if (!response.ok) {
      const text = await response.text();
      ctx.logger.warn("Interaction callback failed", {
        status: response.status,
        body: text,
      });
    }
  } catch (error) {
    ctx.logger.error("Interaction callback error", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function connectGateway(
  ctx: PluginContext,
  token: string,
  onInteraction: InteractionHandler,
): Promise<{ close: () => void }> {
  const gatewayUrl = await getGatewayUrl(ctx, token);
  if (!gatewayUrl) {
    ctx.logger.warn("Could not get Gateway URL, interactions will only work via webhook");
    return { close: () => {} };
  }

  let ws: WebSocket | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let sequence: number | null = null;
  let sessionId: string | null = null;
  let resumeUrl: string | null = null;
  let closed = false;

  function connect(url: string, resume: boolean) {
    if (closed) return;

    const wsUrl = `${url}/?v=${GATEWAY_VERSION}&encoding=${GATEWAY_ENCODING}`;
    ctx.logger.info("Connecting to Discord Gateway", { resume });

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ctx.logger.info("Gateway WebSocket connected");
    };

    ws.onmessage = async (event) => {
      const payload = JSON.parse(String(event.data)) as GatewayPayload;

      if (payload.s !== null) {
        sequence = payload.s;
      }

      switch (payload.op) {
        case 10: {
          // HELLO - start heartbeating
          const heartbeatMs = (payload.d as { heartbeat_interval: number }).heartbeat_interval;
          startHeartbeat(heartbeatMs);

          if (resume && sessionId) {
            // RESUME
            ws?.send(JSON.stringify({
              op: 6,
              d: { token: `Bot ${token}`, session_id: sessionId, seq: sequence },
            }));
          } else {
            // IDENTIFY - intents: GUILDS (1)
            ws?.send(JSON.stringify({
              op: 2,
              d: {
                token: `Bot ${token}`,
                intents: 1,
                properties: {
                  os: "linux",
                  browser: "paperclip-plugin-discord",
                  device: "paperclip-plugin-discord",
                },
              },
            }));
          }
          break;
        }

        case 0: {
          // DISPATCH
          if (payload.t === "READY") {
            const ready = payload.d as ReadyEvent;
            sessionId = ready.session_id;
            resumeUrl = ready.resume_gateway_url;
            ctx.logger.info("Gateway ready", { sessionId });
          }

          if (payload.t === "INTERACTION_CREATE") {
            const interaction = payload.d as InteractionCreateEvent;
            try {
              const response = await onInteraction(interaction);
              await respondViaCallback(ctx, interaction.id, interaction.token, response);
            } catch (error) {
              ctx.logger.error("Gateway interaction handler error", {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          break;
        }

        case 1: {
          // HEARTBEAT request from server
          ws?.send(JSON.stringify({ op: 1, d: sequence }));
          break;
        }

        case 7: {
          // RECONNECT
          ctx.logger.info("Gateway requested reconnect");
          cleanup();
          connect(resumeUrl ?? url, true);
          break;
        }

        case 9: {
          // INVALID SESSION
          const resumable = payload.d as boolean;
          ctx.logger.info("Invalid session", { resumable });
          cleanup();
          if (!resumable) {
            sessionId = null;
            sequence = null;
          }
          // Wait 1-5s before reconnecting per Discord docs
          setTimeout(() => connect(url, resumable), 1000 + Math.random() * 4000);
          break;
        }

        case 11: {
          // HEARTBEAT ACK - no action needed
          break;
        }
      }
    };

    ws.onclose = (event) => {
      ctx.logger.info("Gateway WebSocket closed", { code: event.code, reason: event.reason });
      cleanup();
      if (!closed && event.code !== 4004) {
        // 4004 = authentication failed, don't retry
        setTimeout(() => connect(resumeUrl ?? url, sessionId !== null), 5000);
      }
    };

    ws.onerror = (event) => {
      ctx.logger.warn("Gateway WebSocket error", {
        error: String(event),
      });
    };
  }

  function startHeartbeat(intervalMs: number) {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    // Send first heartbeat after jitter (0-1x interval)
    const jitter = Math.random() * intervalMs;
    setTimeout(() => {
      ws?.send(JSON.stringify({ op: 1, d: sequence }));
      heartbeatInterval = setInterval(() => {
        ws?.send(JSON.stringify({ op: 1, d: sequence }));
      }, intervalMs);
    }, jitter);
  }

  function cleanup() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  connect(gatewayUrl, false);

  return {
    close: () => {
      closed = true;
      cleanup();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "Plugin shutting down");
      }
    },
  };
}

async function getGatewayUrl(ctx: PluginContext, token: string): Promise<string | null> {
  try {
    const response = await ctx.http.fetch(`${DISCORD_API_BASE}/gateway/bot`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!response.ok) {
      ctx.logger.warn("Failed to get Gateway URL", { status: response.status });
      return null;
    }
    const data = (await response.json()) as { url: string };
    return data.url;
  } catch (error) {
    ctx.logger.error("Gateway URL fetch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
