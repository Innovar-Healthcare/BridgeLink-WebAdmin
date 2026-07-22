import { useState, useRef, useEffect } from "react";
import type { DataTypeDefinition, DataTypePropertiesSectionProps, MsgTreeNode } from "./types";
import {
  ScriptEditorDialog,
  PropertyRow,
  PropertyCheckbox,
  selectCls,
  inputCls,
  setXmlText,
} from "./panel-components";
import { unescapeDelimiters } from "./datatype-input-utils";

// ── NCPDP reference data ───────────────────────────────────────────────────────
// Ported from NCPDPReference.java — field codes, segment codes, transaction types.

const NCPDP_TRANSACTION_MAP: Record<string, string> = {
  E1: "EligibilityVerification",
  B1: "Billing",
  B2: "Reversal",
  B3: "Rebill",
  P1: "PARequestBilling",
  P2: "PAReversal",
  P3: "PAInquiry",
  P4: "PARequestOnly",
  N1: "InformationReporting",
  N2: "InformationReportingReversal",
  N3: "InformationReportingRebill",
  C1: "ControlledSubstanceReporting",
  C2: "ControlledSubstanceReportingReversal",
  C3: "ControlledSubstanceReportingRebill",
};

const NCPDP_SEGMENTS_51: Record<string, string> = {
  AM01: "Patient",
  AM02: "PharmacyProvider",
  AM03: "Prescriber",
  AM04: "Insurance",
  AM05: "CoordinationOfBenefitsOtherPayments",
  AM06: "WorkersCompensation",
  AM07: "Claim",
  AM08: "DURPPS",
  AM09: "Coupon",
  AM10: "Compound",
  AM11: "Pricing",
  AM12: "PriorAuthorization",
  AM13: "Clinical",
  AM20: "ResponseMessage",
  AM21: "ResponseStatus",
  AM22: "ResponseClaim",
  AM23: "ResponsePricing",
  AM24: "ResponseDURPPS",
  AM25: "ResponseInsurance",
  AM26: "ResponsePriorAuthorization",
};

const NCPDP_SEGMENTS_D0: Record<string, string> = {
  ...NCPDP_SEGMENTS_51,
  AM14: "AdditionalDocumentation",
  AM15: "Facility",
  AM16: "Narrative",
};

