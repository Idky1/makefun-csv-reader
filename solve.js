// Fast drop-in for csv-reader 1.0.0 (make.fun's "Read broken CSV files faster").
//
// run(input) returns exactly what csv-reader 1.0.0 returns for the same input:
// the reading of {text, header} as {columns, rows, errors}. Semantics (from the
// reference, vendor/csv-reader/index.js in the kit):
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote, and each CRLF or lone CR inside it read as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that never
//     closes is a literal character, and the text after it is read again as
//     unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its field count) or cut (long_row, with extra: the
//     cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met, a record's short_row or
//     long_row when it ends: line the 1-based line its record starts on, counting
//     every LF, CRLF and lone CR inside quotes, and row its record's index in
//     rows, null for the header.
//
// Speed comes from never reading one character at a time: fields are cut out
// with indexOf/slice, a quoted field is found by jumping from quote to quote,
// and a plain field is scanned inline against the record's known line end.
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** One line break inside quotes: a CRLF, a lone CR, or a LF (each counts once). */
const LINE_BREAK_IN_QUOTES = /\r\n|\r|\n/g;

/** A CR or CRLF inside a quoted field becomes one LF. */
const CR_TO_LF = /\r\n?/g;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The next LF at or after pos, or -1: the end of the line the current field is on.
  // Recomputed at each record start and after every quoted field (only a quoted
  // field can move the reading onto a later line); a plain field never crosses it.
  let lineEnd = -1;

  // The field just read (written by the readers instead of returning a fresh
  // object per field, so the hot loop allocates nothing per field).
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Writes fValue/fEnded, and fAdded counts the characters kept. Used for the cold paths only
  // (quote junk, an unterminated quote's re-read, a field continued past a lone CR); a plain field is
  // scanned inline in the record loop.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      const iComma = text.indexOf(',', pos);
      const iLF = text.indexOf('\n', pos);
      const iCR = text.indexOf('\r', pos);
      let idx = -1;
      let kind = -1; // 0 comma, 1 LF, 2 CR
      if (iComma !== -1) { idx = iComma; kind = 0; }
      if (iLF !== -1 && (idx === -1 || iLF < idx)) { idx = iLF; kind = 1; }
      if (iCR !== -1 && (idx === -1 || iCR < idx)) { idx = iCR; kind = 2; }
      if (idx === -1) {
        if (pos < n) { value += text.slice(pos); added += n - pos; }
        pos = n;
        fValue = value; fEnded = END; fAdded = added;
        return;
      }
      if (kind === 0) {
        value += text.slice(pos, idx); added += idx - pos;
        pos = idx + 1;
        fValue = value; fEnded = COMMA; fAdded = added;
        return;
      }
      if (kind === 1) {
        value += text.slice(pos, idx); added += idx - pos;
        pos = idx + 1;
        line += 1;
        fValue = value; fEnded = LINE_BREAK; fAdded = added;
        return;
      }
      // kind === 2, a CR.
      if (text.charCodeAt(idx + 1) === 10) {
        value += text.slice(pos, idx); added += idx - pos;
        pos = idx + 2;
        line += 1;
        fValue = value; fEnded = LINE_BREAK; fAdded = added;
        return;
      }
      // A lone CR: dropped, and the field goes on.
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      value += text.slice(pos, idx); added += idx - pos;
      pos = idx + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    // Find the closing quote, jumping from quote to quote; "" is one quote in the value.
    let segStart = pos + 1;
    let cur = segStart;
    let segments = null;
    let closedAt = -1;
    for (;;) {
      const q = text.indexOf('"', cur);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        if (segments === null) segments = [];
        segments.push(text.slice(segStart, q));
        cur = q + 2;
        segStart = cur;
        continue;
      }
      closedAt = q;
      break;
    }
    if (closedAt === -1) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      // (line was never moved while hunting the quote, so it is still the line the quote opened on.)
      pos = open + 1;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted('"');
      return;
    }
    // The quoted span is [open+1, closedAt). "" pairs are already folded into segments;
    // a lone segment means no doubled quote was met.
    let value;
    if (segments === null) {
      value = text.slice(open + 1, closedAt);
    } else {
      segments.push(text.slice(segStart, closedAt));
      value = segments.join('"');
    }
    // Line breaks inside the quotes: each CRLF, lone CR or LF counts once; each CR becomes one LF.
    if (value.indexOf('\r') !== -1 || value.indexOf('\n') !== -1) {
      const breaks = value.match(LINE_BREAK_IN_QUOTES);
      if (breaks !== null) line += breaks.length;
      if (value.indexOf('\r') !== -1) value = value.replace(CR_TO_LF, '\n');
    }
    pos = closedAt + 1;
    if (pos >= n) { fValue = value; fEnded = END; fAdded = 0; return; }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = value; fEnded = COMMA; fAdded = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fValue = value; fEnded = LINE_BREAK; fAdded = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = value; fEnded = LINE_BREAK; fAdded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  // Finishes a record that is not the header: pads or cuts it to the first record's width.
  function finishRecord(fields) {
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    lineEnd = text.indexOf('\n', pos);

    // Field by field.
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) {
        readQuoted();
        lineEnd = text.indexOf('\n', pos);
      } else {
        // Plain field, scanned inline against the known line end: its next
        // delimiter is the nearest of the next comma, the line end, or a CR.
        const iComma = text.indexOf(',', pos);
        const iCR = text.indexOf('\r', pos);
        let end = iComma;
        let kind = 0; // 0 comma
        if (lineEnd !== -1 && (end === -1 || lineEnd < end)) { end = lineEnd; kind = 1; }
        if (iCR !== -1 && (end === -1 || iCR < end)) { end = iCR; kind = 2; }
        if (end === -1) {
          fValue = text.slice(pos); fAdded = n - pos; pos = n; fEnded = END;
        } else if (kind === 0) {
          fValue = text.slice(pos, end); fAdded = end - pos; pos = end + 1; fEnded = COMMA;
        } else if (kind === 1) {
          fValue = text.slice(pos, end); fAdded = end - pos; pos = end + 1; line += 1; fEnded = LINE_BREAK;
        } else if (text.charCodeAt(end + 1) === 10) {
          fValue = text.slice(pos, end); fAdded = end - pos; pos = end + 2; line += 1; fEnded = LINE_BREAK;
        } else {
          // A lone CR: dropped (stray_cr); the field goes on via readUnquoted.
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          const firstLen = end - pos;
          const first = text.slice(pos, end);
          pos = end + 1;
          readUnquoted(first);
          fAdded += firstLen;
        }
      }
      fields.push(fValue);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
