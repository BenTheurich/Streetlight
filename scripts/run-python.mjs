import { spawn } from 'node:child_process';

const configured = Object.hasOwn(process.env, 'STREETLIGHT_PYTHON');
const executable = configured ? process.env.STREETLIGHT_PYTHON : 'python';

if (executable === '') {
  console.error('Failed to start Python interpreter "": STREETLIGHT_PYTHON is empty');
  process.exitCode = 1;
} else {
  const child = spawn(executable, process.argv.slice(2), {
    shell: false,
    stdio: 'inherit',
  });
  let settled = false;

  child.once('error', (error) => {
    if (settled) return;
    settled = true;
    console.error(`Failed to start Python interpreter ${JSON.stringify(executable)}: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (settled) return;
    settled = true;
    if (code !== null) {
      process.exitCode = code;
      return;
    }
    console.error(
      `Python interpreter ${JSON.stringify(executable)} terminated by signal ${signal ?? 'unknown'}`,
    );
    process.exitCode = 1;
  });
}
