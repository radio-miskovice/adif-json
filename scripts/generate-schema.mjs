import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const sourcePath = process.argv[2];
assert(sourcePath, 'Usage: npm run generate -- <path to official ADIF 3.1.8 exports/json/all.json>');
const source = JSON.parse(readFileSync(sourcePath, 'utf8')).Adif;
assert.equal(source.Version, '3.1.8');
assert.equal(source.Status, 'Released');
const fields = source.Fields.Records;
const enums = source.Enumerations;
const defs = {};
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const records = (name) => Object.values(enums[name].Records);
const unique = (values) => [...new Set(values)];
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ci = (value) => [...value].map((c) => /[a-z]/i.test(c)
  ? `[${c.toUpperCase()}${c.toLowerCase()}]` : escape(c)).join('');
// Unlike a bare $, the final assertion also rejects a trailing newline.
const text = (body) => ({ type: 'string', pattern: `^(?:${body})$(?![\\s\\S])` });
const choices = (values) => text(unique(values).map(ci).join('|'));
const array = (items, minItems = 1) => ({ type: 'array', minItems, items });

defs.String = { type: 'string' };
defs.IntlString = { type: 'string' };
defs.MultilineString = { type: 'string' };
defs.IntlMultilineString = { type: 'string' };
defs.Boolean = { type: 'boolean' };
defs.Number = { type: 'number' };
defs.Integer = { type: 'integer' };
defs.PositiveInteger = { type: 'integer', minimum: 1 };
defs.Digit = text('[0-9]');
defs.Character = { type: 'string', minLength: 1, maxLength: 1 };
defs.IntlCharacter = { ...defs.IntlString, minLength: 1, maxLength: 1 };
defs.Enumeration = ref('String');
const leapYear = '(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)';
const calendar = '(?:[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))|' + leapYear + '-02-29)';
defs.Date = {
  description: 'RFC 3339 full-date, YYYY-MM-DD. No ADIF-specific 1930 lower bound.',
  format: 'date',
  ...text(calendar),
};
const time = '(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]+)?Z';
defs.Time = {
  description: 'RFC 3339 time in UTC, HH:MM:SS[.fraction]Z. Leap-second notation is not supported.',
  format: 'time',
  ...text(time)
};
defs.Timestamp = {
  description: 'RFC 3339 timestamp in UTC.',
  format: 'date-time',
  ...text(`${calendar}T${time}`)
};
const grid = '[A-Ra-r]{2}(?:[0-9]{2}(?:[A-Xa-x]{2}(?:[0-9]{2})?)?)?';
defs.GridSquare = text(grid);
defs.GridSquareExt = text('[A-Xa-x]{2}(?:[0-9]{2})?');
defs.GridSquareList = array(ref('GridSquare'));
const vucc = '[A-Ra-r]{2}[0-9]{2}(?:[A-Xa-x]{2})?';
defs.VUCCGrids = {
  ...array(text(vucc), 2),
  maxItems: 4,
  oneOf: [{ maxItems: 2 }, { minItems: 4 }]
};
defs.Latitude = { type: 'number', minimum: -90, maximum: 90, description: 'Decimal degrees; north positive, south negative.' };
defs.Longitude = { type: 'number', minimum: -180, maximum: 180, description: 'Decimal degrees; east positive, west negative.' };
defs.IOTARefNo = text(`(?:${['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA'].map(ci).join('|')})-(?!000)[0-9]{3}`);
const pota = '[A-Za-z0-9]{1,4}-[0-9]{4,5}(?:@[A-Za-z]{2}-[A-Za-z0-9]{1,3})?';
defs.POTARef = text(pota);
defs.POTARefList = array(ref('POTARef'));
defs.SOTARef = text('[A-Za-z0-9]+/[A-Za-z0-9]+-[0-9]+');
defs.WWFFRef = text('[A-Za-z0-9]{1,4}[Ff]{2}-[0-9]{4}');
defs.SecondarySubdivisionList = array({ type: 'string', minLength: 1 }, 2);
defs.USACACounties = array({
  type: 'object',
  additionalProperties: false,
  required: ['state', 'county'],
  properties: { state: text('[A-Za-z]{2}'), county: { type: 'string', minLength: 1 } }
}, 2);
defs.SecondaryAdministrativeSubdivisionListAlt = array(choices(
  records('Secondary_Administrative_Subdivision_Alt').map((r) => r.Code)
));
defs.SecondaryAdministrativeSubdivisionListAlt.maxItems = 1;
defs.SecondaryAdministrativeSubdivisionListAlt.description =
  'Array of alternate subdivision codes. ADIF 3.1.8 defines only NZ_Regions; at most one entry per enumeration.';

