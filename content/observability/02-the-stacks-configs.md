---
title: The stack's configs
order: 2
slug: 02-the-stacks-configs
summary: Every config file for the collector, Tempo, Loki, Prometheus and Grafana, written out whole, and why each port sits where it does.
---

Five programs, five config files, and two ways to run them. The next chapter
starts them with Docker or with Nix, and you should not have to keep two sets of
config in step.

So the files are written once, here, and both runners read the same copies. The
only things that differ between the two paths are addresses. Inside Docker the
collector reaches Tempo at `tempo:4417`. Under Nix, everything runs on your own
machine, and it is `localhost:4417`. Those few values come from environment
variables, and each runner sets its own.

Make the folders first:

```sh
mkdir -p observability/grafana/provisioning/datasources
mkdir -p observability/grafana/provisioning/dashboards
```

## The port plan

Ports are the easy part to get wrong, so settle them before reading any file.
Under Docker each program has its own network and could use its default port.
Under Nix all five share your machine, and two programs that want the same
default fail to start. One plan has to work for both, so every URL in
this track is the same on either path.

| Port | Program | What it is |
| --- | --- | --- |
| 3000 | your API | already taken, from the last track |
| 3001 | Grafana | its default is 3000, which the API owns |
| 4317 | collector | OTLP over gRPC |
| 4318 | collector | OTLP over HTTP, the one the API uses |
| 13133 | collector | health check, so a runner can ask if it is ready |
| 3200 | Tempo | its HTTP API |
| 4417 | Tempo | OTLP over gRPC, from the collector |
| 4418 | Tempo | OTLP over HTTP |
| 9096 | Tempo | its internal gRPC |
| 3100 | Loki | its HTTP API |
| 9095 | Loki | its internal gRPC |
| 9090 | Prometheus | its HTTP API |

Three of those moves are not obvious. Tempo can receive OTLP itself, and by
default it takes 4317 and 4318, the same two the collector needs. Moving Tempo's
pair to 4417 and 4418 leaves the standard numbers for the collector, which is
the program your API talks to. And Tempo and Loki both default their internal
gRPC port to 9095, so Tempo moves to 9096.

Here is the plan as code, with a check that no two services share a port. Save
it as `observability/ports.ts`:

```ts twoslash
// observability/ports.ts
const ports = {
  api: 3000,
  grafana: 3001,
  tempoHttp: 3200,
  lokiHttp: 3100,
  prometheus: 9090,
  collectorGrpc: 4317,
  collectorHttp: 4318,
  collectorHealth: 13133,
  tempoOtlpGrpc: 4417,
  tempoOtlpHttp: 4418,
  tempoGrpc: 9096,
  lokiGrpc: 9095,
} as const

const owners = new Map<number, string>()
for (const [name, port] of Object.entries(ports)) {
  const taken = owners.get(port)
  if (taken !== undefined) {
    throw new Error(`${name} and ${taken} both want port ${port}`)
  }
  owners.set(port, name)
}

console.log(`${owners.size} ports, no two services share one`)
```

`bun observability/ports.ts` prints `12 ports, no two services share one`. Change
`tempoGrpc` back to `9095` and it stops with
`error: lokiGrpc and tempoGrpc both want port 9095`, which is the failure Nix
would otherwise hand you as a startup error from a program you did not write.

## Three kinds of variable

The files below contain `${...}` placeholders. Each program expands them in its
own syntax, so it is worth knowing the three kinds before you read them.

`BIND_ADDR` is the address a program listens on. It defaults to `127.0.0.1`, so
nothing is reachable from outside your machine. Docker sets it to `0.0.0.0`,
because inside a container `127.0.0.1` is the container itself and nothing else
could connect to it. Docker then publishes the ports on your host's `127.0.0.1`
only, which puts the exposure back where it started.

`DATA_DIR` is where Tempo, Loki and Prometheus keep what they store. Docker
mounts your `.data/` folder at `/data`, and Nix points at the same folder by its
full path. Either way the state lands in `.data/`, and deleting that folder
resets everything.

`TEMPO_ENDPOINT`, `LOKI_ENDPOINT`, `PROMETHEUS_ENDPOINT` and the three `*_URL`
variables are the host names. They are the only values that differ between the
runners.

The collector writes a variable as `${env:NAME}`. Tempo and Loki write
`${NAME}`, and only expand it when started with `-config.expand-env=true`, which
the next chapter passes. Grafana writes `$NAME`, and a literal dollar sign must
be doubled to `$$`, which matters in the data sources file below.

