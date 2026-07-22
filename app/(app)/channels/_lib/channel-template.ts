/**
 * Default XML template for new channels and server-defaults application.
 *
 * Verified against a real Channel Reader channel exported from the BridgeLink
 * test server. Version attributes are replaced at runtime via:
 *   template.replaceAll("{{VERSION}}", normalizeXmlVersion(serverVersion))
 * so every element carries the connected server's product version (mirrors Java's
 * MigratableConverter.marshal), normalized to the 3-part form the server stamps.
 * The channel ID is replaced via:
 *   template.replace("{{CHANNEL_ID}}", crypto.randomUUID())
 */

import { getSession } from "@/lib/auth";
import { generateUUID } from "@/lib/utils";
import type { ServerSettings } from "@/lib/types";
import { normalizeXmlVersion, parseSummaryFromXml, serializeSummaryToXml } from "./channel-xml";

const NEW_CHANNEL_TEMPLATE = `<channel version="{{VERSION}}">
  <id>{{CHANNEL_ID}}</id>
  <nextMetaDataId>1</nextMetaDataId>
  <name>New Channel</name>
  <description></description>
  <sourceConnector version="{{VERSION}}">
    <metaDataId>0</metaDataId>
    <name>sourceConnector</name>
    <properties class="com.mirth.connect.connectors.vm.VmReceiverProperties" version="{{VERSION}}">
      <pluginProperties/>
      <sourceConnectorProperties version="{{VERSION}}">
        <responseVariable>None</responseVariable>
        <respondAfterProcessing>true</respondAfterProcessing>
        <processBatch>false</processBatch>
        <firstResponse>false</firstResponse>
        <processingThreads>1</processingThreads>
        <resourceIds class="linked-hash-map">
          <entry>
            <string>Default Resource</string>
            <string>[Default Resource]</string>
          </entry>
        </resourceIds>
        <queueBufferSize>1000</queueBufferSize>
      </sourceConnectorProperties>
    </properties>
    <transformer version="{{VERSION}}">
      <elements/>
      <inboundDataType>HL7V2</inboundDataType>
      <outboundDataType>HL7V2</outboundDataType>
      <inboundProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2DataTypeProperties" version="{{VERSION}}">
        <serializationProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2SerializationProperties" version="{{VERSION}}">
          <handleRepetitions>true</handleRepetitions>
          <handleSubcomponents>true</handleSubcomponents>
          <useStrictParser>false</useStrictParser>
          <useStrictValidation>false</useStrictValidation>
          <stripNamespaces>false</stripNamespaces>
          <segmentDelimiter>\\r</segmentDelimiter>
          <convertLineBreaks>true</convertLineBreaks>
        </serializationProperties>
        <deserializationProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2DeserializationProperties" version="{{VERSION}}">
          <useStrictParser>false</useStrictParser>
          <useStrictValidation>false</useStrictValidation>
          <segmentDelimiter>\\r</segmentDelimiter>
        </deserializationProperties>
        <batchProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2BatchProperties" version="{{VERSION}}">
          <splitType>MSH_Segment</splitType>
          <batchScript></batchScript>
        </batchProperties>
        <responseGenerationProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2ResponseGenerationProperties" version="{{VERSION}}">
          <segmentDelimiter>\\r</segmentDelimiter>
          <successfulACKCode>AA</successfulACKCode>
          <successfulACKMessage></successfulACKMessage>
          <errorACKCode>AE</errorACKCode>
          <errorACKMessage>An Error Occurred Processing Message.</errorACKMessage>
          <rejectedACKCode>AR</rejectedACKCode>
          <rejectedACKMessage>Message Rejected.</rejectedACKMessage>
          <msh15ACKAccept>false</msh15ACKAccept>
          <dateFormat>yyyyMMddHHmmss.SSS</dateFormat>
        </responseGenerationProperties>
        <responseValidationProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2ResponseValidationProperties" version="{{VERSION}}">
          <successfulACKCode>AA,CA</successfulACKCode>
          <errorACKCode>AE,CE</errorACKCode>
          <rejectedACKCode>AR,CR</rejectedACKCode>
          <validateMessageControlId>true</validateMessageControlId>
          <originalMessageControlId>Destination_Encoded</originalMessageControlId>
          <originalIdMapVariable></originalIdMapVariable>
        </responseValidationProperties>
      </inboundProperties>
      <outboundProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2DataTypeProperties" version="{{VERSION}}">
        <serializationProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2SerializationProperties" version="{{VERSION}}">
          <handleRepetitions>true</handleRepetitions>
          <handleSubcomponents>true</handleSubcomponents>
          <useStrictParser>false</useStrictParser>
          <useStrictValidation>false</useStrictValidation>
          <stripNamespaces>false</stripNamespaces>
          <segmentDelimiter>\\r</segmentDelimiter>
          <convertLineBreaks>true</convertLineBreaks>
        </serializationProperties>
        <deserializationProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2DeserializationProperties" version="{{VERSION}}">
          <useStrictParser>false</useStrictParser>
          <useStrictValidation>false</useStrictValidation>
          <segmentDelimiter>\\r</segmentDelimiter>
        </deserializationProperties>
        <batchProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2BatchProperties" version="{{VERSION}}">
          <splitType>MSH_Segment</splitType>
          <batchScript></batchScript>
        </batchProperties>
        <responseGenerationProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2ResponseGenerationProperties" version="{{VERSION}}">
          <segmentDelimiter>\\r</segmentDelimiter>
          <successfulACKCode>AA</successfulACKCode>
          <successfulACKMessage></successfulACKMessage>
          <errorACKCode>AE</errorACKCode>
          <errorACKMessage>An Error Occurred Processing Message.</errorACKMessage>
          <rejectedACKCode>AR</rejectedACKCode>
          <rejectedACKMessage>Message Rejected.</rejectedACKMessage>
          <msh15ACKAccept>false</msh15ACKAccept>
          <dateFormat>yyyyMMddHHmmss.SSS</dateFormat>
        </responseGenerationProperties>
        <responseValidationProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2ResponseValidationProperties" version="{{VERSION}}">
          <successfulACKCode>AA,CA</successfulACKCode>
          <errorACKCode>AE,CE</errorACKCode>
          <rejectedACKCode>AR,CR</rejectedACKCode>
          <validateMessageControlId>true</validateMessageControlId>
          <originalMessageControlId>Destination_Encoded</originalMessageControlId>
          <originalIdMapVariable></originalIdMapVariable>
        </responseValidationProperties>
      </outboundProperties>
    </transformer>
    <filter version="{{VERSION}}">
      <elements/>
    </filter>
    <transportName>Channel Reader</transportName>
    <mode>SOURCE</mode>
    <enabled>true</enabled>
    <waitForPrevious>true</waitForPrevious>
  </sourceConnector>
  <destinationConnectors/>
  <preprocessingScript>// Modify the message variable below to pre process data
return message;</preprocessingScript>
  <postprocessingScript>// This script executes once after a message has been processed
// Responses returned from here will be stored as &quot;Postprocessor&quot; in the response map
return;</postprocessingScript>
  <deployScript>// This script executes once when the channel is deployed
// You only have access to the globalMap and globalChannelMap here to persist data
return;</deployScript>
  <undeployScript>// This script executes once when the channel is undeployed
// You only have access to the globalMap and globalChannelMap here to persist data
return;</undeployScript>
  <properties version="{{VERSION}}">
    <clearGlobalChannelMap>true</clearGlobalChannelMap>
    <messageStorageMode>DEVELOPMENT</messageStorageMode>
    <encryptData>false</encryptData>
    <encryptAttachments>false</encryptAttachments>
    <encryptCustomMetaData>false</encryptCustomMetaData>
    <removeContentOnCompletion>false</removeContentOnCompletion>
    <removeOnlyFilteredOnCompletion>false</removeOnlyFilteredOnCompletion>
    <removeAttachmentsOnCompletion>false</removeAttachmentsOnCompletion>
    <initialState>STARTED</initialState>
    <storeAttachments>true</storeAttachments>
    <metaDataColumns/>
    <attachmentProperties version="{{VERSION}}">
      <type>None</type>
      <properties/>
    </attachmentProperties>
    <resourceIds class="linked-hash-map">
      <entry>
        <string>Default Resource</string>
        <string>[Default Resource]</string>
      </entry>
    </resourceIds>
  </properties>
  <exportData>
    <metadata>
      <enabled>true</enabled>
      <pruningSettings>
        <archiveEnabled>true</archiveEnabled>
        <pruneErroredMessages>false</pruneErroredMessages>
      </pruningSettings>
      <userId>{{USER_ID}}</userId>
    </metadata>
    <dependentIds/>
    <dependencyIds/>
    <channelTags/>
  </exportData>
</channel>`;