for (const [name, table] of Object.entries(enums)) {
  if (name.startsWith('Secondary_Administrative_')) continue;
  const column = table.Header[1];
  const values = Object.values(table.Records).map((r) => r[column]);
  assert(values.every((v) => typeof v === 'string'), `Missing enumeration values: ${name}`);
  defs[`enum_${name}`] = name === 'DXCC_Entity_Code'
    ? { type: 'integer', enum: values.map(Number) }
    : choices(values);
}
defs.AwardList = array(ref('enum_Award'));
defs.Credit = {
  type: 'object',
  additionalProperties: false,
  required: ['credit'],
  properties: {
    credit: ref('enum_Credit'),
    media: { ...array(ref('enum_QSL_Medium')), uniqueItems: true }
  }
};
defs.LegacyAward = {
  type: 'object',
  additionalProperties: false,
  required: ['award'],
  properties: { award: ref('enum_Award') },
  deprecated: true
};
defs.CreditList = array(ref('Credit'));
defs.CreditOrAwardList = array({ oneOf: [ref('Credit'), ref('LegacyAward')] });
const sponsor = records('Award_Sponsor').map((r) => ci(r.Sponsor)).join('|');
defs.SponsoredAwardList = array(text(`(?:${sponsor})[\\s\\S]+`));
defs.SecondarySubdivision = {
  ...ref('String'),
  minLength: 1,
  description: 'Sponsor-defined code; most county/district lists are maintained outside ADIF.'
};

const header = {};
const qso = {};
for (const [name, field] of Object.entries(fields)) {
  if (name === 'USERDEFn') continue;
  const type = field['Data Type'];
  const enumeration = field.Enumeration;
  let property;
  if (type === 'CreditList,AwardList') property = ref('CreditOrAwardList');
  else if (type === 'Location') {
    assert(/_(?:LAT|LON)$|^(?:LAT|LON)$/.test(name), `Unknown coordinate field: ${name}`);
    property = ref(name.endsWith('LAT') ? 'Latitude' : 'Longitude');
  }
  else if (type === 'Enumeration' && enumeration?.startsWith('Secondary_Administrative_')) {
    property = ref('SecondarySubdivision');
  } else if (type === 'Enumeration' && enumeration?.startsWith('Primary_Administrative_')) {
    property = ref('String');
  } else if (type === 'Enumeration' && enumeration) {
    assert(defs[`enum_${enumeration}`], `Unknown enumeration: ${enumeration}`);
    property = ref(`enum_${enumeration}`);
  } else {
    assert(defs[type], `Unknown type: ${type}`);
    property = ref(type);
  }
  for (const [sourceKey, schemaKey] of [['Minimum Value', 'minimum'], ['Maximum Value', 'maximum']]) {
    if (field[sourceKey] !== undefined) property[schemaKey] = Number(field[sourceKey]);
  }
  property.title = name;
  if (field['Import-only'] === 'true') property.deprecated = true;
  (field['Header Field'] === 'true' ? header : qso)[name.toLowerCase()] = property;
}
header.adif_ver = { const: '3.1.8', title: 'ADIF_VER' };
header.created_timestamp = { ...ref('Timestamp'), title: 'CREATED_TIMESTAMP' };
for (const name of ['vucc_grids', 'my_vucc_grids']) qso[name] = ref('VUCCGrids');
for (const name of ['usaca_counties', 'my_usaca_counties']) qso[name] = ref('USACACounties');

