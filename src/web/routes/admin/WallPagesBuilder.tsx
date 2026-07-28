import type { Tap } from '../../../server/db/taps.js';
import type { WallConfig } from '../../../server/core/wallConfig.js';

type WallPage = WallConfig['pages'][number];

export interface WallPagesBuilderProps {
  pages: WallPage[];
  taps: Tap[];
  onChange: (pages: WallPage[]) => void;
}

function tapLabel(tap: Tap): string {
  return tap.name ?? `Tap ${tap.number}`;
}

/** Swaps two elements of an array (by index), returning a new array. Any out-of-range
 * index is a no-op (returns the original array) rather than throwing or corrupting it —
 * the callers below only ever compute in-range indices, but `noUncheckedIndexedAccess`
 * means TS sees `arr[i]` as possibly `undefined` regardless. */
function swap<T>(arr: T[], i: number, j: number): T[] {
  const copy = [...arr];
  const a = copy[i];
  const b = copy[j];
  if (a === undefined || b === undefined) return arr;
  copy[i] = b;
  copy[j] = a;
  return copy;
}

/**
 * The wall editor's pages builder (Task 7): add/remove pages, reorder pages, and per
 * page — a tap membership checklist plus a SEPARATE ordered list (with its own up/down
 * controls) showing the order those checked taps will render in. Membership and order
 * are deliberately split into two controls: a checkbox only ever appends a newly-checked
 * tap to the end of `tapIds`, so reordering needs its own affordance (see the plan's
 * "per-tap order up/down within a page", distinct from "tap checkboxes per page").
 *
 * An empty `pages` array or an individual page with empty `tapIds` both mean "show every
 * tap" (see `wallPages.ts`'s `resolveWallPages`) — the empty states below say so instead
 * of just rendering nothing.
 */
export function WallPagesBuilder({ pages, taps, onChange }: WallPagesBuilderProps) {
  function addPage() {
    onChange([...pages, { tapIds: [] }]);
  }

  function removePage(pageIndex: number) {
    onChange(pages.filter((_, i) => i !== pageIndex));
  }

  function movePage(pageIndex: number, direction: -1 | 1) {
    onChange(swap(pages, pageIndex, pageIndex + direction));
  }

  function toggleTap(pageIndex: number, tapId: number) {
    onChange(pages.map((page, i) => {
      if (i !== pageIndex) return page;
      const included = page.tapIds.includes(tapId);
      return {
        tapIds: included ? page.tapIds.filter((id) => id !== tapId) : [...page.tapIds, tapId],
      };
    }));
  }

  function moveTapOrder(pageIndex: number, tapIndex: number, direction: -1 | 1) {
    onChange(pages.map((page, i) => (
      i === pageIndex ? { tapIds: swap(page.tapIds, tapIndex, tapIndex + direction) } : page
    )));
  }

  return (
    <div className="wall-pages-builder" data-testid="wall-pages-builder">
      <div className="wall-pages-builder__header">
        <h2 className="admin-field__label-text">Pages</h2>
        <button type="button" data-testid="wall-pages-add" onClick={addPage}>
          Add page
        </button>
      </div>

      {pages.length === 0 && (
        <p className="admin-page-quiet" data-testid="wall-pages-empty">
          No pages yet — the wall will show every tap on one page until you add one.
        </p>
      )}

      {pages.map((page, pageIndex) => (
        // Pages have no stable identity of their own (just a position in the array), so
        // the index is the only key available — acceptable here since rows are never
        // reordered via drag-and-drop keystroke state, just replaced wholesale on change.
        // eslint-disable-next-line react/no-array-index-key -- pages have no stable id beyond position
        <div key={pageIndex} className="wall-page-block" data-testid="wall-page-block">
          <div className="wall-page-block__header">
            <span className="wall-page-block__title">{`Page ${pageIndex + 1}`}</span>
            <div className="wall-page-block__actions">
              <button
                type="button"
                data-testid="wall-page-move-up"
                disabled={pageIndex === 0}
                onClick={() => movePage(pageIndex, -1)}
              >
                Move up
              </button>
              <button
                type="button"
                data-testid="wall-page-move-down"
                disabled={pageIndex === pages.length - 1}
                onClick={() => movePage(pageIndex, 1)}
              >
                Move down
              </button>
              <button
                type="button"
                data-testid="wall-page-remove"
                onClick={() => removePage(pageIndex)}
              >
                Remove page
              </button>
            </div>
          </div>

          <div className="wall-page-block__columns">
            <div className="wall-page-block__membership">
              <span className="wall-page-block__label">Taps on this page</span>
              <ul>
                {taps.map((tap) => (
                  <li key={tap.id}>
                    <label>
                      <input
                        type="checkbox"
                        data-testid="wall-page-tap-checkbox"
                        checked={page.tapIds.includes(tap.id)}
                        onChange={() => toggleTap(pageIndex, tap.id)}
                      />
                      {tapLabel(tap)}
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div className="wall-page-block__order">
              <span className="wall-page-block__label">Order</span>
              {page.tapIds.length === 0 && (
                <p className="admin-page-quiet" data-testid="wall-page-order-empty">
                  Showing every tap — check one above to limit this page.
                </p>
              )}
              {page.tapIds.length > 0 && (
                <ol>
                  {page.tapIds.map((tapId, tapIndex) => {
                    const tap = taps.find((t) => t.id === tapId);
                    return (
                      <li key={tapId} data-testid="wall-page-order-row">
                        <span>{tap ? tapLabel(tap) : `Tap #${tapId}`}</span>
                        <button
                          type="button"
                          data-testid="wall-page-tap-move-up"
                          disabled={tapIndex === 0}
                          onClick={() => moveTapOrder(pageIndex, tapIndex, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          data-testid="wall-page-tap-move-down"
                          disabled={tapIndex === page.tapIds.length - 1}
                          onClick={() => moveTapOrder(pageIndex, tapIndex, 1)}
                        >
                          ↓
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
