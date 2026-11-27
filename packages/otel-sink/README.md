# @mark1russell7/otel-sink

A small OTLP/HTTP receiver for one computer. It keeps spans, logs and metric points in one SQLite file, with retention rules. It answers questions about them over HTTP: the slowest spans, the errors, one trace with its logs, and the counts of each service.

The sink is for a development computer or a small host with no collector. It is not a replacement for a collector and a store, for example Tempo, Loki or Prometheus.

## Start it

```sh
npm install --global @mark1russell7/otel-sink
SINK_DB=~/otel-sink.db PORT=4318 otel-sink
```

The environment gives these values. The value in parentheses is the value without the variable.

- `PORT` (4318): the port of the receiver and of the queries.
- `PROBE_PORT` (9090): the port of `/startup`, `/readiness`, `/liveness` and `/report`.
- `SERVICE_PROFILE` (`local`): the profile of the shutdown, `local` or `pod`.
- `SINK_DB` (`otel-sink.db` in the home folder): the SQLite file. The sink makes its folder when the folder is not there.
- `OTEL_EXPORTER_OTLP_ENDPOINT`: the endpoint of the telemetry of the sink itself. The sink refuses to start when it is its own receiver, because each export then makes a new export.

Point a sender at the sink:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
```

## The receiver

- `POST /v1/traces`, `POST /v1/logs` and `POST /v1/metrics` take a body of OTLP JSON, with gzip or without it.
- **Only JSON.** The default protocol of the OTLP exporters is `http/protobuf`. The sink answers it with 415, and the body of the answer names the setting `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`.
- **The limits.** A body larger than 8 MiB gets 413. A body that is not OTLP JSON gets 400. The sink reads and drops the rest of a refused body, thus the sender reads the answer and gets no reset.
- **The metrics.** The sink keeps the points of sums, gauges and histograms. It keeps the count, the sum and the buckets of each histogram point.

## The queries

Each query takes `since` (a time in milliseconds since the epoch, the last hour by default), `limit` (from 1 to 1000, 50 by default) and `service`. Each time in a result is in milliseconds since the epoch. A bad parameter gets 400 with a list of the problems.

| Route | Result |
| --- | --- |
| `GET /api/slowest` | The slowest spans of the window, the slowest first |
| `GET /api/errors` | The spans with the status error and the logs from the severity ERROR (17), the newest first |
| `GET /api/trace?id=<trace id>` | The spans and the logs of one trace, in the order of their times |
| `GET /api/services` | For each service: the count of spans, the count of failed spans, the error rate and the slowest span |
| `GET /api/stats` | The rows and the bytes of each signal, the size of the file, and the retention rules |

## Retention

The retention rules are data (`RetentionRules`). Each signal has a maximum age and a maximum size.

- **The defaults.** Spans and logs: 3 days and 256 MiB each. Metric points: 7 days and 128 MiB.
- **The hard limit.** The sum of the sizes must be 1 GiB or less. `openStore` refuses rules with problems, and `retentionProblems` gives those problems.
- **The size of a row.** The store counts the bytes of the text of each row, 8 bytes for each number and 32 bytes for the row. Triggers keep the sum of each signal in the table `sizes`.
- **The cap at each write.** After each export, the store deletes the oldest rows of a signal that is past its size. Thus a signal goes past its size by one export at most.
- **The prune.** A worker deletes the rows past their age each minute, and the oldest rows past each size. Each delete is one transaction of at most 5000 rows. Each part of a prune does at most 20 deletes, then the intake continues.
- **The file.** The file uses `auto_vacuum = INCREMENTAL`, and each prune gives the free pages back to the disk.

## As a library

`openStore`, the decoders (`spanRows`, `logRows`, `pointRows`) and the queries (`slowest`, `errors`, `trace`, `services`) are plain functions. `declare(options)` gives the service with its receiver, its queries and its retention worker, and it starts nothing.

```ts
import { declare, PROFILES } from "@mark1russell7/otel-sink";

const life = await declare({ port: 4318, probePort: 9090, profile: PROFILES["local"]!, path: "sink.db" }).run();
```
