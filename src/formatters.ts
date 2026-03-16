import type { PluginEvent } from "@paperclipai/plugin-sdk";
import type { DiscordMessage } from "./discord-api.js";
import { COLORS } from "./constants.js";

type Payload = Record<string, unknown>;

export function formatIssueCreated(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  const identifier = String(p.identifier ?? event.entityId);
  const title = String(p.title ?? "Untitled");
  const description = p.description ? String(p.description) : null;
  const status = p.status ? String(p.status) : null;
  const priority = p.priority ? String(p.priority) : null;
  const assigneeName = p.assigneeName ? String(p.assigneeName) : null;
  const projectName = p.projectName ? String(p.projectName) : null;

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (status) fields.push({ name: "Status", value: `\`${status}\``, inline: true });
  if (priority) fields.push({ name: "Priority", value: `\`${priority}\``, inline: true });
  if (assigneeName) fields.push({ name: "Assignee", value: assigneeName, inline: true });
  if (projectName) fields.push({ name: "Project", value: projectName, inline: true });

  // Include any extra payload fields not already shown
  const knownKeys = new Set(["identifier", "title", "description", "status", "priority", "assigneeName", "projectName", "assigneeAgentId", "projectId"]);
  for (const [key, value] of Object.entries(p)) {
    if (knownKeys.has(key) || value == null || value === "") continue;
    const display = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (display.length > 0 && display.length <= 1024) {
      fields.push({ name: key, value: display, inline: display.length < 40 });
    }
  }

  const dashboardUrl = `http://localhost:3100/issues/${event.entityId}`;

  return {
    embeds: [
      {
        title: `Issue Created: ${identifier}`,
        description: description
          ? `**${title}**\n> ${description.slice(0, 300)}`
          : `**${title}**`,
        color: COLORS.BLUE,
        fields,
        footer: { text: "Paperclip" },
        timestamp: event.occurredAt,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "View Issue",
            url: dashboardUrl,
          },
        ],
      },
    ],
  };
}

export function formatIssueDone(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  const identifier = String(p.identifier ?? event.entityId);
  const title = String(p.title ?? "");
  const status = p.status ? String(p.status) : null;
  const priority = p.priority ? String(p.priority) : null;

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (status) fields.push({ name: "Status", value: `\`${status}\``, inline: true });
  if (priority) fields.push({ name: "Priority", value: `\`${priority}\``, inline: true });

  const dashboardUrl = `http://localhost:3100/issues/${event.entityId}`;

  return {
    embeds: [
      {
        title: `Issue Completed: ${identifier}`,
        description: `**${title}** is now done.`,
        color: COLORS.GREEN,
        fields,
        footer: { text: "Paperclip" },
        timestamp: event.occurredAt,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "View Issue",
            url: dashboardUrl,
          },
        ],
      },
    ],
  };
}

export function formatApprovalCreated(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  const approvalType = String(p.type ?? "unknown");
  const approvalId = String(p.approvalId ?? event.entityId);
  const title = String(p.title ?? "");
  const description = String(p.description ?? "");
  const agentName = String(p.agentName ?? "");
  const issueIds = Array.isArray(p.issueIds) ? p.issueIds as string[] : [];
  const dashboardUrl = `http://localhost:3100/approvals/${approvalId}`;

  // Build embed fields for structured context
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (agentName) fields.push({ name: "Agent", value: agentName, inline: true });
  fields.push({ name: "Type", value: `\`${approvalType}\``, inline: true });
  if (issueIds.length > 0) {
    fields.push({ name: "Linked Issues", value: issueIds.join(", ") });
  }

  // Render linked issues with metadata
  const linkedIssues = Array.isArray(p.linkedIssues) ? p.linkedIssues as Array<Record<string, unknown>> : [];
  if (linkedIssues.length > 0) {
    const issueLines = linkedIssues.map((issue) => {
      const parts = [`**${issue.identifier ?? "?"}** ${issue.title ?? ""}`];
      const meta: string[] = [];
      if (issue.status) meta.push(String(issue.status));
      if (issue.priority) meta.push(String(issue.priority));
      if (issue.assignee) meta.push(`→ ${issue.assignee}`);
      if (meta.length > 0) parts.push(`(${meta.join(" | ")})`);
      if (issue.description) parts.push(`\n> ${String(issue.description).slice(0, 100)}`);
      return parts.join(" ");
    });
    fields.push({ name: `Linked Issues (${linkedIssues.length})`, value: issueLines.join("\n\n").slice(0, 1024) });
  }

  // Include any extra payload fields not already shown
  const knownKeys = new Set(["type", "approvalId", "title", "description", "agentName", "issueIds", "agentId", "runId", "linkedIssues"]);
  for (const [key, value] of Object.entries(p)) {
    if (knownKeys.has(key) || value == null || value === "") continue;
    const display = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (display.length > 0 && display.length <= 1024) {
      fields.push({ name: key, value: display, inline: display.length < 40 });
    }
  }

  return {
    embeds: [
      {
        title: title ? `Approval: ${title}` : "Approval Requested",
        description: description || undefined,
        color: COLORS.YELLOW,
        fields,
        footer: { text: "Paperclip" },
        timestamp: event.occurredAt,
      },
    ],
    components: [
      {
        type: 1, // ActionRow
        components: [
          {
            type: 2, // Button
            style: 3, // Success (green)
            label: "Approve",
            custom_id: `approval_approve_${approvalId}`,
          },
          {
            type: 2, // Button
            style: 4, // Danger (red)
            label: "Reject",
            custom_id: `approval_reject_${approvalId}`,
          },
          {
            type: 2, // Button
            style: 5, // Link (opens URL)
            label: "View",
            url: dashboardUrl,
          },
        ],
      },
    ],
  };
}

