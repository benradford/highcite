// parser.js — citation text → BibTeX string.
//
// Strategy:
//   1. If text contains a DOI  → CrossRef REST API (free, no key, covers ~90M records)
//   2. If Gemini Nano is enabled and available → on-device LLM parse
//   3. Otherwise               → local regex parsing (APA, MLA, Chicago, Vancouver, IEEE)

'use strict';

// ─── Public API ──────────────────────────────────────────────────────────────

// Returns { bibtex: string, method: 'crossref' | 'gemini-nano' | 'regex' }
export async function convertToBibTeX(rawText) {
  const text = normalizeText(rawText);
  const doi  = extractDOI(text);

  // 1. CrossRef
  if (doi) {
    try {
      const email = await getStoredEmail();
      const bibtex = await crossRefLookup(doi, email);
      return { bibtex, method: 'crossref' };
    } catch (err) {
      console.warn('CrossRef lookup failed, falling back:', err.message);
    }
  }

  // 2. Gemini Nano (if enabled in settings)
  try {
    const { llmEnabled = true } = await chrome.storage.sync.get('llmEnabled');
    if (llmEnabled) {
      const bibtex = await llmParse(text);
      return { bibtex, method: 'gemini-nano' };
    }
  } catch (err) {
    console.warn('Gemini Nano parse failed, falling back to regex:', err.message);
  }

  // 3. Regex
  const { type, key, fields } = localParseFields(text, doi);
  return { bibtex: toBibTeX(type, key, fields), method: 'regex' };
}

// ─── Text normalisation ───────────────────────────────────────────────────────

function normalizeText(t) {
  return t
    .replace(/[–—‒]/g, '-')   // en/em-dash → hyphen
    .replace(/[“”„]/g, '"')   // curly double quotes
    .replace(/[‘’ʼ]/g, "'")   // curly single quotes
    .replace(/ /g, ' ')                  // non-breaking space
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── DOI extraction ───────────────────────────────────────────────────────────

const DOI_CORE    = '10\\.\\d{4,9}\\/[^\\s,;"<>\\]}>]+';
const DOI_URL_RE  = new RegExp(`(?:doi\\.org/|doi:\\s*)(${DOI_CORE})`, 'i');
const DOI_BARE_RE = new RegExp(`\\b(${DOI_CORE})`);

function extractDOI(text) {
  const m = text.match(DOI_URL_RE) ?? text.match(DOI_BARE_RE);
  if (!m) return null;
  return m[1].replace(/[.)>]+$/, '');  // strip trailing sentence punctuation
}

// ─── CrossRef lookup ──────────────────────────────────────────────────────────

async function getStoredEmail() {
  try {
    const { crossrefEmail = '' } = await chrome.storage.sync.get('crossrefEmail');
    return crossrefEmail;
  } catch (_) { return ''; }
}

async function crossRefLookup(doi, email) {
  const params = email ? `?mailto=${encodeURIComponent(email)}` : '';
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'HighCite/1.0 (Chrome Extension; https://github.com/highcite)' }
  });
  if (!res.ok) throw new Error(`CrossRef HTTP ${res.status}`);
  const { message: m } = await res.json();
  return crossRefToFields(m);
}

const CR_TYPE_MAP = {
  'journal-article':     'article',
  'proceedings-article': 'inproceedings',
  'book':                'book',
  'book-chapter':        'incollection',
  'monograph':           'book',
  'edited-book':         'book',
  'reference-book':      'book',
  'report':              'techreport',
  'dissertation':        'phdthesis',
  'posted-content':      'misc',   // preprints
  'dataset':             'misc',
  'standard':            'misc'
};

