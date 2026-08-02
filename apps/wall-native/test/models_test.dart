import 'package:flutter/widgets.dart' show Color;
import 'package:flutter_test/flutter_test.dart';
import 'package:kegwall_wall/models/tap_state.dart';
import 'package:kegwall_wall/models/wall_config.dart';
import 'package:kegwall_wall/theme/srm.dart';
import 'package:kegwall_wall/theme/wall_theme.dart';

void main() {
  test('TapState.fromJson parses beer/keg and derives helpers', () {
    final tap = TapState.fromJson(const {
      'tapId': 3,
      'tapNumber': 3,
      'beer': {'id': 1, 'name': 'Citra IPA', 'style': 'IPA', 'srm': 6},
      'keg': {
        'id': 1,
        'status': 'on_tap',
        'sizeMl': 19000,
        'volStartMl': 19000,
        'volDispensedMl': 4000,
        'levelPct': 79,
        'remainingMl': 15000,
      },
      'pricePerPintCents': 450,
    });
    expect(tap.beer!.name, 'Citra IPA');
    expect(tap.isActive, isTrue);
    expect(tap.remainingPints, (15000 / 473.176).round());
    expect(tap.pricePerPintCents, 450);
  });

  test('a kicked keg reads as not active', () {
    final tap = TapState.fromJson(const {
      'tapId': 1,
      'tapNumber': 1,
      'beer': {'id': 1, 'name': 'Stout'},
      'keg': {'id': 1, 'status': 'kicked', 'levelPct': 0, 'remainingMl': 0, 'sizeMl': 19000, 'volStartMl': 19000, 'volDispensedMl': 19000},
    });
    expect(tap.isActive, isFalse);
    expect(tap.keg!.isKicked, isTrue);
  });

  test('WallConfig.fromJson reads look, columns, theme and display scale', () {
    final config = WallConfig.fromJson(const {
      'look': 'ledger',
      'columns': 3,
      'theme': {'preset': 'cream', 'overrides': {'--accent': '#E7B93F'}},
      'display': {'uiScale': 1.2},
      'fields': {'labelImage': true},
    });
    expect(config.look, 'ledger');
    expect(config.columns, 3);
    expect(config.theme.preset, 'cream');
    expect(config.display.uiScale, 1.2);
    expect(config.fields['labelImage'], isTrue);
  });

  test('parseColor handles hex and rgba, srmToColor clamps', () {
    expect(parseColor('#0F1216', const Color(0xFF000000)), const Color(0xFF0F1216));
    final rgba = parseColor('rgba(255,255,255,0.04)', const Color(0xFF000000));
    expect(rgba.alpha, (0.04 * 255).round());
    // SRM clamps into range and returns a color for any input.
    expect(srmToColor(100), isNotNull);
    expect(srmToColor(null), const Color(0xFFFFE699));
  });

  test('theme override replaces only the given token', () {
    final tokens = resolveTokens(WallConfig.fromJson(const {
      'theme': {'preset': 'midnight-slate', 'overrides': {'--accent': '#57B45F'}},
    }).theme);
    expect(tokens.accent, const Color(0xFF57B45F));
    expect(tokens.bg, const Color(0xFF0F1216)); // untouched
  });
}
