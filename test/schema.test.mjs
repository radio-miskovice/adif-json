import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';

const schema = JSON.parse(readFileSync(new URL('../adif.schema.json', import.meta.url), 'utf8'));
const yamlSchema = YAML.parse(readFileSync(new URL('../adif.schema.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: true, strictTypes: false, allowUnionTypes: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const valid = (document) => assert.equal(validate(document), true, JSON.stringify(validate.errors));
const invalid = (document) => assert.equal(validate(document), false, JSON.stringify(document));
const record = (fields) => ({ records: [fields] });
const definition = (name) => ajv.compile({ $schema: schema.$schema, $defs: schema.$defs, $ref: `#/$defs/${name}` });

test('JSON and YAML are identical and pass the 2020-12 meta-schema', () => {
  assert.deepEqual(yamlSchema, schema);
  assert.equal(ajv.validateSchema(schema), true);
  assert.equal(ajv.validateSchema(yamlSchema), true);
});

test('all 181 standard QSO fields and four standard header fields remain mapped', () => {
  assert.equal(Object.keys(schema.$defs.Record.properties).length, 183);
  assert.deepEqual(Object.keys(schema.$defs.Header.properties),
    ['adif_ver', 'created_timestamp', 'programid', 'programversion', 'user_defined', 'app']);
  for (const name of Object.keys(schema.$defs.Record.properties)) assert.equal(name, name.toLowerCase());
});

test('representative JSON-native document', () => {
  valid({
    header: { adif_ver: '3.1.8', programid: 'Example', created_timestamp: '2026-10-20T18:23:35Z' },
    records: [{
      call: 'OK1ABC', qso_date: '2026-10-20', time_on: '18:23:00Z', time_off: '18:24:35.25Z',
      band: '20m', freq: 14.074, mode: 'MFSK', submode: 'FT8',
      dxcc: 503, cqz: 15, ituz: 28, tx_pwr: 5, qso_random: false,
      name: '\u017dofie', name_intl: '\u017dofie',
      comment: 'Unicode \u2713\nSecond line', notes: 'First line\nSecond line',
      gridsquare: 'JN79AA00', gridsquare_ext: 'ab12',
      pota_ref: ['OK-0001', 'K-10000@US-WY'], my_pota_ref: ['VE-5082@CA-AB'],
      sota_ref: 'G/LD-003', wwff_ref: '3DAFF-0002', iota: 'eU-001',
      vucc_grids: ['EM98', 'FM08', 'EM97', 'FM07'],
      usaca_counties: [{ state: 'MA', county: 'Franklin' }, { state: 'MA', county: 'Hampshire' }],
      cnty_alt: ['NZ_Regions:Hawkes Bay/Wairoa'],
      credit_granted: [{ credit: 'DXCC', media: ['LOTW', 'CARD'] }, { credit: 'WAS', media: ['EQSL'] }],
      award_granted: ['ARRL_DXCC_MIXED'],
      lat: 50.0833333333, lon: 14.4166666667,
      qsl_rcvd: 'y', qslrdate: '2026-10-20'
    }]
  });
});

test('strict document shape without invented mandatory QSO fields', () => {
  valid({ records: [] });
  valid(record({ comment: 'Partial record' }));
  valid(record({ call: '' }));
  for (const document of [
    {}, [], { records: {} }, { records: [], extra: true },
    { records: [], header: { adif_ver: '3.1.7' } },
    record({}), record({ CALL: 'OK1ABC' }), record({ unknown: 'x' }), record({ call: null })
  ]) invalid(document);
});

test('native numbers and booleans; string identifiers preserve leading zeroes', () => {
  valid(record({ freq: 14.074, force_init: true, skcc: '00123', rst_sent: '599', dxcc: 291 }));
  for (const fields of [
    { freq: '14.074' }, { force_init: 'Y' }, { silent_key: 1 }, { dxcc: '291' },
    { dxcc: 9999 }, { ituz: 1.5 }, { skcc: 123 }, { freq: null }
  ]) invalid(record(fields));
});

test('all published numeric boundaries are enforced', () => {
  for (const [name, property] of Object.entries(schema.$defs.Record.properties)) {
    for (const [key, offset] of [['minimum', -1], ['maximum', 1]]) {
      if (property[key] === undefined) continue;
      valid(record({ [name]: property[key] }));
      invalid(record({ [name]: property[key] + offset }));
    }
  }
  invalid(record({ fists: 0 }));
  invalid(record({ iota_island_id: 100000000 }));
});

test('RFC 3339 dates check Gregorian month lengths without ADIF year restriction', () => {
  const date = definition('Date');
  for (let year = 1900; year <= 2400; year++) {
    for (let month = 1; month <= 12; month++) {
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const prefix = `${year}-${String(month).padStart(2, '0')}-`;
      assert.equal(date(`${prefix}${days}`), true, `${prefix}${days}`);
      assert.equal(date(`${prefix}${days + 1}`), false, `${prefix}${days + 1}`);
    }
  }
  for (const value of ['1900-02-29', '2100-02-29', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-01\n', '20260101']) {
    invalid(record({ qso_date: value }));
  }
  valid(record({ qso_date: '1929-12-31' }));
  valid(record({ qso_date: '2000-02-29' }));
});

test('RFC 3339 UTC times and timestamps, including fractional seconds', () => {
  for (const value of ['00:00:00Z', '23:59:59Z', '12:34:56.123Z']) valid(record({ time_on: value }));
  for (const value of ['24:00:00Z', '12:60:00Z', '12:34:60Z', '1234', '12:34', '12:34:00', '12:34:00+01:00', '12:34:00Z\n']) {
    invalid(record({ time_on: value }));
  }
  valid({ header: { created_timestamp: '2000-02-29T23:59:59.123Z' }, records: [] });
  for (const value of ['2100-02-29T12:00:00Z', '20261020 123456', '2026-10-20T24:00:00Z']) {
    invalid({ header: { created_timestamp: value }, records: [] });
  }
});

test('calendar checks also work when format assertion is disabled', () => {
  const patternsOnly = new Ajv2020({ strictTypes: false, allowUnionTypes: true, validateFormats: false });
  const check = patternsOnly.compile(schema);
  assert.equal(check(record({ qso_date: '2100-02-29' })), false);
  assert.equal(check(record({ qso_date: '2000-02-29' })), true);
});

test('ADIF additions and case-insensitive controlled values remain compatible', () => {
  for (const submode of ['JTTY', 'FT2']) valid(record({ mode: 'MFSK', submode }));
  valid(record({ mode: 'dynamic', submode: 'freedata' }));
  valid(record({ mode: 'OFDM', submode: 'RIBBIT_SMS' }));
  valid(record({ mode: 'SSB', submode: 'lSb', band: '20M', prop_mode: 'f2' }));
  invalid(record({ mode: 'SSB', submode: 'JTTY' }));
  invalid(record({ mode: 'UNKNOWN' }));
  invalid(record({ band: '21m' }));
  valid(record({ submode: 'Experimental submode', contest_id: 'Custom contest' }));
});

test('DXCC subdivision relationships remain enforced when context is present', () => {
  valid(record({ dxcc: 291, state: 'ma', my_dxcc: 1, my_state: 'ON' }));
  invalid(record({ dxcc: 291, state: 'ON' }));
  invalid(record({ my_dxcc: 1, my_state: 'MA' }));
  valid(record({ state: 'MA', cnty: 'MA,Middlesex' }));
  valid(record({ dxcc: 339, cnty: '100101' }));
});

test('QSL dates require compatible status values', () => {
  for (const prefix of ['', 'dcl_', 'eqsl_', 'lotw_']) {
    valid(record({ [`${prefix}qslrdate`]: '2026-10-20', [`${prefix}qsl_rcvd`]: 'i' }));
    valid(record({ [`${prefix}qslsdate`]: '2026-10-20', [`${prefix}qsl_sent`]: 'q' }));
    invalid(record({ [`${prefix}qslrdate`]: '2026-10-20' }));
    invalid(record({ [`${prefix}qslsdate`]: '2026-10-20', [`${prefix}qsl_sent`]: 'N' }));
  }
});

test('all list definitions use arrays and compound credits use objects', () => {
  for (const name of [
    'AwardList', 'CreditList', 'CreditOrAwardList', 'SponsoredAwardList', 'GridSquareList',
    'POTARefList', 'SecondarySubdivisionList', 'SecondaryAdministrativeSubdivisionListAlt', 'VUCCGrids', 'USACACounties'
  ]) assert.equal(schema.$defs[name].type, 'array', name);
  valid(record({ credit_granted: [{ credit: 'DXCC' }, { award: 'AJA' }] }));
  valid(record({ award_granted: ['ARRL_PROGRAM_AWARD.1'] }));
  for (const fields of [
    { pota_ref: 'K-1234,K-5678' }, { pota_ref: [] },
    { credit_granted: ['DXCC:LOTW'] }, { credit_granted: [{ credit: 'DXCC', media: ['EMAIL'] }] },
    { credit_granted: [{ credit: 'DXCC', award: 'AJA' }] },
    { credit_granted: [{ credit: 'DXCC', media: [] }] },
    { award_granted: 'ARRL_DXCC_MIXED' }, { award_granted: ['UNKNOWN_TEST'] },
    { vucc_grids: ['JN79'] }, { vucc_grids: ['JN79', 'JN89', 'JN99'] },
    { cnty_alt: ['NZ_Regions:Unknown/Unknown'] },
    { usaca_counties: ['MA,Franklin', 'MA,Hampshire'] }
  ]) invalid(record(fields));
});

test('locator and reference syntax is preserved, coordinates are decimal degrees', () => {
  for (const value of ['AA', 'AA00', 'AA00aa', 'RR99xx99']) valid(record({ gridsquare: value }));
  for (const fields of [
    { gridsquare: 'SS00' }, { gridsquare: 'AA00yy' }, { gridsquare_ext: 'YZ' },
    { gridsquare: 'JN79', gridsquare_ext: 'AB' },
    { iota: 'EU-000' }, { iota: 'XX-123' }, { pota_ref: ['K-123'] }, { wwff_ref: 'KFF-123' },
    { lat: 'N050 05.000' }, { lat: 90.001 }, { lon: -180.001 }, { my_lat: -90.1 }, { my_lon: 180.1 }
  ]) invalid(record(fields));
  valid(record({ lat: -90, lon: 180, my_lat: 90, my_lon: -180 }));
});

test('all legacy text variants now accept Unicode and JSON line endings', () => {
  for (const name of ['name', 'name_intl', 'comment', 'comment_intl', 'notes', 'notes_intl', 'address', 'address_intl']) {
    valid(record({ [name]: '\u017dofie\nUnicode \ud83c\udf0d\r\nText' }));
  }
});

test('legacy import-only fields and award values remain mapped', () => {
  valid(record({
    guest_op: 'OK1ABC', ve_prov: 'ON', mode: 'FT8', qsl_rcvd: 'V',
    credit_granted: [{ award: 'AJA' }]
  }));
  assert.equal(schema.$defs.Record.properties.guest_op.deprecated, true);
});

test('custom definitions are genuine JSON Schemas, not ADIF type letters', () => {
  valid({
    header: {
      user_defined: {
        sweater_size: { type: 'string', enum: ['S', 'M', 'L'] },
        shoe_size: { type: 'number', minimum: 5, maximum: 20 },
        metadata: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } },
        unrestricted: true, prohibited: false
      },
      app: { LOGGER: { birthday: { type: 'string', format: 'date' }, enabled: { type: 'boolean' } } }
    },
    records: [{
      user_defined: { sweater_size: 'M', shoe_size: 11, metadata: { tags: ['QRP'] }, unrestricted: null },
      app: { LOGGER: { birthday: '1947-07-26', enabled: true } }
    }]
  });
  for (const customSchema of [
    { type: 'N' }, { type: 'D' }, { minimum: '5' }, { enum: 'S,M,L' }, 42, 'string', null
  ]) {
    invalid({ header: { user_defined: { custom: customSchema } }, records: [] });
    invalid({ header: { app: { LOGGER: { custom: customSchema } } }, records: [] });
  }
  invalid({ header: { user_defined: [{ name: 'custom', type: 'N' }] }, records: [] });
  invalid(record({ app: [{ programid: 'LOGGER', fieldname: 'x', type: 'N', value: 5 }] }));
  invalid(record({ user_defined: { '': 'value' } }));
});

test('custom schema resources can be applied independently to values', () => {
  const customSchema = {
    $schema: schema.$schema,
    $defs: { size: { type: 'number', minimum: 5, maximum: 20 } },
    $ref: '#/$defs/size'
  };
  valid({ header: { user_defined: { shoe_size: customSchema } }, records: [] });
  const check = ajv.compile(customSchema);
  assert.equal(check(11), true);
  assert.equal(check(21), false);
  assert.equal(check('11'), false);
});
