import 'package:flutter/widgets.dart';

/// Beer color from an SRM value — the standard SRM→RGB reference table (matches the web
/// `lib/srm.ts` liquid palette closely). Clamps to 1..40; null/0 reads as a pale straw so an
/// empty/unknown tap still renders a plausible liquid.
const List<int> _srmHex = [
  0xFFFFE699, // 1
  0xFFFFD878, // 2
  0xFFFFCA5A, // 3
  0xFFFFBF42, // 4
  0xFFFBB123, // 5
  0xFFF8A600, // 6
  0xFFF39C00, // 7
  0xFFEA8F00, // 8
  0xFFE58500, // 9
  0xFFDE7C00, // 10
  0xFFD77200, // 11
  0xFFCF6900, // 12
  0xFFCB6200, // 13
  0xFFC35900, // 14
  0xFFBB5100, // 15
  0xFFB54C00, // 16
  0xFFB04500, // 17
  0xFFA63E00, // 18
  0xFFA13700, // 19
  0xFF9B3200, // 20
  0xFF952D00, // 21
  0xFF8E2900, // 22
  0xFF882300, // 23
  0xFF821E00, // 24
  0xFF7B1A00, // 25
  0xFF771900, // 26
  0xFF701400, // 27
  0xFF6A0E00, // 28
  0xFF660D00, // 29
  0xFF5E0B00, // 30
  0xFF5A0A02, // 31
  0xFF600903, // 32
  0xFF520907, // 33
  0xFF4C0505, // 34
  0xFF470606, // 35
  0xFF440607, // 36
  0xFF3F0708, // 37
  0xFF3B0607, // 38
  0xFF3A070B, // 39
  0xFF36080A, // 40
];

Color srmToColor(int? srm) {
  if (srm == null || srm <= 0) return const Color(0xFFFFE699);
  final idx = (srm.clamp(1, 40)) - 1;
  return Color(_srmHex[idx]);
}
