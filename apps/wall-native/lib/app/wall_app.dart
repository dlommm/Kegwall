import 'package:flutter/widgets.dart';

import '../config.dart';
import '../data/wall_repository.dart';
import '../looks/wall_look.dart';
import '../models/wall_config.dart';
import '../theme/wall_theme.dart';

const _defaultTheme = WallThemeConfig(preset: 'midnight-slate');

/// Root of the native wall. Owns the repository, listens to its state, and renders the current
/// look inside a themed [WallThemeScope]. Full-screen, no chrome — this IS the kiosk surface.
class WallApp extends StatefulWidget {
  const WallApp({super.key, required this.config});
  final WallAppConfig config;

  @override
  State<WallApp> createState() => _WallAppState();
}

class _WallAppState extends State<WallApp> {
  late final WallRepository _repo;

  @override
  void initState() {
    super.initState();
    _repo = WallRepository(widget.config);
    _repo.start();
  }

  @override
  void dispose() {
    _repo.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<WallState>(
      valueListenable: _repo.state,
      builder: (context, state, _) {
        final tokens = state.config == null
            ? resolveTokens(_defaultTheme)
            : resolveTokens(state.config!.theme);
        final uiScale = state.config?.display.uiScale ?? 1.0;

        return WallThemeScope(
          tokens: tokens,
          uiScale: uiScale,
          child: Container(
            color: tokens.bg,
            child: MediaQuery(
              // Ignore the OS text scale; the wall controls its own via `uiScale`.
              data: MediaQuery.of(context).copyWith(textScaler: TextScaler.noScaling),
              child: Directionality(
                textDirection: TextDirection.ltr,
                child: _body(state),
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _body(WallState state) {
    if (state.error != null && !state.loaded) {
      return WallMessage(message: state.error!);
    }
    if (!state.loaded) {
      return const WallMessage(message: 'Connecting to the tap wall…');
    }
    if (state.taps.isEmpty) {
      return const WallMessage(message: 'No taps to show yet.');
    }
    return WallLook(taps: state.taps, config: state.config!);
  }
}
