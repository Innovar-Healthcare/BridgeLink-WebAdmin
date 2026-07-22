// Mirror of VariableTransferable.java's VALID_VELOCITY_VARIABLE_PATTERN.
// A bare ${name} reference is only safe when the name is a plain identifier
// (letters, digits, underscore, hyphen, starting with a letter). Anything else
// (periods, brackets, spaces, etc.) must use the maps.get(...) form so Velocity
// does not misparse the name as a property/method chain.
export const VALID_VELOCITY_VARIABLE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

// Pick a string-literal quote character that does not appear in `name`.
// Falls back to escaping single quotes when the name contains both quote types.
// This mirrors Java's replaceAll("'", "\"") logic from VariableTransferable.
function quoted(name: string): string {
  if (!name.includes("'")) return `'${name}'`;
  if (!name.includes('"')) return `"${name}"`;
  return `'${name.replace(/'/g, "\\'")}'`;
}

// Format a variable name for a Velocity-aware editor (SQL, file template, message template).
// Mirrors VariableTransferable with TransferMode.VELOCITY.
export function formatVelocityVarRef(name: string): string {
  if (VALID_VELOCITY_VARIABLE.test(name)) return `\${${name}}`;
  return `\${maps.get(${quoted(name)})}`;
}

// Format a variable name for a JavaScript editor (transformer/filter scripts).
// Mirrors VariableTransferable with TransferMode.JAVASCRIPT.
export function formatJsVarRef(name: string): string {
  return `$(${quoted(name)})`;
}

// Format a previous-destination name as a Velocity response-map reference.
export function formatVelocityResponseMapRef(name: string): string {
  return `\${responseMap[${quoted(name)}]}`;
}

// Format a previous-destination name as a JavaScript response-map reference.
export function formatJsResponseMapRef(name: string): string {
  return `responseMap.get(${quoted(name)})`;
}