## The collector

The collector is the one address your API knows. Everything it does is declared
in three lists: where data comes in, what happens to it, and where it goes out.

```yaml title="observability/otelcol.yaml"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: ${env:BIND_ADDR:-127.0.0.1}:4317
      http:
        endpoint: ${env:BIND_ADDR:-127.0.0.1}:4318

processors:
  batch: {}

connectors:
  # Turns every span into a call counter and a duration histogram.
  spanmetrics:
    metrics_flush_interval: 15s
    dimensions:
      - name: http.route
      - name: http.response.status_code
    histogram:
      explicit:
        buckets: [5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s]

exporters:
  otlp/tempo:
    endpoint: ${env:TEMPO_ENDPOINT}
    tls:
      insecure: true
  otlphttp/loki:
    endpoint: ${env:LOKI_ENDPOINT}/otlp
  otlphttp/prometheus:
    endpoint: ${env:PROMETHEUS_ENDPOINT}/api/v1/otlp

extensions:
  health_check:
    endpoint: ${env:BIND_ADDR:-127.0.0.1}:13133

service:
  extensions: [health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/tempo, spanmetrics]
    metrics:
      receivers: [otlp, spanmetrics]
      processors: [batch]
      exporters: [otlphttp/prometheus]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp/loki]
```

`receivers` is the way in. `otlp` listens on 4317 for gRPC and 4318 for HTTP,
and the API will use the HTTP one.

`exporters` is the way out, one entry per backend. The part after the slash is
only a name, so `otlp/tempo` and `otlphttp/loki` can be told apart in the
pipelines. Tempo takes plain gRPC, hence `insecure: true`, which only means "no
TLS" on a connection that never leaves your machine. Loki and Prometheus both
accept OTLP over HTTP under a fixed path, `/otlp` and `/api/v1/otlp`, and the
exporter adds `/v1/logs` or `/v1/metrics` after it.

`connectors` is the odd one. A connector is an exporter in one pipeline and a
receiver in another, so data can cross from one signal to the next. `spanmetrics`
is how spans become metrics, and
[metrics from spans](/learn/observability/07-metrics-from-spans) is about it.
The `dimensions` list names the span attributes that become labels on those
metrics. Leave it as written for now.

`service.pipelines` ties it together, and it is where to look when data goes
missing. Traces flow to Tempo and, through `spanmetrics`, into the metrics
pipeline. Logs go to Loki. Metrics go to Prometheus, from the connector and from
anything the app sends directly, which for now is nothing.

The `health_check` extension answers on 13133, so a runner can ask whether the
collector is ready.

## Tempo

Tempo stores traces. Run as a single program with local disk, its config is
short.

```yaml title="observability/tempo.yaml"
stream_over_http_enabled: true

server:
  http_listen_address: ${BIND_ADDR:-127.0.0.1}
  http_listen_port: 3200
  grpc_listen_address: ${BIND_ADDR:-127.0.0.1}
  grpc_listen_port: 9096

distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: ${BIND_ADDR:-127.0.0.1}:4417
        http:
          endpoint: ${BIND_ADDR:-127.0.0.1}:4418

storage:
  trace:
    backend: local
    wal:
      path: ${DATA_DIR}/tempo/wal
    local:
      path: ${DATA_DIR}/tempo/blocks
```

`distributor.receivers.otlp` is the port Tempo listens on for traces, moved to
4417 and 4418 as the plan says. `storage` keeps data under `DATA_DIR`: a
write-ahead log for spans that just arrived, and blocks for older ones.
`stream_over_http_enabled` lets Grafana stream search results as they arrive.

## Loki

Loki stores logs, and one part of its config matters more than the rest.

```yaml title="observability/loki.yaml"
auth_enabled: false

server:
  http_listen_address: ${BIND_ADDR:-127.0.0.1}
  http_listen_port: 3100
  grpc_listen_address: ${BIND_ADDR:-127.0.0.1}
  grpc_listen_port: 9095

common:
  instance_addr: 127.0.0.1
  path_prefix: ${DATA_DIR}/loki
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory
  storage:
    filesystem:
      chunks_directory: ${DATA_DIR}/loki/chunks
      rules_directory: ${DATA_DIR}/loki/rules

schema_config:
  configs:
    - from: "2024-01-01"
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

limits_config:
  allow_structured_metadata: true
```