export function formatAgentError(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  const agentName = String(p.agentName ?? p.name ?? event.entityId);
  const errorMessage = String(p.error ?? p.message ?? "Unknown error");

  return {
    embeds: [
      {
        title: "Agent Error",
        description: `**${agentName}** encountered an error`,
        color: COLORS.RED,
        fields: [
          { name: "Error", value: errorMessage.slice(0, 1024) },
        ],
        footer: { text: "Paperclip" },
        timestamp: event.occurredAt,
      },
    ],
  };
}

export function formatAgentRunStarted(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  const agentName = String(p.agentName ?? event.entityId);

  return {
    embeds: [
      {
        title: "Agent Run Started",
        description: `**${agentName}** has started a new run.`,
        color: COLORS.BLUE,
        footer: { text: "Paperclip" },
        timestamp: event.occurredAt,
      },
    ],
  };
}

export function formatAgentRunFinished(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  const agentName = String(p.agentName ?? event.entityId);

  return {
    embeds: [
      {
        title: "Agent Run Finished",
        description: `**${agentName}** completed successfully.`,
        color: COLORS.GREEN,
        footer: { text: "Paperclip" },
        timestamp: event.occurredAt,
      },
    ],
  };
}

// --- X Watchdog formatters ---

export function formatHighScore(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  return {
    embeds: [{
      title: "High Score Tweet Detected",
      description: `**@${p.handle}**: ${String(p.text ?? "").slice(0, 300)}`,
      color: COLORS.BLUE,
      fields: [
        { name: "Score", value: `${p.score}/10`, inline: true },
        { name: "Project", value: String(p.projectName ?? "—"), inline: true },
        { name: "Category", value: String(p.category ?? "—"), inline: true },
      ],
      footer: { text: "X Watchdog" },
      timestamp: event.occurredAt,
    }],
  };
}

export function formatNewLead(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  return {
    embeds: [{
      title: "New Lead Detected",
      description: `**@${p.handle}** added to pipeline`,
      color: COLORS.GREEN,
      fields: [
        { name: "Score", value: `${p.score}/10`, inline: true },
        { name: "Signal", value: String(p.signalType ?? "tweet"), inline: true },
        { name: "Project", value: String(p.projectName ?? "—"), inline: true },
      ],
      footer: { text: "X Watchdog" },
      timestamp: event.occurredAt,
    }],
  };
}

export function formatApprovalNeeded(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  return {
    embeds: [{
      title: "Outreach Approval Needed",
      description: `**@${p.handle}** — ${String(p.messagePreview ?? "").slice(0, 200)}`,
      color: COLORS.YELLOW,
      fields: [
        { name: "Action", value: String(p.action ?? "dm"), inline: true },
        { name: "Project", value: String(p.projectName ?? "—"), inline: true },
      ],
      footer: { text: "X Watchdog" },
      timestamp: event.occurredAt,
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: "Approve", custom_id: `xwd_approve_${p.leadId}` },
        { type: 2, style: 4, label: "Reject", custom_id: `xwd_reject_${p.leadId}` },
      ],
    }],
  };
}

export function formatTgMessage(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  const sender = p.sender as { username?: string; displayName?: string } | undefined;
  return {
    embeds: [{
      title: `TG: ${sender?.displayName ?? sender?.username ?? "Unknown"}`,
      description: String(p.text ?? "").slice(0, 500),
      color: COLORS.BLUE,
      fields: [
        { name: "Group", value: String(p.groupId ?? "—"), inline: true },
      ],
      footer: { text: "X Watchdog — TG Mirror" },
      timestamp: String(p.timestamp ?? event.occurredAt),
    }],
  };
}

export function formatTgMemberJoined(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  const isLead = Boolean(p.isLead);
  return {
    embeds: [{
      title: isLead ? "Lead Joined TG Group!" : "New TG Group Member",
      description: `**@${p.username}** joined the group`,
      color: isLead ? COLORS.GREEN : COLORS.BLUE,
      fields: [
        { name: "Group", value: String(p.groupId ?? "—"), inline: true },
        ...(isLead ? [{ name: "Lead ID", value: String(p.leadId), inline: true }] : []),
      ],
      footer: { text: "X Watchdog" },
      timestamp: event.occurredAt,
    }],
  };
}

export function formatLeadConverted(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  return {
    embeds: [{
      title: "Lead Converted!",
      description: `**@${p.handle}** → TG @${p.tgUsername}`,
      color: COLORS.GREEN,
      fields: [
        { name: "Project", value: String(p.projectId ?? "—"), inline: true },
      ],
      footer: { text: "X Watchdog" },
      timestamp: event.occurredAt,
    }],
  };
}

export function formatCeoProposal(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  return {
    embeds: [{
      title: "CEO Retrospective Proposal",
      description: String(p.summary ?? "").slice(0, 500),
      color: COLORS.YELLOW,
      fields: [
        { name: "Period", value: String(p.periodDays ?? "7") + " days", inline: true },
        { name: "Leads Analyzed", value: String(p.leadsAnalyzed ?? "—"), inline: true },
      ],
      footer: { text: "X Watchdog" },
      timestamp: event.occurredAt,
    }],
  };
}

export function formatXWatchdogError(event: PluginEvent): DiscordMessage {
  const p = event.payload as Payload;
  return {
    embeds: [{
      title: "X Watchdog Error",
      description: String(p.message ?? p.error ?? "Unknown error").slice(0, 500),
      color: COLORS.RED,
      fields: [
        { name: "Component", value: String(p.component ?? "—"), inline: true },
      ],
      footer: { text: "X Watchdog" },
      timestamp: event.occurredAt,
    }],
  };
}
