import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { WallPagesBuilder } from '../../../src/web/routes/admin/WallPagesBuilder';
import type { Tap } from '../../../src/server/db/taps';

const taps: Tap[] = [
  { id: 1, number: 1, name: 'Left' },
  { id: 2, number: 2, name: 'Right' },
  { id: 3, number: 3, name: null },
];

describe('WallPagesBuilder', () => {
  it('shows a quiet empty state and an Add page control when there are no pages yet', () => {
    const onChange = vi.fn();
    render(<WallPagesBuilder pages={[]} taps={taps} onChange={onChange} />);
    expect(screen.getByTestId('wall-pages-empty')).toBeInTheDocument();
    expect(screen.getByTestId('wall-pages-add')).toBeInTheDocument();
  });

  it('Add page appends an empty page', () => {
    const onChange = vi.fn();
    render(<WallPagesBuilder pages={[]} taps={taps} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('wall-pages-add'));
    expect(onChange).toHaveBeenCalledWith([{ tapIds: [] }]);
  });

  it('renders one block per page, with 1-based page numbering', () => {
    const onChange = vi.fn();
    render(
      <WallPagesBuilder
        pages={[{ tapIds: [1] }, { tapIds: [2, 3] }]}
        taps={taps}
        onChange={onChange}
      />,
    );
    const blocks = screen.getAllByTestId('wall-page-block');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toHaveTextContent('Page 1');
    expect(blocks[1]).toHaveTextContent('Page 2');
  });

  it('Remove page drops that page and keeps the others', () => {
    const onChange = vi.fn();
    render(
      <WallPagesBuilder
        pages={[{ tapIds: [1] }, { tapIds: [2] }]}
        taps={taps}
        onChange={onChange}
      />,
    );
    const blocks = screen.getAllByTestId('wall-page-block');
    fireEvent.click(within(blocks[0]!).getByTestId('wall-page-remove'));
    expect(onChange).toHaveBeenCalledWith([{ tapIds: [2] }]);
  });

  it('Move down/up reorders pages, disabled at the ends', () => {
    const onChange = vi.fn();
    render(
      <WallPagesBuilder
        pages={[{ tapIds: [1] }, { tapIds: [2] }, { tapIds: [3] }]}
        taps={taps}
        onChange={onChange}
      />,
    );
    const blocks = screen.getAllByTestId('wall-page-block');
    expect(within(blocks[0]!).getByTestId('wall-page-move-up')).toBeDisabled();
    expect(within(blocks[2]!).getByTestId('wall-page-move-down')).toBeDisabled();

    fireEvent.click(within(blocks[1]!).getByTestId('wall-page-move-up'));
    expect(onChange).toHaveBeenCalledWith([{ tapIds: [2] }, { tapIds: [1] }, { tapIds: [3] }]);

    onChange.mockClear();
    fireEvent.click(within(blocks[1]!).getByTestId('wall-page-move-down'));
    expect(onChange).toHaveBeenCalledWith([{ tapIds: [1] }, { tapIds: [3] }, { tapIds: [2] }]);
  });

  it('checking a tap adds it to that page (appended to the order); unchecking removes it', () => {
    const onChange = vi.fn();
    render(
      <WallPagesBuilder
        pages={[{ tapIds: [1] }]}
        taps={taps}
        onChange={onChange}
      />,
    );
    const block = screen.getByTestId('wall-page-block');
    const checkboxes = within(block).getAllByTestId('wall-page-tap-checkbox');
    // taps[0] (Left) is already checked; taps[2] (Tap 3) is not.
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[2]).not.toBeChecked();

    fireEvent.click(checkboxes[2]!); // check "Tap 3"
    expect(onChange).toHaveBeenCalledWith([{ tapIds: [1, 3] }]);

    onChange.mockClear();
    fireEvent.click(checkboxes[0]!); // uncheck "Left"
    expect(onChange).toHaveBeenCalledWith([{ tapIds: [] }]);
  });

  it('shows the page order as a separate ordered list matching tapIds order, with per-tap up/down', () => {
    const onChange = vi.fn();
    render(
      <WallPagesBuilder
        pages={[{ tapIds: [2, 1] }]}
        taps={taps}
        onChange={onChange}
      />,
    );
    const orderRows = screen.getAllByTestId('wall-page-order-row');
    expect(orderRows).toHaveLength(2);
    expect(orderRows[0]).toHaveTextContent('Right');
    expect(orderRows[1]).toHaveTextContent('Left');

    // First row can't move up, last row can't move down.
    expect(within(orderRows[0]!).getByTestId('wall-page-tap-move-up')).toBeDisabled();
    expect(within(orderRows[1]!).getByTestId('wall-page-tap-move-down')).toBeDisabled();

    fireEvent.click(within(orderRows[1]!).getByTestId('wall-page-tap-move-up'));
    expect(onChange).toHaveBeenCalledWith([{ tapIds: [1, 2] }]);
  });

  it('an empty tapIds page notes it shows every tap, with no order list', () => {
    const onChange = vi.fn();
    render(<WallPagesBuilder pages={[{ tapIds: [] }]} taps={taps} onChange={onChange} />);
    expect(screen.getByTestId('wall-page-order-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('wall-page-order-row')).not.toBeInTheDocument();
  });
});
