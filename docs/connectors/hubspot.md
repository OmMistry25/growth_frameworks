# HubSpot Company Connector

Status: read-only company source, defensive Node HTTPS adapter, and bounded retries implemented

The HubSpot connector owns translation from provider-specific company records into the framework's canonical `Account` contract. It does not embed a particular HubSpot portal's lifecycle stages, owner IDs, or prioritization policy.

## Mapping contract

Configuration names three HubSpot company properties:

- display name;
- domain;
- source segment or stage.

It also maps each accepted source segment value to `high_priority`, `standard`, or `low_priority`. Property names and source values remain connector configuration so the framework stays company-agnostic. Secret-like property names, duplicate property assignments, invalid internal names, and empty segment mappings are rejected.

Records are rejected when the provider ID is invalid, the company is archived, a required property is missing or `null`, the segment value is unmapped, or the resulting canonical account is invalid. Canonical IDs use `hubspot:company:<record-id>` and retain `{ system: "hubspot", id: "<record-id>" }` as an external reference.

## Provider response boundary

The page parser accepts the documented company response fields needed by this connector: `results`, record `id`, string-or-null `properties`, archive metadata, timestamps, and the optional `paging.next.after` cursor. It preserves the documented next link for diagnostics only; a future HTTP source must construct its own approved API URL from the cursor rather than following an arbitrary response URL.

## Read-only account source

`HubSpotCompanyAccountSource` implements the canonical `AccountSource` port through an injected HTTP interface. It composes only `GET` requests to the fixed `https://api.hubapi.com/crm/objects/2026-03/companies` endpoint, sets `archived=false`, and requests only the three configured mapping properties.

The source enforces page size, maximum page count, timeout, and cursor-loop bounds. It constructs each page URL itself from `paging.next.after` and never follows the provider's `paging.next.link`. Authentication, rate-limit, transient, and permanent responses are classified into canonical port errors without including the access token or response body.

## Safety and testing

The Node adapter independently restricts requests to the HTTPS companies endpoint, `GET`, an allowlist of query parameters, bearer authorization, a bounded timeout, redirects disabled, bounded JSON response bytes, and a bounded `Retry-After` value. Its retry wrapper retries only transport failures and selected transient statuses (`408`, `425`, `429`, `502`, `503`, and `504`), with one to five total attempts and capped delays.

The checked-in fixture is explicitly marked synthetic, uses reserved `.example` domains, and contains no customer data or credentials. Tests inject fake fetch functions, response queues, and sleep functions; they perform no network requests or real waiting. Live composition remains outside this package and requires an explicitly supplied access token and adapter.
