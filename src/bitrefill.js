const API = 'https://api.bitrefill.com/v2';

// Bitrefill REST v2. Purchases are real and paid from the account balance.
export class Bitrefill {
  constructor(apiKey = process.env.BITREFILL_API_KEY) {
    if (!apiKey) throw new Error('BITREFILL_API_KEY is not set');
    this.apiKey = apiKey;
  }

  // Balance is denominated in BTC; product prices come back in satoshis.
  balance() {
    return this.#get('/accounts/balance');
  }

  product(id) {
    return this.#get(`/products/${encodeURIComponent(id)}`);
  }

  // auto_pay settles from balance immediately, so a created invoice is a purchase.
  buy({ productId, value }) {
    return this.#request('POST', '/invoices', {
      products: [{ product_id: productId, value, quantity: 1 }],
      payment_method: 'balance',
      auto_pay: true,
    });
  }

  invoice(id) {
    return this.#get(`/invoices/${id}`);
  }

  order(id) {
    return this.#get(`/orders/${id}`);
  }

  #get(path) {
    return this.#request('GET', path);
  }

  async #request(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`bitrefill ${method} ${path} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json.data ?? json;
  }
}
