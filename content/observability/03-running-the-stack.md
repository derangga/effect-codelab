---
title: Running the stack
order: 3
slug: 03-running-the-stack
summary: Start the collector, Tempo, Loki, Prometheus and Grafana with Docker or with Nix, then check that all five answer.
---

The config files describe five programs, and something has to start them, wait
until each is ready, and stop them again. There are two common ways to do that on
a laptop. Docker runs each program in a container. Nix runs the same programs
directly on your machine, in a shell that exists only inside this folder.

You need only one. They read the same files from `observability/`, they put
their data in the same `.data/` folder, and they listen on the same ports, so
nothing after this chapter depends on which you picked.

Start by keeping that state out of git. Add one line to `.gitignore`:

```sh
.data/
```

## Start the stack

Pick a tab. The other can wait until you want it.

#### Tab: Docker

Docker Compose describes the five programs in one file. Save it as
`docker-compose.yml`:

```yaml title="docker-compose.yml"
services:
  tempo:
    image: grafana/tempo:2.7.2
    command: ["-config.file=/etc/observability/tempo.yaml", "-config.expand-env=true"]
    environment:
      BIND_ADDR: 0.0.0.0
      DATA_DIR: /data
    volumes:
      - ./observability:/etc/observability:ro
      - ./.data:/data
    ports:
      - "127.0.0.1:3200:3200"

  loki:
    image: grafana/loki:3.4.5
    command: ["-config.file=/etc/observability/loki.yaml", "-config.expand-env=true"]
    environment:
      BIND_ADDR: 0.0.0.0
      DATA_DIR: /data
    volumes:
      - ./observability:/etc/observability:ro
      - ./.data:/data
    ports:
      - "127.0.0.1:3100:3100"

  prometheus:
    image: prom/prometheus:v3.5.0
    command:
      - --config.file=/etc/observability/prometheus.yaml
      - --storage.tsdb.path=/data/prometheus
      - --web.enable-otlp-receiver
    volumes:
      - ./observability:/etc/observability:ro
      - ./.data:/data
    ports:
      - "127.0.0.1:9090:9090"

  otelcol:
    image: ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib:0.124.0
    command: ["--config=/etc/observability/otelcol.yaml"]
    environment:
      BIND_ADDR: 0.0.0.0
      TEMPO_ENDPOINT: tempo:4417
      LOKI_ENDPOINT: http://loki:3100
      PROMETHEUS_ENDPOINT: http://prometheus:9090
    volumes:
      - ./observability:/etc/observability:ro
    ports:
      - "127.0.0.1:4317:4317"
      - "127.0.0.1:4318:4318"
      - "127.0.0.1:13133:13133"
    depends_on: [tempo, loki, prometheus]

  grafana:
    image: grafana/grafana:12.0.7
    environment:
      TEMPO_URL: http://tempo:3200
      LOKI_URL: http://loki:3100
      PROMETHEUS_URL: http://prometheus:9090
      GF_PATHS_DATA: /data/grafana
      GF_PATHS_PROVISIONING: /etc/observability/grafana/provisioning
      GF_SERVER_HTTP_PORT: "3001"
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_ROLE: Admin
      GF_AUTH_DISABLE_LOGIN_FORM: "true"
      GF_PLUGINS_PREINSTALL_DISABLED: "true"
    volumes:
      - ./observability:/etc/observability:ro
      - ./.data:/data
    ports:
      - "127.0.0.1:3001:3001"
    depends_on: [tempo, loki, prometheus]
```

Every image tag is exact, with no `latest`, and each is the same release the Nix
tab uses. The collector is the one that comes from somewhere else. Docker Hub
never published `0.124.0` (its tags jump from `0.123.0` to `0.126.0`), so the
image comes from the project's own registry, `ghcr.io`, under the same number.

Each service mounts `observability/` read-only at `/etc/observability`, and
Tempo, Loki, Prometheus and Grafana mount `.data/` at `/data`, which is the
`DATA_DIR` the configs expect. The `environment` blocks are the variables from
the last chapter: `BIND_ADDR: 0.0.0.0`, and the three kinds of host name, which
here are service names such as `tempo` and `loki`.

The `ports` lines all start with `127.0.0.1`. Docker would otherwise publish
them on every network interface, and Grafana here has no login. `depends_on`
starts Tempo, Loki and Prometheus before the collector and Grafana, though it
only orders the start. It does not wait for them to be ready, and the collector
retries until they are.

Start it, and stop it again, with:

```sh
docker compose up -d
docker compose down
```

`down` removes the containers and leaves `.data/` alone.

#### Tab: Nix

