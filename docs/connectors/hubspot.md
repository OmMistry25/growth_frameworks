# HubSpot Company Connector

Status: synthetic company mapping implemented; network source not yet implemented

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

## Safety and testing

The checked-in fixture is explicitly marked synthetic, uses reserved `.example` domains, and contains no customer data or credentials. Tests read the fixture locally and perform no network requests. Authentication, bounded pagination, rate-limit handling, and transient retries belong to the next checkpoint's injected HTTP source.
