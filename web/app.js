const $ = (id) => document.getElementById(id);
const ZAT = 1e8;
const usd = (n) => (n == null ? '–' : `$${n.toFixed(2)}`);
const tx = (id) => `<a href="https://testnet.zcashexplorer.app/transactions/${id}" target="_blank" rel="noopener">${id.slice(0, 10)}…</a>`;
const signed = (n) => `<span class="${n >= 0 ? 'up' : 'down'}">${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}</span>`;

// The public deployment serves a snapshot of real testnet data; actions that spend need a local wallet.
const SNAPSHOT = window.HF_SNAPSHOT;
const SNAPSHOT_POSTS = { disclose: 'disclose', audit: 'audit' };
const READ_ONLY = 'This public demo is read-only: trading needs your own wallet and keys. Run Hushfolio locally (see the README).';

async function api(path, body) {
  if (SNAPSHOT) return snapshot(path, body);
  const res = await fetch(`/api/${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

async function snapshot(path, body) {
  const name = body ? SNAPSHOT_POSTS[path] : path;
  if (!name) throw new Error(READ_ONLY);
  return (await fetch(`${SNAPSHOT}${name.replace('/', '-')}.json`)).json();
}

if (SNAPSHOT) {
  document.querySelector('header').insertAdjacentHTML(
    'afterend',
    `<div class="banner">Read-only snapshot of the live Zcash testnet app, taken ${window.HF_SNAPSHOT_AT}. Every number here comes from real shielded transactions. To trade, run it locally: <a href="https://github.com/rizwanmoulvi/hushfolio">GitHub</a> · <a href="https://youtu.be/Q6GEWDKTkro">video</a></div>`,
  );
}

// Tabs
document.querySelectorAll('nav button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button, .tab').forEach((el) => el.classList.remove('on'));
    b.classList.add('on');
    $(b.dataset.tab).classList.add('on');
    if (b.dataset.tab === 'vault') loadBook();
  }),
);

async function loadAccount() {
  const { address, balance } = await api('account');
  $('address').textContent = address;
  const zat = (balance.total_ironwood_balance ?? 0) + (balance.total_orchard_balance ?? 0) + (balance.total_sapling_balance ?? 0);
  $('balance').textContent = `${(zat / ZAT).toFixed(4)} TAZ`;
}

async function loadQuote() {
  const quote = await api('quote');
  const names = { AAPLX: 'Apple', TSLAX: 'Tesla', NVDAX: 'NVIDIA', SPYX: 'S&P 500' };
  $('assets').innerHTML = Object.entries(names)
    .map(([sym, name], i) => `<label><input type="radio" name="sym" value="${sym}" ${i ? '' : 'checked'}>${name} <em>${usd(quote[sym])}</em></label>`)
    .join('');
}

async function loadPortfolio() {
  $('sync').textContent = 'syncing…';
  try {
    const { positions, pending, totals } = await api('portfolio');
    $('positions').innerHTML = positions.length
      ? positions.map(row).join('')
      : '<tr><td colspan="7" class="empty">No positions yet. Your receipts will appear here once the vault fills an order.</td></tr>';
    $('pending').innerHTML = pending.map((p) => `⧗ ${p.side} ${p.sym} ${p.pos} waiting for the vault · tx ${tx(p.txid)}`).join('<br>');
    $('t-value').textContent = usd(totals.valueUsd);
    $('t-unreal').innerHTML = signed(totals.unrealizedUsd);
    $('t-real').innerHTML = `${signed(totals.realizedUsd)}`;
    $('sync').textContent = `synced ${new Date().toLocaleTimeString()}`;
    setTimeout(loadSpend, 1500);
  } catch (err) {
    $('sync').textContent = `sync failed: ${err.message}`;
  }
}

function row(p) {
  const open = p.status === 'open';
  return `<tr>
    <td>${tx(p.closeTxid ?? p.fillTxid)}</td>
    <td>${p.sym}${p.stockBack ? ' <span class="tag">stock-back</span>' : ''}</td>
    <td>${p.qty.toFixed(6)}</td>
    <td>${usd(p.openPx)}</td>
    <td>${open ? usd(p.lastPx) : `${usd(p.closePx)} <span class="tag">closed</span>`}</td>
    <td>${signed(p.pnlUsd)}</td>
    <td>${open ? `<button class="ghost" data-sell="${p.pos}">Sell</button>` : ''}</td>
  </tr>`;
}

$('positions').addEventListener('click', async (e) => {
  const pos = e.target.dataset.sell;
  if (!pos) return;
  e.target.disabled = true;
  e.target.textContent = 'sending…';
  try {
    await api('sell', { pos });
    e.target.textContent = 'sent';
    loadPortfolio();
  } catch (err) {
    alert(err.message);
    e.target.disabled = false;
  }
});

$('buy').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const button = e.target.querySelector('button');
  button.disabled = true;
  button.textContent = 'Sending shielded order…';
  try {
    const { txid } = await api('buy', { sym: form.get('sym'), zec: form.get('zec') });
    button.textContent = `Sent · ${txid.slice(0, 10)}…`;
    $('pending').innerHTML = `⧗ BUY sent · tx ${tx(txid)}`;
    loadAccount();
    loadPortfolio();
  } catch (err) {
    alert(err.message);
  } finally {
    setTimeout(() => ((button.disabled = false), (button.textContent = 'Send shielded order')), 4000);
  }
});

async function loadSpend() {
  const s = await api('spend');
  if (!s.enabled) {
    $('spend-card').hidden = true;
    return;
  }
  const r = s.rules;
  $('br-balance').textContent = `Bitrefill credit: ${Math.round(s.balance.balance * 1e8)} sats`;
  $('spend-rule').textContent = `Rule set once: when a position closes, buy ${r.reward.label} with up to ${r.proceedsShare * 100}% of the verified sale. Auto-buys up to $${r.autoApproveUsd}; asks you up to $${r.maxPurchaseUsd}; never more. Each delivered card earns stock-back in the brand owner's stock (Flipkart → Walmart).`;
  const rows = [...s.approvals, ...s.purchases].map((p) => {
    const action =
      p.status === 'awaiting-approval'
        ? `<button class="ghost" data-spend="approve" data-pos="${p.pos}">Approve</button> <button class="ghost" data-spend="decline" data-pos="${p.pos}">Decline</button>`
        : p.status === 'failed'
          ? `<button class="ghost" data-spend="retry" data-pos="${p.pos}">Retry</button>`
          : '';
    const stockBack = p.stockBackPos ? ` · stock-back claimed (${p.stockBackPos.slice(0, 8)}…)` : p.stockBackError ? ` · <span class="down">stock-back: ${p.stockBackError}</span>` : '';
    const detail = p.error ? `<span class="down">${p.error.match(/"message":"([^"]+)"/)?.[1] ?? p.error.slice(0, 80)}</span>` : p.invoiceId ? `invoice ${p.invoiceId}${p.redemption ? ` · code ${p.redemption.hint}` : ''}${stockBack}` : '';
    return `<tr><td>${p.pos.slice(0, 10)}…</td><td>${p.reward ?? r.reward.label}</td><td>${p.priceUsd ? usd(p.priceUsd) : '–'}</td><td>${p.budgetUsd ? usd(p.budgetUsd) : '–'}</td><td><span class="tag">${p.status}</span> ${detail}</td><td>${action}</td></tr>`;
  });
  $('spend').innerHTML = rows.length
    ? `<table><thead><tr><th>Sale</th><th>Reward</th><th>Price</th><th>Budget</th><th>Status</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '<p class="hint">Nothing yet. Close a position to trigger the agent.</p>';
}

$('spend').addEventListener('click', async (e) => {
  const { spend, pos } = e.target.dataset;
  if (!spend) return;
  e.target.disabled = true;
  try {
    await api(`spend/${spend}`, { pos });
  } catch (err) {
    alert(err.message);
  }
  loadSpend();
});

async function loadBook() {
  const { positions, log } = await api('vault-book');
  $('book').innerHTML = positions.length
    ? positions
        .map((p) => `<tr><td>${p.pos.slice(0, 10)}…</td><td>${p.sym}</td><td>${Number(p.qty).toFixed(6)}</td><td>${usd(p.px)}</td><td>${p.status}</td><td class="down">unknown</td></tr>`)
        .join('')
    : '<tr><td colspan="6" class="empty">No orders yet.</td></tr>';
  $('log').textContent = log.join('\n') || 'Waiting for orders…';
}

let disclosure;
$('disclose').addEventListener('click', async () => {
  disclosure = await api('disclose', {});
  $('disclosure').textContent = JSON.stringify({ ...disclosure, ufvk: `${disclosure.ufvk.slice(0, 48)}…` }, null, 2);
  $('run-audit').disabled = false;
});

$('run-audit').addEventListener('click', async (e) => {
  e.target.disabled = true;
  $('report').innerHTML = '<p class="hint">Building a view-only wallet from the key and syncing it…</p>';
  try {
    renderReport(await api('audit', disclosure));
  } catch (err) {
    $('report').innerHTML = `<p class="down">${err.message}</p>`;
  }
  e.target.disabled = false;
});

function renderReport(r) {
  const checks = (p) =>
    Object.entries(p.checks)
      .map(([name, c]) => `<div class="check"><b class="${c.ok ? 'up' : 'down'}">${c.ok ? '✓' : '✗'}</b>${name}: ${c.detail}</div>`)
      .join('');
  $('report').innerHTML = `
    <div class="verdict ${r.passed ? 'up' : 'down'}">${r.passed ? 'Verified' : 'Discrepancies found'}</div>
    <div class="kv"><span>Realized P&amp;L</span><b>${signed(r.totals.realizedUsd)} · ${r.totals.realizedZec.toFixed(6)} TAZ</b></div>
    <div class="kv"><span>Open positions value</span><b>${usd(r.totals.valueUsd)}</b></div>
    <div class="kv"><span>Forged receipts rejected</span><b>${r.rejected.length}</b></div>
    ${r.positions.map((p) => `<div class="audit-pos"><b>${p.sym}</b> ${p.qty.toFixed(6)} · ${p.status} · ${signed(p.pnlUsd)}${checks(p)}</div>`).join('')}`;
}

loadAccount();
loadQuote();
loadPortfolio();
loadSpend();
setInterval(loadPortfolio, 60_000);
setInterval(loadAccount, 30_000);