// v5.1 field code → name
const NCPDP_FIELDS_51: Record<string, string> = {
  "28": "UnitOfMeasure",
  "1C": "SmokerNon-SmokerCode",
  "1E": "PrescriberLocationCode",
  "2C": "PregnancyIndicator",
  "2E": "PrimaryCareProviderIdQualifier",
  "2F": "NetworkReimbursementId",
  "4C": "CoordinationOfBenefitsOtherPaymentsCount",
  "4E": "PrimaryCareProviderLastName",
  "4F": "RejectFieldOccurrenceIndicator",
  "5C": "OtherPayerCoverageType",
  "5E": "OtherPayerRejectCount",
  "5F": "ApprovedMessageCodeCount",
  "6C": "OtherPayerIdQualifier",
  "6E": "OtherPayerRejectCode",
  "6F": "ApprovedMessageCode",
  "7C": "OtherPayerId",
  "7E": "DurPpsCodeCounter",
  "7F": "HelpDeskPhoneNumberQualifier",
  "8C": "FacilityId",
  "8E": "DurPpsLevelOfEffort",
  "8F": "HelpDeskPhoneNumber",
  "9F": "PreferredProductCount",
  A1: "BinNumber",
  A2: "VersionReleaseNumber",
  A3: "TransactionCode",
  A4: "ProcessorControlNumber",
  A9: "TransactionCount",
  AK: "SoftwareVendorCertificationId",
  AM: "SegmentIdentification",
  AN: "TransactionResponseStatus",
  AP: "PreferredProductIdQualifier",
  AR: "PreferredProductId",
  AS: "PreferredProductIncentive",
  AT: "PreferredProductCopayIncentive",
  AU: "PreferredProductDescription",
  AV: "TaxExemptIndicator",
  AW: "FlatSalesTaxAmountPaid",
  AX: "PercentageSalesTaxAmountPaid",
  AY: "PercentageSalesTaxRatePaid",
  AZ: "PercentageSalesTaxBasisPaid",
  B1: "ServiceProviderId",
  B2: "ServiceProviderIdQualifier",
  BE: "ProfessionalServiceFeeSubmitted",
  C1: "GroupId",
  C2: "CardholderId",
  C3: "PersonCode",
  C4: "DateOfBirth",
  C5: "PatientGenderCode",
  C6: "PatientRelationshipCode",
  C7: "PatientLocation",
  C8: "OtherCoverageCode",
  C9: "EligibilityClarificationCode",
  CA: "PatientFirstName",
  CB: "PatientLastName",
  CC: "CardholderFirstName",
  CD: "CardholderLastName",
  CE: "HomePlan",
  CF: "EmployerName",
  CG: "EmployerStreetAddress",
  CH: "EmployerCityAddress",
  CI: "EmployerStateProvinceAddress",
  CJ: "EmployerZipPostalZone",
  CK: "EmployerPhoneNumber",
  CL: "EmployerContactName",
  CM: "PatientStreetAddress",
  CN: "PatientCityAddress",
  CO: "PatientStateProvinceAddress",
  CP: "PatientZipPostalZone",
  CQ: "PatientPhoneNumber",
  CR: "CarrierId",
  CW: "AlternateId",
  CX: "PatientIdQualifier",
  CY: "PatientId",
  CZ: "EmployerId",
  D1: "DateOfService",
  D2: "PrescriptionServiceReferenceNumber",
  D3: "FillNumber",
  D5: "DaysSupply",
  D6: "CompoundCode",
  D7: "ProductServiceId",
  D8: "DispenseAsWrittenProductSelectionCode",
  D9: "IngredientCostSubmitted",
  DB: "PrescriberId",
  DC: "DispensingFeeSubmitted",
  DE: "DatePrescriptionWritten",
  DF: "NumberOfRefillsAuthorized",
  DI: "LevelOfService",
  DJ: "PrescriptionOriginCode",
  DK: "SubmissionClarificationCode",
  DL: "PrimaryCareProviderId",
  DN: "BasisOfCostDetermination",
  DO: "DiagnosisCode",
  DQ: "UsualAndCustomaryCharge",
  DR: "PrescriberLastName",
  DT: "UnitDoseIndicator",
  DU: "GrossAmountDue",
  DV: "OtherPayerAmountPaid",
  DX: "PatientPaidAmountSubmitted",
  DY: "DateOfInjury",
  DZ: "ClaimReferenceId",
  E1: "ProductServiceIdQualifier",
  E3: "IncentiveAmountSubmitted",
  E4: "ReasonForServiceCode",
  E5: "ProfessionalServiceCode",
  E6: "ResultOfServiceCode",
  E7: "QuantityDispensed",
  E8: "OtherPayerDate",
  E9: "ProviderId",
  EA: "OriginallyPrescribedProductServiceCode",
  EB: "OriginallyPrescribedQuantity",
  EC: "CompoundIngredientComponentCount",
  ED: "CompoundIngredientQuantity",
  EE: "CompoundIngredientDrugCost",
  EF: "CompoundDosageFormDescriptionCode",
  EG: "CompoundDispensingUnitFormIndicator",
  EH: "CompoundRouteOfAdministration",
  EJ: "OrigPrescribedProductServiceIdQualifier",
  EK: "ScheduledPrescriptionIdNumber",
  EM: "PrescriptionServiceReferenceNumberQualifier",
  EN: "AssociatedPrescriptionServiceReferenceNumber",
  EP: "AssociatedPrescriptionServiceDate",
  ER: "ProcedureModifierCode",
  ET: "QuantityPrescribed",
  EU: "PriorAuthorizationTypeCode",
  EV: "PriorAuthorizationNumberSubmitted",
  EW: "IntermediaryAuthorizationTypeId",
  EX: "IntermediaryAuthorizationId",
  EY: "ProviderIdQualifier",
  EZ: "PrescriberIdQualifier",
  F1: "HeaderResponseStatus",
  F3: "AuthorizationNumber",
  F4: "Message",
  F5: "PatientPayAmount",
  F6: "IngredientCostPaid",
  F7: "DispensingFeePaid",
  F9: "TotalAmountPaid",
  FA: "RejectCount",
  FB: "RejectCode",
  FC: "AccumulatedDeductibleAmount",
  FD: "RemainingDeductibleAmount",
  FE: "RemainingBenefitAmount",
  FH: "AmountAppliedToPeriodicDeductible",
  FI: "AmountOfCopayCo-Insurance",
  FJ: "AmountAttributedToProductSelection",
  FK: "AmountExceedingPeriodicBenefitMaximum",
  FL: "IncentiveAmountPaid",
  FM: "BasisOfReimbursementDetermination",
  FN: "AmountAttributedToSalesTax",
  FO: "PlanId",
  FQ: "AdditionalMessageInformation",
  FS: "ClinicalSignificanceCode",
  FT: "OtherPharmacyIndicator",
  FU: "PreviousDateOfFill",
  FV: "QuantityOfPreviousFill",
  FW: "DatabaseIndicator",
  FX: "OtherPrescriberIndicator",
  FY: "DurFreeTextMessage",
  GE: "PercentageSalesTaxAmountSubmitted",
  H1: "MeasurementTime",
  H2: "MeasurementDimension",
  H3: "MeasurementUnit",
  H4: "MeasurementValue",
  H5: "PrimaryCareProviderLocationCode",
  H6: "DurCo-AgentId",
  H7: "OtherAmountClaimedSubmittedCount",
  H8: "OtherAmountClaimedSubmittedQualifier",
  H9: "OtherAmountClaimedSubmitted",
  HA: "FlatSalesTaxAmountSubmitted",
  HB: "OtherPayerAmountPaidCount",
  HC: "OtherPayerAmountPaidQualifier",
  HD: "DispensingStatus",
  HE: "PercentageSalesTaxRateSubmitted",
  HF: "QuantityIntendedToBeDispensed",
  HG: "DaysSupplyIntendedToBeDispensed",
  HH: "BasisOfCalculationDispensingFee",
  HJ: "BasisOfCalculationCopay",
  HK: "BasisOfCalculationFlatSalesTax",
  HM: "BasisOfCalculationPercentageSalesTax",
  J1: "ProfessionalServiceFeePaid",
  J2: "OtherAmountPaidCount",
  J3: "OtherAmountPaidQualifier",
  J4: "OtherAmountPaid",
  J5: "OtherPayerAmountRecognized",
  J6: "DurPpsResponseCodeCounter",
  J7: "PayerIdQualifier",
  J8: "PayerId",
  J9: "DurCo-AgentIdQualifier",
  JE: "PercentageSalesTaxBasisSubmitted",
  KE: "CouponType",
  ME: "CouponNumber",
  NE: "CouponValueAmount",
  PA: "RequestType",
  PB: "RequestPeriodDate-Begin",
  PC: "RequestPeriodDate-End",
  PD: "BasisOfRequest",
  PE: "AuthorizedRepresentativeFirstName",
  PF: "AuthorizedRepresentativeLastName",
  PG: "AuthorizedRepresentativeStreetAddress",
  PH: "AuthorizedRepresentativeCityAddress",
  PJ: "AuthorizedRepresentativeStateProvinceAddress",
  PK: "AuthorizedRepresentativeZipPostalZone",
  PM: "PrescriberPhoneNumber",
  PP: "PriorAuthorizationSupportingDocumentation",
  PR: "PriorAuthorizationProcessedDate",
  PS: "PriorAuthorizationEffectiveDate",
  PT: "PriorAuthorizationExpirationDate",
  PW: "PriorAuthorizationNumberOfRefillsAuthorized",
  PX: "PriorAuthorizationQuantityAccumulated",
  PY: "PriorAuthorizationNumber-Assigned",
  RA: "PriorAuthorizationQuantity",
  RB: "PriorAuthorizationDollarsAuthorized",
  RE: "CompoundProductIdQualifier",
  SE: "ProcedureModifierCodeCount",
  TE: "CompoundProductId",
  UE: "CompoundIngredientBasisOfCostDetermination",
  VE: "DiagnosisCodeCount",
  WE: "DiagnosisCodeQualifier",
  XE: "ClinicalInformationCounter",
  ZE: "MeasurementDate",
};

