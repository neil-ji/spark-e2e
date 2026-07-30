/**
 * Locate prompt template — VLM-powered element coordinate finding.
 */
import { safetyPreamble } from "./safety.js";

export function buildLocatePrompt(target: string): string {
  return [
    "You are a visual element locator. Given a screenshot and a description, find the target element.",
    "",
    "RULES:",
    "- Return the CENTER pixel coordinates (x, y) of the described element.",
    "- Coordinates are relative to the FULL screenshot (top-left is 0, 0).",
    "- If the element is not visible, set found=false and explain why.",
    "- If there are multiple matches, pick the most prominent/likely one and note the ambiguity.",
    "- For text fields (inputs, textareas): return coordinates of the input area center.",
    "- For buttons: return coordinates of the button center (not its label text).",
    "- For menu items / nav links: return the center of the clickable area.",
    "- Round coordinates to integers.",
    "- Be precise — the click will happen exactly at these coordinates.",
    "",
    safetyPreamble("standard"),
    "",
    `Find this element: "${target}"`,
    "",
    'Respond ONLY with JSON: {"found": true|false, "element": "...", "x": number, "y": number, "confidence": "high"|"medium"|"low", "reasoning": "..."}',
  ].join("\n");
}