Nix needs two files. The first says which programs to put in the shell. Save it
as `flake.nix`:

```nix title="flake.nix"
{
  description = "Local Grafana stack for backend-effect";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/ac62194c3917d5f474c1a844b6fd6da2db95077d";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            process-compose
            opentelemetry-collector-contrib
            tempo
            grafana-loki
            prometheus
            grafana
          ];
          GRAFANA_HOME = "${pkgs.grafana}/share/grafana";
          PC_DISABLE_DOTENV = "1";
          shellHook = ''
            export DATA_DIR="$PWD/.data"
          '';
        };
      });
    };
}
```

A **flake** is a Nix project with a pinned set of inputs. The one input here is
`nixpkgs`, the collection of packages, and it is pinned to a full commit instead
of a branch name. A branch moves, and a commit does not, so that commit decides
every version below, and the Docker tags in the other tab are these same numbers:

| Program | Version |
| --- | --- |
| `opentelemetry-collector-contrib` | 0.124.0 |
| `tempo` | 2.7.2 |
| `grafana-loki` | 3.4.5 |
| `prometheus` | 3.5.0 |
| `grafana` | 12.0.7 |

Loki is `grafana-loki`. A package named plain `loki` also exists, and it is
something unrelated.

`GRAFANA_HOME` is where the Nix store keeps Grafana's web assets, which Grafana
needs to be told about. `shellHook` runs when you enter the shell, and sets
`DATA_DIR` to the full path of `.data/`. `bun` is in the list so that the same
shell can run the API.

`PC_DISABLE_DOTENV` is there for a less obvious reason. `process-compose` is a
program that starts and watches several others, and by default it reads `.env`
from the current folder and hands every variable in it to every program it
starts. Your `.env` holds `JWT_SECRET`, which none of the five should see. It
will also hold the `OTEL_` lines below, and Tempo reads those standard
variables. It would start exporting its own spans to the collector, where the
connector in [metrics from spans](/learn/observability/07-metrics-from-spans)
would count them as if they were requests. Setting the variable to `1` makes
`process-compose` ignore `.env`.

`process-compose` reads the second file. Save it as `process-compose.yaml`:

```yaml title="process-compose.yaml"
version: "0.5"

environment:
  - TEMPO_ENDPOINT=localhost:4417
  - LOKI_ENDPOINT=http://localhost:3100
  - PROMETHEUS_ENDPOINT=http://localhost:9090
  - TEMPO_URL=http://localhost:3200
  - LOKI_URL=http://localhost:3100
  - PROMETHEUS_URL=http://localhost:9090

processes:
  tempo:
    command: tempo -config.file=observability/tempo.yaml -config.expand-env=true
    readiness_probe:
      http_get: { host: 127.0.0.1, port: 3200, path: /ready }
      initial_delay_seconds: 5
      period_seconds: 3
      failure_threshold: 30

  loki:
    command: loki -config.file=observability/loki.yaml -config.expand-env=true
    readiness_probe:
      http_get: { host: 127.0.0.1, port: 3100, path: /ready }
      initial_delay_seconds: 5
      period_seconds: 3
      failure_threshold: 30

  prometheus:
    command: >-
      prometheus
      --config.file=observability/prometheus.yaml
      --storage.tsdb.path=$DATA_DIR/prometheus
      --web.listen-address=127.0.0.1:9090
      --web.enable-otlp-receiver
    readiness_probe:
      http_get: { host: 127.0.0.1, port: 9090, path: /-/ready }
      period_seconds: 3
      failure_threshold: 30

  otelcol:
    command: otelcol-contrib --config=observability/otelcol.yaml
    depends_on:
      tempo: { condition: process_healthy }
      loki: { condition: process_healthy }
      prometheus: { condition: process_healthy }
    readiness_probe:
      http_get: { host: 127.0.0.1, port: 13133, path: / }
      period_seconds: 3
      failure_threshold: 30

  grafana:
    command: grafana server --homepath $GRAFANA_HOME
    environment:
      - GF_PATHS_DATA=$DATA_DIR/grafana
      - GF_PATHS_LOGS=$DATA_DIR/grafana/log
      - GF_PATHS_PLUGINS=$DATA_DIR/grafana/plugins
      - GF_PATHS_PROVISIONING=$PWD/observability/grafana/provisioning
      - GF_SERVER_HTTP_ADDR=127.0.0.1
      - GF_SERVER_HTTP_PORT=3001
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
      - GF_AUTH_DISABLE_LOGIN_FORM=true
      - GF_PLUGINS_PREINSTALL_DISABLED=true
    depends_on:
      tempo: { condition: process_healthy }
      loki: { condition: process_healthy }
      prometheus: { condition: process_healthy }
    readiness_probe:
      http_get: { host: 127.0.0.1, port: 3001, path: /api/health }
      period_seconds: 3
      failure_threshold: 30
```

