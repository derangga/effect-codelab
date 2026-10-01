---
title: Metrics from spans
order: 7
slug: 07-metrics-from-spans
summary: How the collector turns spans into request-rate, error and duration series, what Prometheus calls them, and the three queries the dashboard uses.
---

A trace explains one request. The question that comes next is about all of
them: how many logins are failing per minute, and is that more than usual? A
single trace cannot answer it, and you do not want to open a thousand to count.

The usual answer is to add counters to the code. Increment one when a login
fails, another when it succeeds, record a timer around the handler. That works,
and it is more code in every handler, plus the risk of forgetting one.

This API does not need it, because every request is already a span, and a span
records three things a metric wants: that it happened, how long it took, and
whether it failed. The collector sees every span on its way through, so it can
count them there. No line in the API changes in this chapter.

## The connector

You wrote the part that does this in [the stack's configs](/learn/observability/02-the-stacks-configs).
Here it is again, on its own:

```yaml
connectors:
  spanmetrics:
    metrics_flush_interval: 15s
    dimensions:
      - name: http.route
      - name: http.response.status_code
    histogram:
      explicit:
        buckets: [5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s]
```

A **connector** sits between two pipelines. The traces pipeline lists
`spanmetrics` among its exporters, which hands it every span, and the metrics
pipeline lists it among its receivers, which takes whatever it produces. For each
span, the connector does two things.

It adds one to a **counter** named `calls`. A counter is a number that only goes
up. And it records the span's length in a **histogram** named `duration`. A
histogram does not keep each value. It keeps a count of how many fell into each
size band, called a **bucket**, such as "between 50 and 100 milliseconds". The
`buckets` list sets those bands, and it decides how precise your latency answers
can be.

Every counter and histogram is split by labels. By default the connector splits
by the service name, the span name, the span kind and the status. The
`dimensions` list adds more, taken from span attributes, so the route and the
HTTP status can be told apart without the span names carrying them.
`metrics_flush_interval` is how often the connector sends its totals on. The
default is a minute, and a chart that moves once a minute is hard to read.

## What Prometheus stores

The connector calls its metrics `traces.span.metrics.calls` and
`traces.span.metrics.duration`. Prometheus does not allow dots in a name, and
its OTLP endpoint rewrites them as it stores the data. Dots become underscores, a
counter gets `_total`, and the unit joins a histogram's name. Four series names
come out:

```
traces_span_metrics_calls_total
traces_span_metrics_duration_milliseconds_bucket
traces_span_metrics_duration_milliseconds_count
traces_span_metrics_duration_milliseconds_sum
```

The labels follow the same rule, dots to underscores. One real series, for the
login requests that were answered with a 401, reads:

```
traces_span_metrics_calls_total{
  span_name="http.server POST",
  span_kind="SPAN_KIND_SERVER",
  http_route="/login",
  http_response_status_code="401",
  status_code="STATUS_CODE_OK",
  service_name="effect-auth-api",
  job="effect-auth-api"
}
```

Two things to notice. `status_code` is `STATUS_CODE_OK` on a 401, for the reason
from the last chapter: the server span only turns red when the server itself
broke. And `job` is a copy of the service name, which Prometheus adds on its
own.

Prometheus will list its metric names if you ask, which is a quick way to confirm
the connector is delivering:

```sh
curl -s 127.0.0.1:9090/api/v1/label/__name__/values
```

It prints exactly the four names above. Prometheus scrapes nothing here, so it
holds no metrics about itself, and those four are everything it has.

## Three queries

**PromQL** is Prometheus's query language. Three of its pieces cover everything
the dashboard needs.

`rate(x[1m])` takes a counter and gives its increase per second, averaged over
the last minute. A raw counter only goes up, which is no use on a chart, and the
rate is what you actually want to see. The window must hold several of the
connector's 15 second flushes, which is why a minute works and ten seconds does
not.

`sum by (label) (...)` adds series together and keeps only the labels you name,
so three series for one route, split by status, become one number per route.

`histogram_quantile(0.95, ...)` estimates the value that 95 percent of requests
came in under, from the buckets. It needs the `le` label, which is the upper
edge of each bucket, so `le` has to survive the `sum by`.

The first query is request rate per route:

```
sum by (http_route) (
  rate(traces_span_metrics_calls_total{span_kind="SPAN_KIND_SERVER"}[1m])
)
```

The `span_kind` filter matters. Without it every span is counted, and one login
alone is six of them, so the numbers come out several times too high. Server
spans are the requests.

The second is failed logins per second:

```
sum(
  rate(traces_span_metrics_calls_total{
    span_name="AuthHandlers.login", status_code="STATUS_CODE_ERROR"
  }[1m])
)
```

This one reads the handler span from the last chapter, because that is where a
failed login turns into an error. The `AuthHandlers.login` name is exactly why
the naming rule mattered: it is a label value you filter on, and it has to be
the same string everywhere.

The third is the 95th percentile latency per route:

```
histogram_quantile(0.95,
  sum by (le, http_route) (
    rate(traces_span_metrics_duration_milliseconds_bucket{
      span_kind="SPAN_KIND_SERVER"
    }[1m])
  )
)
```

## Run them

These three are the whole dashboard, and this script runs them against
Prometheus's HTTP API so you can see the numbers before there is a chart. Save
it as `observability/query.ts`:

```ts twoslash
// observability/query.ts
import { Effect, Schema } from 'effect'

const queries = {
  'requests per second, by route':
    'sum by (http_route) (rate(traces_span_metrics_calls_total{span_kind="SPAN_KIND_SERVER"}[1m]))',
  'failed logins per second':
    'sum(rate(traces_span_metrics_calls_total{span_name="AuthHandlers.login",status_code="STATUS_CODE_ERROR"}[1m]))',
  'p95 latency in ms, by route':
    'histogram_quantile(0.95, sum by (le, http_route) (rate(traces_span_metrics_duration_milliseconds_bucket{span_kind="SPAN_KIND_SERVER"}[1m])))',
}

const PrometheusResult = Schema.Struct({
  data: Schema.Struct({
    result: Schema.Array(
      Schema.Struct({
        metric: Schema.Record(Schema.String, Schema.String),
        value: Schema.Tuple([Schema.Number, Schema.String]),
      }),
    ),
  }),
})

const run = Effect.fn('run')(function* (title: string, expr: string) {
  const url = `http://127.0.0.1:9090/api/v1/query?query=${encodeURIComponent(expr)}`
  const { data } = yield* Effect.tryPromise(() =>
    fetch(url).then((response) => response.json()),
  ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(PrometheusResult)))

  console.log(title)
  if (data.result.length === 0) console.log('  no data yet')
  for (const { metric, value } of data.result) {
    const label = Object.values(metric).join(' ') || 'total'
    console.log(`  ${label.padEnd(12)} ${Number(value[1]).toFixed(2)}`)
  }
})

