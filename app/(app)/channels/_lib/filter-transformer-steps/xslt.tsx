/**
 * Built-in XSLT Step definition.
 *
 * Mirrors the Java class `com.mirth.connect.plugins.xsltstep.XsltStep`.
 */

import { XsltPanel } from "../../_components/filter-transformer/xslt-panel";
import type { XsltStep } from "../filter-transformer-xml";
import type { TransformerStepDefinition, TransformerStepEditorProps } from "./types";
import { childBool, childText, childTextRaw, tcStr } from "../filter-transformer-xml-helpers";
import { convertIdentifier } from "../iterator-utils";

/**
 * The XSLT transformation prelude shared by the standalone script and the
 * Iterator iteration script (mirrors Java `XsltStep.getTransformationScript`).
 * Both end by populating `resultVar`; they differ only in how it is stored.
 */
function buildTransformationScript(step: XsltStep): string {
  let s = "";
  if (step.useCustomFactory && step.customFactory) {
    s += `tFactory = Packages.javax.xml.transform.TransformerFactory.newInstance("${step.customFactory}", null);\n`;
  } else {
    s += "tFactory = Packages.javax.xml.transform.TransformerFactory.newInstance();\n";
  }
  s += `xsltTemplate = new Packages.java.io.StringReader(${step.template});\n`;
  s +=
    "transformer = tFactory.newTransformer(new Packages.javax.xml.transform.stream.StreamSource(xsltTemplate));\n";
  s += `sourceVar = new Packages.java.io.StringReader(${step.sourceXml});\n`;
  s += "resultVar = new Packages.java.io.StringWriter();\n";
  s +=
    "transformer.transform(new Packages.javax.xml.transform.stream.StreamSource(sourceVar), new Packages.javax.xml.transform.stream.StreamResult(resultVar));\n";
  return s;
}

/**
 * Accumulator variable name used inside an Iterator: `_` + `resultVariable`
 * with non-identifier characters stripped. The `channelMap.put` key uses the
 * RAW `resultVariable` — matching Java's `XsltStep`.
 */
function accumulatorName(step: XsltStep): string {
  return `_${convertIdentifier(step.resultVariable)}`;
}

function XsltStepEditor({
  step,
  onChange,
  isDark,
  showErrors,
}: TransformerStepEditorProps<XsltStep>) {
  return (
    <XsltPanel step={step} onChange={onChange} isDark={isDark ?? false} showErrors={showErrors} />
  );
}

export const XsltStepDefinition: TransformerStepDefinition<XsltStep> = {
  type: "XSLT Step",
  xmlTag: "com.mirth.connect.plugins.xsltstep.XsltStep",
  contexts: ["source", "destination"],

  defaults: () => ({
    type: "XSLT Step",
    name: "",
    sequenceNumber: "0",
    enabled: true,
    sourceXml: "",
    resultVariable: "",
    template: "",
    useCustomFactory: false,
    customFactory: "",
  }),

  parse: (el) => ({
    type: "XSLT Step",
    name: "",
    sequenceNumber: "0",
    enabled: true,
    sourceXml: childText(el, "sourceXml"),
    resultVariable: childText(el, "resultVariable"),
    template: childTextRaw(el, "template"),
    useCustomFactory: childBool(el, "useCustomFactory", false),
    customFactory: childText(el, "customFactory"),
  }),

  serialize: (step) =>
    tcStr("sourceXml", step.sourceXml) +
    tcStr("resultVariable", step.resultVariable) +
    tcStr("template", step.template) +
    tcStr("useCustomFactory", String(step.useCustomFactory)) +
    tcStr("customFactory", step.customFactory),

  emitScript: (step) =>
    `${buildTransformationScript(step)}channelMap.put('${step.resultVariable}', resultVar.toString());\n`,

  // Iterator phases — mirror XsltStep.getPreScript/getIterationScript/getPostScript.
  emitPreScript: (step) => `var ${accumulatorName(step)} = Lists.list();`,

  emitIterationScript: (step) =>
    `${buildTransformationScript(step)}${accumulatorName(step)}.add(resultVar.toString());\n`,

  emitPostScript: (step) =>
    `channelMap.put('${step.resultVariable}', ${accumulatorName(step)}.toArray());\n`,

  // Java XsltStepPanel.checkProperties requires only `sourceXml` and
  // `resultVariable`. An empty or malformed template does NOT block save (the
  // editor panel still flags it inline as a non-blocking warning).
  validate: (step) => {
    if (!step.sourceXml?.trim()) return "Source XML cannot be empty.";
    if (!step.resultVariable?.trim()) return "Result variable cannot be empty.";
    return null;
  },

  EditorPanel: XsltStepEditor,
};
