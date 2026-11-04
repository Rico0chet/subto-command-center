const test = require('node:test');
const assert = require('node:assert');
let L;
test.before(async () => { L = await import('../src/lookup.mjs'); });

test('parses addresses with and without commas', () => {
  assert.deepStrictEqual(L.parseAddress('123 Main St, Mesa, AZ 85203'), { full: '123 Main St, Mesa, AZ 85203', street: '123 Main St', city: 'Mesa', state: 'AZ', zip: '85203' });
  const b = L.parseAddress('4500 N Oak Ave Unit 4 Phoenix AZ 85018-1234');
  assert.strictEqual(b.street, '4500 N Oak Ave Unit 4');
  assert.strictEqual(b.city, 'Phoenix');
  assert.strictEqual(b.state, 'AZ');
  assert.strictEqual(b.zip, '85018');
  const c = L.parseAddress('77 Lake Rd, Lake Havasu City, az');
  assert.strictEqual(c.city, 'Lake Havasu City');
  assert.strictEqual(c.state, 'AZ');
});

test('builds direct links', () => {
  const site = (id) => L.DEFAULT_SITES.find((s) => s.id === id);
  const a = '123 Main St, Mesa, AZ 85203';
  assert.strictEqual(L.buildUrl(site('zillow'), a).url, 'https://www.zillow.com/homes/123-Main-St-Mesa-AZ-85203_rb/');
  assert.strictEqual(L.buildUrl(site('gmaps'), a).url, 'https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Mesa%2C%20AZ%2085203');
  assert.strictEqual(L.buildUrl(site('tps'), a).url, 'https://www.truepeoplesearch.com/resultaddress?streetaddress=123%20Main%20St&citystatezip=Mesa%2C%20AZ%2085203');
  assert.strictEqual(L.buildUrl(site('fps'), a).url, 'https://www.fastpeoplesearch.com/address/123-main-st_mesa-az-85203');
  assert.match(L.buildUrl(site('redfin'), a).url, /^https:\/\/duckduckgo\.com\/\?q=%5Csite%3Aredfin\.com%20123/);
  assert.strictEqual(L.buildUrl(site('airbnb'), a).url, 'https://www.airbnb.com/s/Mesa--AZ/homes');
  const paste = L.buildUrl(site('dealsauce'), a);
  assert.strictEqual(paste.paste, true);
  assert.strictEqual(paste.url, 'https://app.dealsauce.io/');
});

test('county pages and custom sites merge in; hidden sites are off', () => {
  const list = L.mergeSites({ county: { name: 'Maricopa', assessor: 'https://mcassessor.maricopa.gov/search?q={q}', recorder: 'https://recorder.maricopa.gov/' },
    lookupHidden: ['zillow'], lookupCustom: [{ id: 'x-1', label: 'Mine', url: 'https://example.com/?a={zip}', group: 'investor' }] });
  assert.strictEqual(list.find((s) => s.id === 'zillow').enabled, false);
  assert.strictEqual(list.find((s) => s.id === 'privy').enabled, false);
  const ass = list.find((s) => s.id === 'c-assessor');
  assert.strictEqual(L.buildUrl(ass, '1 A St, Mesa, AZ 85201').url, 'https://mcassessor.maricopa.gov/search?q=1%20A%20St%2C%20Mesa%2C%20AZ%2085201');
  assert.strictEqual(L.buildUrl(list.find((s) => s.id === 'c-recorder'), 'x').paste, true);
  assert.strictEqual(L.buildUrl(list.find((s) => s.id === 'x-1'), '1 A St, Mesa, AZ 85201').url, 'https://example.com/?a=85201');
  assert.throws(() => L.cleanCustomSite({ label: 'x', url: 'javascript:alert(1)' }));
});
