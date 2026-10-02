import { useState } from 'react'
import { failingId, runTasks, type TaskState, taskIds } from '@/effect-demo/many-at-once'
import { Board, Dial, Panel, RunButtons, useFlip, useRun } from './demo-kit'

const sleepMs = 600
const idle = (): Array<TaskState> => taskIds.map(() => 'waiting')
const columns = [
  { title: 'Waiting', states: ['waiting'] },
  { title: 'Running', states: ['running'] },
  { title: 'Finished', states: ['done', 'failed', 'interrupted'] },
]

/**
 * Nine tasks through one `Effect.forEach`, and a dial for its `concurrency`
 * option. The failing toggle shows what the option does not change: the first
 * failure interrupts whatever is running and the rest never start.
 */
export default function ManyAtOnceDemo() {
  const [concurrency, setConcurrency] = useState(3)
  const [failing, setFailing] = useState(false)
  const [states, setStates] = useState(idle)
  const { running, start, stop } = useRun()
  const { root, capture } = useFlip()

  const reset = () => {
    stop()
    capture()
    setStates(idle())
  }
  const run = () => {
    capture()
    setStates(idle())
    start((live) =>
      runTasks({ concurrency, failing, sleepMs }, (task, state) => {
        if (!live()) return
        capture()
        setStates((prev) => prev.map((s, i) => (taskIds[i] === task ? state : s)))
      }),
    )
  }

  const count = (state: TaskState) => states.filter((s) => s === state).length
  const status = states.includes('failed')
    ? `#${failingId} failed. ${count('interrupted')} running tasks were interrupted and ${count('waiting')} never started.`
    : `${count('running')} running, ${count('done')} of ${taskIds.length} done`

  return (
    <Panel ref={root}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Dial
          label="concurrency"
          min={1}
          max={taskIds.length}
          value={concurrency}
          onChange={(value) => {
            reset()
            setConcurrency(value)
          }}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={failing}
            onChange={(e) => {
              reset()
              setFailing(e.target.checked)
            }}
          />
          Task #{failingId} fails
        </label>
        <RunButtons running={running} onRun={run} onReset={reset} />
      </div>

      <p className="mt-4 font-mono text-sm" role="status">
        {status}
      </p>
      <Board
        columns={columns}
        tokens={taskIds.map((task, i) => ({
          id: task,
          state: states[i],
          label: `#${task}`,
          progressMs: states[i] === 'running' ? sleepMs : undefined,
        }))}
      />
    </Panel>
  )
}
