import 'package:flutter/widgets.dart';

import '../models/wall_config.dart';

/// The resolved token set a look reads — the Flutter equivalent of the web wall's CSS custom
/// properties (`--bg`, `--surface`, …). Ported from `src/web/themes/themes.ts`.
@immutable
class WallTokens {
  const WallTokens({
    required this.bg,
    required this.surface,
    required this.text,
    required this.textDim,
    required this.textFaint,
    required this.accent,
    required this.border,
    required this.borderStrong,
    required this.cardRadius,
    required this.ok,
    required this.warn,
    required this.danger,
  });

  final Color bg;
  final Color surface;
  final Color text;
  final Color textDim;
  final Color textFaint;
  final Color accent;
  final Color border;
  final Color borderStrong;
  final double cardRadius;
  final Color ok;
  final Color warn;
  final Color danger;

  WallTokens withOverrides(Map<String, String> overrides) {
    Color pick(String key, Color fallback) {
      final v = overrides[key];
      return v == null ? fallback : parseColor(v, fallback);
    }

    return WallTokens(
      bg: pick('--bg', bg),
      surface: pick('--surface', surface),
      text: pick('--text', text),
      textDim: pick('--text-dim', textDim),
      textFaint: pick('--text-faint', textFaint),
      accent: pick('--accent', accent),
      border: pick('--border', border),
      borderStrong: pick('--border-strong', borderStrong),
      cardRadius: cardRadius,
      ok: pick('--ok', ok),
      warn: pick('--warn', warn),
      danger: pick('--danger', danger),
    );
  }
}

/// Parse a CSS color token: `#RRGGBB`, `#RGB`, or `rgba(r,g,b,a)`. `color-mix(...)` and other
/// functional forms fall back (the server rarely emits them in theme tokens). Never throws.
Color parseColor(String raw, Color fallback) {
  final s = raw.trim();
  if (s.startsWith('#')) {
    final hex = s.substring(1);
    if (hex.length == 6) {
      final v = int.tryParse(hex, radix: 16);
      if (v != null) return Color(0xFF000000 | v);
    } else if (hex.length == 3) {
      final r = hex[0], g = hex[1], b = hex[2];
      final v = int.tryParse('$r$r$g$g$b$b', radix: 16);
      if (v != null) return Color(0xFF000000 | v);
    }
  } else if (s.startsWith('rgba(') || s.startsWith('rgb(')) {
    final inner = s.substring(s.indexOf('(') + 1, s.length - 1);
    final parts = inner.split(',').map((p) => p.trim()).toList();
    if (parts.length >= 3) {
      final r = int.tryParse(parts[0]) ?? 0;
      final g = int.tryParse(parts[1]) ?? 0;
      final b = int.tryParse(parts[2]) ?? 0;
      final a = parts.length >= 4 ? (double.tryParse(parts[3]) ?? 1) : 1;
      return Color.fromARGB((a * 255).round(), r, g, b);
    }
  }
  return fallback;
}

const _statusDark = <String, Color>{
  '--ok': Color(0xFF57B45F),
  '--warn': Color(0xFFE7B93F),
  '--danger': Color(0xFFE05B4B),
};

final WallTokens _midnightSlate = WallTokens(
  bg: const Color(0xFF0F1216),
  surface: const Color(0x0AFFFFFF),
  text: const Color(0xFFE9EDF1),
  textDim: const Color(0xFF93A0AC),
  textFaint: const Color(0xFF6E7B87),
  accent: const Color(0xFFD08C4C),
  border: const Color(0x14FFFFFF),
  borderStrong: const Color(0x1FFFFFFF),
  cardRadius: 16,
  ok: _statusDark['--ok']!,
  warn: _statusDark['--warn']!,
  danger: _statusDark['--danger']!,
);

final WallTokens _cream = WallTokens(
  bg: const Color(0xFFF4F1EB),
  surface: const Color(0x08000000),
  text: const Color(0xFF241E17),
  textDim: const Color(0xFF6B6154),
  textFaint: const Color(0xFF938876),
  accent: const Color(0xFFB5702A),
  border: const Color(0x14000000),
  borderStrong: const Color(0x22000000),
  cardRadius: 16,
  ok: const Color(0xFF3E8E46),
  warn: const Color(0xFFB07A12),
  danger: const Color(0xFFB2402F),
);

/// Preset id → tokens. Seeded with midnight-slate + cream; the remaining 8 themes are ported
/// in the theme milestone (they fall back to midnight-slate until then).
final Map<String, WallTokens> _presets = {
  'midnight-slate': _midnightSlate,
  'cream': _cream,
};

/// Resolve a wall's theme config to a concrete token set (preset + per-wall overrides).
WallTokens resolveTokens(WallThemeConfig config) {
  final base = _presets[config.preset] ?? _midnightSlate;
  return config.overrides.isEmpty ? base : base.withOverrides(config.overrides);
}

/// Exposes the resolved tokens + per-wall UI scale to the whole look tree — the wall's
/// `--ui-scale` equivalent. Looks read `WallThemeScope.of(context)`.
class WallThemeScope extends InheritedWidget {
  const WallThemeScope({
    super.key,
    required this.tokens,
    required this.uiScale,
    required super.child,
  });

  final WallTokens tokens;
  final double uiScale;

  static WallThemeScope of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<WallThemeScope>();
    assert(scope != null, 'No WallThemeScope in the widget tree');
    return scope!;
  }

  /// Scale a base size by the per-wall UI scale (calc(Npx * var(--ui-scale)) equivalent).
  double scaled(double base) => base * uiScale;

  @override
  bool updateShouldNotify(WallThemeScope old) =>
      old.tokens != tokens || old.uiScale != uiScale;
}
