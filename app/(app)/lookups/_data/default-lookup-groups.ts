/**
 * Bundled "default" lookup groups, mirroring the Java Swing client's
 * `Import Default Lookup Group` dialog.
 *
 * In the Java client these ship as classpath resources under
 * `client/src/main/resources/defaultLookUpTables/default-<Name>-group.json`
 * (see `GroupPanel.handleImportJson` / `ImportLookupGroupDialog`). BridgeLink
 * does not serve them over REST, so the Web UI bundles the same payloads here
 * to keep feature parity.
 *
 * Each payload matches the Export Group output shape (`{ group, values }`) that
 * the existing import flow already consumes — `executeImport` in
 * `app/(app)/lookups/page.tsx` strips the server-managed `id`/`createdDate`/
 * `updatedDate` fields before sending, so they are kept verbatim here.
 *
 * The list order matches the Java dialog's hardcoded dropdown order:
 * Race, Ethnicity, Administrative Gender, Marital Status, Religion.
 */

export interface DefaultLookupGroupPayload {
  group: {
    name: string;
    description?: string;
    version?: string;
    cacheSize?: number;
    cachePolicy?: string;
    valueType?: string;
    [key: string]: unknown;
  };
  values: Record<string, string>;
}

export interface DefaultLookupGroup {
  /** Display name shown in the import dialog dropdown (matches the Java list). */
  name: string;
  /** The bundled `{ group, values }` payload, fed into the standard import flow. */
  payload: DefaultLookupGroupPayload;
}

export const DEFAULT_LOOKUP_GROUPS: DefaultLookupGroup[] = [
  {
    name: "Race",
    payload: {
      group: {
        id: 30,
        name: "Race",
        description: "Default Race values",
        version: "1.0.0",
        cacheSize: 1000,
        cachePolicy: "LRU",
        createdDate: "2025-08-22T15:23:21.015+00:00",
        updatedDate: "2025-08-22T15:35:19.756+00:00",
      },
      values: {
        "1002-5": "American Indian or Alaska Native",
        "2028-9": "Asian",
        "2054-5": "Black or African American",
        "2076-8": "Native Hawaiian or Other Pacific Islander",
        "2106-3": "White",
        "2131-1": "Other Race",
        ASK: "Asked but no answer",
        NI: "No Information",
        UNK: "Unknown",
      },
    },
  },
  {
    name: "Ethnicity",
    payload: {
      group: {
        id: 34,
        name: "Ethnicity",
        description: "Default Ethnicity values",
        version: "1.0.0",
        cacheSize: 1000,
        cachePolicy: "LRU",
        createdDate: "2025-08-22T15:36:00.067+00:00",
        updatedDate: "2025-08-22T15:36:00.067+00:00",
      },
      values: {
        H: "Hispanic or Latino",
        N: "Not Hispanic or Latino",
        U: "Unknown",
      },
    },
  },
  {
    name: "Administrative Gender",
    payload: {
      group: {
        id: 33,
        name: "Administrative Gender",
        description: "Default Administrative Gender values",
        version: "1.0.0",
        cacheSize: 1000,
        cachePolicy: "LRU",
        createdDate: "2025-08-22T15:35:04.060+00:00",
        updatedDate: "2025-08-22T15:35:25.251+00:00",
      },
      values: {
        A: "Ambiguous",
        F: "Female",
        M: "Male",
        N: "Not Applicable/ Not Specific",
        O: "Other",
        U: "Unknown",
      },
    },
  },
  {
    name: "Marital Status",
    payload: {
      group: {
        id: 35,
        name: "Marital Status",
        description: "Default Marital Status values",
        version: "1.0.0",
        cacheSize: 1000,
        cachePolicy: "LRU",
        createdDate: "2025-08-22T15:36:33.236+00:00",
        updatedDate: "2025-08-22T15:36:33.236+00:00",
      },
      values: {
        A: "Separated",
        C: "Common Law",
        D: "Divorced",
        E: "Legally Separated",
        I: "Interlocutory",
        M: "Married",
        N: "Annulled",
        O: "Other",
        P: "Domestic Partner",
        S: "Never Married/Sigle",
        U: "Unmarried(unspecific)",
        W: "Widowed",
      },
    },
  },
  {
    name: "Religion",
    payload: {
      group: {
        id: 36,
        name: "Religion",
        description: "Default Religion values",
        version: "1.0.0",
        cacheSize: 1000,
        cachePolicy: "LRU",
        createdDate: "2025-08-22T15:37:14.692+00:00",
        updatedDate: "2025-08-22T15:37:14.692+00:00",
      },
      values: {
        AGN: "Agnostic",
        ATH: "Atheist",
        BAH: "Baha’i",
        BUD: "Buddhist",
        CATH: "Roman Catholic",
        CHR: "Christian (unspecified)",
        CHU: "Christian: Unspecified",
        EPI: "Episcopalian",
        EV: "Evangelical",
        HIN: "Hindu",
        JEW: "Jewish",
        MORM: "Mormon (Latter-day Saints)",
        MOS: "Muslim (Islamic)",
        ORT: "Orthodox (Eastern Orthodox)",
        OTH: "Other",
        PRES: "Presbyterian",
        PROT: "Protestant (unspecified)",
        QUA: "Quaker",
        SHA: "Shinto",
        SIKH: "Sikh",
        TAO: "Taoist",
        UNI: "Unitarian-Universalist",
        UNK: "Unknown",
      },
    },
  },
];
