---
title: When login fails
order: 6
slug: 06-when-login-fails
summary: Follow one failed login from its 401 to the span that failed, its log record, and back, using the two links Grafana has between them.
---

Somebody says they cannot log in. What you have is a rough time and a status
code, and in most systems that is where the trail ends. With traces and logs
tied together by an id, it is where the trail starts.

This chapter follows one failed login through everything the last four chapters
set up. It changes nothing in the API, and ends with a small script. Send a
wrong password first, so there is something to follow:

```sh
curl -i -s -X POST 127.0.0.1:3000/login -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"wrong"}'
```

```
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Date: Thu, 01 Oct 2026 10:17:09 GMT
Content-Length: 29

{"_tag":"InvalidCredentials"}
```

## The span that failed

Open the newest trace in Tempo, the same way as before. This is the one for the
bad password, with the `AuthHandlers.login` row clicked open to show its
details:

![Grafana trace view of a failed POST /login. The server span shows a 401, AuthHandlers.login has a red error marker, and its details show status error and a userId attribute](/images/observability-failed-login.webp)

Two spans disagree about whether anything went wrong, and the disagreement is
the point.

The server span, `http.server POST`, has a green status and carries
`http.response.status_code = 401`. OpenTelemetry's convention for HTTP servers
is that a 4xx is not an error on the server's side, because the server did
exactly what it should: it was asked to log somebody in with a wrong password,
and it said no. The failure is the caller's.

`AuthHandlers.login` has the red marker, with `Status: error`. Its work did
fail. The handler ended with `InvalidCredentials`, and a span takes its status
from how the code inside it finished. Open **Events** and the failure is there by
name, as an `exception` event of type `InvalidCredentials`.

So the error status you look for sits on the handler span, never on the
server span. To list every failed request in the last hour, ask Tempo for it
in TraceQL:

```
{ resource.service.name = "effect-auth-api" && status = error }
```

## Whose account

The details panel also shows the attribute from the last chapter,
`userId = 01a0f6ed-...`. That is the account the bad password was tried
against. You can now ask a sharper question than "any failures", namely every
failed login for one account:

```
{ name = "AuthHandlers.login" && status = error && span.userId = "01a0f6ed-1b9c-7ec2-9934-ab47be6f5b27" }
```

Try a login with an email nobody registered. The trace has the same shape, with
the same five spans, and a `PasswordHasher.verify` of the same length, because
the handler verifies against a dummy hash when the email is unknown. The only
difference is that `AuthHandlers.login` has no `userId`. The caller cannot tell
the two cases apart, by response or by timing, and you can, which is the right
way round.

One thing may look wrong. `PasswordHasher.verify` is green in a failed login.
It did not fail: it answered `false`, and a correct `false` is a success. The
login handler is the one that decided to say no.

## The log record

The server span is one half of what happened to this request. The other half is
a line you were already reading in the console:

```
INFO (#26) http.span=62ms: Sent HTTP response {
  "http.method": "POST",
  "http.url": "/login",
  "http.status": 401,
}
```

Since chapter four, the same record also goes to Loki. In Grafana, open
**Explore**, pick **Loki**, and run:

```
{service_name="effect-auth-api"} | http_status="401"
```

The braces select a log stream by label, and `service_name` is the one label
Loki indexes. Everything after the `|` filters the lines of those streams. The
status is not a label, it is structured metadata, one of the fields Effect
attached to the record: the method, the url, the status, and two that nobody
wrote.

![Grafana Explore on Loki showing a Sent HTTP response log line expanded, with fields including http_status 401, http_url /login, span_id and trace_id, and an Open trace button under Links](/images/observability-log-to-trace.webp)

`trace_id` and `span_id` are those two. Effect's logger reads the span that is
running when the line is written, and `Sent HTTP response` is written inside the
request's server span. So the record carries the id of the trace it belongs to,
and the id of that exact span. You wrote no logging code for it. The line was
already there, and the exporter added the ids.

## The two links

