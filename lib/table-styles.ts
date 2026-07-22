/**
 * Shared table header styling constants.
 *
 * Use TABLE_HEADER_CLS on the <thead> or header <tr>/<div>.
 * Use TABLE_TH_CLS on each individual <th> cell.
 *
 * These are also re-exported from @/components/sortable-header-cell so tables
 * that already import SortableHeaderCell can get everything from one place.
 *
 * To change the header color application-wide, edit only this file.
 */

/** BridgeLink-blue background + bottom separator — apply to thead or header tr/div. */
export const TABLE_HEADER_CLS = "bg-[#1B3D6D] border-b border-[#0F2542]";

/** White text + right column separator — apply to each th in a custom table header. */
export const TABLE_TH_CLS = "text-white border-r border-white/20 last:border-r-0";
