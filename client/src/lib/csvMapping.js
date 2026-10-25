/** Contact fields a CSV column can be imported into. */
export const IMPORT_FIELDS = [
  { key: 'firstName', label: 'First name', required: true },
  { key: 'lastName',  label: 'Last name',  required: true },
  { key: 'email',     label: 'Email',      required: true },
  { key: 'phone',     label: 'Phone' },
  { key: 'title',     label: 'Job title' },
  { key: 'company',   label: 'Company' },
  { key: 'tags',      label: 'Tags (separated by ; or ,)' },
  { key: 'status',    label: 'Status' },
];

const ALIASES = {
  firstName: ['first name', 'firstname', 'first', 'given name', 'forename'],
  lastName:  ['last name', 'lastname', 'last', 'surname', 'family name'],
  email:     ['email', 'email address', 'e-mail', 'mail', 'work email'],
  phone:     ['phone', 'phone number', 'mobile', 'telephone', 'tel', 'cell'],
  title:     ['title', 'job title', 'position', 'role'],
  company:   ['company', 'company name', 'organization', 'organisation', 'account', 'employer'],
  tags:      ['tags', 'tag', 'labels', 'source', 'lead source'],
  status:    ['status', 'lifecycle', 'lifecycle stage', 'stage'],
};

const normalize = (header) => String(header).toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
const NORMALIZED_ALIASES = Object.fromEntries(Object.entries(ALIASES).map(([key, names]) => [key, names.map(normalize)]));

/** Best-guess mapping `{ [csvHeader]: fieldKey | '' }`; each field is used at most once. */
export function guessMapping(headers) {
  const used = new Set();
  const mapping = {};
  for (const header of headers) {
    const name = normalize(header);
    const field = Object.keys(NORMALIZED_ALIASES).find((key) => !used.has(key) && NORMALIZED_ALIASES[key].includes(name));
    mapping[header] = field || '';
    if (field) used.add(field);
  }
  return mapping;
}

/** Applies a mapping to parsed CSV rows; empty cells are left out. */
export function applyMapping(rows, mapping) {
  return rows.map((row) => {
    const out = {};
    for (const [header, field] of Object.entries(mapping)) {
      const value = String(row[header] ?? '').trim();
      if (field && value) out[field] = value;
    }
    return out;
  });
}

/** Required fields that no column is mapped to. */
export const missingRequired = (mapping) => {
  const mapped = new Set(Object.values(mapping));
  return IMPORT_FIELDS.filter((f) => f.required && !mapped.has(f.key));
};
