---
title: Observability
order: 2
theme: applications
level: intermediate
icon: Activity
prereq: Assumes the HTTP Auth API track
summary: Eight chapters that add traces, logs and metrics to the HTTP Auth API and read them in a local Grafana, with every config file and two ways to run the stack.
---

The HTTP Auth API works, and you cannot see inside it. When `POST /login`
takes 300 milliseconds, nothing says whether the time went to the database, the
password hash or the token. When a login fails, the only trace is a 401 and a
line in the console.

This track fixes that. By the end, every request leaves a **trace** you can open
as a waterfall, a **log** line that links to that trace, and a dashboard of
request rate, failed logins and latency. All three come out of a small local
stack: an OpenTelemetry collector, Tempo, Loki, Prometheus and Grafana.

Two things are deliberately missing. The app has no metrics code, because the
collector turns spans into metrics for you, and
[metrics from spans](/learn/observability/07-metrics-from-spans) shows how. And
the app uses no OpenTelemetry package at all. The exporter is already inside
`effect`.

This track is documentation, like the one before it. Nothing here is built
inside this repository. Every TypeScript block is compiled when this site
builds, and every config file was run before it was written down.

## Is this stable?

Less than the rest of Effect. The exporter lives in `effect/observability`, and
every export there carries the same `@stability unstable` tag as the HTTP
modules in the [HTTP Auth API](/learn/http-auth-api) track. The
[`4.0.0` release notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0)
say what that tag means: an API with it "may have breaking changes in minor
releases".

The same reading applies. The tag says a name or an argument may move, and it
does not say the code is unfinished. If a release renames `Otlp.layerFromConfig`,
the compiler points at the line. Everything is pinned exactly, in the lockfile,
in the Docker tags and in the Nix flake, so that upgrading is something you
choose.

## What you need

The finished [HTTP Auth API](/learn/http-auth-api) from the previous track,
running with Bun. Its last chapter,
[`/me` and the public user](/learn/http-auth-api/07-me-and-the-public-user),
leaves the project in the state this one starts from. You do not install
anything new with `bun add`.

You also need one of two ways to run five services on your machine:

- **Docker**, with the compose plugin. Any recent Docker Desktop or OrbStack has
  it.
- **Nix**, with flakes turned on. It gives you the same five programs without
  containers, in a shell that exists only inside this folder.

Pick whichever you already have. Both run the same config files, so every URL
in this track is identical on either path, and
[running the stack](/learn/observability/03-running-the-stack) has a tab for
each.

## The shape of the project

Six files you already have change, and the rest is new. You do not need to
create anything now. Each file appears in the chapter that first needs it.

```
effect-auth-api/
├── .env                                   gains the OTEL_ lines
├── .gitignore                             gains .data/
├── docker-compose.yml                     Docker path
├── flake.nix                              Nix path
├── flake.lock                             Nix path, written by Nix
├── process-compose.yaml                   Nix path
├── .data/                                 what the five services store, never committed
├── observability/
│   ├── otelcol.yaml                       the collector
│   ├── tempo.yaml                         traces
│   ├── loki.yaml                          logs
│   ├── prometheus.yaml                    metrics
│   ├── spans.ts                           what Effect records with nothing installed
│   ├── ports.ts                           a check that no two services share a port
│   ├── check-stack.ts                     a check that all five are up
│   ├── last-failure.ts                    follows a 401 from Loki to Tempo
│   ├── query.ts                           the three queries, run against Prometheus
│   ├── check-dashboard.ts                 a check that every panel has data
│   └── grafana/provisioning/
│       ├── datasources/datasources.yaml
│       └── dashboards/                    dashboards.yaml and auth-api.json
└── src/
    ├── main.ts                            the exporter goes in
    ├── auth.ts                            spans on the hasher and the tokens
    ├── repo.ts                            a span on findByEmail
    └── handlers.ts                        renamed spans, and the user id
```

The API itself is never started by either runner. It runs on your machine, as it
did in the last track, and sends its telemetry to the stack. That keeps the
edit and reload loop you already have.

## How the chapters work

Each chapter opens with a problem, builds one idea, and ends on something you
can run. Read them in order, because each one assumes the project as the
previous chapter left it.

The first three never touch your code. They explain the words, write the config
files, and start the stack. The next five change the API, one idea each, and
check the result in Grafana.

## Roadmap

1. [Traces, logs and metrics](/learn/observability/01-traces-logs-metrics)
2. [The stack's configs](/learn/observability/02-the-stacks-configs)
3. [Running the stack](/learn/observability/03-running-the-stack)
4. [Exporting](/learn/observability/04-exporting)
5. [Filling the trace](/learn/observability/05-filling-the-trace)
6. [When login fails](/learn/observability/06-when-login-fails)
7. [Metrics from spans](/learn/observability/07-metrics-from-spans)
8. [The dashboard](/learn/observability/08-the-dashboard)

## What this track leaves out

A local stack is not a production one, and the gaps are worth naming.

**Alerting.** Grafana can page you when failed logins spike. That needs a
contact point and a rule, and neither teaches anything about Effect.

**Sampling and retention.** Every request is kept, and everything lives in
`.data/` until you delete it. A busy service keeps a fraction of its traces and
expires the rest.

**Security.** Grafana here is anonymous and admin, bound to `127.0.0.1`. That is
right for one laptop and wrong for anything shared.

**Effect's own `Metric` module.** Counters and gauges you define yourself work
with this exporter too. This track does not use them, because spans already
carry what the dashboard needs.

## Where to go next

If you want the same API with a frontend and a typed client, that is the
[Fullstack Monorepo](/learn/fullstack-monorepo) track. If you want the habits
that undo all of this, the [anti-patterns](/learn/anti-patterns) track
collects them.
