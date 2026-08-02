import 'dart:convert';
import 'dart:io';

/// Runtime configuration for the native wall: where the server is, which wall to show, and the
/// paired display token. Resolved (in order) from `--dart-define`s, then a JSON config file the
/// installer writes to `/etc/kegwall-wall/config.json`, then defaults. Kept dependency-free.
class WallAppConfig {
  const WallAppConfig({
    required this.baseUrl,
    required this.wallSlug,
    required this.displayToken,
  });

  /// e.g. `http://localhost:8080` — the Kegwall server this kiosk talks to.
  final String baseUrl;

  /// Which wall to render (the first-run wizard always creates `main`).
  final String wallSlug;

  /// The per-display token (see db/displays.ts). Empty when token enforcement is off.
  final String displayToken;

  static const _defineBase = String.fromEnvironment('KEGWALL_BASE_URL');
  static const _defineSlug = String.fromEnvironment('KEGWALL_WALL_SLUG');
  static const _defineToken = String.fromEnvironment('KEGWALL_DISPLAY_TOKEN');

  /// Loads config, preferring compile-time `--dart-define`s, then the on-device JSON file.
  static WallAppConfig load() {
    var base = _defineBase;
    var slug = _defineSlug;
    var token = _defineToken;

    if (base.isEmpty || slug.isEmpty) {
      final file = File('/etc/kegwall-wall/config.json');
      if (file.existsSync()) {
        try {
          final json = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
          base = base.isNotEmpty ? base : (json['baseUrl'] as String? ?? '');
          slug = slug.isNotEmpty ? slug : (json['wallSlug'] as String? ?? '');
          token = token.isNotEmpty ? token : (json['displayToken'] as String? ?? '');
        } catch (_) {
          // Malformed config — fall through to defaults rather than crash the kiosk.
        }
      }
    }

    return WallAppConfig(
      baseUrl: base.isNotEmpty ? base : 'http://localhost:8080',
      wallSlug: slug.isNotEmpty ? slug : 'main',
      displayToken: token,
    );
  }

  /// The `/ws` URL with the display token in the query string (WS can't carry a header).
  Uri wsUri() {
    final http = Uri.parse(baseUrl);
    final scheme = http.scheme == 'https' ? 'wss' : 'ws';
    return http.replace(
      scheme: scheme,
      path: '/ws',
      queryParameters: displayToken.isEmpty ? null : {'token': displayToken},
    );
  }

  /// REST auth headers (the display token as a bearer, when set).
  Map<String, String> authHeaders() =>
      displayToken.isEmpty ? const {} : {'Authorization': 'Bearer $displayToken'};
}
