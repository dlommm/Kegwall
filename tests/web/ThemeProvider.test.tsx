import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider, THEME_SCOPE_CLASS } from '../../src/web/themes/ThemeProvider';
import { getTheme } from '../../src/web/themes/themes';

function scopeEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`.${THEME_SCOPE_CLASS}`);
  if (!el) throw new Error('theme scope element not found');
  return el;
}

describe('ThemeProvider', () => {
  it('renders its children', () => {
    const { getByText } = render(
      <ThemeProvider>
        <p>hello wall</p>
      </ThemeProvider>,
    );
    expect(getByText('hello wall')).toBeInTheDocument();
  });

  it('applies the resolved theme tokens as CSS custom properties on the scope element', () => {
    const { container } = render(
      <ThemeProvider theme={{ id: 'mono' }}>
        <p>content</p>
      </ThemeProvider>,
    );

    const el = scopeEl(container);
    const computed = getComputedStyle(el);
    const monoTokens = getTheme('mono').tokens;
    expect(computed.getPropertyValue('--bg').trim()).toBe(monoTokens['--bg']);
    expect(computed.getPropertyValue('--accent').trim()).toBe(monoTokens['--accent']);
    expect(computed.getPropertyValue('--font-display').trim()).toContain('Oswald');
  });

  it('falls back to taproom for an unknown theme id', () => {
    const { container } = render(
      <ThemeProvider theme={{ id: 'does-not-exist' }}>
        <p>content</p>
      </ThemeProvider>,
    );

    const el = scopeEl(container);
    const computed = getComputedStyle(el);
    const taproomTokens = getTheme('taproom').tokens;
    expect(computed.getPropertyValue('--bg').trim()).toBe(taproomTokens['--bg']);
    expect(el.dataset.themeId).toBe('taproom');
  });

  it('falls back to taproom when no theme prop is given at all', () => {
    const { container } = render(
      <ThemeProvider>
        <p>content</p>
      </ThemeProvider>,
    );
    expect(scopeEl(container).dataset.themeId).toBe('taproom');
  });

  it('overrides beat the base theme tokens', () => {
    const { container } = render(
      <ThemeProvider theme={{ id: 'taproom', overrides: { '--accent': '#00ff00' } }}>
        <p>content</p>
      </ThemeProvider>,
    );

    const computed = getComputedStyle(scopeEl(container));
    expect(computed.getPropertyValue('--accent').trim()).toBe('#00ff00');
    // Untouched tokens still come from the base theme.
    expect(computed.getPropertyValue('--bg').trim()).toBe(getTheme('taproom').tokens['--bg']);
  });

  it('customCss wins over both the base theme tokens and overrides', () => {
    const { container } = render(
      <ThemeProvider
        theme={{ id: 'taproom', overrides: { '--accent': '#00ff00' } }}
        customCss={`.${THEME_SCOPE_CLASS} { --accent: #ff00ff; }`}
      >
        <p>content</p>
      </ThemeProvider>,
    );

    const computed = getComputedStyle(scopeEl(container));
    expect(computed.getPropertyValue('--accent').trim()).toBe('#ff00ff');
  });

  it('renders no extra <style> tag when customCss is absent', () => {
    const { container } = render(
      <ThemeProvider theme={{ id: 'taproom' }}>
        <p>content</p>
      </ThemeProvider>,
    );
    // Exactly one <style> tag: the generated token block. No second (empty) one.
    expect(container.querySelectorAll('style')).toHaveLength(1);
  });

  it('appends a second <style> tag, after the token block, when customCss is present', () => {
    const { container } = render(
      <ThemeProvider theme={{ id: 'taproom' }} customCss=".foo { color: red; }">
        <p>content</p>
      </ThemeProvider>,
    );
    const styles = container.querySelectorAll('style');
    expect(styles).toHaveLength(2);
    expect(styles[1]?.textContent).toContain('.foo');
  });

  it('merges an extra className onto the scope element without dropping the scope class', () => {
    const { container } = render(
      <ThemeProvider theme={{ id: 'taproom' }} className="wall-root">
        <p>content</p>
      </ThemeProvider>,
    );
    const el = scopeEl(container);
    expect(el.classList.contains('wall-root')).toBe(true);
  });
});
