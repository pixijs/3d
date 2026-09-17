import childProcess from 'child_process';
import path from 'path';

export const spawn = (command: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const binPath = path.resolve(process.cwd(), 'node_modules/.bin');
    const envPath = `${binPath}${path.delimiter}${process.env.PATH}`;

    const child = childProcess.spawn(command, args, {
      stdio: 'inherit',
      cwd: process.cwd(),
      shell: process.platform === 'win32',
      env: { ...process.env, PATH: envPath },
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`"${command} ${args.join(' ')}" exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
