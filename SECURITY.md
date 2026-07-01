# Security Policy

## Supported Versions

This project is pre-1.0. Security fixes are considered for the current `main`
branch and the latest published release candidate.

## Reporting a Vulnerability

Please report suspected vulnerabilities through GitHub Security Advisories or by
opening a private issue with reproduction steps, affected fixture or command
paths, and expected impact. Do not include live credentials, customer data, or
private connector payloads in reports.

## Safety Model

`connector-route-replay` is local-first. It reads fixture files, explains
connector routing decisions, and prints reports. It must not call live
connectors, read credential stores, publish data, or perform external writes.
Treat any route involving destructive actions, credential access, or external
writes as requiring a separate approved workflow.
