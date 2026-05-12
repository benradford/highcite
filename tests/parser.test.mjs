/**
 * Citation parser test suite — no-DOI citations in various formats and stylizations.
 *
 * Stylization coverage:
 *   - ALL-CAPS journal names and acronyms (NATURE, PLOS ONE, IEEE ACCESS, NAT REV CANCER)
 *   - ALL-CAPS title words / gene/protein names (CRISPR, HIV)
 *   - Curly/smart quotes in titles (normalized by parser to straight quotes)
 *   - En-dash and em-dash in page ranges (normalized to --)
 *   - Curly apostrophes in author names
 *   - Non-breaking spaces
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { convertToBibTeX } from '../parser.js';

/**
 * Parse a BibTeX string into a plain object for easy field assertions.
 * Handles both {string value} and bare numeric values.
 */
function bf(bibtex) {
  const out = {};
  const hdr = bibtex.match(/^@(\w+)\{(\w+),/);
  if (hdr) { out._type = hdr[1]; out._key = hdr[2]; }
  const re = /^\s*(\w+)\s*=\s*(?:\{([^}]*)\}|(\d+))/gm;
  let m;
  while ((m = re.exec(bibtex)) !== null) {
    out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return out;
}

// ── APA ───────────────────────────────────────────────────────────────────────

describe('APA', () => {

  it('standard article — two authors, volume, issue, pages', async () => {
    const f = bf(await convertToBibTeX(
      'Smith, J. A., & Jones, B. (2020). The impact of climate change. Nature, 15(3), 100-200.'
    ));
    assert.equal(f._type, 'article');
    assert.equal(f.year, '2020');
    assert.ok(f.author?.includes('Smith'), 'author should include Smith');
    assert.ok(f.author?.includes('Jones'), 'author should include Jones');
    assert.ok(f.title?.includes('climate change'));
    assert.equal(f.journal, 'Nature');
    assert.equal(f.volume, '15');
    assert.equal(f.number, '3');
    assert.equal(f.pages, '100--200');
  });

  it('ALL-CAPS journal name (PLOS ONE)', async () => {
    const f = bf(await convertToBibTeX(
      'Brown, K. L. (2019). Neural network approaches to image recognition. PLOS ONE, 14(7), 1-12.'
    ));
    assert.equal(f.journal, 'PLOS ONE');
    assert.equal(f.year, '2019');
    assert.equal(f.volume, '14');
    assert.equal(f.number, '7');
  });

  it('ALL-CAPS multi-word journal (NATURE MEDICINE)', async () => {
    const f = bf(await convertToBibTeX(
      'Chen, Y. F., & Li, M. (2021). Single-cell transcriptomics review. NATURE MEDICINE, 27(3), 400-415.'
    ));
    assert.equal(f.journal, 'NATURE MEDICINE');
    assert.equal(f.year, '2021');
    assert.equal(f.pages, '400--415');
  });

  it('year with disambiguation letter (2021a)', async () => {
    const f = bf(await convertToBibTeX(
      'Garcia, M. R. (2021a). Advances in immunotherapy. Cancer Research, 81(4), 900-910.'
    ));
    assert.equal(f.year, '2021');
    assert.equal(f.journal, 'Cancer Research');
    assert.ok(f.author?.includes('Garcia'));
  });

  it('en-dash page range normalized to --', async () => {
    // U+2013 EN DASH in page range
    const f = bf(await convertToBibTeX(
      'Lee, H. J. (2022). Deep learning methods for genomics. Science, 374(6571), 980–985.'
    ));
    assert.equal(f.pages, '980--985');
    assert.equal(f.year, '2022');
  });

  it('em-dash page range normalized to --', async () => {
    // U+2014 EM DASH in page range
    const f = bf(await convertToBibTeX(
      'Patel, R. N. (2018). Antibiotic resistance mechanisms. Lancet, 392(10153), 1202—1209.'
    ));
    assert.equal(f.pages, '1202--1209');
  });

  it('non-breaking space in citation normalized', async () => {
    // U+00A0 NON-BREAKING SPACE between author initials
    const f = bf(await convertToBibTeX(
      'Wilson, T. D. (2016). Psychological change. Psychological Science, 27(4), 583-585.'
    ));
    assert.equal(f.year, '2016');
    assert.ok(f.author?.includes('Wilson'));
  });

  it('hyphenated family name', async () => {
    const f = bf(await convertToBibTeX(
      'Martin-Sanchez, F. J. (2022). Biomedical informatics advances. Journal of Biomedical Informatics, 128, 104-115.'
    ));
    assert.ok(f.author?.includes('Martin-Sanchez'), 'hyphenated name should be preserved');
    assert.equal(f.year, '2022');
  });
});

// ── MLA ───────────────────────────────────────────────────────────────────────

describe('MLA', () => {

  it('standard article — vol., no., pp., year', async () => {
    const f = bf(await convertToBibTeX(
      'Smith, John. "Article Title Here." Journal of Science, vol. 10, no. 2, 2020, pp. 100-200.'
    ));
    assert.equal(f._type, 'article');
    assert.equal(f.title, 'Article Title Here');
    assert.equal(f.journal, 'Journal of Science');
    assert.equal(f.volume, '10');
    assert.equal(f.number, '2');
    assert.equal(f.year, '2020');
    assert.equal(f.pages, '100--200');
    assert.ok(f.author?.includes('Smith'));
  });

  it('ALL-CAPS journal name (PLOS COMPUTATIONAL BIOLOGY)', async () => {
    const f = bf(await convertToBibTeX(
      'Jones, Alice B. "Data Analysis Methods." PLOS COMPUTATIONAL BIOLOGY, vol. 15, no. 3, 2019, pp. 50-75.'
    ));
    assert.equal(f.journal, 'PLOS COMPUTATIONAL BIOLOGY');
    assert.equal(f.title, 'Data Analysis Methods');
    assert.equal(f.year, '2019');
  });

  it('ALL-CAPS acronym in title (CRISPR)', async () => {
    const f = bf(await convertToBibTeX(
      'Davis, Robert. "CRISPR Gene Editing Challenges." Nature Biotechnology, vol. 38, no. 9, 2020, pp. 1024-1032.'
    ));
    assert.equal(f.title, 'CRISPR Gene Editing Challenges');
    assert.equal(f.journal, 'Nature Biotechnology');
    assert.equal(f.pages, '1024--1032');
  });

  it('ALL-CAPS IEEE journal abbreviation', async () => {
    const f = bf(await convertToBibTeX(
      'Kumar, Raj. "Federated Learning at Scale." IEEE TRANSACTIONS ON NEURAL NETWORKS, vol. 33, no. 5, 2022, pp. 2100-2115.'
    ));
    assert.equal(f.journal, 'IEEE TRANSACTIONS ON NEURAL NETWORKS');
    assert.equal(f.volume, '33');
  });

  it('curly/smart double quotes around title normalized', async () => {
    // U+201C LEFT and U+201D RIGHT double quotation marks
    const f = bf(await convertToBibTeX(
      'Brown, Lisa. “Quantum Entanglement Revisited.” Physical Review Letters, vol. 120, no. 4, 2018, pp. 40-55.'
    ));
    assert.equal(f.title, 'Quantum Entanglement Revisited');
    assert.equal(f.journal, 'Physical Review Letters');
    assert.equal(f.year, '2018');
  });

  it('en-dash page range in MLA citation', async () => {
    const f = bf(await convertToBibTeX(
      'Nguyen, Thi H. "Microbiome Diversity in Urban Populations." Cell Host & Microbe, vol. 29, no. 6, 2021, pp. 900–912.'
    ));
    assert.equal(f.pages, '900--912');
  });
});

// ── Chicago ───────────────────────────────────────────────────────────────────

describe('Chicago', () => {

  it('standard article — journal vol, no. N (YYYY): pages', async () => {
    const f = bf(await convertToBibTeX(
      'Brown, Emily. "The Rise of Machine Learning." Artificial Intelligence Review 12, no. 4 (2018): 300-350.'
    ));
    assert.equal(f._type, 'article');
    assert.equal(f.title, 'The Rise of Machine Learning');
    assert.equal(f.journal, 'Artificial Intelligence Review');
    assert.equal(f.volume, '12');
    assert.equal(f.number, '4');
    assert.equal(f.year, '2018');
    assert.equal(f.pages, '300--350');
    assert.ok(f.author?.includes('Brown'));
  });

  it('ALL-CAPS journal name (SCIENCE)', async () => {
    const f = bf(await convertToBibTeX(
      'Davis, Michael R. "Quantum Computing Advances." SCIENCE 375, no. 1 (2021): 45-50.'
    ));
    assert.equal(f.journal, 'SCIENCE');
    assert.equal(f.volume, '375');
    assert.equal(f.number, '1');
    assert.equal(f.year, '2021');
    assert.equal(f.pages, '45--50');
  });

  it('ALL-CAPS acronym in title (HIV)', async () => {
    const f = bf(await convertToBibTeX(
      'Chen, Wei. "HIV Treatment Outcomes in Sub-Saharan Africa." Journal of Infectious Diseases 220, no. 6 (2019): 900-910.'
    ));
    assert.equal(f.title, 'HIV Treatment Outcomes in Sub-Saharan Africa');
    assert.equal(f.journal, 'Journal of Infectious Diseases');
    assert.equal(f.year, '2019');
  });

  it('ALL-CAPS acronym in title (mRNA)', async () => {
    const f = bf(await convertToBibTeX(
      'Park, Ji-Yeon. "mRNA Vaccine Design Principles." Nature Reviews Drug Discovery 21, no. 3 (2022): 180-195.'
    ));
    assert.equal(f.title, 'mRNA Vaccine Design Principles');
    assert.equal(f.year, '2022');
    assert.equal(f.pages, '180--195');
  });

  it('en-dash in page range', async () => {
    const f = bf(await convertToBibTeX(
      'Yamamoto, Kenji. "Earthquake Prediction Models." Geophysical Research Letters 48, no. 2 (2020): 100–10.'
    ));
    assert.equal(f.pages, '100--10');
    assert.equal(f.year, '2020');
  });

  it('curly quotes around title normalized', async () => {
    const f = bf(await convertToBibTeX(
      'Okonkwo, Chidi. “Climate Migration Patterns.” Environmental Science 30, no. 7 (2023): 550-580.'
    ));
    assert.equal(f.title, 'Climate Migration Patterns');
    assert.equal(f.year, '2023');
  });

  it('no-volume format “(YYYY): pages” — not misdetected as APA', async () => {
    // Chicago/old-MLA style: Journal (YYYY): pages, no vol./no. fields
    const f = bf(await convertToBibTeX(
      'Reidinger, Verena, Lucas Leemann, and Jonathan Slapin. “How Descriptive Over- and under-Representation Impacts Citizens’ Evaluations of Decision-Making across Policy Domains.” Political Science Research and Methods (2026): 1–20. Web.'
    ));
    assert.equal(f._type, 'article');
    assert.equal(f.year, '2026');
    assert.equal(f.journal, 'Political Science Research and Methods');
    assert.equal(f.pages, '1--20');
    assert.ok(f.title?.includes('Descriptive'));
    assert.ok(f.author?.includes('Reidinger'), 'first author family name');
    assert.ok(f.author?.includes('Leemann'),   'second author family name');
    assert.ok(f.author?.includes('Slapin'),    'third author family name');
  });

  it('three-author Chicago — authors split on “and” correctly', async () => {
    const f = bf(await convertToBibTeX(
      'Smith, John, Jane Doe, and Robert Brown. “Collaborative Research Methods.” Journal of Research 15, no. 2 (2022): 100-120.'
    ));
    assert.ok(f.author?.includes('Smith'),  'first author');
    assert.ok(f.author?.includes('Doe'),    'second author');
    assert.ok(f.author?.includes('Brown'),  'third author');
    assert.equal(f.year, '2022');
  });
});

// ── Vancouver ─────────────────────────────────────────────────────────────────

describe('Vancouver', () => {

  it('standard article — year;vol(issue):pages', async () => {
    const f = bf(await convertToBibTeX(
      'Smith JA, Jones BC. Understanding genomics. J Genet Med. 2020;15(2):100-200.'
    ));
    assert.equal(f._type, 'article');
    assert.equal(f.year, '2020');
    assert.equal(f.volume, '15');
    assert.equal(f.number, '2');
    assert.equal(f.pages, '100--200');
    assert.ok(f.author?.includes('Smith'));
  });

  it('ALL-CAPS journal abbreviation (NAT REV CANCER)', async () => {
    const f = bf(await convertToBibTeX(
      'Brown CD, Williams EF. Cancer immunotherapy update. NAT REV CANCER. 2019;19(5):295-310.'
    ));
    assert.equal(f.year, '2019');
    assert.equal(f.volume, '19');
    assert.equal(f.number, '5');
    assert.equal(f.pages, '295--310');
  });

  it('ALL-CAPS journal (JAMA) — three authors', async () => {
    const f = bf(await convertToBibTeX(
      'Taylor GH, Robinson IJ, Anderson KL. Surgical outcomes meta-analysis. JAMA. 2021;326(4):320-335.'
    ));
    assert.equal(f.year, '2021');
    assert.equal(f.volume, '326');
    assert.equal(f.number, '4');
    assert.ok(f.author?.includes('Taylor'));
    assert.ok(f.author?.includes('Robinson'));
  });

  it('ALL-CAPS title words', async () => {
    const f = bf(await convertToBibTeX(
      'Zhao MN, Liu QP. SARS-CoV-2 spike protein mutations. Nat Commun. 2022;13(1):1001-1015.'
    ));
    assert.ok(f.title?.includes('SARS-CoV-2'));
    assert.equal(f.year, '2022');
  });

  it('en-dash page range normalized', async () => {
    const f = bf(await convertToBibTeX(
      'Lopez RA, Kim SH. Gut microbiome analysis methods. Gut. 2020;69(4):710–725.'
    ));
    assert.equal(f.pages, '710--725');
  });
});

// ── IEEE ──────────────────────────────────────────────────────────────────────

describe('IEEE', () => {

  it('standard article — vol., no., pp., year', async () => {
    const f = bf(await convertToBibTeX(
      'J. A. Smith and B. C. Jones, "A survey of machine learning," IEEE Trans. Neural Netw., vol. 25, no. 3, pp. 500-520, 2020.'
    ));
    assert.equal(f._type, 'article');
    assert.equal(f.volume, '25');
    assert.equal(f.number, '3');
    assert.equal(f.pages, '500--520');
    assert.equal(f.year, '2020');
    assert.ok(f.author?.includes('Smith'));
    assert.ok(f.author?.includes('Jones'));
  });

  it('ALL-CAPS journal name (IEEE ACCESS)', async () => {
    const f = bf(await convertToBibTeX(
      'M. A. Brown and K. L. Davis, "Deep learning fundamentals," IEEE ACCESS, vol. 8, no. 1, pp. 1000-2000, 2021.'
    ));
    assert.equal(f.year, '2021');
    assert.ok(f.title?.includes('Deep learning'));
    assert.ok(f.author?.includes('Brown'));
  });

  it('ALL-CAPS full journal (IEEE TRANSACTIONS ON PATTERN ANALYSIS)', async () => {
    const f = bf(await convertToBibTeX(
      'A. K. Jain, "Object recognition in images," IEEE TRANSACTIONS ON PATTERN ANALYSIS AND MACHINE INTELLIGENCE, vol. 31, no. 6, pp. 1024-1036, 2009.'
    ));
    assert.equal(f.volume, '31');
    assert.equal(f.number, '6');
    assert.equal(f.year, '2009');
    assert.ok(f.author?.includes('Jain'));
  });

  it('single author', async () => {
    const f = bf(await convertToBibTeX(
      'R. E. Kalman, "A new approach to linear filtering and prediction problems," J. Basic Eng., vol. 82, no. 1, pp. 35-45, 1960.'
    ));
    assert.equal(f.year, '1960');
    assert.ok(f.author?.includes('Kalman'));
    assert.equal(f.volume, '82');
  });

  it('em-dash in page range normalized', async () => {
    const f = bf(await convertToBibTeX(
      'A. Einstein and N. Bohr, "Quantum mechanics debate," Nature Physics, vol. 1, no. 1, pp. 10–20, 2005.'
    ));
    assert.equal(f.pages, '10--20');
  });

  it('curly/smart title quotes normalized', async () => {
    const f = bf(await convertToBibTeX(
      'Y. LeCun, “Convolutional networks for image recognition,” IEEE Trans. Pattern Anal., vol. 11, no. 2, pp. 200-215, 1998.'
    ));
    assert.equal(f.title, 'Convolutional networks for image recognition');
    assert.equal(f.year, '1998');
  });
});