// D0 = v5.1 fields plus D0-specific additions and two name overrides
const NCPDP_FIELDS_D0: Record<string, string> = {
  ...NCPDP_FIELDS_51,
  // D0 overrides (same code, different name):
  C7: "PlaceOfService",
  DT: "SpecialPackagingIndicator",
  // D0-only additions:
  "2A": "MedigapId",
  "2B": "MedicaidIndicator",
  "2D": "ProviderAcceptAssignmentIndicator",
  "2G": "CompoundIngredientModifierCodeCount",
  "2H": "CompoundIngredientModifierCode",
  "2J": "PrescriberFirstName",
  "2K": "PrescriberStreetAddress",
  "2M": "PrescriberCityAddress",
  "2N": "PrescriberStateAddress",
  "2P": "PrescriberZipAddress",
  "2Q": "AdditionalDocumentationTypeId",
  "2R": "LengthOfNeed",
  "2S": "LengthOfNeedQualifier",
  "2T": "PrescriberSupplierDateSigned",
  "2U": "RequestStatus",
  "2V": "RequestPeriodBeginDate",
  "2W": "RequestPeriodRecertDate",
  "2X": "SupportingDocumentation",
  "2Y": "PlanSalesTaxAmount",
  "2Z": "QuestionNumberLetterCount",
  "3Q": "FacilityName",
  "3U": "FacilityStreetAddress",
  "3V": "FacilityStateAddress",
  "4B": "QuestionNumberLetter",
  "4D": "QuestionPercentResponse",
  "4G": "QuestionDateResponse",
  "4H": "QuestionDollarAmountResponse",
  "4J": "QuestionNumericResponse",
  "4K": "QuestionAlphaNumericResponse",
  "4U": "AmountOfCoinsurance",
  "4V": "BasisOfCalculationCoinsurance",
  "4X": "PatientResidence",
  "5J": "FacilityCityAddress",
  "6D": "FacilityZipAddress",
  A7: "InternalControlNumber",
  BM: "NarrativeMessage",
  E2: "RouteOfAdministration",
  EQ: "PatientSalesTaxAmount",
  FF: "FormularyId",
  G1: "CompoundType",
  G2: "CMSPartDDefinedQualifiedFacility",
  G3: "EstimatedGenericSavings",
  HN: "PatientEmailAddress",
  K5: "TransactionReferenceNumber",
  MA: "URL",
  MG: "OtherPayerBinNumber",
  MH: "OtherPayerProcessorControlNumber",
  MJ: "OtherPayerGroupId",
  MQ: "AmountAttributedToProductSelectionQualifier",
  MT: "PatientAssignmentIndicator",
  MU: "BenefitStageCount",
  MV: "BenefitStageQualifier",
  MW: "BenefitStageAmount",
  N3: "MedicaidPaidAmount",
  N4: "MedicaidSubrogationInternalControlNumber",
  N5: "MedicaidIdNumber",
  N6: "MedicaidAgencyNumber",
  NP: "OtherPayerPatientRespAmountPaidQualifier",
  NQ: "OtherPayerPatientRespAmount",
  NR: "OtherPayerPatientRespAmountPaidCount",
  NT: "OtherPayerIdCount",
  NU: "OtherPayerCardholderId",
  NV: "DelayReasonCode",
  NX: "SubmissionClarificationCodeCount",
  TR: "BillingEntityTypeIndicator",
  TS: "PayToQualifier",
  TT: "PayToId",
  TU: "PayToName",
  TV: "PayToStreetAddress",
  TW: "PayToCityAddress",
  TX: "PayToStateAddress",
  TY: "PayToZipAddress",
  TZ: "GenericEquivalentProductIdQualifier",
  U1: "ContractNumber",
  U6: "BenefitId",
  U7: "PharmacyServiceType",
  U8: "IngredientCostContractedAmount",
  U9: "DispensingFeeContractedAmount",
  UA: "GenericEquivalentProductId",
  UB: "OtherPayerHelpDeskPhone",
  UC: "SpendingAccountAmountRemaining",
  UD: "HealthPlanFundedAssistanceAmount",
  UF: "AdditionalMessageInformationCount",
  UG: "AdditionalMessageInformationContinuity",
  UH: "AdditionalMessageInformationQualifier",
  UJ: "AmountAttributedToProviderNetworkSelection",
  UK: "AmountAttributedToProductSelectionBrandDrug",
  UM: "AmountAttributedToProductSelectionNonPreferredSelection",
  UN: "AmountAttributedToProductSelectionBrandNonPreferredSelection",
  UP: "AmountAttributedToCoverageGap",
  UQ: "CmsLowIncomeCostSharingLevel",
  UR: "MedicarePartDCoverageCode",
  US: "NextMedicarePartDEffecticeDate",
  UT: "NextMedicarePartDTerminationDate",
  UV: "OtherPayerPersonCode",
  UW: "OtherPayerPatientRelationshipCode",
  UX: "OtherPayerBenefitEffectiveDate",
  UY: "OtherPayerBenefitTerminationDate",
};