function crossRefToFields(m) {
  const type       = CR_TYPE_MAP[m.type] ?? 'misc';
  const personList = m.author ?? m.editor ?? [];
  const authorStr  = joinPersons(personList);
  const year       = extractCRYear(m);
  const title      = m.title?.[0] ?? '';
  const doi        = m.DOI ?? '';

  const fields = {};
  if (authorStr) fields.author = authorStr;
  if (title)     fields.title  = title;
  if (year)      fields.year   = year;

  switch (type) {
    case 'article':
      fields.journal = m['container-title']?.[0] ?? '';
      if (m.volume) fields.volume = m.volume;
      if (m.issue)  fields.number = m.issue;
      if (m.page)   fields.pages  = normPages(m.page);
      break;

    case 'inproceedings':
      fields.booktitle = m['container-title']?.[0] ?? m.event?.name ?? '';
      if (m.page)      fields.pages    = normPages(m.page);
      if (m.publisher) fields.publisher = m.publisher;
      break;

    case 'book':
    case 'incollection':
      if (m.publisher) fields.publisher = m.publisher;
      if (type === 'incollection') {
        fields.booktitle = m['container-title']?.[0] ?? '';
        if (m.page) fields.pages = normPages(m.page);
      }
      if (m.ISBN?.[0]) fields.isbn = m.ISBN[0];
      break;

    case 'techreport':
      fields.institution = m.institution?.name ?? m.publisher ?? '';
      break;

    default:
      if (m['container-title']?.[0]) fields.howpublished = m['container-title'][0];
      break;
  }

  if (doi) { fields.doi = doi; fields.url = `https://doi.org/${doi}`; }

  const citeKey = makeCiteKey(personList[0]?.family ?? 'Unknown', year, title);
  return toBibTeX(type, citeKey, fields);
}

function joinPersons(people) {
  return people
    .map(p => (p.family && p.given) ? `${p.family}, ${p.given}` : (p.family ?? p.name ?? ''))
    .filter(Boolean)
    .join(' and ');
}

function extractCRYear(m) {
  const parts =
    m['published-print']?.['date-parts']?.[0] ??
    m['published-online']?.['date-parts']?.[0] ??
    m.issued?.['date-parts']?.[0];
  return parts?.[0]?.toString() ?? '';
}

function normPages(p) {
  return p.replace(/(\d)\s*[-–—]\s*(\d)/g, '$1--$2');
}

// ─── Local regex parsing ──────────────────────────────────────────────────────

function localParseFields(text, knownDoi) {
  const fmt = detectFormat(text);

  let result;
  switch (fmt) {
    case 'apa':       result = parseAPA(text);       break;
    case 'mla':       result = parseMLA(text);       break;
    case 'chicago':   result = parseChicago(text);   break;
    case 'vancouver': result = parseVancouver(text); break;
    case 'ieee':      result = parseIEEE(text);      break;
    default:          result = parseGeneric(text);   break;
  }

  const { type, authorObjs = [], fields } = result;

  if (knownDoi) {
    if (!fields.doi) fields.doi = knownDoi;
    if (!fields.url) fields.url = `https://doi.org/${knownDoi}`;
  }

  const firstFamily = authorObjs[0]?.family ?? '';
  const key = makeCiteKey(firstFamily || 'Unknown', fields.year ?? '', fields.title ?? '');
  return { type, key, fields };
}

function isWeakParse(fields) {
  return !fields.title && !fields.author;
}

// ─── Gemini Nano (Chrome built-in LLM) ───────────────────────────────────────

const LLM_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    entry_type:  { type: 'string' },
    author:      { type: 'string' },
    editor:      { type: 'string' },
    title:       { type: 'string' },
    journal:     { type: 'string' },
    booktitle:   { type: 'string' },
    year:        { type: 'string' },
    volume:      { type: 'string' },
    number:      { type: 'string' },
    pages:       { type: 'string' },
    publisher:   { type: 'string' },
    institution: { type: 'string' },
    doi:         { type: 'string' },
    url:         { type: 'string' }
  },
  required: ['entry_type', 'title'],
  additionalProperties: false
};

const LLM_VALID_TYPES = new Set([
  'article', 'book', 'inproceedings', 'incollection',
  'phdthesis', 'techreport', 'misc', 'booklet',
  'manual', 'mastersthesis', 'proceedings', 'unpublished'
]);

const LLM_FIELD_KEYS = [
  'author', 'editor', 'title', 'journal', 'booktitle',
  'year', 'volume', 'number', 'pages', 'publisher', 'institution', 'doi', 'url'
];

