// --- Suppliers (redesign 4l) ------------------------------------------------
import { request, type ApiResult } from '../adminHttp';

export type {
  Supplier, SupplierInput, PriceBookEntry, SupplierStats,
} from '../../../server/db/suppliers.js';

/** GET /api/suppliers — supplier list + contact data (editor role; no owner cost). */
export function listSuppliers(): Promise<ApiResult<import('../../../server/db/suppliers.js').Supplier[]>> {
  return request('/api/suppliers');
}

/** GET /api/suppliers/stats — header counts + YTD spend (admin only — owner cost). */
export function getSupplierStats(): Promise<ApiResult<import('../../../server/db/suppliers.js').SupplierStats>> {
  return request('/api/suppliers/stats');
}

/** GET /api/suppliers/:id/pricebook — derived last-paid prices (admin only — owner cost). */
export function getSupplierPriceBook(
  id: number,
): Promise<ApiResult<import('../../../server/db/suppliers.js').PriceBookEntry[]>> {
  return request(`/api/suppliers/${id}/pricebook`);
}

export function createSupplier(
  input: import('../../../server/db/suppliers.js').SupplierInput,
): Promise<ApiResult<import('../../../server/db/suppliers.js').Supplier>> {
  return request('/api/suppliers', { method: 'POST', body: JSON.stringify(input) });
}

export function updateSupplier(
  id: number, input: import('../../../server/db/suppliers.js').SupplierInput,
): Promise<ApiResult<import('../../../server/db/suppliers.js').Supplier>> {
  return request(`/api/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteSupplier(id: number): Promise<ApiResult<null>> {
  return request(`/api/suppliers/${id}`, { method: 'DELETE' });
}
