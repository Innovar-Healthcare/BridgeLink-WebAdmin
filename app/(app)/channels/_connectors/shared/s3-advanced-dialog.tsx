"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { HoverTooltip } from "@/components/hover-tooltip";
import { RadioGroup } from "./radio-group";
import { inputCls, selectCls } from "./styles";
import { SecretInput } from "@/components/ui/secret-input";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { VariableOrNumberInput } from "@/components/ui/variable-or-number-input";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";

type HeaderCol = "name" | "value";

const HEADER_COLS: ColDef<HeaderCol>[] = [
  { key: "name", label: "Name", defaultWidth: 200, minWidth: 80, defaultVisible: true },
  { key: "value", label: "Value", defaultWidth: 200, minWidth: 80, defaultVisible: true },
];

interface HeaderRow {
  name: string;
  value: string;
  _index: number;
}

// ─── AWS regions (mirrors Java SDK Region.regions()) ──────────────────────────

const AWS_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "af-south-1",
  "ap-east-1",
  "ap-south-1",
  "ap-south-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ca-central-1",
  "ca-west-1",
  "eu-central-1",
  "eu-central-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-north-1",
  "eu-south-1",
  "eu-south-2",
  "il-central-1",
  "me-central-1",
  "me-south-1",
  "sa-east-1",
  // AWS GovCloud (US) and China partitions — present in the Java SDK's Region list.
  "us-gov-east-1",
  "us-gov-west-1",
  "cn-north-1",
  "cn-northwest-1",
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface S3AdvancedSettings {
  anonymous: boolean;
  username: string; // Access Key ID when not using default creds
  password: string; // Secret Access Key when not using default creds
  useDefaultCredentials: boolean;
  useTemporaryCredentials: boolean;
  duration: string; // seconds, valid range 900–129600
  region: string;
  customHeaders: Array<{ name: string; value: string }>;
}

interface S3AdvancedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: S3AdvancedSettings;
  onSave: (updated: S3AdvancedSettings) => void;
  /** When true, shows the Anonymous Access radio row (File Reader). Default: false. */
  showAnonymousField?: boolean;
  /** When true, shows Access Key ID / Secret Key fields (File Reader). Default: false. */
  showCredentialFields?: boolean;
}

// ─── Row helper ───────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 min-h-[32px]">
      <span className="text-sm text-gray-600 dark:text-gray-400 text-right w-[210px] shrink-0 leading-snug py-1">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ─── S3AdvancedDialog ─────────────────────────────────────────────────────────

