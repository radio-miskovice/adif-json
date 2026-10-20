# JSON-native amateur radio interchange

[adif.schema.json](./adif.schema.json) and
[adif.schema.yaml](./adif.schema.yaml) specify the same **JSON Schema Draft
2020-12** document model, serialized as JSON and YAML respectively.

This is a proposed successor to ADI and ADX, not a JSON wrapper for their
wire syntax. The field inventory maps all fields in
[ADIF/ADX 3.1.8](https://adif.org/318/ADIF_318.htm), while values use JSON-native
structures and standard JSON Schema validation. It is not an officially
adopted replacement for ADIF.

## Document structure

```json
{
  "header": {
    "adif_ver": "3.1.8",
    "programid": "ExampleLogger",
    "created_timestamp": "2026-10-20T18:23:35Z"
  },
  "records": [
    {
      "call": "OK1ABC",
      "qso_date": "2026-10-20",
      "time_on": "18:23:00Z",
      "freq": 14.074,
      "band": "20m",
      "mode": "MFSK",
      "submode": "FT8",
      "tx_pwr": 5,
      "qso_random": false,
      "lat": 50.0833333333,
      "lon": 14.4166666667,
      "pota_ref": ["OK-0001", "K-10000@US-WY"],
      "credit_granted": [
        { "credit": "DXCC", "media": ["LOTW", "CARD"] }
      ]
    }
  ]
}
```

`records` is required and may be empty; `header` is optional. All four ordinary
ADIF header fields and all **181 standard QSO fields** are mapped to lowercase
property names, including import-only fields. `USERDEFn` / ADX `USERDEF`
declarations and application fields have the structured mappings below.
Unknown standard properties are rejected; custom values have separate containers.
No individual standard QSO field is mandatory; a record must have at least one
property.

`adif_ver`, if present, identifies the supported legacy field inventory (`3.1.8`),
not the version of this successor format. No release/version identifier for
the successor standard has been assigned yet.

## Value model and legacy conversion

JSON Schema defines the schema vocabulary, not a mandatory domain data model.
The following are deliberate design choices for this successor format:

| Legacy ADIF/ADX data | Successor representation |
| --- | --- |
| Number, Integer, PositiveInteger | Native number, with appropriate integer and range constraints |
| Boolean `Y` / `N` | Native `true` / `false` |
| DXCC entity code | Native integer, including `0` and historical entities |
| Date `YYYYMMDD` | RFC 3339 full-date string `YYYY-MM-DD`, `format: date` |
| Time `HHMM` / `HHMMSS` | UTC RFC 3339 time `HH:MM:SS[.fraction]Z`, `format: time` |
| CREATED_TIMESTAMP | UTC RFC 3339 timestamp `YYYY-MM-DDTHH:MM:SS[.fraction]Z`, `format: date-time` |
| Latitude / longitude | Decimal-degree numbers; north/east positive, south/west negative |
| String and all international/multiline variants | Unicode JSON strings; LF and CRLF are both allowed |
| Simple delimited lists | JSON arrays |
| Credits and confirmation media | Arrays of objects, e.g. `[{"credit":"DXCC","media":["LOTW","CARD"]}]` |
| Import-only AwardList entries in credit fields | Objects such as `{"award":"AJA"}` in the credit array |
| USA-CA county lists | Arrays of `{"state":"MA","county":"Franklin"}` objects |
| Alternate subdivisions | Array of codes, e.g. `["NZ_Regions:Hawkes Bay/Wairoa"]` |

Every text field, including both `name` and `name_intl`, accepts Unicode.
The `_intl` properties remain separate to map every source tag; neither is
silently merged into or given precedence over its counterpart.
Dates have no inherited 1930 lower bound. Calendar-validity patterns supplement
`format` so invalid dates are rejected even when format assertion is disabled.
UTC times require seconds and `Z`; fractional seconds are supported, but
leap-second notation is not. Convert offset timestamps to UTC before storing.
Importing `HHMM` supplies seconds as `00`; this normalizes rather than preserves
the original lexical precision.

For a legacy coordinate, compute
`sign * (degrees + minutes / 60)`. Source direction and formatting are not
retained, including the distinction between positive and negative zero.
Numeric precision and any rounding on export are converter responsibilities.
String identifiers such as `skcc`, `rst_sent`, `stx_string`, and `srx_string`
remain strings, preserving leading zeroes.

Convert comma-, colon-, semicolon-, and ampersand-delimited legacy lists into
their corresponding arrays/objects; delimiters are not part of list structure
in this format. A county scalar such as `cnty: "MA,Middlesex"` remains a
sponsor-defined identifier, not a list. `usaca_counties` is the structured
county list. `cnty_alt` and `my_cnty_alt` permit one `NZ_Regions` code in the
3.1.8 inventory, with at most one entry per subdivision enumeration.

This replaces the previous draft's ADIF-shaped encodings; old compact dates,
location strings, delimited lists, and ADIF custom type letters are rejected.
Compatibility means full field/semantic coverage, not byte-for-byte preservation
of ADI/ADX syntax or arbitrary source metadata.

## Controlled values and relationships

Closed enumerations come from the official 3.1.8 exports, including historical
values and additions such as `JTTY`, `FT2`, `FREEDATA`, `RIBBIT_PIX`, and
`RIBBIT_SMS`. Their string values remain case-insensitive for interoperability.
Deprecated legacy fields are marked with JSON Schema `deprecated`.

`submode` and `contest_id` remain open strings; their published values are
interoperability recommendations. Recognized submodes are checked against
`mode` when both are supplied. Primary subdivisions are checked against
`dxcc` / `my_dxcc` where a table exists. QSL dates require compatible
received/sent statuses.

Locator syntax and field mappings remain intact, including `gridsquare_ext`.
If a base locator accompanies an extension, it must have eight characters.
VUCC arrays contain two or four four-/six-character locators. Lists are
nonempty when supplied; omit an unavailable list instead of encoding an empty
legacy field.

## Custom schemas and values

Custom fields use ordinary JSON Schema resources, not ADIF type indicators or
numbered declarations:

```json
{
  "header": {
    "user_defined": {
      "sweater_size": { "type": "string", "enum": ["S", "M", "L"] },
      "shoe_size": { "type": "number", "minimum": 5, "maximum": 20 }
    },
    "app": {
      "LOGGER": {
        "birthday": { "type": "string", "format": "date" },
        "equipment": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    }
  },
  "records": [
    {
      "user_defined": { "sweater_size": "M", "shoe_size": 11 },
      "app": {
        "LOGGER": {
          "birthday": "1947-07-26",
          "equipment": ["Dipole", "Transceiver"]
        }
      }
    }
  ]
}
```

Mapping:

- ADI `USERDEFn` and ADX `USERDEF` declarations become entries in
  `header.user_defined`, keyed by field name. Convert type indicators to native
  schemas (`N` to `number`, `B` to `boolean`, `D` to `string` with `format: date`,
  etc.). All text indicators map to Unicode strings. A custom `L` location
  becomes a signed decimal-degree number constrained to the appropriate
  latitude/longitude range, as determined by the source direction.
- User-defined QSO values become `records[].user_defined[fieldname]`.
- ADI `APP_PROGRAMID_FIELDNAME` and ADX `APP` values become
  `records[].app[programid][fieldname]`. Their optional declared types become
  schemas in `header.app[programid][fieldname]`; undeclared legacy types map to
  `{"type":"string"}`. Conversion must resolve the ADI program/field boundary;
  ADX already supplies both names separately.
- Arbitrary JSON values, including objects, arrays, and null, are supported
  when permitted by the custom schema. Custom names are nonempty Unicode JSON
  property names, case-sensitive and isolated from standard field names.
  Converters must detect case-insensitive name collisions in legacy data
  rather than silently overwrite values.

Embedded definitions reference the standard 2020-12 meta-schema and are
validated as schemas. A conforming validator must provide that meta-schema
(including its referenced vocabularies); Ajv2020 supplies it locally, so tests
do not require network access. Definitions may be objects or boolean schemas.

**Applying custom definitions is a second validation stage.** Standard JSON
Schema does not execute schemas found inside an instance as part of validating
that same instance. Consumers must:

1. Validate the document against this interchange schema.
2. For every custom value, resolve its matching user/application definition;
   reject undeclared values. Compile each definition as a separate Draft
   2020-12 schema resource and validate the value against it. Reject invalid
   schemas, unresolved references, and values that fail validation.

Schema-local `$defs` and `$ref` work normally within each custom schema resource.
Do not fetch untrusted external references automatically; configure permitted
schema resources explicitly. For strict reference/format checking, consumers
must enable their validator's relevant options. Header definitions can use
the full standard vocabulary rather than a restricted home-grown type system.

## Checks outside structural validation

Consumers/converters also handle external award, DARC DOK, POTA, SOTA, WWFF,
and county registries; VUCC adjacency; chronological ordering; band/frequency
and geographic consistency; and normalization of historical export values.
ADIF's exported secondary-subdivision table covers Alaska only, not every
external county/district list. The schema does not pretend it is complete.

## Regeneration and tests

```powershell
npm ci
npm test
```

Download and extract the official
[3.1.8 resources archive](https://adif.org.uk/318/resources), then regenerate:

```powershell
npm run generate -- 'C:\path\to\318\exports\json\all.json'
npm test
```

Both serializations are generated from one schema object. Tests cover
equivalence, meta-schema validity, field count, native value representations,
Gregorian calendars, numeric boundaries, legacy field mappings and relationships,
custom schema validity, and rejection of superseded wire encodings.