const program = Effect.forEach(
  Object.entries(queries),
  ([title, expr]) => run(title, expr),
  { discard: true },
)

Effect.runPromise(program)
```

It needs a minute of traffic for the rates to mean anything. Send some, then wait
for the next flush:

```sh
for i in $(seq 1 20); do
  curl -s -X POST 127.0.0.1:3000/login -H 'content-type: application/json' \
    -d '{"email":"ada@example.com","password":"wrong"}' -o /dev/null
  curl -s -X POST 127.0.0.1:3000/login -H 'content-type: application/json' \
    -d '{"email":"ada@example.com","password":"Secret1"}' -o /dev/null
  sleep 2
done
sleep 20
bun observability/query.ts
```

```
requests per second, by route
  /register    0.02
  /me          0.02
  /login       0.84
failed logins per second
  total        0.43
p95 latency in ms, by route
  /me          NaN
  /register    NaN
  /login       97.50
```

Your numbers will differ. The shape should not. `/login` carries almost all of
the traffic, and failed logins run at about half its rate, because the loop sent
one wrong password for every right one. `/register` and `/me` show a tiny rate,
from the single request each got in the last minute, and `NaN` for p95. That is
not an error. With no recent requests there are no samples to take a percentile
of, and PromQL says so.

The p95 for `/login` sits near 100 milliseconds although each login took about
60. That is the buckets talking. Every login lands in the 50 to 100 millisecond
band, and the percentile is estimated by interpolating inside it, so the answer
tends toward the top edge. Finer buckets around the range you care about give a
finer answer, and the cost is more series.

A request that matches no route, such as a mistyped URL, has no `http.route`, and
shows up as a row with no label.

## What people get wrong

Using these as exact figures. They are derived, so they inherit three limits. A
rate is an average over the window. A percentile is an estimate within a bucket.
And the counters live in the collector's memory, so a restart sets them back to
zero. `rate` handles the reset without a spike, but a total you read by eye does
not.

For anything where an exact count matters, count it in the code with Effect's
`Metric` module. The exporter from [exporting](/learn/observability/04-exporting)
sends those too, once `OTEL_METRICS_EXPORTER=otlp` is set.

## Next

Three queries are worth a chart each.
[The dashboard](/learn/observability/08-the-dashboard) provisions them as a
Grafana dashboard from a JSON file, and shows how to edit one in the browser and
bring the change back into the file.
