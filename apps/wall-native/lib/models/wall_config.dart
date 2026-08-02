// The wall's configuration, as returned by `GET /api/public/wall/:slug`. A subset of the
// server's `wallConfigSchema` — the fields the native looks actually render. Unknown fields
// are ignored so a newer server never breaks an older client.

class WallThemeConfig {
  const WallThemeConfig({required this.preset, this.overrides = const {}});

  /// Named theme (e.g. 'midnight-slate') the client maps to a token set.
  final String preset;

  /// Per-wall token overrides (e.g. {'accent': '#E7B93F'}).
  final Map<String, String> overrides;

  static WallThemeConfig fromJson(Map<String, dynamic>? j) {
    if (j == null) return const WallThemeConfig(preset: 'midnight-slate');
    final ov = <String, String>{};
    final raw = j['overrides'];
    if (raw is Map) {
      raw.forEach((k, v) {
        if (v is String) ov[k.toString()] = v;
      });
    }
    return WallThemeConfig(
      preset: j['preset'] as String? ?? 'midnight-slate',
      overrides: ov,
    );
  }
}

class WallPage {
  const WallPage({required this.tapIds});
  final List<int> tapIds;

  static WallPage fromJson(Map<String, dynamic> j) => WallPage(
        tapIds: ((j['tapIds'] as List?) ?? const [])
            .map((e) => (e as num).toInt())
            .toList(growable: false),
      );
}

class DisplayConfig {
  const DisplayConfig({this.uiScale = 1.0});
  final double uiScale;

  static DisplayConfig fromJson(Map<String, dynamic>? j) => DisplayConfig(
        uiScale: (j?['uiScale'] as num?)?.toDouble() ?? 1.0,
      );
}

class WallConfig {
  const WallConfig({
    required this.look,
    required this.columns,
    required this.cardTemplate,
    required this.fillStyle,
    required this.theme,
    required this.fields,
    required this.pages,
    required this.rotationSeconds,
    required this.transition,
    required this.display,
    this.ticker,
    this.takeoverStyle = 'off',
  });

  final String look; // classic | ledger | gallery | columns | chalkboard | ...
  final int columns;
  final String cardTemplate;
  final String fillStyle; // liquid | keg
  final WallThemeConfig theme;
  final Map<String, bool> fields;
  final List<WallPage> pages;
  final int rotationSeconds;
  final String transition;
  final DisplayConfig display;
  final String? ticker;
  final String takeoverStyle; // off | full | spotlight | split | dock | fill

  static WallConfig fromJson(Map<String, dynamic> j) {
    final fields = <String, bool>{};
    final rawFields = j['fields'];
    if (rawFields is Map) {
      rawFields.forEach((k, v) {
        if (v is bool) fields[k.toString()] = v;
      });
    }
    return WallConfig(
      look: j['look'] as String? ?? 'classic',
      columns: (j['columns'] as num?)?.toInt() ?? 2,
      cardTemplate: j['cardTemplate'] as String? ?? 'standard',
      fillStyle: j['fillStyle'] as String? ?? 'liquid',
      theme: WallThemeConfig.fromJson(j['theme'] as Map<String, dynamic>?),
      fields: fields,
      pages: ((j['pages'] as List?) ?? const [])
          .map((e) => WallPage.fromJson(e as Map<String, dynamic>))
          .toList(growable: false),
      rotationSeconds: (j['rotationSeconds'] as num?)?.toInt() ?? 15,
      transition: j['transition'] as String? ?? 'crossfade',
      display: DisplayConfig.fromJson(j['display'] as Map<String, dynamic>?),
      ticker: j['ticker'] as String?,
      takeoverStyle: (j['takeover'] as Map<String, dynamic>?)?['style'] as String? ?? 'off',
    );
  }
}