export function S3AdvancedDialog({
  open,
  onOpenChange,
  settings,
  onSave,
  showAnonymousField = false,
  showCredentialFields = false,
}: S3AdvancedDialogProps) {
  const { viewDensity } = useCompactMode();
  const [local, setLocal] = useState<S3AdvancedSettings>(settings);
  const [errors, setErrors] = useState<{ duration?: string; region?: string }>({});
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const headerColConfig = useColumnConfig(HEADER_COLS, "bl-s3-headers-cols-v1");
  const headerSortState = useSortable<HeaderCol>("name", "asc");

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocal(settings);
      setErrors({});
      setSelectedRow(null);
    }
  }, [open, settings]);

  function set<K extends keyof S3AdvancedSettings>(key: K, val: S3AdvancedSettings[K]) {
    setLocal((prev) => ({ ...prev, [key]: val }));
  }

  // ── Region field/dropdown sync ──────────────────────────────────────────────

  const updatingRegion = useRef(false);

  function handleRegionTextChange(text: string) {
    if (updatingRegion.current) return;
    updatingRegion.current = true;
    set("region", text);
    updatingRegion.current = false;
  }

  function handleRegionSelectChange(selected: string) {
    if (updatingRegion.current) return;
    updatingRegion.current = true;
    if (selected !== "Custom") {
      set("region", selected);
    }
    updatingRegion.current = false;
  }

  function regionSelectValue(region: string): string {
    return AWS_REGIONS.includes(region) ? region : "Custom";
  }

  // ── Custom headers table ────────────────────────────────────────────────────

  function addHeader() {
    const existing = local.customHeaders.map((h) => h.name);
    let i = 1;
    while (existing.includes(`Property${i}`)) i++;
    const updated = [...local.customHeaders, { name: `Property${i}`, value: "" }];
    set("customHeaders", updated);
    setSelectedRow(updated.length - 1);
  }

  function deleteHeader() {
    if (selectedRow === null) return;
    const updated = local.customHeaders.filter((_, idx) => idx !== selectedRow);
    set("customHeaders", updated);
    setSelectedRow(updated.length > 0 ? Math.min(selectedRow, updated.length - 1) : null);
  }

  function updateHeader(idx: number, field: "name" | "value", val: string) {
    const updated = local.customHeaders.map((h, i) => (i === idx ? { ...h, [field]: val } : h));
    set("customHeaders", updated);
  }

  // ── Validation & save ───────────────────────────────────────────────────────

  function handleOk() {
    const newErrors: { duration?: string; region?: string } = {};

    if (local.useTemporaryCredentials && !local.anonymous) {
      const dur = parseInt(local.duration, 10);
      if (!local.duration || isNaN(dur) || dur < 900 || dur > 129600) {
        newErrors.duration = "Duration must be between 900 and 129600 seconds.";
      }
    }
    if (!local.region.trim()) {
      newErrors.region = "Region cannot be blank.";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSave(local);
    onOpenChange(false);
  }

  const credDisabled = local.anonymous;
  const durationEnabled = local.useTemporaryCredentials && !local.anonymous;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl w-full">
        <DialogHeader>
          <DialogTitle>S3 Advanced Settings</DialogTitle>
          <DialogDescription>Configure Amazon S3 connection settings.</DialogDescription>
        </DialogHeader>

        <div className="border border-border rounded p-4 space-y-3 overflow-hidden">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1">
            Amazon S3 Advanced Settings
          </p>

          {/* Anonymous Access — only shown when showAnonymousField=true (File Reader) */}
          {showAnonymousField && (
            <Row label="Anonymous Access:">
              <RadioGroup
                name="s3-anonymous"
                value={local.anonymous ? "yes" : "no"}
                onChange={(v) =>
                  // Java anonymousYes/NoActionPerformed clears the AWS credentials in BOTH
                  // directions for S3 (the runtime ignores typed keys when anonymous), so wipe
                  // username/password whenever the toggle changes.
                  setLocal((prev) => ({
                    ...prev,
                    anonymous: v === "yes",
                    username: "",
                    password: "",
                  }))
                }
                options={[
                  { label: "Yes", value: "yes" },
                  { label: "No", value: "no" },
                ]}
                title="Select Yes to access S3 anonymously. Select No to use AWS credentials."
              />
            </Row>
          )}

          {/* Use Default Credential Provider Chain */}
          <Row label="Use Default Credential Provider Chain:">
            <RadioGroup
              name="s3-default-creds"
              value={local.useDefaultCredentials ? "yes" : "no"}
              onChange={(v) => set("useDefaultCredentials", v === "yes")}
              disabled={credDisabled}
              options={[
                { label: "Yes", value: "yes" },
                { label: "No", value: "no" },
              ]}
              title="If enabled, the default provider chain looks for credentials in Java system properties, environment variables, credentials profile file, ECS container credentials, and EC2 instance profile credentials."
            />
            {local.anonymous && (
              <span className="text-xs text-red-600 dark:text-red-400 ml-2">
                Anonymous credentials are currently in use
              </span>
            )}
          </Row>

          {/* Access Key ID / Secret — only shown when showCredentialFields=true (File Reader) */}
          {showCredentialFields && !local.anonymous && !local.useDefaultCredentials && (
            <>
              <Row label="Access Key ID:">
                <HoverTooltip content="The AWS Access Key ID used to authenticate requests.">
                  <input
                    type="text"
                    value={local.username}
                    onChange={(e) => set("username", e.target.value)}
                    className={`${inputCls(viewDensity)} w-52`}
                  />
                </HoverTooltip>
              </Row>
              <Row label="Secret Access Key:">
                <HoverTooltip content="The AWS Secret Access Key used to authenticate requests.">
                  <SecretInput
                    value={local.password}
                    onChange={(e) => set("password", e.target.value)}
                    density={viewDensity}
                    className={`${inputCls(viewDensity)} w-52`}
                  />
                </HoverTooltip>
              </Row>
            </>
          )}

          {/* Use Temporary Credentials */}
          <Row label="Use Temporary Credentials:">
            <RadioGroup
              name="s3-temp-creds"
              value={local.useTemporaryCredentials ? "yes" : "no"}
              onChange={(v) => set("useTemporaryCredentials", v === "yes")}
              disabled={credDisabled}
              options={[
                { label: "Yes", value: "yes" },
                { label: "No", value: "no" },
              ]}
              title="Select whether or not to use temporary credentials."
            />
          </Row>

          {/* Duration */}
          <Row label="Duration (seconds):">
            <HoverTooltip content="The duration that the temporary credentials are valid. Must be between 900 seconds (15 minutes) and 129600 seconds (36 hours).">
              <VariableOrNumberInput
                min={900}
                max={129600}
                value={local.duration}
                onChange={(duration) => set("duration", duration)}
                disabled={!durationEnabled}
                className={`${inputCls(viewDensity)} w-28 ${errors.duration ? "border-red-500" : ""}`}
              />
            </HoverTooltip>
            {errors.duration && (
              <span className="text-xs text-red-600 dark:text-red-400">{errors.duration}</span>
            )}
          </Row>

          {/* Region */}
          <Row label="Region:">
            <div className="flex items-center gap-2 flex-nowrap">
              <HoverTooltip content="The AWS region to use for S3 operations.">
                <input
                  type="text"
                  value={local.region}
                  onChange={(e) => handleRegionTextChange(e.target.value)}
                  className={`${inputCls(viewDensity)} w-44 ${errors.region ? "border-red-500" : ""}`}
                />
              </HoverTooltip>
              <HoverTooltip content="Select a standard AWS region or choose Custom to enter a custom region.">
                <select
                  value={regionSelectValue(local.region)}
                  onChange={(e) => handleRegionSelectChange(e.target.value)}
                  className={selectCls(viewDensity)}
                >
                  <option value="Custom">Custom</option>
                  {AWS_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </HoverTooltip>
            </div>
            {errors.region && (
              <span className="text-xs text-red-600 dark:text-red-400">{errors.region}</span>
            )}
          </Row>

          {/* Custom HTTP Headers */}
          <div className="flex items-start gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-400 text-right w-[210px] shrink-0 pt-2">
              Custom HTTP Headers:
            </span>
            <div className="flex gap-2 flex-1 min-w-0">
              <DataTable<HeaderRow, HeaderCol>
                variant="sortable"
                cols={HEADER_COLS}
                rows={headerSortState.sorted(
                  local.customHeaders.map((h, i) => ({ ...h, _index: i })),
                  (r) => {
                    switch (headerSortState.sort.key) {
                      case "name":
                        return r.name;
                      case "value":
                        return r.value;
                      default:
                        return undefined;
                    }
                  }
                )}
                colConfig={headerColConfig}
                sortState={headerSortState}
                rowKey={(r) => r._index}
                selectedRowId={selectedRow}
                onRowClick={(r) => setSelectedRow(r._index)}
                empty=" "
                containerClassName="flex-1 min-h-[180px] max-h-[300px]"
                renderCell={(row, col) => (
                  <HoverTooltip content={col === "name" ? "Header name" : "Header value"}>
                    <input
                      type="text"
                      value={row[col]}
                      onChange={(e) => updateHeader(row._index, col, e.target.value)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRow(row._index);
                      }}
                      className="w-full px-1 py-0.5 text-xs bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
                    />
                  </HoverTooltip>
                )}
              />
              <div className="flex flex-col gap-1">
                <button
                  onClick={addHeader}
                  className="px-3 py-1 text-xs rounded border border-border
                    text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700
                    hover:border-border transition-colors"
                >
                  New
                </button>
                <button
                  onClick={deleteHeader}
                  disabled={selectedRow === null || local.customHeaders.length === 0}
                  className="px-3 py-1 text-xs rounded border border-border
                    text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700
                    hover:border-border transition-colors
                    disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-1.5 text-sm rounded border border-border
              text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700
              hover:border-border transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleOk}
            className="px-4 py-1.5 text-sm rounded border border-blue-500 bg-blue-500 text-white
              hover:bg-blue-600 hover:border-blue-600 transition-colors font-medium"
          >
            OK
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
