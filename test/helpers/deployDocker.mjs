// A persistent Docker CLI double for the real deploy.sh state-transition tests. It never launches containers.
import fs from 'node:fs';
const file = process.env.SP_DOCKER_TEST_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
state.calls.push(args);
let code = 0;
const output = (value) => process.stdout.write(String(value) + '\n');
const container = (name) => state.containers[name];
if (args[0] === 'container' && args[1] === 'inspect') {
  const current = container(args.at(-1));
  if (!current) code = 1;
  else if (args.includes('--format')) {
    const format = args[args.indexOf('--format') + 1];
    if (format.includes('io.stronghold.managed')) output(current.managed);
    else if (format.includes('io.stronghold.release')) output(current.release);
    else if (format.includes('.State.Running')) output(current.running);
    else if (format.includes('.Config.Image')) output(current.image);
  }
} else if (args[0] === 'image' && args[1] === 'inspect') {
  if (args.includes('--format')) output(state.scenario === 'wrong-revision' ? 'c'.repeat(40) : state.newSha);
  else code = state.scenario === 'cached-rollback' ? 0 : 1;
} else if (args[0] === 'run') {
  const name = args[args.indexOf('--name') + 1];
  state.containers[name] = { managed: true, release: state.newSha, image: args.at(-1), running: true };
  if (name === 'stronghold' && state.scenario === 'run-failure') code = 1;
  else output(name);
} else if (args[0] === 'exec') {
  const name = args[2], mode = args[6];
  if (!container(name)?.running) code = 1;
  else if (mode === 'smoke' && name.endsWith('-candidate') && state.scenario === 'candidate-failure') code = 1;
  else if (mode === 'smoke' && name === 'stronghold' && state.scenario === 'live-failure') code = 1;
  else if (mode === 'drain') {
    state.drains++;
    if (state.scenario === 'busy' || (state.scenario === 'wait' && state.drains === 1)) code = 10;
    else if (state.scenario === 'unknown-gate') code = 1;
  }
} else if (args[0] === 'rm') {
  delete state.containers[args.at(-1)];
} else if (args[0] === 'stop') {
  container(args.at(-1)).running = false;
} else if (args[0] === 'rename') {
  const [, from, to] = args;
  if (!container(from) || container(to)) code = 1;
  else { state.containers[to] = container(from); delete state.containers[from]; }
} else if (args[0] === 'start') {
  container(args[1]).running = true;
} else if (args[0] !== 'pull') {
  throw new Error(`Unimplemented Docker call: ${args.join(' ')}`);
}
fs.writeFileSync(file, JSON.stringify(state));
process.exitCode = code;
