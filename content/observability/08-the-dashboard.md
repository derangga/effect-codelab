---
title: The dashboard
order: 8
slug: 08-the-dashboard
summary: The three queries as a provisioned Grafana dashboard, written out whole, and how to edit it in the browser and bring the change back into the file.
---

The queries from the last chapter work, and a query is not something you leave
open on a second monitor. A chart is. Grafana can hold the three as a dashboard,
and the only question is where that dashboard lives.

By default a dashboard is clicked together in the browser and kept in Grafana's
own database. Delete `.data/`, or hand the project to a colleague, and it is
gone. So this one is a file. Grafana reads it at startup, and the stack already
knows where to look, because the dashboards file from
[the stack's configs](/learn/observability/02-the-stacks-configs) points at the
folder it sits in.

## The file

Save it next to that file, as
`observability/grafana/provisioning/dashboards/auth-api.json`:

```json title="observability/grafana/provisioning/dashboards/auth-api.json"
{
  "uid": "auth-api",
  "title": "Auth API",
  "tags": [
    "auth-api"
  ],
  "timezone": "browser",
  "schemaVersion": 41,
  "version": 1,
  "refresh": "10s",
  "time": {
    "from": "now-15m",
    "to": "now"
  },
  "panels": [
    {
      "id": 1,
      "type": "timeseries",
      "title": "Requests per second by route",
      "datasource": {
        "type": "prometheus",
        "uid": "prometheus"
      },
      "gridPos": {
        "h": 9,
        "w": 8,
        "x": 0,
        "y": 0
      },
      "fieldConfig": {
        "defaults": {
          "unit": "reqps",
          "custom": {
            "lineWidth": 2,
            "fillOpacity": 0
          }
        },
        "overrides": []
      },
      "targets": [
        {
          "refId": "A",
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "sum by (http_route) (rate(traces_span_metrics_calls_total{span_kind=\"SPAN_KIND_SERVER\"}[1m]))",
          "legendFormat": "{{http_route}}"
        }
      ]
    },
    {
      "id": 2,
      "type": "timeseries",
      "title": "Failed logins per second",
      "datasource": {
        "type": "prometheus",
        "uid": "prometheus"
      },
      "gridPos": {
        "h": 9,
        "w": 8,
        "x": 8,
        "y": 0
      },
      "fieldConfig": {
        "defaults": {
          "unit": "reqps",
          "custom": {
            "lineWidth": 2,
            "fillOpacity": 0
          }
        },
        "overrides": []
      },
      "targets": [
        {
          "refId": "A",
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "sum(rate(traces_span_metrics_calls_total{span_name=\"AuthHandlers.login\",status_code=\"STATUS_CODE_ERROR\"}[1m]))",
          "legendFormat": "failed logins"
        }
      ]
    },
    {
      "id": 3,
      "type": "timeseries",
      "title": "p95 latency by route",
      "datasource": {
        "type": "prometheus",
        "uid": "prometheus"
      },
      "gridPos": {
        "h": 9,
        "w": 8,
        "x": 16,
        "y": 0
      },
      "fieldConfig": {
        "defaults": {
          "unit": "ms",
          "custom": {
            "lineWidth": 2,
            "fillOpacity": 0
          }
        },
        "overrides": []
      },
      "targets": [
        {
          "refId": "A",
          "datasource": {
            "type": "prometheus",
            "uid": "prometheus"
          },
          "expr": "histogram_quantile(0.95, sum by (le, http_route) (rate(traces_span_metrics_duration_milliseconds_bucket{span_kind=\"SPAN_KIND_SERVER\"}[1m])))",
          "legendFormat": "{{http_route}}"
        }
      ]
    }
  ]
}
```

It is long because JSON is, and short on ideas. The top level names the dashboard:
`uid` becomes its address, `refresh` is how often the charts reload, and `time` is
the window they open on. `uid` is the one worth keeping stable, since the URL
`http://127.0.0.1:3001/d/auth-api` is built from it.

Each entry in `panels` is one chart. `type: "timeseries"` is a line chart over time.
`gridPos` places it on a 24 column grid, where `w: 8` is a third of the width, so
three panels at `x` of 0, 8 and 16 fill a row. `datasource` points at the
Prometheus source by the fixed `uid` the data sources file gave it.

Inside a panel, `targets` holds the queries. Each `expr` is a query from the last
chapter, character for character, and `legendFormat` turns a label into the line's
name: `{{http_route}}` writes `/login` under the line for that route.
`fieldConfig.defaults.unit` is what makes `reqps` read as "req/s" and `ms` as
milliseconds, and `fillOpacity: 0` leaves the lines unfilled so overlapping routes
stay readable.

Grafana picks up a new file in about ten seconds, with no restart. Send some
traffic, using the loop from the last chapter, and open the dashboard:

![The Auth API dashboard in Grafana with three panels: requests per second by route, failed logins per second, and p95 latency by route, each showing lines for /login, /me and /register](/images/observability-dashboard.webp)

Three charts, from three queries, with no application code behind them. The
failed logins line follows the wrong passwords you send, and the p95 for `/me`
sits far below the other two.

## Editing it in the browser

A file is a good place to keep a dashboard and a poor place to design one. Grafana's
editor shows the result as you go, so the usual way to change a chart is to change
it there. The provisioning file allows that: `allowUiUpdates: true` is the line
that does it.

Click **Edit** at the top right. Open a panel's menu and choose **Edit** to change
its query, title or unit, then use **Save dashboard**.

Where that save goes is the part to understand. It goes into Grafana's database,
under `.data/grafana/`, and the JSON file does not change. The two now disagree,
and the database wins until the file is edited. If you reset `.data/`, the file is
loaded again and the change is lost.

To keep the change, take the dashboard out of Grafana and put it in the file. Open
the dashboard, then **Export** and **Export as JSON**:

![The Export dashboard JSON drawer in Grafana showing the dashboard as JSON, with a switch for exporting to another instance and buttons to download, copy or cancel](/images/observability-export-json.webp)

Leave **Export the dashboard to use in another instance** off. Turned on, it swaps
the data source references for placeholders that another Grafana is meant to
fill in, and the panels here point at a data source by its fixed `uid` on purpose.

Choose **Download file** or **Copy to clipboard**, and replace the contents of
`auth-api.json` with what you got. The exported file is a good deal longer than
the one above: 328 lines against 125 in a test run. It is the same dashboard with
every default Grafana fills in written out, and it is valid as it is. Within ten
seconds Grafana loads it, and from then on the file and the database agree.

Then `git diff` shows exactly what you changed in the chart, which is the reason
to do all this.

## Checking it against real data

A query in a JSON file can be wrong without anyone noticing, because a chart with
a typo just stays empty. This script reads the dashboard back from Grafana,
runs every panel's query against Prometheus, and reports the ones that return
nothing. Save it as `observability/check-dashboard.ts`:

```ts twoslash
// observability/check-dashboard.ts
import { Effect, Schema } from 'effect'

const Dashboard = Schema.Struct({
  dashboard: Schema.Struct({
    panels: Schema.Array(
      Schema.Struct({
        title: Schema.String,
        targets: Schema.Array(Schema.Struct({ expr: Schema.String })),
      }),
    ),
  }),
})

const Series = Schema.Struct({
  data: Schema.Struct({ result: Schema.Array(Schema.Unknown) }),
})

const getJson = (url: string) =>
  Effect.tryPromise(() => fetch(url).then((response) => response.json()))

const check = Effect.fn('check')(function* (title: string, expr: string) {
  const series = yield* getJson(
    `http://127.0.0.1:9090/api/v1/query?query=${encodeURIComponent(expr)}`,
  ).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Series)),
    Effect.map((body) => body.data.result.length),
    Effect.orElseSucceed(() => 0),
  )
  console.log(`${series > 0 ? 'ok  ' : 'FAIL'} ${title} (${series} series)`)
  return series > 0
})

