import 'package:flutter/widgets.dart';

import '../models/tap_state.dart';
import '../models/wall_config.dart';
import '../theme/wall_theme.dart';
import 'classic_look.dart';

/// Dispatches to the widget for the wall's configured look — the Dart port of the web
/// `WallLook.tsx`. Milestone 1 ships `classic`; the other 10 looks (ledger/gallery/columns +
/// the 7 style looks) land in the subsequent milestones and slot in here. Until then an
/// unimplemented look falls back to the classic grid so the wall always renders something.
class WallLook extends StatelessWidget {
  const WallLook({super.key, required this.taps, required this.config});

  final List<TapState> taps;
  final WallConfig config;

  @override
  Widget build(BuildContext context) {
    switch (config.look) {
      case 'classic':
      default:
        return ClassicLook(taps: taps, config: config);
    }
  }
}

/// A quiet full-screen message (loading / error / empty), themed.
class WallMessage extends StatelessWidget {
  const WallMessage({super.key, required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    final t = WallThemeScope.of(context).tokens;
    return Center(
      child: Text(message, style: TextStyle(color: t.textDim, fontSize: 22)),
    );
  }
}