async function llmParse(text) {
  // LanguageModel lives on `window` in page contexts and on `self` in service workers.
  const LM = (typeof LanguageModel !== 'undefined' && LanguageModel)
          || (typeof self !== 'undefined' && self.LanguageModel);
  if (!LM) {
    console.error('[HighCite] LanguageModel API not found in this context');
    throw new Error('LanguageModel API unavailable');
  }

  // Chrome ≤137 returns 'available'; Chrome 138+ returns 'readily-available'.
  const availability = await LM.availability({
    expectedInputs:  [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }]
  }).catch(() => LM.availability());   // fall back to no-arg form if options unsupported
  console.info('[HighCite] Gemini Nano availability:', availability);

  if (availability === 'unavailable') throw new Error('Gemini Nano unavailable on this device');
  if (availability === 'downloading') throw new Error('Gemini Nano model is still downloading');

  const session = await LM.create();
  try {
    const prompt =
      'Extract bibliographic fields from this academic citation.\n' +
      'Use entry_type: article, book, inproceedings, incollection, phdthesis, techreport, or misc.\n' +
      'Format authors as "Family, Given and Family, Given".\n' +
      'Use double hyphen in page ranges (e.g. 100--200).\n\n' +
      `Citation: ${text}`;

    const raw  = await session.prompt(prompt, { responseConstraint: LLM_RESPONSE_SCHEMA });
    const data = JSON.parse(raw);

    if (!data.title) throw new Error('no title in LLM response');

    const type   = LLM_VALID_TYPES.has(data.entry_type) ? data.entry_type : 'misc';
    const fields = {};
    for (const k of LLM_FIELD_KEYS) {
      if (data[k]) fields[k] = String(data[k]);
    }
    if (fields.doi && !fields.url) fields.url = `https://doi.org/${fields.doi}`;

    const firstFamily = (fields.author ?? '').split(' and ')[0].split(',')[0].trim() || 'Unknown';
    const key = makeCiteKey(firstFamily, fields.year ?? '', fields.title ?? '');
    return toBibTeX(type, key, fields);
  } finally {
    session.destroy();
  }
}

// ── Format detection ─────────────────────────────────────────────────────────

function detectFormat(text) {
  // Vancouver: year;volume pattern, e.g. "2020;10(2)"
  if (/\d{4};\d+/.test(text)) return 'vancouver';

  // IEEE: starts with "F. Lastname" or "F. L. Lastname", has quoted title
  if (/^[A-Z]\.\s+[A-Z]/.test(text) && /"[^"]+"/.test(text)) return 'ieee';

  // Chicago: quoted title + "no. N (YYYY)" — check before MLA; period may be inside quotes
  if (/"[^"]+"/.test(text) && /no\.\s*\d+\s*\(\d{4}\)/i.test(text)) return 'chicago';

  // MLA: quoted title + "vol. N" — period may be inside quotes (American style)
  if (/"[^"]+"/.test(text) && /\bvol\.\s*\d+/i.test(text)) return 'mla';

  // Chicago no-volume: "Journal (YYYY): pages" — must be caught before APA's (YYYY) check
  if (/"[^"]+"/.test(text) && /\(\d{4}\)\s*:/.test(text)) return 'chicago';

  // APA: (YYYY) or (YYYYa) shortly after an author block
  if (/\(\d{4}[a-z]?\)/.test(text)) return 'apa';

  // Quoted title without explicit format cues — try Chicago-style
  if (/"[^"]+"/.test(text)) return 'chicago';

  return 'generic';
}

// ── APA ───────────────────────────────────────────────────────────────────────
// Smith, J. A., & Jones, B. (2020). Title. Journal, 10(2), 100–200. doi:...
function parseAPA(text) {
  const fields = {};

  const yearM = text.match(/\((\d{4})[a-z]?\)/);
  if (yearM) fields.year = yearM[1];

  // Split on "(YYYY)." to separate author block from title+rest
  const [beforeYear = '', afterYear = ''] = text.split(/\(\d{4}[a-z]?\)\.\s*/);
  const authorObjs = parseAPAAuthors(beforeYear.trim());
  if (authorObjs.length) {
    fields.author = authorObjs.map(a => a.given ? `${a.family}, ${a.given}` : a.family).join(' and ');
  }

  // afterYear: "Title sentence. Journal, vol(num), pages."
  const dotParts = afterYear.split(/\.\s+/);
  if (dotParts[0]) fields.title = strip(dotParts[0]);

  if (dotParts[1]) {
    const jinfo = dotParts[1];
    const jM     = jinfo.match(/^([^,]+)/);
    const volM   = jinfo.match(/,\s*(\d+)\s*\(/);
    const issueM = jinfo.match(/\((\d+)\)/);
    const pagesM = jinfo.match(/,\s*(\d+\s*[-–]+\s*\d+)/);
    if (jM)     fields.journal = jM[1].trim();
    if (volM)   fields.volume  = volM[1];
    if (issueM) fields.number  = issueM[1];
    if (pagesM) fields.pages   = normPages(pagesM[1]);
  }

  return { type: 'article', authorObjs, fields };
}

function parseAPAAuthors(raw) {
  // "Smith, J. A., Jones, B. C., & Williams, D."
  raw = raw.replace(/&/g, '').replace(/\s+/g, ' ').trim();
  const re = /([A-ZÀ-Ý][a-zÀ-ÿ'\-]+(?:[\s-][A-ZÀ-Ý][a-zÀ-ÿ'\-]+)*),\s*([A-Z]\.(?:\s*[A-Z]\.)*)/g;
  const authors = [];
  let m;
  while ((m = re.exec(raw)) !== null) {
    authors.push({ family: m[1].trim(), given: m[2].trim() });
  }
  if (!authors.length && raw) {
    authors.push({ family: raw.replace(/[,.]$/, '').trim(), given: '' });
  }
  return authors;
}