// Repeating field name sets — ported from NCPDPReference.java populateRepFields51/D0
// Used in parseNcpdp to determine when to close a Count wrapper group.
const NCPDP_REPEATING_FIELDS_51 = new Set([
  "ProcedureModifierCode",
  "OtherPayerCoverageType",
  "OtherPayerIdQualifier",
  "OtherPayerId",
  "OtherPayerDate",
  "OtherPayerAmountPaidQualifier",
  "OtherPayerAmountPaid",
  "OtherPayerRejectCode",
  "OtherAmountClaimedSubmittedQualifier",
  "OtherAmountClaimedSubmitted",
  "CompoundProductIdQualifier",
  "CompoundProductId",
  "CompoundIngredientQuantity",
  "CompoundIngredientDrugCost",
  "CompoundIngredientBasisOfCostDetermination",
  "DiagnosisCodeQualifier",
  "DiagnosisCode",
  "RejectCode",
  "RejectFieldOccurrenceIndicator",
  "ApprovedMessageCode",
  "PreferredProductIdQualifier",
  "PreferredProductId",
  "PreferredProductIncentive",
  "PreferredProductCopayIncentive",
  "PreferredProductDescription",
  "OtherAmountPaidQualifier",
  "OtherAmountPaid",
]);

const NCPDP_REPEATING_FIELDS_D0 = new Set([
  ...NCPDP_REPEATING_FIELDS_51,
  "SubmissionClarificationCode",
  "BenefitStageAmount",
  "BenefitStageQualifier",
  "OtherPayerPatientRespAmount",
  "OtherPayerPatientRespAmountPaidQualifier",
  "InternalControlNumber",
  "OtherPayerAmountPaidCount",
  "CompoundIngredientModifierCode",
  "QuestionNumberLetter",
  "QuestionPercentResponse",
  "QuestionDateResponse",
  "QuestionDollarAmountResponse",
  "QuestionNumericResponse",
  "QuestionAlphaNumericResponse",
  "AdditionalMessageInformation",
  "AdditionalMessageInformationContinuity",
  "AdditionalMessageInformationQualifier",
  "OtherPayerProcessorControlNumber",
  "OtherPayerCardholderId",
  "OtherPayerGroupId",
  "OtherPayerPersonCode",
  "OtherPayerHelpDeskPhone",
  "OtherPayerPatientRelationshipCode",
  "OtherPayerBenefitEffectiveDate",
  "OtherPayerBenefitTerminationDate",
]);

// ── NCPDP helpers ──────────────────────────────────────────────────────────────

/**
 * Faithful port of Java `StringUtil.unescape`, shared across the datatype
 * previews. Kept here as a named re-export for the existing NCPDP delimiter
 * usages and `ncpdp-unescape.test.ts`; the implementation lives in
 * `datatype-input-utils.ts` (see {@link unescapeDelimiters}).
 */
export const ncpdpUnescape = unescapeDelimiters;

function ncpdpSegName(segId: string, version: string): string {
  return (version === "D0" ? NCPDP_SEGMENTS_D0 : NCPDP_SEGMENTS_51)[segId] ?? segId;
}

function ncpdpFieldDesc(code: string, version: string): string {
  return (version === "D0" ? NCPDP_FIELDS_D0 : NCPDP_FIELDS_51)[code] ?? "";
}

// ── NCPDP parser ───────────────────────────────────────────────────────────────
// Parses NCPDP 5.1 / D.0 messages into a tree matching BridgeLink's XML representation
// (produced by NCPDPReader.java). Structure mirrors the generated XML:
//   NCPDP_51_Billing_Request
//     └─ TransactionHeaderRequest   (fixed-width header fields)
//     └─ Patient                    (segment AM01)
//          └─ DateOfBirth           (field C4)
//     └─ TRANSACTIONS
//          └─ TRANSACTION [0]
//               └─ ResponseStatus   (segment AM21)
//                    └─ TransactionResponseStatus

