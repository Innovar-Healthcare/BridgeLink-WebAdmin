"use client";

import { GitBranch } from "lucide-react";
import { SettingsSection } from "@/components/settings/settings-section";
import type { ConnectorDefinition, ConnectorSectionProps } from "./types";
import { DEFAULT_CHANNEL_READER_PROPERTIES_XML } from "../_lib/channel-xml";

function ChannelReaderBottomSection(_props: ConnectorSectionProps) {
  return (
    <SettingsSection
      title="Channel Reader Settings"
      icon={GitBranch}
      defaultExpanded={true}
      storageKey="bl-channel-reader-main"
    >
      <p className="text-sm text-gray-500 dark:text-gray-400 italic">No configurable settings.</p>
    </SettingsSection>
  );
}

export const ChannelReaderConnector: ConnectorDefinition = {
  BottomSection: ChannelReaderBottomSection,
  // No TopSection (no polling).
  // defaultPropertiesXml is required so that switching FROM another source type (e.g. HTTP
  // Listener) replaces the stale properties blob with clean VmReceiverProperties. Without
  // this, the old connector's class attribute and fields persist → deploy crash.
  defaultPropertiesXml: DEFAULT_CHANNEL_READER_PROPERTIES_XML,
};