The ids are the join between the two kinds of record, and the data sources file
from [the stack's configs](/learn/observability/02-the-stacks-configs) turned
them into links.

From a trace to its logs: with the span details open, as in the screenshot
above, **Logs for this span** opens Loki beside Tempo with the query already
written, `{service_name="effect-auth-api"} | trace_id="..."`.

![Grafana split view with the failed login trace on the left and the Loki pane on the right, showing the one log line for that trace](/images/observability-trace-to-logs.webp)

From a log line back to its trace: expand the line, as above, and under
**Links** the `trace_id` field has an **Open trace** button. It opens that trace
in Tempo.

Together they make a loop with no typing in it. Start from whichever you were
handed, a user complaint, a log line in an alert, or a spike on a chart, and
step to the other one.

## Checking the join yourself

Both links work because the `trace_id` in Loki is the same string as a trace id
in Tempo. This script does the click by hand. It asks Loki for the newest 401,
takes the `trace_id` from it, and asks Tempo for that trace. Save it as
`observability/last-failure.ts`:

```ts twoslash
// observability/last-failure.ts
import { Effect, Schema } from 'effect'

const LokiResult = Schema.Struct({
  data: Schema.Struct({
    result: Schema.Array(
      Schema.Struct({ stream: Schema.Record(Schema.String, Schema.String) }),
    ),
  }),
})

const TempoTrace = Schema.NullOr(
  Schema.Struct({
    batches: Schema.Array(
      Schema.Struct({
        scopeSpans: Schema.Array(
          Schema.Struct({
            spans: Schema.Array(Schema.Struct({ name: Schema.String })),
          }),
        ),
      }),
    ),
  }),
)

const getJson = (url: string) =>
  Effect.tryPromise(() => fetch(url).then((response) => response.json()))

const program = Effect.gen(function* () {
  const query = encodeURIComponent(
    '{service_name="effect-auth-api"} | http_status="401"',
  )
  const logs = yield* getJson(
    `http://127.0.0.1:3100/loki/api/v1/query_range?query=${query}&limit=1`,
  ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(LokiResult)))

  const traceId = logs.data.result[0]?.stream.trace_id
  if (traceId === undefined) {
    return yield* Effect.fail('no 401 in the last hour, send a bad login first')
  }

  const trace = yield* getJson(
    `http://127.0.0.1:3200/api/traces/${traceId}`,
  ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(TempoTrace)))

  if (trace === null) {
    return yield* Effect.fail(
      'Tempo has not finished ingesting that trace, run this again in a few seconds',
    )
  }

  const names = trace.batches.flatMap((batch) =>
    batch.scopeSpans.flatMap((scope) => scope.spans.map((span) => span.name)),
  )
  console.log(`Loki says the 401 belongs to trace ${traceId}`)
  console.log(`Tempo has that trace, with ${names.length} spans:`)
  for (const name of names) console.log(`  ${name}`)
})

Effect.runPromise(program)
```

```sh
bun observability/last-failure.ts
```

```
Loki says the 401 belongs to trace d518fb96f9943f655da6b9c1ad04f461
Tempo has that trace, with 5 spans:
  sql.execute
  UserRepo.findByEmail
  PasswordHasher.verify
  AuthHandlers.login
  http.server POST
```

The two `Schema.Struct` values describe only the parts of each response the
script reads. Anything else in the JSON is ignored, and if either response
changes shape the script stops with a decoding error instead of printing
`undefined`.

It has two ways to stop early, and both are real. With no failed login in the
last hour, it says `no 401 in the last hour, send a bad login first`. And if you
run it seconds after the request, it can say that Tempo has not finished
ingesting the trace. Loki has the log line within a second, but a trace takes
longer to settle in Tempo, which is why `TempoTrace` allows `null`. In between,
Tempo can answer with only the spans it has received so far, so the count may
read lower than five. Give it a few more seconds and run it again, and the
count settles.

## What people get wrong

Looking for failures on the server span. A search for `status = error` finds the
spans whose code failed, such as the handler's, and never the server span of a
401. A search for the 401 itself finds the server span through its status code.
The two answer different questions: the first is what the code decided, and the
second is what the caller saw.

## Next

Traces and logs answer questions about one request. The next question is about
all of them: how many logins fail per minute, and whether that is normal.
[Metrics from spans](/learn/observability/07-metrics-from-spans) gets the answer
from the same spans, with no new code.