// ── MLA ───────────────────────────────────────────────────────────────────────
// Smith, John. "Article Title." Journal, vol. 10, no. 2, 2020, pp. 100-200.
function parseMLA(text) {
  const fields = {};

  const titleM = text.match(/"([^"]+)"/);
  if (titleM) fields.title = strip(titleM[1]);

  const authorRaw  = text.split(/"[^"]+"/).shift()?.trim().replace(/[.,]$/, '') ?? '';
  const authorObjs = authorRaw ? parseInvertedFirstAuthors(authorRaw) : [];
  if (authorObjs.length) fields.author = fmtAuthors(authorObjs);

  const jrnM  = text.match(/"[^"]+"\.?\s+([^,]+?),\s+vol\./i);
  const volM  = text.match(/\bvol\.\s*(\d+)/i);
  const noM   = text.match(/\bno\.\s*(\d+)/i);
  const ppM   = text.match(/\bpp\.\s*(\d+\s*[-–]+\s*\d+)/i);
  const yrM   = text.match(/,\s*(\d{4})\s*[,.]/) ?? text.match(/\b(\d{4})\b/);

  if (jrnM) fields.journal = jrnM[1].trim();
  if (volM) fields.volume  = volM[1];
  if (noM)  fields.number  = noM[1];
  if (ppM)  fields.pages   = normPages(ppM[1]);
  if (yrM)  fields.year    = yrM[1];

  return { type: 'article', authorObjs, fields };
}

