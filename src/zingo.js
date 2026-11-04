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
  // net: 'sync' waits for a full sync, 'online' skips it, 'offline' never touches the network.
  call(command, args = [], { net = 'sync' } = {}) {
    const job = this.#queue.then(() => this.#run(command, args, net));
    this.#queue = job.catch(() => {});
    return job;
  }

  async addresses() {
    return (await this.call('addresses', [], { net: 'offline' })).map((a) => a.encoded_address);
  }

  async newAddress() {
    return (await this.call('new_address', ['o'], { net: 'offline' })).encoded_address;
  }

  // zingo-cli prints balances as "key: value" lines, not JSON.
  async balance() {
    const raw = await this.call('balance', [], { net: 'offline' });
    return Object.fromEntries([...String(raw).matchAll(/(\w+): ([\d_]+)/g)].map(([, k, v]) => [k, Number(v.replaceAll('_', ''))]));
  }

  // Every Hushfolio memo this wallet sent or received, after a full sync.
  async messages() {
    const result = await this.call('messages', ['HF1|']);
    if (!Array.isArray(result?.value_transfers)) throw new Error(`messages failed: ${String(result).slice(0, 300)}`);
    return result.value_transfers;
  }

  async send(outputs) {
    const result = await this.call('quicksend', [JSON.stringify(outputs)], { net: 'online' });
    if (!result?.txids?.length) throw new Error(`send failed: ${JSON.stringify(result)}`);
    return result.txids[0];
  }

  async #run(command, args, net) {
    const { stdout } = await exec(ZINGO_CLI, [...this.#flags(net), command, ...args], {
      maxBuffer: 64 << 20,
      timeout: 10 * 60_000,
    });
    return parseOutput(stdout);
  }

  // Every online session boots the Nym mixnet (~30 s), so local reads go offline.
  #flags(net) {
    const flags = ['--chain', 'testnet', '--data-dir', this.dir];
    if (net === 'offline') flags.push('--offline');
    else flags.push('--server', LIGHTWALLETD, net === 'sync' ? '--waitsync' : '--nosync');
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
