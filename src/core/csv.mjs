// Spreadsheet applications may execute untrusted text as formulas.
export function safeCsvCell(value) {
  const text = String(value ?? '');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: detect control-prefixed spreadsheet formula payloads.
  return /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/u.test(text) ? `'${text}` : text;
}