// ── Chicago ───────────────────────────────────────────────────────────────────
// Smith, John. "Article Title." Journal 10, no. 2 (2020): 100-200.
function parseChicago(text) {
  const fields = {};

  const titleM = text.match(/"([^"]+)"/);
  if (titleM) fields.title = strip(titleM[1]);

  const authorRaw  = text.split(/"[^"]+"/).shift()?.trim().replace(/[.,]$/, '') ?? '';
  const authorObjs = authorRaw ? parseInvertedFirstAuthors(authorRaw) : [];
  if (authorObjs.length) fields.author = fmtAuthors(authorObjs);

  const afterTitle = text.split(/"[^"]+"\.?\s*/)[1] ?? '';

  // "Journal 10, no. 2 (2020): 100–200"
  const jrnVolM = afterTitle.match(/^([A-Za-z][^0-9]+?)\s+(\d+),\s*no\.\s*(\d+)/i);
  if (jrnVolM) {
    fields.journal = jrnVolM[1].trim();
    fields.volume  = jrnVolM[2];
    fields.number  = jrnVolM[3];
  } else {
    // No volume: "Journal (2020)"
    const jrnOnlyM = afterTitle.match(/^([^(0-9]+?)\s*\(/);
    if (jrnOnlyM) fields.journal = jrnOnlyM[1].trim().replace(/[.,]$/, '');
  }

  const yrM    = afterTitle.match(/\((\d{4})\)/);
  const pagesM = afterTitle.match(/\(\d{4}\):\s*(\d+\s*[-–]+\s*\d+)/);
  if (yrM)    fields.year  = yrM[1];
  if (pagesM) fields.pages = normPages(pagesM[1]);

  return { type: 'article', authorObjs, fields };
}

// ── Vancouver / NLM ───────────────────────────────────────────────────────────
// Smith JA, Jones BC. Article title. J Name. 2020;10(2):100-200.
function parseVancouver(text) {
  const fields = {};

  // Author block: "Smith JA, Jones BC." — last name + 1–4 uppercase initials
  const authM = text.match(/^((?:[A-ZÀ-Ý][a-zÀ-ÿ'\-]+(?:\s[A-ZÀ-Ý][a-zÀ-ÿ'\-]+)?\s+[A-Z]{1,4},?\s*)+)/);
  let authorObjs = [];
  if (authM) {
    authorObjs = authM[1].trim().replace(/\.\s*$/, '')
      .split(/,\s*/)
      .map(t => {
        const m = t.trim().match(/^([A-ZÀ-Ý][a-zÀ-ÿ'\-]+(?:\s[A-ZÀ-Ý][a-zÀ-ÿ'\-]+)?)\s+([A-Z]{1,4})$/);
        if (!m) return null;
        const given = m[2].split('').join('. ') + '.';
        return { family: m[1], given };
      })
      .filter(Boolean);
    if (authorObjs.length) fields.author = fmtAuthors(authorObjs);
  }

  // Rest after author block
  const rest       = text.replace(/^[^.]+\.\s*/, '');
  const sentParts  = rest.split(/\.\s*/);
  if (sentParts[0]) fields.title   = strip(sentParts[0]);
  if (sentParts[1]) fields.journal = sentParts[1].trim();

  const yrM    = text.match(/(\d{4});/);
  const volM   = text.match(/;(\d+)[\s(]/);
  const issueM = text.match(/\((\d+)\)/);
  const pagesM = text.match(/:(\d+[-–]\d+)/);
  if (yrM)    fields.year   = yrM[1];
  if (volM)   fields.volume = volM[1];
  if (issueM) fields.number = issueM[1];
  if (pagesM) fields.pages  = normPages(pagesM[1]);

  return { type: 'article', authorObjs, fields };
}

// ── IEEE ──────────────────────────────────────────────────────────────────────
// J. A. Smith and B. Jones, "Title," Journal, vol. X, no. Y, pp. pages, Year.
function parseIEEE(text) {
  const fields = {};

  const titleM = text.match(/"([^"]+)"/);
  if (titleM) fields.title = strip(titleM[1]);

  const authorRaw  = text.split(/"[^"]+"/).shift()?.trim().replace(/,\s*$/, '') ?? '';
  const authorObjs = authorRaw.split(/\s+and\s+/i).map(a => {
    a = a.trim();
    const m = a.match(/^((?:[A-Z]\.\s*)+)(.+)/);
    return m ? { family: m[2].trim(), given: m[1].trim() } : { family: a, given: '' };
  }).filter(a => a.family);
  if (authorObjs.length) fields.author = fmtAuthors(authorObjs);

  const after = text.split(/"[^"]+"[,.]?\s*/)[1] ?? '';
  const jrnM  = after.match(/^([^,]+)/);
  const volM  = after.match(/\bvol\.\s*(\d+)/i);
  const noM   = after.match(/\bno\.\s*(\d+)/i);
  const ppM   = after.match(/\bpp\.\s*(\d+\s*[-–]+\s*\d+)/i);
  const yrM   = after.match(/,\s*(\d{4})\s*[,.]?\s*$/);

  if (jrnM) fields.journal = jrnM[1].trim().replace(/,$/, '');
  if (volM) fields.volume  = volM[1];
  if (noM)  fields.number  = noM[1];
  if (ppM)  fields.pages   = normPages(ppM[1]);
  if (yrM)  fields.year    = yrM[1];

  return { type: 'article', authorObjs, fields };
}

// ── Generic fallback ─────────────────────────────────────────────────────────

function parseGeneric(text) {
  const fields = {};
  let type = 'misc';

  const titleM = text.match(/"([^"]+)"/);
  if (titleM) { fields.title = strip(titleM[1]); type = 'article'; }

  const yrM  = text.match(/\b((?:19|20)\d{2})\b/);
  const volM = text.match(/\bvol(?:ume)?\.?\s*(\d+)/i);
  const ppM  = text.match(/\bpp?\.?\s*(\d+\s*[-–]+\s*\d+)/i);

  if (yrM)  fields.year  = yrM[1];
  if (volM) { fields.volume = volM[1]; type = 'article'; }
  if (ppM)  fields.pages = normPages(ppM[1]);

  if (!fields.title) {
    fields.note = text.length > 250 ? text.slice(0, 250) + '…' : text;
  }

  return { type, authorObjs: [], fields };
}

