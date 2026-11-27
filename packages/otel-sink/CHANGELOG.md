# Changelog

## 0.1.2

### Changed

- The OTLP/HTTP receiver and the checks of the query parameters go through the request tracking of the service, as the queries do. Thus the drain of a shutdown waits for each export. Before the start of the server, an export gets a 503 that the sender can send again.
- A refusal (400, 413 or 415) is a reply of the route with its status, and the request tracking records it as done, not as a failure.

### Added

- `RECEIVER_ROUTES`: the three routes of the receiver, on the controller `receiver`.

## 0.1.1

### Fixed

- Version 0.1.0 has no `dist` folder, so its entry points and the command `otel-sink` do not work. The build of the repository did not start the build of this package. Use 0.1.1 or later.

## 0.1.0

### Added

- The first release. `@mark1russell7/otel-sink` is an OTLP/HTTP receiver for one computer with no collector. It keeps spans, logs and metric points in one SQLite file.
- The receiver: `POST /v1/traces`, `/v1/logs` and `/v1/metrics` take OTLP JSON, with gzip or without it. A protobuf body gets 415, a body larger than 8 MiB gets 413, and a body that is not OTLP gets 400.
- The retention rules (`RetentionRules`): a maximum age and a maximum size for each signal, and a hard limit of 1 GiB on the sum. The store caps a signal at each write, and a worker prunes in bounded parts.
- The queries: `GET /api/slowest`, `/api/errors`, `/api/trace`, `/api/services` and `/api/stats`.
- The command `otel-sink`, with the environment variables `PORT`, `PROBE_PORT`, `SERVICE_PROFILE` and `SINK_DB`. It refuses to start when its own OTLP endpoint is its receiver.
- The plain functions `openStore`, `spanRows`, `logRows`, `pointRows`, `slowest`, `errors`, `trace` and `services`, and `declare(options)` for the service.
