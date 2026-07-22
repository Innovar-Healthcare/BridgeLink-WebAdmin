// Business Source License (BSL) information surfaced in the About dialog.
//
// Keep LICENSE_TEXT in sync with the canonical repo-root LICENSE file — that file
// is the GitHub-recognized legal artifact, this constant is what the UI renders.

export const LICENSE_NAME = "Business Source License 1.1";

export const SUPPLEMENTAL_TERMS_NAME = "Supplemental Terms";

// Keep SUPPLEMENTAL_TERMS_TEXT in sync (substance) with the repo-root
// SUPPLEMENTAL-TERMS.md file. These Terms are separate from, and not part of,
// the License (see Section 1); they govern obtaining the Licensed Work from Innovar.
export const SUPPLEMENTAL_TERMS_TEXT = `BridgeLink WebAdmin — Supplemental Terms
Effective Date: 07/20/2026    Version 1.0

1. Scope; Relationship to the Business Source License

These Supplemental Terms ("Terms") govern your access to and use of Innovar
Healthcare Systems Group's ("Innovar," "Licensor," "we") websites, download
services, and distribution channels for BridgeLink WebAdmin (the "Licensed
Work"), and apply to your relationship with Innovar in connection with obtaining
the Licensed Work from us. The Licensed Work itself is licensed under the
Business Source License 1.1 (the "License"). These Terms do not modify the
License, do not condition or restrict any rights granted under the License, and
are not part of the License. In the event of any conflict between these Terms and
the License with respect to rights in the Licensed Work, the License controls.

2. No Creation of Business Associate Relationship

Neither the License nor these Terms creates a Business Associate relationship, as
defined under HIPAA, between you and Innovar, and neither is intended to address
any processing or handling of Protected Health Information (PHI) or operate as a
Business Associate Agreement (BAA). If your deployment of the Licensed Work
involves PHI, you are solely responsible for your own HIPAA compliance, and any
Business Associate relationship with Innovar exists only if and to the extent
established under a separately executed BAA.

3. Limitation of Liability

You agree that Innovar shall not be liable for any consequential, punitive, or
special damages arising out of or relating to your download or use of the
Licensed Work or these Terms, even if such damages were foreseeable and even if
such damages were warned of. The Licensed Work is provided "AS IS" as further
described in the License.

4. Relationship to BridgeLink Engine Agreements

Any license or rights you hold in the BridgeLink integration engine are granted
under, and governed exclusively by, your separate agreement(s) with Innovar for
the BridgeLink integration engine. Nothing in the License or these Terms expands
those rights. Innovar reserves all rights and remedies available under such
agreements, at law, and in equity, including with respect to any use of the
Licensed Work outside the scope of the License's Additional Use Grant.

5. Waiver

No failure or decision to abstain from enforcing rights held by either party
under these Terms shall be deemed to be a waiver of such rights. Any waiver of
such rights must be in writing and, absent language to the contrary, shall only
apply to the specific events discussed or referenced in such waiver.

6. Governing Law; Venue

These Terms shall be governed by the laws of the State of Alabama, without regard
to its conflict of laws principles. Subject to Section 7 (Arbitration), you agree
to bring any action arising under or related to these Terms only in the state or
federal courts located in Mobile, Alabama.

7. Arbitration

You agree that any dispute or action arising under or related to these Terms
shall be subject to mandatory binding arbitration, to take place in Mobile,
Alabama, and to be administered in accordance with the American Arbitration
Association's rules and procedures for arbitration.

8. Waiver of Jury Trial

EACH PARTY HEREBY WAIVES ITS RIGHT TO A TRIAL BY JURY FOR ANY DISPUTE OR ACTION
UNDER THESE TERMS.

9. Contact

Questions about these Terms or commercial licensing of the Licensed Work:
license@innovarhealthcare.com.`;