// ─── BibTeX generation ────────────────────────────────────────────────────────

const STOP_WORDS = new Set(['a','an','the','of','in','on','at','for','and','or','to','with','from','by','as','is']);

function makeCiteKey(family, year, title) {
  const surname = (family || 'Unknown').replace(/[^A-Za-z]/g, '');
  const y = year || 'XXXX';
  const titleWord = (title || '')
    .split(/\s+/)
    .map(w => w.replace(/[^A-Za-z]/g, ''))
    .find(w => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase())) ?? '';
  const tPart = titleWord
    ? titleWord.charAt(0).toUpperCase() + titleWord.slice(1).toLowerCase()
    : '';
  return `${surname}${y}${tPart}`;
}

const FIELD_ORDER = [
  'author','editor','title','booktitle','journal','year',
  'volume','number','pages','publisher','institution',
  'address','edition','doi','url','isbn','issn',
  'howpublished','note'
];

const NUMERIC_FIELDS = new Set(['year','volume','number','edition']);

function wrapVal(key, value) {
  if (NUMERIC_FIELDS.has(key) && /^\d+$/.test(value)) return value;
  if (value.startsWith('{') || value.startsWith('"')) return value;
  return `{${value}}`;
}

function toBibTeX(type, key, fields) {
  const extra = Object.keys(fields).filter(k => !FIELD_ORDER.includes(k));
  const ordered = [...FIELD_ORDER, ...extra].filter(k => {
    const v = fields[k];
    return v != null && String(v).trim() !== '';
  });

  const maxLen = Math.max(0, ...ordered.map(k => k.length));
  const lines  = [`@${type}{${key},`];

  ordered.forEach((k, i) => {
    const val   = wrapVal(k, String(fields[k]));
    const comma = i < ordered.length - 1 ? ',' : '';
    lines.push(`  ${k.padEnd(maxLen)} = ${val}${comma}`);
  });

  lines.push('}');
  return lines.join('\n');
}

// ─── Small utilities ──────────────────────────────────────────────────────────

function strip(s)  { return s.trim().replace(/[.,]$/, ''); }

// Parse "Last, First[, First2 Last2[, and First3 Last3]]" (Chicago/MLA multi-author).
// First author is inverted; subsequent authors are in natural order.
function parseInvertedFirstAuthors(raw) {
  raw = raw.replace(/[.,]\s*$/, '').trim();

  // Peel off the last author introduced by "and"
  let lastPart = '';
  const andM = raw.match(/,?\s*\band\b\s+(.+)$/i);
  if (andM) {
    lastPart = andM[1].trim();
    raw = raw.slice(0, raw.length - andM[0].length).trim();
  }

  // "Reidinger, Verena, Lucas Leemann"
  // parts[0] = family of first author, parts[1] = given, parts[2..] = extra authors
  const parts = raw.split(/,\s*/);
  const authors = [];

  if (parts.length >= 2) {
    authors.push({ family: parts[0].trim(), given: parts[1].trim() });
    for (let i = 2; i < parts.length; i++) {
      const name = parts[i].trim();
      if (!name) continue;
      const sp = name.lastIndexOf(' ');
      authors.push(sp >= 0
        ? { family: name.slice(sp + 1), given: name.slice(0, sp) }
        : { family: name, given: '' });
    }
  } else if (parts[0]) {
    authors.push({ family: parts[0].trim(), given: '' });
  }

  if (lastPart) {
    const sp = lastPart.lastIndexOf(' ');
    authors.push(sp >= 0
      ? { family: lastPart.slice(sp + 1), given: lastPart.slice(0, sp) }
      : { family: lastPart, given: '' });
  }

  return authors;
}

function parseSingleInverted(text) {
  text = text.trim().replace(/\.$/, '');
  const m = text.match(/^([^,]+),\s*(.+)/);
  return m ? { family: m[1].trim(), given: m[2].trim() } : { family: text, given: '' };
}

function fmtAuthors(list) {
  return list.map(a => a.given ? `${a.family}, ${a.given}` : a.family).join(' and ');
}
