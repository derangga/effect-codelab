import { useState } from 'react'
import { heavyId, runTasks, type TaskState, taskIds, weight } from '@/effect-demo/semaphore'
import { Board, Dial, Panel, RunButtons, useFlip, useRun } from './demo-kit'

const sleepMs = 600
const idle = (): Array<TaskState> => taskIds.map(() => 'waiting')
const columns = [
  { title: 'Waiting', states: ['waiting'] },
  { title: 'Running', states: ['running'] },
  { title: 'Done', states: ['done'] },
]

/**
 * Nine tasks, one semaphore. Each task is a sleep wrapped in
 * `withPermits`, the same program the chapter shows. Changing a control
 * interrupts the run in flight, and so does leaving the page.
 */
export default function SemaphoreDemo() {
  const [permits, setPermits] = useState(3)
  const [wantHeavy, setWantHeavy] = useState(false)
  const [states, setStates] = useState(idle)
  const { running, start, stop } = useRun()
  const { root, capture } = useFlip()

  // A task cannot ask for more permits than exist, so one permit means no heavy task.
  const heavy = wantHeavy && permits >= 2

  const reset = () => {
    stop()
    capture()
    setStates(idle())
  }
  const run = () => {
    capture()
    setStates(idle())
    start((live) =>
      runTasks({ permits, heavy, sleepMs }, (task, state) => {
        if (!live()) return
        capture()
        setStates((prev) => prev.map((s, i) => (taskIds[i] === task ? state : s)))
      }),
    )
  }

  const inUse = taskIds.reduce(
    (sum, task, i) => sum + (states[i] === 'running' ? weight(task, permits, heavy) : 0),
    0,
  )

  return (
    <Panel ref={root}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Dial
          label="Permits"
          min={1}
          max={5}
          value={permits}
          onChange={(value) => {
            reset()
            setPermits(value)
          }}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={heavy}
            disabled={permits < 2}
            onChange={(e) => {
              reset()
              setWantHeavy(e.target.checked)
            }}
          />
          Task #{heavyId} takes 2 permits
          {permits < 2 ? ' (needs 2 or more permits)' : ''}
        </label>
        <RunButtons running={running} onRun={run} onReset={reset} />
      </div>

      <p className="mt-4 font-mono text-sm" role="status">
        {inUse} of {permits} permits in use
      </p>
      <Board
        columns={columns}
        tokens={taskIds.map((task, i) => ({
          id: task,
          state: states[i],
          label:
            states[i] === 'running' && weight(task, permits, heavy) > 1 ? `#${task} ×2` : `#${task}`,
          progressMs: states[i] === 'running' ? sleepMs : undefined,
        }))}
      />
    </Panel>
  )
}
