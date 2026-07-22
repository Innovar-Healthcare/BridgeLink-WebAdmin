// dcmjs ships no type declarations. We access it through narrow, hand-rolled
// interfaces (see lib/dicom-tag-parser.ts and components/messages/dicom-viewer.tsx),
// so an untyped ambient module is sufficient — the call sites cast to the shapes
// they need. Previously dcmjs was pulled in via require() (implicitly any); this
// declaration lets the equivalent `await import("dcmjs")` type-check.
declare module "dcmjs";
