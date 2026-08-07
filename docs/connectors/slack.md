# Slack Incoming Webhook Destination

The Slack connector implements the canonical transition destination with an incoming webhook. It is not composed into an application yet and its tests never access Slack.

## Safety contract

- Construction requires `allowDelivery: true`.
- Delivery is rejected when the run context is a dry run.
- Only HTTPS incoming-webhook URLs on `hooks.slack.com` or `hooks.slack-gov.com` are accepted.
- Redirects are rejected, requests have a bounded timeout, and response bodies are truncated before interpretation.
- Dynamic message fields are length-bounded, reject control characters, and escape Slack link/mention syntax.
- Webhook URLs are treated as secrets and are never included in connector errors or message payloads.

The webhook URL must come from a secret manager or protected environment variable. Never place it in configuration files, command arguments, logs, fixtures, or version control. Slack may revoke leaked webhook URLs.

## Message content

Messages contain the account ID, detector ID, transition kind, prior and next states, occurrence time, run ID, and idempotency key. They do not include account domains, probe responses, evidence metadata, or the webhook URL.

## Failure mapping

- HTTP `200` with body `ok`: success
- HTTP `429`: retryable `rate_limited`; honor `Retry-After` when supplied
- HTTP `5xx`: retryable `transient`
- all other responses: non-retryable `permanent`
- connection, redirect, and timeout failures: retryable `transient`

Application composition must add bounded retry and durable delivery idempotency before enabling unattended delivery.
