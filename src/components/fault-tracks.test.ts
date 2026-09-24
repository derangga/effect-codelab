import { expect, test } from 'vitest';
import { advance, idle, type Trace, type View } from './fault-tracks';

/** Steps the replay until it has to wait on the run, and returns each phase it passed. */
const play = (trace: Trace, settled: boolean, from: View = idle) => {
  const phases: Array<string> = [];
  let view = from;
  for (let step = advance(view, trace, settled); step; step = advance(view, trace, settled)) {
    view = step.view;
    phases.push(`${view.phase}${view.phase === 'run' ? `:${view.attempt}.${view.stage}` : ''}`);
  }
  return { view, phases };
};

test('a healthy call walks every stage and lands on the value', () => {
  const { view, phases } = play([{ n: 1, startedAt: 10, endedAt: 300, outcome: 'ok' }], true);
  expect(phases).toEqual(['run:1.0', 'run:1.1', 'run:1.2', 'run:1.3', 'ok']);
  expect(view.run).toBe(10);
});

test('a call still in flight holds at the first stage', () => {
  const { phases } = play([{ n: 1, startedAt: 10 }], false);
  expect(phases).toEqual(['run:1.0']);
});

test('a 404 drops at the status check and is not retried', () => {
  const { phases } = play(
    [{ n: 1, startedAt: 0, endedAt: 5, outcome: 'ResponseError: HTTP 404' }],
    true,
  );
  expect(phases).toEqual(['run:1.0', 'run:1.1', 'fail', 'judge', 'caught', 'failed']);
});

test('the gate waits for the run before it answers', () => {
  const trace: Trace = [{ n: 1, startedAt: 0, endedAt: 5, outcome: 'ResponseError: HTTP 500' }];
  expect(play(trace, false).view.phase).toBe('fail');

  const retried: Trace = [...trace, { n: 2, startedAt: 230 }];
  const failed = play(trace, false).view;
  expect(advance(failed, retried, false)?.view).toMatchObject({ verdict: 'retry', wait: 225 });

  const next = play(retried, false);
  expect(next.phases).toContain('back');
  expect(next.view).toMatchObject({ phase: 'run', attempt: 2, stage: 0 });
});

test('four failed attempts end as out of retries', () => {
  const trace: Trace = [1, 2, 3, 4].map((n) => ({
    n,
    startedAt: n * 1000,
    endedAt: n * 1000 + 5,
    outcome: 'RequestTimeout: over 2 seconds',
  }));
  const { view, phases } = play(trace, true);
  expect(phases.filter((phase) => phase === 'back')).toHaveLength(3);
  expect(view).toMatchObject({ phase: 'failed', attempt: 4, verdict: 'spent' });
});

test('a replayed timeout holds the first stage for as long as it really took', () => {
  const trace: Trace = [{ n: 1, startedAt: 2200, endedAt: 4200, outcome: 'RequestTimeout: over 2 seconds' }];
  const view: View = { phase: 'run', attempt: 1, stage: 0, run: 2200 };
  expect(advance(view, trace, false)).toMatchObject({ view: { phase: 'fail' }, after: 2000 });
});

test('a new run sends a finished drawing back to the start', () => {
  const done = play([{ n: 1, startedAt: 10, endedAt: 300, outcome: 'ok' }], true).view;
  expect(advance(done, [{ n: 1, startedAt: 900 }], false)?.view).toEqual(idle);
  expect(advance(done, [], false)?.view).toEqual(idle);
});