function parseNcpdp(
  text: string,
  prefix: string,
  suffix: string,
  propsXml?: string | null
): MsgTreeNode {
  // Read delimiters from serialization properties XML
  let segDelimStr = "0x1E";
  let groupDelimStr = "0x1D";
  let fieldDelimStr = "0x1C";

  if (propsXml) {
    const pdoc = new DOMParser().parseFromString(propsXml, "application/xml");
    const ps = pdoc.querySelector("serializationProperties");
    if (ps) {
      segDelimStr = ps.querySelector("segmentDelimiter")?.textContent?.trim() ?? segDelimStr;
      groupDelimStr = ps.querySelector("groupDelimiter")?.textContent?.trim() ?? groupDelimStr;
      fieldDelimStr = ps.querySelector("fieldDelimiter")?.textContent?.trim() ?? fieldDelimStr;
    }
  }

  const segDelim = ncpdpUnescape(segDelimStr);
  const groupDelim = ncpdpUnescape(groupDelimStr);
  const fieldDelim = ncpdpUnescape(fieldDelimStr);

  const message = text.trim();

  // Parse fixed-width header (content before the first segment delimiter)
  const firstSegIdx = message.indexOf(segDelim);
  if (firstSegIdx < 0) throw new Error("No segment delimiter found in NCPDP message");

  const header = message.substring(0, firstSegIdx);
  let version: string;
  let rootLabel: string;
  let headerSegName: string;
  let nodeId = 0;
  const nextId = () => String(nodeId++);
  const headerChildren: MsgTreeNode[] = [];

  if (header.length > 40) {
    // Request: 56-char fixed-width header (NCPDPReader.parseHeader request branch)
    version = header.substring(6, 8);
    const txCode = header.substring(8, 10);
    const txName = NCPDP_TRANSACTION_MAP[txCode] ?? txCode;
    rootLabel = `NCPDP_${version}_${txName}_Request`;
    headerSegName = "TransactionHeaderRequest";

    const addR = (name: string, s: number, e: number) => {
      if (header.length >= e)
        headerChildren.push({
          id: nextId(),
          label: name,
          dragExpr: `${prefix}['${headerSegName}']['${name}']${suffix}`,
          children: [],
          value: header.substring(s, e) || undefined,
        });
    };
    addR("BinNumber", 0, 6);
    addR("VersionReleaseNumber", 6, 8);
    addR("TransactionCode", 8, 10);
    addR("ProcessorControlNumber", 10, 20);
    addR("TransactionCount", 20, 21);
    addR("ServiceProviderIdQualifier", 21, 23);
    addR("ServiceProviderId", 23, 38);
    addR("DateOfService", 38, 46);
    addR("SoftwareVendorCertificationId", 46, 56);
  } else {
    // Response: 31-char fixed-width header
    version = header.substring(0, 2);
    const txCode = header.substring(2, 4);
    const txName = NCPDP_TRANSACTION_MAP[txCode] ?? txCode;
    rootLabel = `NCPDP_${version}_${txName}_Response`;
    headerSegName = "TransactionHeaderResponse";

    const addR = (name: string, s: number, e: number) => {
      if (header.length >= e)
        headerChildren.push({
          id: nextId(),
          label: name,
          dragExpr: `${prefix}['${headerSegName}']['${name}']${suffix}`,
          children: [],
          value: header.substring(s, e) || undefined,
        });
    };
    addR("VersionReleaseNumber", 0, 2);
    addR("TransactionCode", 2, 4);
    addR("TransactionCount", 4, 5);
    addR("HeaderResponseStatus", 5, 6);
    addR("ServiceProviderIdQualifier", 6, 8);
    addR("ServiceProviderId", 8, 23);
    addR("DateOfService", 23, 31);
  }

  const headerNode: MsgTreeNode = {
    id: nextId(),
    label: headerSegName,
    dragExpr: `${prefix}['${headerSegName}']`,
    children: headerChildren,
  };

  // Body starts at the first occurrence of either delimiter
  const gdi0 = message.indexOf(groupDelim);
  const sdi0 = message.indexOf(segDelim);
  const bodyStart = gdi0 === -1 || sdi0 < gdi0 ? sdi0 : gdi0;
  let body = message.substring(bodyStart);

  // ── Body parsing loop — mirrors NCPDPReader.java parse() exactly ──
  const rootChildren: MsgTreeNode[] = [headerNode];
  const txNodes: MsgTreeNode[] = [];
  let inGroup = false;
  let txIdx = -1;
  let curTxKids: MsgTreeNode[] = [];
  let hasMore = true;

  /** Parse one raw segment string → MsgTreeNode (null if blank).
   *  Mirrors NCPDPReader.java parseSegment() exactly, including Counter/Count nesting.
   *
   *  Counter fields (name ends with "Counter") open a wrapper group for all subsequent
   *  fields; a new Counter closes the previous one.  Count fields (name ends with "Count")
   *  open a wrapper group for the repeating fields that follow; the group is closed when
   *  a non-repeating, non-Count field is encountered.  This produces the same XML tree
   *  structure as the Java SAX parser so drag-expressions are accurate.
   */
  function parseNCPDPSegment(seg: string): MsgTreeNode | null {
    if (!seg.trim()) return null;

    // Strip leading field delimiter (NCPDPReader.parseSegment strips it)
    const s = seg.startsWith(fieldDelim) ? seg.substring(fieldDelim.length) : seg;

    const fdi = s.indexOf(fieldDelim);
    let segId: string;
    let subSeg: string;

    if (fdi === -1) {
      segId = s;
      subSeg = "";
    } else {
      segId = s.substring(0, fdi);
      subSeg = s.substring(fdi + fieldDelim.length);
    }

    const sName = ncpdpSegName(segId, version);
    const segPath = inGroup
      ? `${prefix}['TRANSACTIONS']['TRANSACTION'][${txIdx}]['${sName}']`
      : `${prefix}['${sName}']`;

    // ── Counter / Count nesting — mirrors NCPDPReader.java parseSegment() exactly ──
    const stack: Array<{
      node: MsgTreeNode;
      kids: MsgTreeNode[];
      kind: "Counter" | "Count";
      path: string;
    }> = [];
    const topKids: MsgTreeNode[] = [];

    const curKids = () => (stack.length > 0 ? stack[stack.length - 1].kids : topKids);
    const curPath = () => (stack.length > 0 ? stack[stack.length - 1].path : segPath);
    const popGroup = () => {
      const e = stack.pop()!;
      e.node.children = e.kids;
      curKids().push(e.node);
    };

    const repFields = version === "D0" ? NCPDP_REPEATING_FIELDS_D0 : NCPDP_REPEATING_FIELDS_51;
    let inCounter = false;
    let inCount = false;
    const counterOcc: Record<string, number> = {};

    let moreF = subSeg.length > 0;
    let rem = subSeg;

    while (moreF) {
      const fi = rem.indexOf(fieldDelim);
      let field: string;
      if (fi !== -1) {
        field = rem.substring(0, fi);
        rem = rem.substring(fi + fieldDelim.length);
      } else {
        field = rem;
        moreF = false;
      }

      if (field.length < 2) continue;
      const fCode = field.substring(0, 2);
      let fDesc = ncpdpFieldDesc(fCode, version);
      const fVal = field.substring(2);
      if (!fDesc) fDesc = `${fCode}_field`;

      // Mirror Java: close Count group when a non-repeating, non-Count field arrives.
      if (inCount && !repFields.has(fDesc) && !fDesc.endsWith("Count")) {
        popGroup();
        if (stack.length === 0) inCount = false;
      }

      if (fDesc.endsWith("Counter")) {
        // Close the previous Counter group before starting a new one.
        if (inCounter) popGroup();
        inCounter = true;
        const occ = (counterOcc[fDesc] = (counterOcc[fDesc] ?? -1) + 1);
        const counterPath = `${curPath()}['${fDesc}'][${occ}]`;
        const node: MsgTreeNode = {
          id: nextId(),
          label: `${fDesc} [${fVal}]`,
          dragExpr: counterPath,
          children: [],
        };
        stack.push({ node, kids: [], kind: "Counter", path: counterPath });
      } else if (fDesc.endsWith("Count")) {
        inCount = true;
        const countPath = `${curPath()}['${fDesc}']`;
        const node: MsgTreeNode = {
          id: nextId(),
          label: fDesc,
          dragExpr: countPath,
          children: [],
          value: fVal || undefined,
        };
        stack.push({ node, kids: [], kind: "Count", path: countPath });
      } else {
        // Regular field — path goes through any open Counter/Count wrappers.
        curKids().push({
          id: nextId(),
          label: fDesc,
          dragExpr: `${curPath()}['${fDesc}']${suffix}`,
          children: [],
          value: fVal || undefined,
        });
      }
    }

    // Close all remaining open groups (mirrors Java's while(fieldStack.size() > 0)).
    while (stack.length > 0) popGroup();

    return { id: nextId(), label: sName, dragExpr: segPath, children: topKids };
  }

  while (hasMore) {
    const gdi = body.indexOf(groupDelim);
    const sdi = body.indexOf(segDelim);

    if (gdi > -1 && sdi > -1 && gdi < sdi) {
      const node = parseNCPDPSegment(body.substring(0, gdi));
      if (node) (inGroup ? curTxKids : rootChildren).push(node);

      if (inGroup) {
        txNodes.push({
          id: nextId(),
          label: `TRANSACTION [${txIdx}]`,
          dragExpr: `${prefix}['TRANSACTIONS']['TRANSACTION'][${txIdx}]`,
          children: curTxKids,
        });
      }
      txIdx++;
      inGroup = true;
      curTxKids = [];
      body = body.substring(sdi + segDelim.length);
    } else if (sdi === -1) {
      const node = parseNCPDPSegment(body);
      if (node) (inGroup ? curTxKids : rootChildren).push(node);
      hasMore = false;
    } else {
      const node = parseNCPDPSegment(body.substring(0, sdi));
      if (node) (inGroup ? curTxKids : rootChildren).push(node);
      body = body.substring(sdi + segDelim.length);
    }
  }

  if (inGroup) {
    txNodes.push({
      id: nextId(),
      label: `TRANSACTION [${txIdx}]`,
      dragExpr: `${prefix}['TRANSACTIONS']['TRANSACTION'][${txIdx}]`,
      children: curTxKids,
    });
  }

  if (txNodes.length > 0) {
    rootChildren.push({
      id: nextId(),
      label: "TRANSACTIONS",
      dragExpr: `${prefix}['TRANSACTIONS']`,
      children: txNodes,
    });
  }

  return { id: "root", label: rootLabel, dragExpr: prefix, children: rootChildren };
}

