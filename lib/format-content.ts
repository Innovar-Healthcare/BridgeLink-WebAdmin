/**
 * Pretty-print JSON or XML content. Returns original text unchanged for
 * other formats or if parsing fails.
 */
import { logWarn } from "@/lib/dev-logger";
export function formatContent(text: string, shouldFormat: boolean): string {
  if (typeof text !== "string") return String(text ?? "");
  if (!shouldFormat || !text) return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  const firstChar = trimmed.charAt(0);
  if (firstChar === "{" || firstChar === "[") {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch (e) {
      logWarn("Format", "JSON format failed", e);
      return text;
    }
  }
  if (firstChar === "<") {
    try {
      let formatted = "";
      let indent = 0;
      const parts = trimmed.replace(/>\s*</g, ">\n<").split("\n");
      for (const part of parts) {
        if (part.match(/^<\/\w/)) indent = Math.max(0, indent - 1);
        formatted += "  ".repeat(indent) + part + "\n";
        if (part.match(/^<\w[^>]*[^/]>$/) && !part.startsWith("<?") && !part.startsWith("<!"))
          indent++;
      }
      return formatted.trimEnd();
    } catch (e) {
      logWarn("Format", "XML format failed", e);
      return text;
    }
  }
  return text;
}
