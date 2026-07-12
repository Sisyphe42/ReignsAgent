export function stringify(value) {
  const lines = [];
  writeTable(lines, value, "");
  return `${lines.join("\n").trim()}\n`;
}

export function parse(source) {
  const root = {};
  let table = root;
  for (const [index, rawLine] of String(source).split(/\r?\n/).entries()) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const section = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (section) {
      table = root;
      for (const part of section[1].split(".")) {
        if (!isRecord(table[part])) table[part] = {};
        table = table[part];
      }
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) throw new Error(`Invalid TOML at line ${index + 1}`);
    table[assignment[1]] = parseValue(assignment[2], index + 1);
  }
  return root;
}

function writeTable(lines, value, prefix) {
  const entries = Object.entries(value ?? {});
  for (const [key, entry] of entries) {
    if (!isRecord(entry)) lines.push(`${key} = ${formatValue(entry)}`);
  }
  for (const [key, entry] of entries) {
    if (!isRecord(entry)) continue;
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    const section = prefix ? `${prefix}.${key}` : key;
    lines.push(`[${section}]`);
    writeTable(lines, entry, section);
  }
}

function formatValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  throw new Error(`Unsupported TOML value '${typeof value}'`);
}

function parseValue(source, line) {
  const value = source.trim();
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") throw new Error("not a string");
      return parsed;
    } catch (error) {
      throw new Error(`Invalid TOML string at line ${line}: ${error.message}`);
    }
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) return parseArray(value.slice(1, -1), line);
  throw new Error(`Unsupported TOML value at line ${line}`);
}

function parseArray(source, line) {
  const values = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (character === "," && !quoted) {
      if (current.trim()) values.push(parseValue(current, line));
      current = "";
    } else current += character;
  }
  if (quoted) throw new Error(`Unterminated TOML array string at line ${line}`);
  if (current.trim()) values.push(parseValue(current, line));
  return values;
}

function stripComment(line) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (character === "#" && !quoted) return line.slice(0, index);
  }
  return line;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
