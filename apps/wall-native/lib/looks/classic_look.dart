import 'package:flutter/widgets.dart';

import '../models/tap_state.dart';
import '../models/wall_config.dart';
import '../theme/srm.dart';
import '../theme/wall_theme.dart';

/// The classic tap-grid look — the Dart port of the web wall's `WallGrid` + `TapCard`. Renders
/// a responsive grid of tap cards (SRM-true liquid swatch, name, style, level bar, remaining).
/// A kicked tap renders drained + desaturated; an empty tap a quiet placeholder.
class ClassicLook extends StatelessWidget {
  const ClassicLook({super.key, required this.taps, required this.config});

  final List<TapState> taps;
  final WallConfig config;

  @override
  Widget build(BuildContext context) {
    final theme = WallThemeScope.of(context);
    return Padding(
      padding: EdgeInsets.all(theme.scaled(24)),
      child: GridView.count(
        crossAxisCount: config.columns,
        mainAxisSpacing: theme.scaled(16),
        crossAxisSpacing: theme.scaled(16),
        childAspectRatio: 2.4,
        children: [
          for (final tap in taps) _TapCard(tap: tap),
        ],
      ),
    );
  }
}

class _TapCard extends StatelessWidget {
  const _TapCard({required this.tap});

  final TapState tap;

  @override
  Widget build(BuildContext context) {
    final theme = WallThemeScope.of(context);
    final t = theme.tokens;
    final beer = tap.beer;
    final keg = tap.keg;
    final kicked = keg?.isKicked ?? false;
    final levelPct = (keg != null && !kicked) ? keg.levelPct.round() : 0;

    if (beer == null || keg == null) {
      return _card(
        theme,
        child: Center(
          child: Text('Tap ${tap.tapNumber} — Empty',
              style: TextStyle(color: t.textDim, fontSize: theme.scaled(20), fontStyle: FontStyle.italic)),
        ),
      );
    }

    final liquid = kicked ? t.textFaint : srmToColor(beer.srm);
    return _card(
      theme,
      child: Opacity(
        opacity: kicked ? 0.55 : 1,
        child: Row(
          // Stretch so the liquid swatch fills the card height without an unbounded constraint.
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // SRM-true liquid swatch.
            Container(
              width: theme.scaled(20),
              decoration: BoxDecoration(
                color: liquid,
                borderRadius: BorderRadius.circular(theme.scaled(4)),
                border: Border.all(color: t.border),
              ),
            ),
            SizedBox(width: theme.scaled(16)),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text('${tap.tapNumber}. ${beer.name}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                color: t.text, fontSize: theme.scaled(24), fontWeight: FontWeight.w600)),
                      ),
                      if (tap.pricePerPintCents != null)
                        _chip(theme, '\$${(tap.pricePerPintCents! / 100).toStringAsFixed(2)} / pint'),
                    ],
                  ),
                  if (beer.style != null)
                    Text(beer.style!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: t.textDim, fontSize: theme.scaled(15))),
                  SizedBox(height: theme.scaled(8)),
                  _levelBar(theme, kicked ? 0 : levelPct),
                  SizedBox(height: theme.scaled(4)),
                  Text(
                    kicked ? 'Kicked' : '$levelPct%  ·  ${tap.remainingPints} pints',
                    style: TextStyle(color: t.textDim, fontSize: theme.scaled(14)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _card(WallThemeScope theme, {required Widget child}) => Container(
        padding: EdgeInsets.all(theme.scaled(16)),
        decoration: BoxDecoration(
          color: theme.tokens.surface,
          borderRadius: BorderRadius.circular(theme.tokens.cardRadius),
          border: Border.all(color: theme.tokens.border),
        ),
        child: child,
      );

  Widget _levelBar(WallThemeScope theme, int pct) {
    final t = theme.tokens;
    final color = pct <= 15 ? t.danger : (pct <= 35 ? t.warn : t.ok);
    return ClipRRect(
      borderRadius: BorderRadius.circular(theme.scaled(5)),
      child: Stack(
        children: [
          Container(height: theme.scaled(9), color: t.border),
          FractionallySizedBox(
            alignment: Alignment.centerLeft,
            widthFactor: (pct / 100).clamp(0, 1).toDouble(),
            child: Container(height: theme.scaled(9), color: color),
          ),
        ],
      ),
    );
  }

  Widget _chip(WallThemeScope theme, String text) => Container(
        padding: EdgeInsets.symmetric(horizontal: theme.scaled(8), vertical: theme.scaled(2)),
        decoration: BoxDecoration(
          color: theme.tokens.accent.withOpacity(0.16),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(text,
            style: TextStyle(
                color: theme.tokens.accent, fontSize: theme.scaled(13), fontWeight: FontWeight.w600)),
      );
}
