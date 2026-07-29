import { KEG_ASSET_IDS, KEG_ASSETS, type KegAssetId } from './kegAssets';

/**
 * The swap wizard / on-deck "add to queue" form's "Keg type" select value (keg-asset
 * fill indicator feature): `'auto'` (the default — `KegFill` auto-matches by the keg's
 * `sizeMl`, see `kegAssets.ts`'s `resolveKegAsset`) or one of the 7 real asset ids, sent
 * to the server as the keg's `kegType` (persisted as `kegs.keg_type`, migration 005).
 * `'auto'` is never itself sent to the server — see each form's submit handler, which
 * omits `kegType` from the payload entirely rather than sending the string `'auto'`.
 */
export type KegTypeSelectValue = 'auto' | KegAssetId;

export const KEG_TYPE_OPTIONS: { value: KegTypeSelectValue; label: string }[] = [
  { value: 'auto', label: 'Auto (match by size)' },
  ...KEG_ASSET_IDS.map((id) => ({ value: id, label: KEG_ASSETS[id].label })),
];