The top-level `environment` holds the host names from the last chapter, and here
every one is `localhost`. Each process runs a program with the shared config
file, plus the flags that file could not hold. Prometheus gets
`--web.enable-otlp-receiver`, which switches on the OTLP endpoint the collector
posts to, and `--storage.tsdb.path`, which points its data into `.data/`.

`readiness_probe` is a request that process-compose repeats until it succeeds,
and `depends_on` with `process_healthy` holds a process back until its
dependencies pass theirs. The collector and Grafana both wait for the three
backends.

Grafana is the process with the most settings. `GF_PATHS_*` move its database,
logs and plugins into `.data/`. `GF_PATHS_PROVISIONING` must be a full path
built from `$PWD`, because a relative one is resolved against Grafana's install
directory in the Nix store and finds nothing. `GF_PLUGINS_PREINSTALL_DISABLED`
stops it downloading extra apps at startup. The last four make it anonymous,
admin, with no login form, on `127.0.0.1:3001`.

Nix only sees files that git tracks, so add the three before using them:

```sh
git add flake.nix process-compose.yaml
```

Then enter the shell and start everything. The first `nix develop` downloads the
programs from a binary cache, which takes a few minutes, and writes
`flake.lock`. Add that to git too, so the lock travels with the project.

```sh
nix develop
process-compose up
```

`process-compose up` opens a terminal view of the five processes. Stop them with
`process-compose down` from a second terminal in the same folder, or pass
`-t=false` to `up` for plain log output.

### The environment lines

Back in `.env`, which already holds `JWT_SECRET`, add four lines. Nothing reads
them yet, and [exporting](/learn/observability/04-exporting) is the chapter that
does.

```sh
OTEL_SERVICE_NAME=effect-auth-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_TRACES_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
```

These are the standard OpenTelemetry names, so they mean the same thing to any
OpenTelemetry tool. The endpoint is the collector's HTTP port from the port
plan.

### Check that it is up

Tempo and Loki take about twenty seconds to become ready, so a check straight
after starting will report them down. Save this as `observability/check-stack.ts`
and run it:

```ts twoslash
// observability/check-stack.ts
import { Effect } from 'effect'

const services = [
  { name: 'collector', url: 'http://127.0.0.1:13133/' },
  { name: 'tempo', url: 'http://127.0.0.1:3200/ready' },
  { name: 'loki', url: 'http://127.0.0.1:3100/ready' },
  { name: 'prometheus', url: 'http://127.0.0.1:9090/-/ready' },
  { name: 'grafana', url: 'http://127.0.0.1:3001/api/health' },
]

const probe = (service: (typeof services)[number]) =>
  Effect.tryPromise(() => fetch(service.url)).pipe(
    Effect.map((response) => response.ok),
    Effect.timeout('2 seconds'),
    Effect.orElseSucceed(() => false),
    Effect.map((up) => ({ name: service.name, up })),
  )

const program = Effect.gen(function* () {
  const results = yield* Effect.forEach(services, probe, {
    concurrency: 'unbounded',
  })
  for (const { name, up } of results) {
    console.log(`${up ? 'up  ' : 'DOWN'} ${name}`)
  }
  const down = results.filter((result) => !result.up)
  if (down.length > 0) {
    return yield* Effect.fail(`not ready: ${down.map((r) => r.name).join(', ')}`)
  }
})

Effect.runPromise(program)
```

```sh
bun observability/check-stack.ts
```

```
up   collector
up   tempo
up   loki
up   prometheus
up   grafana
```

The five probes run at once, and each has two seconds to answer. A program that
is down, or too slow, is reported as `DOWN` rather than hanging the check, and
if any are down the script ends with the names of the ones that are, and a
non-zero exit.

Open [http://127.0.0.1:3001](http://127.0.0.1:3001). Grafana comes up without a
login, and **Connections > Data sources** lists Loki, Prometheus and Tempo, all
created from the YAML in the last chapter.

## What people get wrong

Changing a config and expecting a running stack to notice. Tempo, Loki, the
collector and Prometheus read their files once, at startup. With Docker, run
`docker compose restart` after editing one. With Nix, `process-compose process
restart` re-runs a program but keeps the process-compose file it loaded at the
start, so an edit to `process-compose.yaml` itself needs `process-compose down`
and `up`.

## Next

Five programs are running and nothing is sending them data.
[Exporting](/learn/observability/04-exporting) adds the one layer that makes the
API send its first trace, and shows what that trace is missing.