// ── Tooltip definitions ───────────────────────────────────────────────────────

const SER_TT = {
  fieldDelimiter: {
    label: "Field Delimiter",
    description: "Characters that delimit the fields in the message.",
  },
  groupDelimiter: {
    label: "Group Delimiter",
    description: "Characters that delimit the groups in the message.",
  },
  segmentDelimiter: {
    label: "Segment Delimiter",
    description: "Characters that delimit the segments in the message.",
  },
};

const DES_TT = {
  fieldDelimiter: {
    label: "Field Delimiter",
    description: "Characters that delimit the fields in the message.",
  },
  groupDelimiter: {
    label: "Group Delimiter",
    description: "Characters that delimit the groups in the message.",
  },
  segmentDelimiter: {
    label: "Segment Delimiter",
    description: "Characters that delimit the segments in the message.",
  },
  useStrictValidation: {
    label: "Use Strict Validation",
    description: "Validates the NCPDP message against a schema.",
  },
};

const BAT_TT = {
  splitType: {
    label: "Split Batch By",
    description:
      "Select the method for splitting the batch message.  This option has no effect unless Process Batch Files is enabled in the connector.\n\nJavaScript: Use JavaScript to split messages.",
  },
  batchScript: {
    label: "JavaScript",
    description:
      "Enter JavaScript that splits the batch, and returns the next message.  This script has access to 'reader', a Java BufferedReader, to read the incoming data stream.  The script must return a string containing the next message, or a null/empty string to indicate end of input.  This option has no effect unless Process Batch is enabled in the connector.",
  },
};