export const LICENSE_TEXT = `Business Source License 1.1

License text copyright © 2024 MariaDB plc, All Rights Reserved.
"Business Source License" is a trademark of MariaDB plc.

-----------------------------------------------------------------------------

Parameters

Licensor:      Innovar Healthcare Systems Group

Licensed Work: BridgeLink WebAdmin.
               The Licensed Work is © 2026 Innovar Healthcare Systems Group.

Additional Use Grant:

Production use of the Licensed Work is permitted under this grant only where the
Licensed Work is used as a user interface or operational layer for the BridgeLink
integration engine, and only as expressly set out below. Use of the Licensed Work
as a user interface or operational layer for any other integration engine,
middleware, or competing product is outside the scope of this grant and, like any
production use not granted herein, requires a separate commercial license from the
Licensor.

The Licensor grants you the right to use the Licensed Work in production, provided
such use is limited to:

(1) internal use within your organization, not including your affiliates or
    subsidiaries unless such entities also agree to the terms of this license;

(2) deployment for a specific end customer in a single-tenant environment, where
    such customer has exclusive use of the instance and independently controls and
    operates the Licensed Work, including its configuration, administration, and
    ongoing operation;

(3) development, use, distribution, and commercial licensing of extensions or
    modifications that interoperate with the Licensed Work, provided such extensions
    do not include or redistribute the Licensed Work itself in a way that enables
    production use beyond the scope of this grant;

(4) use of the Licensed Work to deliver implementation or integration services,
    provided that control of the Licensed Work is transferred to the end customer
    upon deployment within 180 days of the installation; in the event that such
    transfer does not occur within 180 days, you shall be required to obtain a
    commercial license to continue such use.

Any production use of the Licensed Work that is not expressly permitted above
requires a separate license from the Licensor. Permitted uses under this Additional
Use Grant are determined by how the Licensed Work is used, rather than whether the
use is commercial. For the avoidance of doubt, the following are examples of uses
that are not within the scope of this grant:

  - offering the Licensed Work as part of a hosted, managed, or SaaS offering to
    third parties (OEM use);
  - operating, administering, monitoring, or controlling the Licensed Work on behalf
    of third parties (OEM use);
  - embedding, integrating, or including the Licensed Work within any product,
    device, or system provided to third parties (OEM use);
  - distributing or provisioning the Licensed Work as part of a standardized or
    repeatable offering across multiple customers (OEM use);
  - using the Licensed Work as the primary or substantial basis of another
    integration engine or integration platform (Competing Use).

OEM use requires an OEM license from the Licensor. Competing Use, and any use of the
Licensed Work as a user interface or operational layer for an integration engine
other than BridgeLink, requires a separate commercial license from the Licensor.

Definitions (for the purposes of this Additional Use Grant):

"SaaS" means providing access to the functionality of the Licensed Work to third
parties over a network where those third parties do not directly control and operate
their own independent instance.

"Competing Use" means: (a) use of the Licensed Work as a user interface or
operational layer for any integration engine other than BridgeLink; or (b) use of
the Licensed Work, in whole or in substantial part, as the basis for a competing
integration engine, interoperability platform, middleware platform, or other similar
product.

"Middleware" means any software used to connect two applications, databases, or
operating systems to allow the transfer of data and information.

"On behalf of" means any situation where someone other than the end customer retains
the ability to access, administer, manage, update, monitor, or control the Licensed
Work after deployment.

"Single-tenant" means an instance dedicated exclusively to one end customer who has
full operational control. It does not qualify as single-tenant if any third party
retains administrative or management access.

"Control of the Licensed Work is transferred to the end customer upon deployment"
means the end customer holds exclusive administrative credentials and operational
control of the Licensed Work. Any continuing access by the integrator or service
provider is limited solely to customer-directed support and maintenance.

"OEM use" means embedding, integrating, or including the Licensed Work within a
product, device, system, or service provided to third parties, or hosting,
operating, administering, or maintaining the Licensed Work on behalf of third
parties, including hosted, managed, or SaaS offerings and provisioning across
multiple customer environments.

Change Date:    The third anniversary of the first publicly available distribution
                of each specific version of the Licensed Work under this License.

Change License: Mozilla Public License, version 2.0

For information about alternative licensing arrangements for the Licensed Work,
please contact license@innovarhealthcare.com.

-----------------------------------------------------------------------------

Terms

The Licensor hereby grants you the right to copy, modify, create derivative works,
redistribute, and make non-production use of the Licensed Work. The Licensor may
make an Additional Use Grant, above, permitting limited production use.

Effective on the Change Date, or the fourth anniversary of the first publicly
available distribution of a specific version of the Licensed Work under this
License, whichever comes first, the Licensor hereby grants you rights under the
terms of the Change License, and the rights granted in the paragraph above
terminate.

If your use of the Licensed Work does not comply with the requirements currently in
effect as described in this License, you must purchase a commercial license from the
Licensor, its affiliated entities, or authorized resellers, or you must refrain from
using the Licensed Work.

All copies of the original and modified Licensed Work, and derivative works of the
Licensed Work, are subject to this License. This License applies separately for each
version of the Licensed Work and the Change Date may vary for each version of the
Licensed Work released by Licensor.

You must conspicuously display this License on each original or modified copy of the
Licensed Work. If you receive the Licensed Work in original or modified form from a
third party, the terms and conditions set forth in this License apply to your use of
that work.

Any use of the Licensed Work in violation of this License will automatically
terminate your rights under this License for the current and all other versions of
the Licensed Work.

This License does not grant you any right in any trademark or logo of Licensor or
its affiliates (provided that you may use a trademark or logo of Licensor as
expressly required by this License).

TO THE EXTENT PERMITTED BY APPLICABLE LAW, THE LICENSED WORK IS PROVIDED ON AN "AS
IS" BASIS. LICENSOR HEREBY DISCLAIMS ALL WARRANTIES AND CONDITIONS, EXPRESS OR
IMPLIED, INCLUDING (WITHOUT LIMITATION) WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE, NON-INFRINGEMENT, AND TITLE.

MariaDB hereby grants you permission to use this License's text to license your
works, and to refer to it using the trademark "Business Source License", as long as
you comply with the Covenants of Licensor below.

Covenants of Licensor

In consideration of the right to use this License's text and the "Business Source
License" name and trademark, Licensor covenants to MariaDB, and to all other
recipients of the licensed work to be provided by Licensor:

1. To specify as the Change License the GPL Version 2.0 or any later version, or a
   license that is compatible with GPL Version 2.0 or a later version, where
   "compatible" means that software provided under the Change License can be included
   in a program with software provided under GPL Version 2.0 or a later version.
   Licensor may specify additional Change Licenses without limitation.

2. To either: (a) specify an additional grant of rights to use that does not impose
   any additional restriction on the right granted in this License, as the Additional
   Use Grant; or (b) insert the text "None".

3. To specify a Change Date.

4. Not to modify this License in any other way.

Notice

The Business Source License (this document, or the "License") is not an Open Source
license. However, the Licensed Work will eventually be made available under an Open
Source License, as stated in this License.
`;
