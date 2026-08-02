import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

import '../config.dart';
import '../models/tap_state.dart';
import '../models/wall_config.dart';

/// The full render state the widget tree listens to.
@immutable
class WallState {
  const WallState({
    this.config,
    this.taps = const [],
    this.allowedTapIds,
    this.units = 'us',
    this.connected = false,
    this.error,
  });

  final WallConfig? config;
  final List<TapState> taps;
  final Set<int>? allowedTapIds;
  final String units;
  final bool connected;
  final String? error;

  bool get loaded => config != null;

  WallState copyWith({
    WallConfig? config,
    List<TapState>? taps,
    Set<int>? allowedTapIds,
    String? units,
    bool? connected,
    String? error,
  }) =>
      WallState(
        config: config ?? this.config,
        taps: taps ?? this.taps,
        allowedTapIds: allowedTapIds ?? this.allowedTapIds,
        units: units ?? this.units,
        connected: connected ?? this.connected,
        error: error,
      );
}

/// Loads the wall over REST, then keeps its taps live over `/ws` (reconnecting with backoff).
/// The WS feed is global, so the wall's `allowedTapIds` is re-applied to every snapshot — the
/// same rule the browser wall follows.
class WallRepository {
  WallRepository(this.config);

  final WallAppConfig config;
  final ValueNotifier<WallState> state = ValueNotifier(const WallState());

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _sub;
  Timer? _reconnect;
  bool _disposed = false;

  Future<void> start() async {
    await _loadWall();
    _connectWs();
  }

  Future<void> _loadWall() async {
    try {
      final uri = Uri.parse('${config.baseUrl}/api/public/wall/${config.wallSlug}');
      final res = await http.get(uri, headers: config.authHeaders());
      if (res.statusCode != 200) {
        state.value = state.value.copyWith(error: 'wall load failed (${res.statusCode})');
        return;
      }
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final wall = body['wall'] as Map<String, dynamic>;
      final allowed = (body['allowedTapIds'] as List?)?.map((e) => (e as num).toInt()).toSet();
      final taps = ((body['taps'] as List?) ?? const [])
          .map((e) => TapState.fromJson(e as Map<String, dynamic>))
          .toList(growable: false);
      state.value = state.value.copyWith(
        config: WallConfig.fromJson(wall['config'] as Map<String, dynamic>),
        taps: _scoped(taps, allowed),
        allowedTapIds: allowed,
        units: body['units'] as String? ?? 'us',
      );
    } catch (e) {
      state.value = state.value.copyWith(error: 'wall load error: $e');
    }
  }

  void _connectWs() {
    if (_disposed) return;
    try {
      final channel = WebSocketChannel.connect(config.wsUri());
      _channel = channel;
      _sub = channel.stream.listen(
        _onMessage,
        onDone: _scheduleReconnect,
        onError: (_) => _scheduleReconnect(),
        cancelOnError: true,
      );
      state.value = state.value.copyWith(connected: true);
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _onMessage(dynamic raw) {
    if (raw is! String) return;
    Map<String, dynamic> msg;
    try {
      msg = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    switch (msg['type']) {
      case 'snapshot':
        final taps = ((msg['taps'] as List?) ?? const [])
            .map((e) => TapState.fromJson(e as Map<String, dynamic>))
            .toList(growable: false);
        state.value = state.value.copyWith(taps: _scoped(taps, state.value.allowedTapIds));
        break;
      case 'walls_changed':
        // Device bindings / config changed — reload the wall payload.
        _loadWall();
        break;
      default:
        break; // ping / notifications / host_stats — ignored by the wall
    }
  }

  /// Apply the wall's device scoping + drop hidden taps (the browser wall's rule).
  List<TapState> _scoped(List<TapState> taps, Set<int>? allowed) {
    var out = taps.where((t) => !t.hidden);
    if (allowed != null) out = out.where((t) => allowed.contains(t.tapId));
    return out.toList(growable: false);
  }

  void _scheduleReconnect() {
    state.value = state.value.copyWith(connected: false);
    _sub?.cancel();
    _channel = null;
    if (_disposed) return;
    _reconnect?.cancel();
    _reconnect = Timer(const Duration(seconds: 3), _connectWs);
  }

  void dispose() {
    _disposed = true;
    _reconnect?.cancel();
    _sub?.cancel();
    _channel?.sink.close();
    state.dispose();
  }
}
