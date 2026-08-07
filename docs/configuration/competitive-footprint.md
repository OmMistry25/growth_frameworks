# Competitive Footprint Configuration

Competitive Footprint external input uses two JSON files: detector and framework configuration, and canonical accounts. Example files are stored in `examples/competitive-footprint` and contain synthetic values only.

## Safety boundary

The loaders:

- accept regular files no larger than 1 MiB;
- require schema version `1`;
- reject unknown top-level and nested fields;
- reject fields with secret-like names anywhere in the input;
- validate every detector through its connector configuration contract;
- require unique detector and account identifiers;
- normalize and validate every account domain;
- require a cadence rule for every account segment and signal state.

Credentials do not belong in these files. Future connectors that require credentials must receive them through a separate runtime secret source.

## Configuration file

The configuration file contains:

- framework loss confirmation and cadence policy;
- DNS detector rules and resolver limits;
- HTTP subdomain rules and request limits;
- TCP rules and connection limits.

Detector match values, evidence codes, confidence, host templates, ports, paths, and accepted statuses are configuration rather than framework behavior.

## Account file

The account file declares whether its data is `synthetic-only` or `user-supplied`. Each account contains:

- a stable identifier;
- display name;
- domain;
- canonical priority segment;
- optional external system references.

Account identifiers and external references must be unique. Domains are normalized before they enter framework execution.

## Current execution status

This checkpoint validates and loads external files only. The existing CLI remains synthetic and dry-run-only. A later composition change must require explicit network authorization before using these files with live probe adapters.