/** Build a seeded template: replace {{VERSION}}, {{CHANNEL_ID}}, and {{USER_ID}} placeholders. */
export function buildTemplate(serverVersion: string): { xml: string; channelId: string } {
  // Stamp the server's product version, normalized to the 3-part form the server uses.
  const ver = normalizeXmlVersion(serverVersion);
  const channelId = generateUUID();
  // Use the logged-in user's ID for exportData.metadata.userId (mirrors Java UI behaviour).
  // Falls back to 1 (the default BridgeLink admin user ID) if the session doesn't have it yet.
  const userId = getSession()?.userId ?? 1;
  const xml = NEW_CHANNEL_TEMPLATE.replaceAll("{{VERSION}}", ver)
    .replace("{{CHANNEL_ID}}", channelId)
    .replace("{{USER_ID}}", String(userId));
  return { xml, channelId };
}

/**
 * Apply server-side defaults to a freshly built new-channel XML.
 * Mirrors Java's ChannelSetup new-channel logic:
 *   currentChannel.getProperties().setMetaDataColumns(serverSettings.getDefaultMetaDataColumns());
 *   if (queueBufferSize != null && queueBufferSize > 0) { defaultQueueBufferSize = queueBufferSize; }
 */
export function applyServerDefaults(xml: string, settings: ServerSettings): string {
  let result = xml;

  // Inject defaultMetaDataColumns into <channel > properties > metaDataColumns>
  const cols = settings.defaultMetaDataColumns;
  if (cols && cols.length > 0) {
    const parsed = parseSummaryFromXml(result);
    parsed.metaDataColumns = cols.map((c) => ({
      name: c.name,
      type: c.type,
      mappingName: c.mappingName,
    }));
    result = serializeSummaryToXml(result, parsed);
  }

  // Override queueBufferSize in <sourceConnectorProperties> when server has a positive value
  const bufSize = settings.queueBufferSize;
  if (bufSize != null && bufSize > 0) {
    result = result.replaceAll(
      /<queueBufferSize>\d+<\/queueBufferSize>/g,
      `<queueBufferSize>${bufSize}</queueBufferSize>`
    );
  }

  return result;
}
