import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LIGHTWALLETD, ZINGO_CLI } from './config.js';

const exec = promisify(execFile);

// A testnet wallet driven through one-shot zingo-cli calls.
export class Zingo {
  #queue = Promise.resolve();

  constructor(dir, { viewkey, birthday } = {}) {
    this.dir = dir;
    this.viewkey = viewkey;
    this.birthday = birthday;
  }

  // zingo-cli processes share one wallet file, so calls run one at a time.
  call(command, args = [], { sync = true } = {}) {
    const job = this.#queue.then(() => this.#run(command, args, sync));
    this.#queue = job.catch(() => {});
    return job;
  }

  async addresses() {
    return (await this.call('addresses', [], { sync: false })).map((a) => a.encoded_address);
  }

  async newAddress() {
    return (await this.call('new_address', ['o'], { sync: false })).encoded_address;
  }

  async messages() {
    return this.call('messages', ['HF1|']);
  }

  async send(outputs) {
    const result = await this.call('quicksend', [JSON.stringify(outputs)], { sync: false });
    if (!result?.txids?.length) throw new Error(`send failed: ${JSON.stringify(result)}`);
    return result.txids[0];
  }

  async #run(command, args, sync) {
    const { stdout } = await exec(ZINGO_CLI, [...this.#flags(sync), command, ...args], {
      maxBuffer: 64 << 20,
      timeout: 10 * 60_000,
    });
    return parseOutput(stdout);
  }

  #flags(sync) {
    const flags = ['--chain', 'testnet', '--server', LIGHTWALLETD, '--data-dir', this.dir];
    flags.push(sync ? '--waitsync' : '--nosync');
    if (this.viewkey && !existsSync(join(this.dir, 'zingo-wallet.dat'))) {
      flags.push('--viewkey', this.viewkey, '--birthday', String(this.birthday));
    }
    return flags;
  }
}

// zingo-cli may print progress lines before its JSON result.
function parseOutput(stdout) {
  const start = stdout.search(/^[[{]/m);
  if (start === -1) return stdout.trim();
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return stdout.trim();
  }
}