const rules = [];
const conditional = (conditions, consequence) => ({
  if: { properties: conditions, required: Object.keys(conditions) },
  then: consequence
});
const modeGroups = Map.groupBy(records('Submode'), (r) => r.Mode);
for (const [mode, rows] of modeGroups) {
  rules.push(conditional({ submode: choices(rows.map((r) => r.Submode)) }, {
    properties: { mode: choices([mode]) }
  }));
}
for (const [dxcc, state] of [['dxcc', 'state'], ['my_dxcc', 'my_state']]) {
  const groups = Map.groupBy(records('Primary_Administrative_Subdivision'), (r) => r['DXCC Entity Code']);
  for (const [entity, rows] of groups) {
    rules.push(conditional({ [dxcc]: { const: Number(entity) } }, {
      properties: { [state]: choices(rows.map((r) => r.Code)) }
    }));
  }
}
for (const prefix of ['', 'dcl_', 'eqsl_', 'lotw_']) {
  for (const [suffix, status, allowed] of [['qslrdate', 'qsl_rcvd', ['Y', 'I', 'V']], ['qslsdate', 'qsl_sent', ['Y', 'Q', 'I']]]) {
    rules.push(conditional({ [`${prefix}${suffix}`]: true }, {
      required: [`${prefix}${status}`],
      properties: { [`${prefix}${status}`]: choices(allowed) }
    }));
  }
}
for (const prefix of ['', 'my_']) {
  rules.push(conditional({ [`${prefix}gridsquare_ext`]: true }, {
    properties: { [`${prefix}gridsquare`]: { minLength: 8, maxLength: 8 } }
  }));
}

defs.ExtensionName = {
  type: 'string',
  minLength: 1,
  description: 'Nonempty Unicode name. Custom fields are isolated from standard fields by their containers.'
};
defs.JsonSchema = {
  $ref: 'https://json-schema.org/draft/2020-12/schema',
  description: 'JSON Schema Draft 2020-12 resource. Meta-validated here; consumers must apply it to custom values in a second validation stage.'
};
defs.CustomDefinitions = {
  type: 'object',
  propertyNames: ref('ExtensionName'),
  additionalProperties: ref('JsonSchema')
};
defs.CustomValues = {
  type: 'object',
  propertyNames: ref('ExtensionName'),
  additionalProperties: true
};
header.user_defined = {
  ...ref('CustomDefinitions'),
  description: 'Custom field names mapped to JSON Schema resources. Replaces ADI USERDEFn and ADX USERDEF declarations.'
};
header.app = {
  type: 'object',
  propertyNames: ref('ExtensionName'),
  additionalProperties: ref('CustomDefinitions'),
  description: 'Application schemas keyed by PROGRAMID, then FIELDNAME.'
};
qso.app = {
  type: 'object',
  propertyNames: ref('ExtensionName'),
  additionalProperties: ref('CustomValues'),
  description: 'Application values keyed by PROGRAMID, then FIELDNAME. Maps ADI APP_PROGRAMID_FIELDNAME and ADX APP elements.'
};
qso.user_defined = {
  ...ref('CustomValues'),
  description: 'Values keyed by custom field name; validate against header.user_defined in a second validation stage.'
};
defs.Header = { type: 'object', additionalProperties: false, properties: header };
defs.Record = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: qso,
  allOf: rules
};
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'JSON-native amateur radio interchange document',
  description: 'Proposed successor format covering all ADIF/ADX 3.1.8 fields. Uses Unicode strings, RFC 3339 dates and UTC times, decimal-degree coordinates, native numbers and booleans, arrays, structured credits, and JSON Schema custom definitions. Legacy field names remain mapped; legacy wire encodings are not retained.',
  $comment: 'Field inventory source: https://adif.org/318/ADIF_318.htm and https://adif.org.uk/318/resources . ADIF_VER identifies source compatibility, not the version of this proposed format. See README.md for conversion and validation rules.',
  type: 'object',
  additionalProperties: false,
  required: ['records'],
  properties: { header: ref('Header'), records: { type: 'array', items: ref('Record') } },
  $defs: defs
};
const output = fileURLToPath(new URL('..', import.meta.url));
writeFileSync(`${output}\\adif.schema.json`, `${JSON.stringify(schema, null, 2)}\n`);
writeFileSync(`${output}\\adif.schema.yaml`, YAML.stringify(schema, { lineWidth: 0 }));
console.log(`Generated identical JSON/YAML schemas: ${Object.keys(header).length - 2} standard header fields, ${Object.keys(qso).length - 2} standard QSO fields.`);