`common` is the single-program setup: one instance, a ring held in memory, files
on local disk. `grpc_listen_port` is the 9095 that Tempo gave up.

The part that matters is `schema_config` and `allow_structured_metadata`. Loki
indexes only a few labels per log stream, and keeps everything else as
**structured metadata**, values attached to each record that are searchable but
not indexed. OTLP logs arrive with fields like `trace_id` and `span_id`, and
Loki stores those as structured metadata. That needs schema `v13` and the `tsdb`
store, which is why the schema is spelled out rather than left to a default. The
two ids are what link a log line to its trace, and nothing in the later
chapters works without them.

## Prometheus

Prometheus is the odd one out. It takes almost all of its settings from the
command line, which the next chapter writes, and the file is nearly empty.

```yaml title="observability/prometheus.yaml"
# Prometheus will not start without a config file. Nothing is scraped here,
# because the collector pushes its data in over OTLP.
global:
  evaluation_interval: 15s
```

The file exists because Prometheus refuses to start without one: it exits with
`Error loading config (--config.file=prometheus.yml)`. Normally this file lists
what to scrape. Here nothing is scraped, because the collector pushes metrics in
over OTLP, and that needs a flag, `--web.enable-otlp-receiver`, rather than a
setting.

## Grafana

Grafana is configured by environment variables and by **provisioning**, a
folder of YAML it reads at startup to create data sources and dashboards. That
means nothing is clicked together by hand, and a fresh checkout comes up with
everything in place.

The data sources come first.

```yaml title="observability/grafana/provisioning/datasources/datasources.yaml"
apiVersion: 1

datasources:
  - name: Tempo
    uid: tempo
    type: tempo
    access: proxy
    url: $TEMPO_URL
    jsonData:
      tracesToLogsV2:
        datasourceUid: loki
        spanStartTimeShift: -5m
        spanEndTimeShift: 5m
        customQuery: true
        query: '{service_name="$${__span.tags["service.name"]}"} | trace_id="$${__trace.traceId}"'

  - name: Loki
    uid: loki
    type: loki
    access: proxy
    url: $LOKI_URL
    jsonData:
      derivedFields:
        - name: trace_id
          matcherType: label
          matcherRegex: trace_id
          url: "$${__value.raw}"
          datasourceUid: tempo
          urlDisplayLabel: Open trace

  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    url: $PROMETHEUS_URL
    isDefault: true
```

Each has a fixed `uid`, so that other config can point at it by name. The URLs
are `$TEMPO_URL`, `$LOKI_URL` and `$PROMETHEUS_URL`, the three that differ between
runners.

The two blocks under `jsonData` are the links between signals, and they are the
reason to provision at all.

`tracesToLogsV2` on Tempo makes a button on every span that opens Loki. The
`query` is what it runs: logs from the same service whose `trace_id` equals the
trace being viewed. The `$$` is the escape from earlier. Grafana would otherwise
read `${__trace.traceId}` as one of its own environment variables, find nothing,
and send an empty query. Written as `$$`, it reaches Tempo's own template, which
fills in the real id.

`derivedFields` on Loki goes the other way. It turns the `trace_id` field of a
log record into a link that opens that trace in Tempo. `matcherType: label`
means "look in the record's labels and structured metadata", which is where the
id lives.

Then the dashboards file, which points Grafana at a folder.

```yaml title="observability/grafana/provisioning/dashboards/dashboards.yaml"
apiVersion: 1

providers:
  - name: auth-api
    type: file
    allowUiUpdates: true
    options:
      path: $GF_PATHS_PROVISIONING/dashboards
```

The `path` is the folder this file sits in, so any `.json` dropped next to it is
loaded as a dashboard. There are none yet, and
[the dashboard](/learn/observability/08-the-dashboard) writes the first.
`allowUiUpdates: true` lets you edit a provisioned dashboard in the browser, and
the chapter shows how to bring that edit back into the file.

## What people get wrong

Writing a host name into a shared file. `localhost:4417` in `otelcol.yaml` works
under Nix and breaks under Docker, where `localhost` inside the collector's
container is the collector itself, and Tempo is somewhere else. The error is a
refused connection at runtime, and nothing in the file looks wrong. Anything
that names another program belongs in a variable, and the runner supplies it.

## Next

Six files describe the stack and nothing runs yet.
[Running the stack](/learn/observability/03-running-the-stack) starts it, once
with Docker and once with Nix, and checks that all five programs are up.