// ── XML parse / update helpers ─────────────────────────────────────────────────

function pd(xml: string) {
  return new DOMParser().parseFromString(xml, "application/xml");
}
function gEl(el: Element | null, tag: string, fb: string): string {
  return el?.querySelector(tag)?.textContent?.trim() ?? fb;
}
function bEl(el: Element | null, tag: string, fb: boolean): boolean {
  const v = el?.querySelector(tag)?.textContent?.trim();
  return v === "true" ? true : v === "false" ? false : fb;
}

// ── PropertiesSection ─────────────────────────────────────────────────────────

function NCPDPPropertiesSection({
  propsXml,
  onChange,
  side,
  transformerType,
  isDark,
  channelId,
}: DataTypePropertiesSectionProps) {
  const xml = propsXml ?? "";
  const doc = xml ? pd(xml) : null;
  const serEl = doc?.querySelector("serializationProperties") ?? null;
  const desEl = doc?.querySelector("deserializationProperties") ?? null;
  const batEl = doc?.querySelector("batchProperties") ?? null;

  // Serialization (inbound) / deserialization (outbound) state
  const [serFieldDelim, setSerFieldDelim] = useState(() => gEl(serEl, "fieldDelimiter", "0x1C"));
  const [serGroupDelim, setSerGroupDelim] = useState(() => gEl(serEl, "groupDelimiter", "0x1D"));
  const [serSegDelim, setSerSegDelim] = useState(() => gEl(serEl, "segmentDelimiter", "0x1E"));
  const [desFieldDelim, setDesFieldDelim] = useState(() => gEl(desEl, "fieldDelimiter", "0x1C"));
  const [desGroupDelim, setDesGroupDelim] = useState(() => gEl(desEl, "groupDelimiter", "0x1D"));
  const [desSegDelim, setDesSegDelim] = useState(() => gEl(desEl, "segmentDelimiter", "0x1E"));
  const [strictValid, setStrictValid] = useState(() => bEl(desEl, "useStrictValidation", false));
  const [splitType, setSplitType] = useState(() => gEl(batEl, "splitType", "JavaScript"));
  const [batchScript, setBatchScript] = useState(() => gEl(batEl, "batchScript", ""));
  const [scriptOpen, setScriptOpen] = useState(false);

  // Keep a ref to the latest xml so the update function is always fresh.
  // Synced in a deps-less effect (not during render) to satisfy react-hooks/refs;
  // `update` only reads xmlRef.current from an event handler, never during render.
  const xmlRef = useRef(xml);
  useEffect(() => {
    xmlRef.current = xml;
  });

  function update(selector: string, value: string) {
    const d = pd(xmlRef.current);
    setXmlText(d, selector, value);
    onChange(new XMLSerializer().serializeToString(d.documentElement));
  }

  // ── INBOUND ────────────────────────────────────────────────────────────────

  if (side === "inbound") {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-3 py-3 space-y-4 text-xs">
            <div>
              <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">Serialization</p>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
                <PropertyRow
                  info={SER_TT.fieldDelimiter}
                  label="Field Delimiter"
                  labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                >
                  <input
                    type="text"
                    value={serFieldDelim}
                    onChange={(e) => {
                      setSerFieldDelim(e.target.value);
                      update("serializationProperties > fieldDelimiter", e.target.value);
                    }}
                    className={`${inputCls} w-20`}
                  />
                </PropertyRow>

                <PropertyRow
                  info={SER_TT.groupDelimiter}
                  label="Group Delimiter"
                  labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                >
                  <input
                    type="text"
                    value={serGroupDelim}
                    onChange={(e) => {
                      setSerGroupDelim(e.target.value);
                      update("serializationProperties > groupDelimiter", e.target.value);
                    }}
                    className={`${inputCls} w-20`}
                  />
                </PropertyRow>

                <PropertyRow
                  info={SER_TT.segmentDelimiter}
                  label="Segment Delimiter"
                  labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                >
                  <input
                    type="text"
                    value={serSegDelim}
                    onChange={(e) => {
                      setSerSegDelim(e.target.value);
                      update("serializationProperties > segmentDelimiter", e.target.value);
                    }}
                    className={`${inputCls} w-20`}
                  />
                </PropertyRow>
              </div>
            </div>

            {/* Batch — source-only group (mirrors Java DataTypePropertiesTableModel) */}
            {transformerType === "source" && (
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">Batch</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
                  <PropertyRow
                    info={BAT_TT.splitType}
                    label="Split Batch By"
                    labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                  >
                    <select
                      value={splitType}
                      onChange={(e) => {
                        setSplitType(e.target.value);
                        update("batchProperties > splitType", e.target.value);
                      }}
                      className={selectCls}
                    >
                      <option value="JavaScript">JavaScript</option>
                    </select>
                  </PropertyRow>

                  <PropertyRow
                    info={BAT_TT.batchScript}
                    label="JavaScript"
                    labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                  >
                    <button
                      onClick={() => setScriptOpen(true)}
                      className="justify-self-start px-2 py-0.5 text-xs rounded border border-border text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Edit
                    </button>
                  </PropertyRow>
                </div>
              </div>
            )}
          </div>
        </div>
        <ScriptEditorDialog
          open={scriptOpen}
          onOpenChange={setScriptOpen}
          title="Batch Script"
          value={batchScript}
          onSave={(v) => {
            setBatchScript(v);
            update("batchProperties > batchScript", v);
          }}
          isDark={isDark}
          channelId={channelId}
          contextType="CHANNEL_BATCH"
        />
      </div>
    );
  }

  // ── OUTBOUND ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-3 py-3 space-y-4 text-xs">
          <div>
            <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">Deserialization</p>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
              <PropertyRow
                info={DES_TT.fieldDelimiter}
                label="Field Delimiter"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={desFieldDelim}
                  onChange={(e) => {
                    setDesFieldDelim(e.target.value);
                    update("deserializationProperties > fieldDelimiter", e.target.value);
                  }}
                  className={`${inputCls} w-20`}
                />
              </PropertyRow>

              <PropertyRow
                info={DES_TT.groupDelimiter}
                label="Group Delimiter"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={desGroupDelim}
                  onChange={(e) => {
                    setDesGroupDelim(e.target.value);
                    update("deserializationProperties > groupDelimiter", e.target.value);
                  }}
                  className={`${inputCls} w-20`}
                />
              </PropertyRow>

              <PropertyRow
                info={DES_TT.segmentDelimiter}
                label="Segment Delimiter"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={desSegDelim}
                  onChange={(e) => {
                    setDesSegDelim(e.target.value);
                    update("deserializationProperties > segmentDelimiter", e.target.value);
                  }}
                  className={`${inputCls} w-20`}
                />
              </PropertyRow>

              <div className="col-span-2">
                <PropertyCheckbox
                  label="Use Strict Validation"
                  info={DES_TT.useStrictValidation}
                  checked={strictValid}
                  onChange={(v) => {
                    setStrictValid(v);
                    update("deserializationProperties > useStrictValidation", String(v));
                  }}
                />
              </div>
            </div>
          </div>

          <div>
            <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">
              Template Serialization
            </p>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
              <PropertyRow
                info={SER_TT.fieldDelimiter}
                label="Field Delimiter"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={serFieldDelim}
                  onChange={(e) => {
                    setSerFieldDelim(e.target.value);
                    update("serializationProperties > fieldDelimiter", e.target.value);
                  }}
                  className={`${inputCls} w-20`}
                />
              </PropertyRow>

              <PropertyRow
                info={SER_TT.groupDelimiter}
                label="Group Delimiter"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={serGroupDelim}
                  onChange={(e) => {
                    setSerGroupDelim(e.target.value);
                    update("serializationProperties > groupDelimiter", e.target.value);
                  }}
                  className={`${inputCls} w-20`}
                />
              </PropertyRow>

              <PropertyRow
                info={SER_TT.segmentDelimiter}
                label="Segment Delimiter"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={serSegDelim}
                  onChange={(e) => {
                    setSerSegDelim(e.target.value);
                    update("serializationProperties > segmentDelimiter", e.target.value);
                  }}
                  className={`${inputCls} w-20`}
                />
              </PropertyRow>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Plugin definition ─────────────────────────────────────────────────────────