const program = Effect.gen(function* () {
  const { dashboard } = yield* getJson(
    'http://127.0.0.1:3001/api/dashboards/uid/auth-api',
  ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Dashboard)))

  const queries = dashboard.panels.flatMap((panel) =>
    panel.targets.map((target) => ({ title: panel.title, expr: target.expr })),
  )
  const results = yield* Effect.forEach(queries, (q) => check(q.title, q.expr))
  if (results.includes(false)) {
    return yield* Effect.fail('a panel query returned nothing, see FAIL above')
  }
})

Effect.runPromise(program)
```

With some recent traffic:

```sh
bun observability/check-dashboard.ts
```

```
ok   Requests per second by route (3 series)
ok   Failed logins per second (1 series)
ok   p95 latency by route (3 series)
```

It asks Grafana for the dashboard rather than reading the file, so it checks what
is loaded, including an edit you saved in the browser and have not exported yet. A
query that Prometheus rejects as invalid counts as no data too, and shows as
`FAIL`. A query that is valid and returns nothing, because there has been no
traffic in the last minute, does as well, so send some requests first.

## What people get wrong

Saving in Grafana and expecting the file to follow. **Save dashboard** feels like
the end of the job, the chart looks right, and the repository has not changed. The
edit lives only in `.data/`, so it disappears when someone else clones the project
or you reset the stack. The export is the step that makes it real.

## Where to go from here

The API now answers three questions it could not before: why was this request
slow, what happened to this login, and how often does it fail. None of it needed
a change to a handler beyond a name and an attribute.

From here, the stack is yours to point somewhere real. The collector's three
exporters are the only addresses to change to send the same data to a hosted
backend, and the API will not notice. If you want an app to put in front of this
API, the [Fullstack Monorepo](/learn/fullstack-monorepo) track builds one, with a
typed client and a React page.
