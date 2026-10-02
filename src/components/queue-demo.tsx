import { type ReactNode, useState } from 'react'
import { advance, itemIds, runQueue, type Stage } from '@/effect-demo/queue'
import { Dial, Panel, RunButtons, Token, useFlip, useRun } from './demo-kit'

const idle = (): Array<Stage> => itemIds.map(() => 'unmade')

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex-1">
      <h3 className="mb-2 font-semibold text-[11px] text-fd-muted-foreground uppercase tracking-wider">
        {title}
      </h3>
      <ul className="m-0 flex min-h-9 list-none flex-wrap content-start gap-2 p-0">{children}</ul>
    </div>
  )
}

/**
 * One producer, one bounded queue, one consumer, the same program the chapter
 * shows. An item is one token that travels from the producer, through the
 * queue, to the consumer. With a slow consumer the queue fills and the
 * producer stops inside `Queue.offer`, holding the item it could not hand over.
 */
export default function QueueDemo() {
  const [capacity, setCapacity] = useState(3)
  const [produceMs, setProduceMs] = useState(200)
  const [consumeMs, setConsumeMs] = useState(600)
  const [stages, setStages] = useState(idle)
  const { running, start, stop } = useRun()
  const { root, capture } = useFlip()

  const reset = () => {
    stop()
    capture()
    setStages(idle())
  }
  const run = () => {
    capture()
    setStages(idle())
    start((live) =>
      runQueue({ capacity, produceMs, consumeMs }, (item, stage) => {
        if (!live()) return
        capture()
        setStages((prev) => prev.map((s, i) => (itemIds[i] === item ? advance(s, stage) : s)))
      }),
    )
  }
  const change = (set: (value: number) => void) => (value: number) => {
    reset()
    set(value)
  }

  const at = (stage: Stage) => itemIds.filter((_, i) => stages[i] === stage)
  const queued = at('queued')
  const held = at('offering')
  const status =
    held.length > 0
      ? `The queue is full. The producer is suspended, holding #${held[0]}.`
      : at('written').length === itemIds.length
        ? 'All nine written.'
        : at('making').length > 0
          ? `The producer is making #${at('making')[0]}.`
          : running && at('unmade').length === 0
            ? 'The consumer is writing what is left.'
            : 'Press Run.'

  return (
    <Panel ref={root}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Dial label="Capacity" min={1} max={5} value={capacity} onChange={change(setCapacity)} />
        <Dial
          label="Producer makes one every"
          min={100}
          max={1000}
          step={100}
          value={produceMs}
          shown={`${produceMs} ms`}
          onChange={change(setProduceMs)}
        />
        <Dial
          label="Consumer writes one in"
          min={100}
          max={1000}
          step={100}
          value={consumeMs}
          shown={`${consumeMs} ms`}
          onChange={change(setConsumeMs)}
        />
        <RunButtons running={running} onRun={run} onReset={reset} />
      </div>

      <p className="mt-4 font-mono text-sm" role="status">
        {status}
      </p>
      <div className="mt-3 flex flex-wrap gap-4">
        <Box title="Producer">
          {/* One element through making and offering, so a held item keeps its full bar. */}
          {[...at('making'), ...held].map((item) => (
            <Token key={item} id={item} state="waiting" progressMs={produceMs}>
              #{item}
            </Token>
          ))}
        </Box>
        <Box title={`Queue, ${queued.length} of ${capacity}`}>
          {Array.from({ length: capacity }, (_, slot) =>
            queued[slot] === undefined ? (
              <Token key={`empty-${slot}`} state="skipped">
                <span className="sr-only">empty</span>
              </Token>
            ) : (
              <Token key={queued[slot]} id={queued[slot]} state="waiting">
                #{queued[slot]}
              </Token>
            ),
          )}
        </Box>
        <Box title="Consumer writes">
          {at('writing').map((item) => (
            <Token key={item} id={item} state="running" progressMs={consumeMs}>
              #{item}
            </Token>
          ))}
        </Box>
      </div>
      <div className="mt-4">
        <Box title="Written">
          {at('written').map((item) => (
            <Token key={item} id={item} state="done">
              #{item}
            </Token>
          ))}
        </Box>
      </div>
    </Panel>
  )
}
