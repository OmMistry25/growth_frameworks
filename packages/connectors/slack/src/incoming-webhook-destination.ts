import type {
  RunContext,
  SignalTransition,
  TransitionDestination,
} from "@growth-frameworks/contracts/competitive-footprint";
import { PortOperationError } from "@growth-frameworks/contracts/competitive-footprint";

const allowedHosts = new Set(["hooks.slack.com", "hooks.slack-gov.com"]);
const maximumResponseBytes = 256;

export interface SlackWebhookResponse {
  readonly status: number;
  readonly body: string;
  readonly retryAfterSeconds?: number;
}

export interface SlackWebhookHttpPort {
  post(url: URL, payload: Readonly<{ text: string }>, timeoutMs: number): Promise<SlackWebhookResponse>;
}

export interface SlackIncomingWebhookDestinationOptions {
  readonly webhookUrl: string;
  readonly allowDelivery: true;
  readonly timeoutMs?: number;
  readonly http?: SlackWebhookHttpPort;
}

export class SlackIncomingWebhookDestination implements TransitionDestination {
  readonly #webhookUrl: URL;
  readonly #timeoutMs: number;
  readonly #http: SlackWebhookHttpPort;

  constructor(options: SlackIncomingWebhookDestinationOptions) {
    if (options.allowDelivery !== true) {
      throw new PortOperationError("Slack delivery requires explicit authorization", "authorization", false);
    }
    this.#webhookUrl = parseWebhookUrl(options.webhookUrl);
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 100 || this.#timeoutMs > 30_000) {
      throw new TypeError("Slack webhook timeout must be an integer from 100 to 30000 milliseconds");
    }
    this.#http = options.http ?? new NodeSlackWebhookHttpClient();
  }

  async deliver(transition: SignalTransition, context: RunContext): Promise<void> {
    if (context.dryRun) {
      throw new PortOperationError("Slack delivery is disabled during dry run", "authorization", false);
    }
    const response = await this.#http.post(
      this.#webhookUrl,
      { text: formatTransition(transition, context) },
      this.#timeoutMs,
    );
    if (response.status === 200 && response.body.trim() === "ok") return;
    if (response.status === 429) {
      throw new PortOperationError(
        response.retryAfterSeconds === undefined
          ? "Slack webhook rate limited the request"
          : `Slack webhook rate limited the request; retry after ${response.retryAfterSeconds} seconds`,
        "rate_limited",
        true,
      );
    }
    if (response.status >= 500) {
      throw new PortOperationError(`Slack webhook failed with HTTP ${response.status}`, "transient", true);
    }
    throw new PortOperationError(`Slack webhook rejected the request with HTTP ${response.status}`, "permanent", false);
  }
}

export class NodeSlackWebhookHttpClient implements SlackWebhookHttpPort {
  async post(url: URL, payload: Readonly<{ text: string }>, timeoutMs: number): Promise<SlackWebhookResponse> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new PortOperationError("Slack webhook request failed", "transient", true, { cause: error });
    }
    const body = (await response.text()).slice(0, maximumResponseBytes);
    return {
      status: response.status,
      body,
      ...parseRetryAfter(response.headers.get("retry-after")),
    };
  }
}

function parseWebhookUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PortOperationError("Slack webhook URL is invalid", "authorization", false);
  }
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    !allowedHosts.has(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    pathParts.length !== 4 ||
    pathParts[0] !== "services" ||
    pathParts.slice(1).some((part) => !/^[A-Za-z0-9_-]{8,}$/.test(part))
  ) {
    throw new PortOperationError("Slack webhook URL is not an approved incoming-webhook endpoint", "authorization", false);
  }
  return url;
}

function formatTransition(transition: SignalTransition, context: RunContext): string {
  return [
    "Competitive Footprint transition",
    `Account: ${safeMessageField(transition.accountId, "account ID")}`,
    `Detector: ${safeMessageField(transition.detectorId, "detector ID")}`,
    `Change: ${safeMessageField(transition.kind, "transition kind")}`,
    `State: ${safeMessageField(transition.previous.state, "previous state")} -> ${safeMessageField(transition.next.state, "next state")}`,
    `Occurred: ${safeMessageField(transition.occurredAt, "occurrence time")}`,
    `Run: ${safeMessageField(context.runId, "run ID")}`,
    `Idempotency key: ${safeMessageField(transition.idempotencyKey, "idempotency key")}`,
  ].join("\n");
}

function safeMessageField(value: string, label: string): string {
  if (value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PortOperationError(`Slack message ${label} is invalid`, "permanent", false);
  }
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function parseRetryAfter(value: string | null): { readonly retryAfterSeconds?: number } {
  if (value === null || !/^\d+$/.test(value)) return {};
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 86_400) return {};
  return { retryAfterSeconds: seconds };
}