export const NCPDPDataType: DataTypeDefinition = {
  name: "NCPDP",

  defaultPropertiesXml(tagName, version) {
    const base = "com.mirth.connect.plugins.datatypes.ncpdp";
    return (
      `<${tagName} class="${base}.NCPDPDataTypeProperties" version="${version}">` +
      `<serializationProperties class="${base}.NCPDPSerializationProperties" version="${version}">` +
      `<segmentDelimiter>0x1E</segmentDelimiter>` +
      `<groupDelimiter>0x1D</groupDelimiter>` +
      `<fieldDelimiter>0x1C</fieldDelimiter>` +
      `</serializationProperties>` +
      `<deserializationProperties class="${base}.NCPDPDeserializationProperties" version="${version}">` +
      `<segmentDelimiter>0x1E</segmentDelimiter>` +
      `<groupDelimiter>0x1D</groupDelimiter>` +
      `<fieldDelimiter>0x1C</fieldDelimiter>` +
      `<useStrictValidation>false</useStrictValidation>` +
      `</deserializationProperties>` +
      `<batchProperties class="${base}.NCPDPBatchProperties" version="${version}">` +
      `<splitType>JavaScript</splitType><batchScript></batchScript>` +
      `</batchProperties>` +
      `</${tagName}>`
    );
  },

  parseTemplate: parseNcpdp,

  PropertiesSection: NCPDPPropertiesSection,
};
